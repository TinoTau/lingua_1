use super::super::NodeRegistry;
use super::selection_breakdown::NoAvailableNodeBreakdown;
use std::time::Instant;
use tracing::info;

impl NodeRegistry {
    /// 选择节点（兼容方法）
    /// 
    /// 阶段3：此方法现在委托给 select_node_redis_direct
    pub async fn select_node_with_types_excluding_with_breakdown(
        &self,
        src_lang: &str,
        tgt_lang: &str,
        required_types: &[crate::messages::ServiceType],
        accept_public: bool,
        exclude_node_id: Option<&str>,
    ) -> (Option<String>, NoAvailableNodeBreakdown) {
        let path_t0 = Instant::now();
        
        info!(
            src_lang = %src_lang,
            tgt_lang = %tgt_lang,
            required_types = ?required_types,
            "【兼容层】调用 select_node_redis_direct"
        );
        
        // 阶段3：直接委托给 Redis 直查实现
        let (selected, breakdown) = self.select_node_redis_direct(
            src_lang,
            tgt_lang,
            required_types,
            accept_public,
            exclude_node_id,
            self.resource_threshold,  // 使用配置的资源阈值
        ).await;
        
        // 记录性能指标（兼容旧指标）
        crate::metrics::observability::record_path_latency(
            "node_registry.select_node_with_types",
            path_t0.elapsed().as_millis() as u64,
        );
        
        (selected, breakdown)
    }
}

