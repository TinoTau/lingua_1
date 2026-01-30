use super::{DispatchExcludeReason, NodeRegistry};
use std::collections::HashMap;
use tracing::info;

impl NodeRegistry {
    /// 记录调度排除原因
    /// 
    /// ## 实现方式
    /// - 直接写入 Redis，使用 HINCRBY 增加计数
    /// - 无锁设计，无需本地状态同步
    /// 
    /// ## Redis Key
    /// - `stats:exclude:{reason}` Hash: { "count": "123" }
    pub(super) async fn record_exclude_reason(&self, reason: DispatchExcludeReason, node_id: String) {
        let reason_str = format!("{:?}", reason);
        
        // 流程日志：开始记录
        info!(
            node_id = %node_id,
            reason = ?reason,
            "【排除统计】记录节点排除原因"
        );
        
        // 直接写入 Redis（Redis 直查架构）
        let result = self.redis_repo().record_exclude_reason(
            &reason_str,
            &node_id,
        ).await;
        
        // 流程日志：完成记录
        match result {
            Ok(_) => {
                info!(
                    node_id = %node_id,
                    reason = ?reason,
                    "【排除统计】✅ 记录完成（Redis 直写）"
                );
            }
            Err(e) => {
                tracing::error!(
                    node_id = %node_id,
                    reason = ?reason,
                    error = %e,
                    "【排除统计】❌ 记录失败"
                );
            }
        }
    }

    /// 获取调度排除原因统计（用于日志输出/指标）
    /// 
    /// ## 实现方式
    /// - 直接查询 Redis
    /// - 无锁设计
    /// 
    /// ## 注意
    /// - 返回简化格式：HashMap<reason, count>
    /// - 不再保留 Top-K 节点 ID（简化设计）
    pub async fn get_exclude_reason_stats(&self) -> HashMap<DispatchExcludeReason, (usize, Vec<String>)> {
        match self.redis_repo().get_exclude_stats().await {
            Ok(stats) => {
                // 转换为旧格式（保持 API 兼容）
                let mut result = HashMap::new();
                for (reason_str, count) in stats {
                    // 尝试解析为 DispatchExcludeReason
                    // 注意：这里简化处理，只映射常见原因
                    let reason = match reason_str.as_str() {
                        s if s.contains("ModelNotAvailable") => DispatchExcludeReason::ModelNotAvailable,
                        s if s.contains("StatusNotReady") => DispatchExcludeReason::StatusNotReady,
                        s if s.contains("NotInPublicPool") => DispatchExcludeReason::NotInPublicPool,
                        s if s.contains("GpuUnavailable") => DispatchExcludeReason::GpuUnavailable,
                        s if s.contains("CapacityExceeded") => DispatchExcludeReason::CapacityExceeded,
                        s if s.contains("ResourceThresholdExceeded") => DispatchExcludeReason::ResourceThresholdExceeded,
                        s if s.contains("LangPairUnsupported") => DispatchExcludeReason::LangPairUnsupported,
                        s if s.contains("AsrLangUnsupported") => DispatchExcludeReason::AsrLangUnsupported,
                        s if s.contains("TtsLangUnsupported") => DispatchExcludeReason::TtsLangUnsupported,
                        _ => continue, // 跳过无法识别的原因
                    };
                    result.insert(reason, (count, Vec::new())); // Vec 为空（不再保留 Top-K）
                }
                result
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "获取排除统计失败，返回空数据"
                );
                HashMap::new()
            }
        }
    }

}
