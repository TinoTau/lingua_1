use axum::extract::ws::Message;
use crate::core::config::NodeHealthConfig;
use crate::messages::NodeStatus;
use crate::node_registry::{Node, NodeRegistry};
use super::NodeConnectionManager;
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
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    pub async fn on_heartbeat(&self, node_id: &str) {
        // 使用 ManagementRegistry（统一管理锁）
        let node = {
            let mgmt = self.node_registry.management_registry.read().await;
            mgmt.nodes.get(node_id).map(|state| state.node.clone())
        };
        let node = match node {
            Some(n) => n,
            None => return,
        };

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
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
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
    #[allow(dead_code)] // 当前未使用，保留用于未来扩展
    async fn check_node_health(&self, node: &Node) -> bool {
        // 检查 GPU 可用性
        if node.hardware.gpus.is_none() || node.hardware.gpus.as_ref().unwrap().is_empty() {
            warn!(node_id = %node.node_id, "Node health check failed: No GPU");
            return false;
        }
        
        // 检查 GPU 使用率是否异常（超过 100% 或为负值）
        // 注意：update_node_heartbeat 会将 None 转换为 Some(0.0)，所以这里应该总是有值
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
            // 这种情况不应该发生，因为 update_node_heartbeat 会将 None 转换为 Some(0.0)
            // 但如果发生了，记录警告并使用 0.0 作为默认值
            warn!(
                node_id = %node.node_id,
                "Node health check: GPU usage is None (unexpected), using 0.0 as default"
            );
            // 不返回 false，允许节点继续健康检查
        }
        
        // 按类型检查能力：registering 阶段要求已上报 installed_services，且核心类型（ASR、NMT、TTS）ready=true；ready/degraded 阶段要求至少有一个类型 ready
        // 注意：TONE 是可选的，不参与 registering 阶段的健康检查
        let services_ready = if node.status == NodeStatus::Registering {
            if node.installed_services.is_empty() {
                warn!(node_id = %node.node_id, "Node health check failed: installed_services is empty (type schema)");
                return false;
            }
            // 只检查核心服务类型（ASR、NMT、TTS），TONE 是可选的
            let core_types = vec![
                crate::messages::ServiceType::Asr,
                crate::messages::ServiceType::Nmt,
                crate::messages::ServiceType::Tts,
            ];
            // 检查节点是否安装了核心类型，如果安装了，则要求状态为 Running
            // 注意：节点能力信息已迁移到 Redis，这里使用 installed_services 作为替代
            let mut has_core_type = false;
            let mut all_core_ready = true;
            for core_type in &core_types {
                let has_installed = node.installed_services.iter().any(|s| s.r#type == *core_type);
                if has_installed {
                    has_core_type = true;
                    // 检查服务状态是否为 Running
                    let is_ready = node.installed_services
                        .iter()
                        .any(|s| s.r#type == *core_type && s.status == crate::messages::ServiceStatus::Running);
                    if !is_ready {
                        all_core_ready = false;
                    }
                }
            }
            // 必须至少有一个核心类型，且所有已安装的核心类型都必须 Running
            has_core_type && all_core_ready
        } else {
            // ready/degraded 阶段：至少有一个服务状态为 Running
            !node.installed_services.is_empty()
                && node.installed_services.iter().any(|s| s.status == crate::messages::ServiceStatus::Running)
        };
        
        if !services_ready {
            warn!(
                node_id = %node.node_id,
                status = ?node.status,
                installed_services_count = node.installed_services.len(),
                "Node health check failed: Services not ready（使用 installed_services 检查）"
            );
            // 记录详细的服务状态
            for service in &node.installed_services {
                debug!(
                    node_id = %node.node_id,
                    service_id = %service.service_id,
                    service_type = ?service.r#type,
                    status = ?service.status,
                    "Service status"
                );
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
        // 使用 ManagementRegistry（统一管理锁）
        let old_status = {
            let mut mgmt = self.node_registry.management_registry.write().await;
            if let Some(node_state) = mgmt.nodes.get_mut(node_id) {
                if node_state.node.status != from {
                    // 状态已经改变，不执行转换
                    return;
                }
                let old_status = node_state.node.status.clone();
                node_state.node.status = to.clone();
                old_status
            } else {
                return;
            }
        };
        
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
            if let Ok(json) = serde_json::to_string(&status_msg) {
                if let Err(e) = tx.send(Message::Text(json)) {
                    warn!("发送 node_status 消息到节点 {} 失败: {}", node_id, e);
                }
            }
        }
    }

    /// 定期扫描（兜底处理）
    /// 处理超时、offline、warmup 超时等情况
    pub async fn periodic_scan(&self) {
        let now = Utc::now();
        // 使用 ManagementRegistry（统一管理锁）
        let node_ids: Vec<String> = {
            let mgmt = self.node_registry.management_registry.read().await;
            mgmt.nodes.keys().cloned().collect()
        };

        for node_id in node_ids {
            // 使用 ManagementRegistry（统一管理锁）
            let node = {
                let mgmt = self.node_registry.management_registry.read().await;
                mgmt.nodes.get(&node_id).map(|state| state.node.clone())
            };
            let node = match node {
                Some(n) => n,
                None => continue,
            };

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

