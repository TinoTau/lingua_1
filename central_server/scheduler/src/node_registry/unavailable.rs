use super::NodeRegistry;
use std::time::Duration;
use tracing::info;

impl NodeRegistry {
    /// 标记节点的某服务包暂不可用（TTL），用于快速抑制重复调度失败
    /// 
    /// ## 实现方式
    /// - 直接写入 Redis，使用 SETEX 设置 TTL
    /// - 无锁设计，无需本地状态同步
    /// 
    /// ## Redis Key
    /// - `unavailable:{node_id}:{service_id}`
    pub async fn mark_service_temporarily_unavailable(
        &self,
        node_id: &str,
        service_id: &str,
        service_version: Option<String>,
        reason: Option<String>,
        ttl: Duration,
    ) {
        let ttl_secs = ttl.as_secs();
        
        // 流程日志：开始标记
        info!(
            node_id = %node_id,
            service_id = %service_id,
            service_version = ?service_version,
            reason = ?reason,
            ttl_secs = ttl_secs,
            "【服务不可用】开始标记节点服务临时不可用"
        );
        
        // 直接写入 Redis（Redis 直查架构）
        let result = self.redis_repo().mark_service_unavailable(
            node_id,
            service_id,
            service_version.as_deref(),
            reason.as_deref(),
            ttl_secs,
        ).await;
        
        // 流程日志：完成标记
        match result {
            Ok(_) => {
                info!(
                    node_id = %node_id,
                    service_id = %service_id,
                    "【服务不可用】✅ 标记完成（Redis 直写）"
                );
            }
            Err(e) => {
                tracing::error!(
                    node_id = %node_id,
                    service_id = %service_id,
                    error = %e,
                    "【服务不可用】❌ 标记失败"
                );
            }
        }
    }
    
    /// 检查节点服务是否临时不可用
    /// 
    /// ## 实现方式
    /// - 直接查询 Redis EXISTS
    /// - 无锁设计
    pub async fn is_service_temporarily_unavailable(
        &self,
        node_id: &str,
        service_id: &str,
    ) -> bool {
        match self.redis_repo().is_service_unavailable(node_id, service_id).await {
            Ok(unavailable) => unavailable,
            Err(e) => {
                tracing::warn!(
                    node_id = %node_id,
                    service_id = %service_id,
                    error = %e,
                    "检查服务可用性失败，默认视为可用"
                );
                false // 失败时默认视为可用，避免误判
            }
        }
    }
}
