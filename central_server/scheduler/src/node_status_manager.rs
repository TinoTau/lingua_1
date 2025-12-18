use crate::config::NodeHealthConfig;
use crate::messages::{NodeStatus, ModelStatus};
use crate::node_registry::{Node, NodeRegistry};
use crate::connection_manager::NodeConnectionManager;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn, debug};
use chrono::Utc;

/// 节点状态管理器
/// 负责节点状态转换、健康检查和定期扫描
pub struct NodeStatusManager {
    node_registry: Arc<NodeRegistry>,
    node_connections: Arc<NodeConnectionManager>,
    config: NodeHealthConfig,
    /// 节点健康检查历史（用于判断 registering → ready）
    /// key: node_id, value: (连续正常心跳次数, 注册时间)
    health_check_history: Arc<RwLock<std::collections::HashMap<String, (usize, chrono::DateTime<chrono::Utc>)>>>,
    /// 节点失败历史（用于判断 ready → degraded）
    /// key: node_id, value: (失败窗口, 连续失败次数)
    failure_history: Arc<RwLock<std::collections::HashMap<String, (Vec<bool>, usize)>>>,
}

impl NodeStatusManager {
    pub fn new(
        node_registry: Arc<NodeRegistry>,
        node_connections: Arc<NodeConnectionManager>,
        config: NodeHealthConfig,
    ) -> Self {
        Self {
            node_registry,
            node_connections,
            config,
            health_check_history: Arc::new(RwLock::new(std::collections::HashMap::new())),
            failure_history: Arc::new(RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// 处理节点心跳（立即触发状态检查）
    pub async fn on_heartbeat(&self, node_id: &str) {
        let nodes = self.node_registry.nodes.read().await;
        let node = match nodes.get(node_id) {
            Some(n) => n.clone(),
            None => return,
        };
        drop(nodes);

        // 执行健康检查
        let health_ok = self.check_node_health(&node).await;
        
        // 根据当前状态和健康检查结果，决定是否转换状态
        match node.status {
            NodeStatus::Registering => {
                if health_ok {
                    // 更新健康检查历史
                    let mut history = self.health_check_history.write().await;
                    let entry = history.entry(node_id.to_string()).or_insert_with(|| {
                        (0, node.last_heartbeat)
                    });
                    entry.0 += 1;
                    
                    // 检查是否满足 registering → ready 条件
                    if entry.0 >= self.config.health_check_count {
                        self.transition_status(node_id, NodeStatus::Registering, NodeStatus::Ready, Some("Health check passed".to_string())).await;
                        history.remove(node_id);
                    }
                } else {
                    // 健康检查失败，重置计数
                    let mut history = self.health_check_history.write().await;
                    history.remove(node_id);
                }
            }
            NodeStatus::Ready => {
                if !health_ok {
                    // 记录失败
                    self.record_failure(node_id).await;
                    
                    // 检查是否满足 ready → degraded 条件
                    if self.should_degrade(node_id).await {
                        self.transition_status(node_id, NodeStatus::Ready, NodeStatus::Degraded, Some("Health check failed".to_string())).await;
                    }
                } else {
                    // 健康检查通过，清除失败记录
                    let mut failure_history = self.failure_history.write().await;
                    failure_history.remove(node_id);
                }
            }
            NodeStatus::Degraded => {
                if health_ok {
                    // 恢复健康，转回 ready
                    self.transition_status(node_id, NodeStatus::Degraded, NodeStatus::Ready, Some("Health recovered".to_string())).await;
                    let mut failure_history = self.failure_history.write().await;
                    failure_history.remove(node_id);
                }
            }
            _ => {
                // draining 和 offline 状态不处理心跳
            }
        }
    }

    /// 记录节点失败
    async fn record_failure(&self, node_id: &str) {
        let mut failure_history = self.failure_history.write().await;
        let entry = failure_history.entry(node_id.to_string()).or_insert_with(|| {
            (Vec::new(), 0)
        });
        
        // 添加到失败窗口
        entry.0.push(true);
        if entry.0.len() > self.config.failure_threshold.window_size {
            entry.0.remove(0);
        }
        
        // 更新连续失败次数
        entry.1 += 1;
    }

    /// 检查是否应该降级（ready → degraded）
    async fn should_degrade(&self, node_id: &str) -> bool {
        let failure_history = self.failure_history.read().await;
        if let Some((window, consecutive)) = failure_history.get(node_id) {
            // 检查连续失败次数
            if *consecutive >= self.config.failure_threshold.consecutive_failure_count {
                return true;
            }
            
            // 检查窗口内失败次数
            let failure_count = window.iter().filter(|&&x| x).count();
            if failure_count >= self.config.failure_threshold.failure_count {
                return true;
            }
        }
        false
    }

    /// 检查节点健康状态
    /// 
    /// 健康检查条件：
    /// 1. GPU 可用（所有节点都必须有 GPU）
    /// 2. 必需模型 ready
    async fn check_node_health(&self, node: &Node) -> bool {
        // 检查 GPU 可用性
        if node.hardware.gpus.is_none() || node.hardware.gpus.as_ref().unwrap().is_empty() {
            warn!(node_id = %node.node_id, "Node health check failed: No GPU");
            return false;
        }
        
        // 检查 GPU 使用率是否异常（超过 100% 或为负值）
        if let Some(gpu_usage) = node.gpu_usage {
            if gpu_usage < 0.0 || gpu_usage > 100.0 {
                warn!(
                    node_id = %node.node_id,
                    gpu_usage = gpu_usage,
                    "Node health check failed: GPU usage out of range (must be 0-100%)"
                );
                return false;
            }
        } else {
            warn!(node_id = %node.node_id, "Node health check failed: GPU usage is None");
            return false;
        }
        
        // Phase 1：capability_state key 语义统一为 service_id
        // - registering：要求节点已上报 installed_services，且这些 service_id 在 capability_state 中均为 Ready
        // - ready/degraded：要求 capability_state 中至少存在一个 Ready（避免空状态误判健康）
        let services_ready = if node.status == NodeStatus::Registering {
            if node.installed_services.is_empty() {
                warn!(node_id = %node.node_id, "Node health check failed: installed_services is empty (Phase1 strict)");
                return false;
            }
            node.installed_services.iter().all(|svc| {
                node.capability_state
                    .get(&svc.service_id)
                    .map(|status| status == &ModelStatus::Ready)
                    .unwrap_or(false)
            })
        } else {
            !node.capability_state.is_empty()
                && node.capability_state.values().any(|status| status == &ModelStatus::Ready)
        };
        
        if !services_ready {
            warn!(
                node_id = %node.node_id,
                status = ?node.status,
                installed_services_count = node.installed_services.len(),
                capability_state_count = node.capability_state.len(),
                "Node health check failed: Services not ready"
            );
            // 记录详细的服务状态
            if !node.capability_state.is_empty() {
                for (service_id, status) in &node.capability_state {
                    debug!(node_id = %node.node_id, service_id = %service_id, status = ?status, "Service status");
                }
            }
            return false;
        }
        
        true
    }

    /// 转换节点状态
    async fn transition_status(
        &self,
        node_id: &str,
        from: NodeStatus,
        to: NodeStatus,
        reason: Option<String>,
    ) {
        let mut nodes = self.node_registry.nodes.write().await;
        if let Some(node) = nodes.get_mut(node_id) {
            if node.status != from {
                // 状态已经改变，不执行转换
                return;
            }
            
            let old_status = node.status.clone();
            node.status = to.clone();
            drop(nodes);
            
            info!(
                node_id = node_id,
                from = ?old_status,
                to = ?to,
                reason = reason.as_deref(),
                "Node status transition"
            );
            
            // 发送 node_status 消息（最小版）
            let status_str = match to {
                NodeStatus::Registering => "registering",
                NodeStatus::Ready => "ready",
                NodeStatus::Degraded => "degraded",
                NodeStatus::Draining => "draining",
                NodeStatus::Offline => "offline",
            };
            
            // 构造 node_status 消息（最小版）
            let status_msg = serde_json::json!({
                "type": "node_status",
                "node_id": node_id,
                "status": status_str,
                "reason": reason,
                "timestamp": Utc::now().timestamp(),
            });
            
            // 发送消息到节点（如果连接存在）
            if let Some(tx) = self.node_connections.get_sender(node_id).await {
                use axum::extract::ws::Message;
                if let Ok(json) = serde_json::to_string(&status_msg) {
                    if let Err(e) = tx.send(Message::Text(json)) {
                        warn!("发送 node_status 消息到节点 {} 失败: {}", node_id, e);
                    }
                }
            }
        }
    }

    /// 定期扫描（兜底处理）
    /// 处理超时、offline、warmup 超时等情况
    pub async fn periodic_scan(&self) {
        let now = Utc::now();
        let nodes = self.node_registry.nodes.read().await;
        let node_ids: Vec<String> = nodes.keys().cloned().collect();
        drop(nodes);

        for node_id in node_ids {
            let nodes = self.node_registry.nodes.read().await;
            let node = match nodes.get(&node_id) {
                Some(n) => n.clone(),
                None => continue,
            };
            drop(nodes);

            // 检查心跳超时（any → offline）
            let heartbeat_timeout = chrono::Duration::seconds(self.config.heartbeat_timeout_seconds as i64);
            if now.signed_duration_since(node.last_heartbeat) > heartbeat_timeout {
                if node.status != NodeStatus::Offline {
                    self.transition_status(&node_id, node.status.clone(), NodeStatus::Offline, Some("心跳超时".to_string())).await;
                }
                continue;
            }

            // 检查 warmup 超时（registering → degraded）
            // 使用节点的注册时间，而不是 health_check_history，因为健康检查失败时 history 会被移除
            if node.status == NodeStatus::Registering {
                let warmup_timeout = chrono::Duration::seconds(self.config.warmup_timeout_seconds as i64);
                if now.signed_duration_since(node.registered_at) > warmup_timeout {
                    self.transition_status(&node_id, NodeStatus::Registering, NodeStatus::Degraded, Some("warmup 超时".to_string())).await;
                    // 清理 health_check_history（如果存在）
                    let mut history = self.health_check_history.write().await;
                    history.remove(&node_id);
                }
            }
        }
    }

    /// 启动定期扫描任务
    pub fn start_periodic_scan(&self) {
        let manager = self.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(manager.config.status_scan_interval_seconds));
            loop {
                interval.tick().await;
                manager.periodic_scan().await;
            }
        });
    }
}

impl Clone for NodeStatusManager {
    fn clone(&self) -> Self {
        Self {
            node_registry: self.node_registry.clone(),
            node_connections: self.node_connections.clone(),
            config: self.config.clone(),
            health_check_history: self.health_check_history.clone(),
            failure_history: self.failure_history.clone(),
        }
    }
}

