use super::{NodeRegistry, UnavailableServiceEntry};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tracing::debug;

impl NodeRegistry {
    /// 标记节点的某服务包暂不可用（TTL），用于快速抑制重复调度失败。
    pub async fn mark_service_temporarily_unavailable(
        &self,
        node_id: &str,
        service_id: &str,
        service_version: Option<String>,
        reason: Option<String>,
        ttl: Duration,
    ) {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let expire_at_ms = now_ms + ttl.as_millis() as i64;

        let t0 = Instant::now();
        let mut guard = self.unavailable_services.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.unavailable_services.write", t0.elapsed().as_millis() as u64);
        let entry = guard.entry(node_id.to_string()).or_insert_with(HashMap::new);
        entry.insert(
            service_id.to_string(),
            UnavailableServiceEntry {
                expire_at_ms,
            },
        );

        debug!(
            node_id = %node_id,
            service_id = %service_id,
            service_version = ?service_version,
            reason = ?reason,
            ttl_ms = ttl.as_millis() as u64,
            "MODEL_NOT_AVAILABLE：已标记节点服务包暂不可用"
        );
    }
}


