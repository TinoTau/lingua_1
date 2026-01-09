use super::{DispatchExcludeReason, NodeRegistry};
use std::collections::HashMap;
use std::time::Instant;
use tracing::debug;

impl NodeRegistry {
    /// 记录调度排除原因（聚合统计 + Top-K 示例）
    pub(super) async fn record_exclude_reason(&self, reason: DispatchExcludeReason, node_id: String) {
        let t0 = Instant::now();
        let mut stats = self.exclude_reason_stats.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.exclude_reason_stats.write", t0.elapsed().as_millis() as u64);
        let entry = stats.entry(reason.clone()).or_insert_with(|| (0, Vec::new()));
        entry.0 += 1;

        // Top-K 示例（最多保留 5 个节点 ID）
        const TOP_K: usize = 5;
        if entry.1.len() < TOP_K && !entry.1.contains(&node_id) {
            entry.1.push(node_id.clone());
        }

        debug!(
            node_id = %node_id,
            reason = ?reason,
            total_count = entry.0,
            "调度过滤：节点被排除"
        );
    }

    /// 获取调度排除原因统计（用于日志输出/指标）
    pub async fn get_exclude_reason_stats(&self) -> HashMap<DispatchExcludeReason, (usize, Vec<String>)> {
        let t0 = Instant::now();
        let guard = self.exclude_reason_stats.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.exclude_reason_stats.read", t0.elapsed().as_millis() as u64);
        guard.clone()
    }

}


