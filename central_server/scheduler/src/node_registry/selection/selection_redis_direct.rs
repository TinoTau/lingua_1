//! 节点选择逻辑（Redis 直查 + PoolService 版）
//! 
//! 阶段2完整版：
//! - 委托 PoolService 进行基于语言对的节点选择
//! - 对选中节点进行额外过滤（服务类型、资源阈值等）
//! - 支持 region/gpu_tier 分层（通过 PoolService）
//! - 使用 unavailable 和 exclude_stats（Redis 版）

use crate::node_registry::{NodeRegistry, DispatchExcludeReason};
use crate::node_registry::selection::selection_breakdown::NoAvailableNodeBreakdown;
use crate::messages::ServiceType;
use std::time::Instant;
use tracing::{debug, info, warn};

impl NodeRegistry {
    /// 选择节点（Redis 直查 + PoolService 版）
    /// 
    /// 阶段2完整实现：
    /// - **优先路径**: 通过 PoolService 按语言对选择节点（2-5ms）
    /// - **附加过滤**: 验证服务类型、资源使用率等
    /// - **降级路径**: 如果 PoolService 不可用，回退到全局查询
    /// 
    /// ## 参数
    /// - `src_lang`: 源语言
    /// - `tgt_lang`: 目标语言
    /// - `required_types`: 必需的服务类型（ASR/TTS等）
    /// - `accept_public`: 是否接受公共任务
    /// - `exclude_node_id`: 排除的节点ID
    /// - `resource_threshold`: 资源使用率阈值（0.0-1.0）
    /// 
    /// ## 返回
    /// - `Some(node_id)`: 选中的节点ID
    /// - `NoAvailableNodeBreakdown`: 详细的失败原因统计
    pub async fn select_node_redis_direct(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        required_types: &[ServiceType],
        accept_public: bool,
        exclude_node_id: Option<&str>,
        resource_threshold: f32,
    ) -> (Option<String>, NoAvailableNodeBreakdown) {
        let start = Instant::now();
        let mut breakdown = NoAvailableNodeBreakdown::default();
        
        // ==================== 路径1: PoolService 选择（推荐）====================
        
        if let Some(pool_svc) = self.pool_service().await {
            info!(
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                "Redis 直查：使用 PoolService 选择节点"
            );
            
            // 调用 PoolService（基于语言对的快速选择）
            // 注意：此路径没有 turn_id 上下文，传递 None（不会使用 turn 亲和）
            match pool_svc.select_node(src_lang, tgt_lang, None, None).await {
                Ok(candidate_node_id) => {
                    debug!(
                        node_id = %candidate_node_id,
                        pair = %format!("{}:{}", src_lang, tgt_lang),
                        "PoolService 返回候选节点"
                    );
                    
                    // 验证候选节点
                    let validation_result = self.validate_selected_node(
                        &candidate_node_id,
                        required_types,
                        accept_public,
                        exclude_node_id,
                        resource_threshold,
                        &mut breakdown,
                    ).await;
                    
                    if let Some(final_node_id) = validation_result {
                        info!(
                            node_id = %final_node_id,
                            elapsed_ms = start.elapsed().as_millis(),
                            "✅ PoolService 路径：成功选择节点"
                        );
                        return (Some(final_node_id), breakdown);
                    } else {
                        warn!(
                            candidate = %candidate_node_id,
                            "PoolService 返回的节点未通过验证"
                        );
                        // 继续尝试路径2
                    }
                }
                Err(e) => {
                    debug!(
                        error = %e,
                        "PoolService 未找到节点，回退到全局查询"
                    );
                    // 继续尝试路径2
                }
            }
        }
        
        // ==================== 路径2: 全局查询（降级）====================
        
        warn!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            "Redis 直查：降级到全局节点查询"
        );
        
        self.select_node_fallback(
            src_lang,
            tgt_lang,
            required_types,
            accept_public,
            exclude_node_id,
            resource_threshold,
            &mut breakdown,
            start,
        ).await
    }
    
    /// 验证 PoolService 选中的节点
    /// 
    /// 对候选节点进行额外过滤：
    /// - 服务类型检查
    /// - 资源使用率检查
    /// - 容量检查
    /// - 排除指定节点
    async fn validate_selected_node(
        &self,
        candidate_node_id: &str,
        required_types: &[ServiceType],
        accept_public: bool,
        exclude_node_id: Option<&str>,
        resource_threshold: f32,
        breakdown: &mut NoAvailableNodeBreakdown,
    ) -> Option<String> {
        let now_ts = crate::node_registry::NodeRedisRepository::current_ts();
        
        // 排除指定节点
        if let Some(ex) = exclude_node_id {
            if candidate_node_id == ex {
                debug!(node_id = %candidate_node_id, "节点被明确排除");
                return None;
            }
        }
        
        // 获取节点详细信息
        let node = match self.get_node_data(candidate_node_id).await {
            Ok(Some(n)) => n,
            Ok(None) => {
                warn!(node_id = %candidate_node_id, "节点不存在");
                breakdown.status_not_ready += 1;
                return None;
            }
            Err(e) => {
                warn!(node_id = %candidate_node_id, error = %e, "获取节点信息失败");
                return None;
            }
        };
        
        // 检查状态
        if node.status != "online" {
            breakdown.status_not_ready += 1;
            self.record_exclude_reason(DispatchExcludeReason::StatusNotReady, candidate_node_id.to_string()).await;
            return None;
        }
        
        // 检查心跳超时
        if !node.online || (now_ts - node.last_heartbeat_ts) > 3600 {
            breakdown.offline += 1;
            self.record_exclude_reason(DispatchExcludeReason::StatusNotReady, candidate_node_id.to_string()).await;
            return None;
        }
        
        // 检查 GPU
        if !node.has_gpu {
            breakdown.gpu_unavailable += 1;
            self.record_exclude_reason(DispatchExcludeReason::GpuUnavailable, candidate_node_id.to_string()).await;
            return None;
        }
        
        // 检查公共任务
        if !accept_public && !node.accept_public_jobs {
            breakdown.not_in_public_pool += 1;
            self.record_exclude_reason(DispatchExcludeReason::NotInPublicPool, candidate_node_id.to_string()).await;
            return None;
        }
        
        // 检查服务类型
        if !required_types.is_empty() {
            let has_all_types = required_types.iter().all(|rt| {
                node.installed_services.iter().any(|s| s.r#type == *rt)
            });
            if !has_all_types {
                breakdown.model_not_available += 1;
                self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, candidate_node_id.to_string()).await;
                return None;
            }
        }
        
        // 检查容量
        if node.current_jobs >= node.max_concurrency as usize {
            breakdown.capacity_exceeded += 1;
            debug!(
                node_id = %node.node_id,
                current_jobs = node.current_jobs,
                max_concurrency = node.max_concurrency,
                "节点容量已满"
            );
            self.record_exclude_reason(DispatchExcludeReason::CapacityExceeded, candidate_node_id.to_string()).await;
            return None;
        }
        
        // 检查资源使用率
        let cpu_ok = node.cpu_usage < resource_threshold;
        let gpu_ok = node.gpu_usage.map_or(true, |g| g < resource_threshold);
        let mem_ok = node.memory_usage < resource_threshold;
        
        if !cpu_ok || !gpu_ok || !mem_ok {
            breakdown.resource_threshold_exceeded += 1;
            warn!(
                node_id = %node.node_id,
                cpu_usage = node.cpu_usage,
                gpu_usage = ?node.gpu_usage,
                memory_usage = node.memory_usage,
                threshold = resource_threshold,
                "节点资源使用率超过阈值"
            );
            self.record_exclude_reason(DispatchExcludeReason::ResourceThresholdExceeded, candidate_node_id.to_string()).await;
            return None;
        }
        
        // 检查服务临时不可用（Redis 版）
        if let Some(first_type) = required_types.first() {
            let service_id = format!("{:?}_", first_type).to_lowercase();
            if self.is_service_temporarily_unavailable(&node.node_id, &service_id).await {
                debug!(
                    node_id = %node.node_id,
                    service_id = %service_id,
                    "服务临时不可用"
                );
                return None;
            }
        }
        
        // 通过所有验证
        Some(candidate_node_id.to_string())
    }
    
    /// 降级路径：全局节点查询和选择
    /// 
    /// 当 PoolService 不可用或未找到合适节点时使用
    async fn select_node_fallback(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        required_types: &[ServiceType],
        accept_public: bool,
        exclude_node_id: Option<&str>,
        resource_threshold: f32,
        breakdown: &mut NoAvailableNodeBreakdown,
        start: Instant,
    ) -> (Option<String>, NoAvailableNodeBreakdown) {
        let now_ts = crate::node_registry::NodeRedisRepository::current_ts();
        
        // Step 1: 从 Redis 查询所有在线节点
        let all_nodes = match self.list_sched_nodes().await {
            Ok(nodes) => nodes,
            Err(e) => {
                warn!(error = %e, "查询在线节点失败");
                return (None, breakdown.clone());
            }
        };
        
        if all_nodes.is_empty() {
            warn!("Redis 中没有在线节点");
            return (None, breakdown.clone());
        }
        
        debug!(
            total_nodes = all_nodes.len(),
            "Redis 直查：获取到在线节点（降级路径）"
        );
        
        breakdown.total_nodes = all_nodes.len();
        let mut available_nodes = Vec::new();
        
        // Step 2: 过滤节点
        for node in all_nodes {
            // 排除指定节点
            if let Some(ex) = exclude_node_id {
                if node.node_id == ex {
                    continue;
                }
            }
            
            // 检查状态
            if node.status != "online" {
                breakdown.status_not_ready += 1;
                self.record_exclude_reason(DispatchExcludeReason::StatusNotReady, node.node_id.clone()).await;
                continue;
            }
            
            // 检查心跳超时
            if !node.online || (now_ts - node.last_heartbeat_ts) > 3600 {
                breakdown.offline += 1;
                self.record_exclude_reason(DispatchExcludeReason::StatusNotReady, node.node_id.clone()).await;
                continue;
            }
            
            // 检查 GPU
            if !node.has_gpu {
                breakdown.gpu_unavailable += 1;
                self.record_exclude_reason(DispatchExcludeReason::GpuUnavailable, node.node_id.clone()).await;
                continue;
            }
            
            // 检查公共任务
            if !accept_public && !node.accept_public_jobs {
                breakdown.not_in_public_pool += 1;
                self.record_exclude_reason(DispatchExcludeReason::NotInPublicPool, node.node_id.clone()).await;
                continue;
            }
            
            // 检查服务类型
            if !required_types.is_empty() {
                let has_all_types = required_types.iter().all(|rt| {
                    node.installed_services.iter().any(|s| s.r#type == *rt)
                });
                if !has_all_types {
                    breakdown.model_not_available += 1;
                    self.record_exclude_reason(DispatchExcludeReason::ModelNotAvailable, node.node_id.clone()).await;
                    continue;
                }
            }
            
            // 检查容量
            if node.current_jobs >= node.max_concurrency as usize {
                breakdown.capacity_exceeded += 1;
                debug!(
                    node_id = %node.node_id,
                    current_jobs = node.current_jobs,
                    max_concurrency = node.max_concurrency,
                    "节点容量已满"
                );
                self.record_exclude_reason(DispatchExcludeReason::CapacityExceeded, node.node_id.clone()).await;
                continue;
            }
            
            // 检查资源使用率
            let cpu_ok = node.cpu_usage < resource_threshold;
            let gpu_ok = node.gpu_usage.map_or(true, |g| g < resource_threshold);
            let mem_ok = node.memory_usage < resource_threshold;
            
            if !cpu_ok || !gpu_ok || !mem_ok {
                breakdown.resource_threshold_exceeded += 1;
                warn!(
                    node_id = %node.node_id,
                    cpu_usage = node.cpu_usage,
                    gpu_usage = ?node.gpu_usage,
                    memory_usage = node.memory_usage,
                    threshold = resource_threshold,
                    "节点资源使用率超过阈值"
                );
                self.record_exclude_reason(DispatchExcludeReason::ResourceThresholdExceeded, node.node_id.clone()).await;
                continue;
            }
            
            // 检查服务临时不可用（Redis 版）
            if let Some(first_type) = required_types.first() {
                let service_id = format!("{:?}_{}", first_type, src_lang);
                if self.is_service_temporarily_unavailable(&node.node_id, &service_id).await {
                    debug!(
                        node_id = %node.node_id,
                        service_id = %service_id,
                        "服务临时不可用"
                    );
                    continue;
                }
            }
            
            available_nodes.push(node);
        }
        
        // Step 3: 如果没有可用节点
        if available_nodes.is_empty() {
            warn!(
                total_nodes = breakdown.total_nodes,
                status_not_ready = breakdown.status_not_ready,
                offline = breakdown.offline,
                not_in_public_pool = breakdown.not_in_public_pool,
                gpu_unavailable = breakdown.gpu_unavailable,
                model_not_available = breakdown.model_not_available,
                capacity_exceeded = breakdown.capacity_exceeded,
                resource_threshold_exceeded = breakdown.resource_threshold_exceeded,
                best_reason = %breakdown.best_reason_label(),
                required_types = ?required_types,
                src_lang = %src_lang,
                tgt_lang = %tgt_lang,
                "Redis 直查：没有找到可用节点（降级路径）"
            );
            return (None, breakdown.clone());
        }
        
        // Step 4: 排序（按负载优先，然后按 GPU 使用率）
        available_nodes.sort_by(|a, b| {
            let load_cmp = a.current_jobs.cmp(&b.current_jobs);
            if load_cmp != std::cmp::Ordering::Equal {
                return load_cmp;
            }
            
            let gpu_a = a.gpu_usage.unwrap_or(0.0);
            let gpu_b = b.gpu_usage.unwrap_or(0.0);
            gpu_a.partial_cmp(&gpu_b).unwrap_or(std::cmp::Ordering::Equal)
        });
        
        let selected_node_id = available_nodes[0].node_id.clone();
        
        info!(
            node_id = %selected_node_id,
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            required_types = ?required_types,
            candidate_count = available_nodes.len(),
            elapsed_ms = start.elapsed().as_millis(),
            "✅ 降级路径：成功选择节点"
        );
        
        (Some(selected_node_id), breakdown.clone())
    }
}
