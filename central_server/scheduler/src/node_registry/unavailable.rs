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

    /// 检查某节点是否对 required_model_ids（服务包 id）存在暂不可用标记。
    /// 
    /// 注意：此方法目前未使用，保留用于未来可能的服务包级别的不可用标记检查。
    #[allow(dead_code)]
    pub(super) async fn has_unavailable_required_services(
        &self,
        node_id: &str,
        required_model_ids: &[String],
    ) -> bool {
        if required_model_ids.is_empty() {
            return false;
        }

        let now_ms = chrono::Utc::now().timestamp_millis();
        let t0 = Instant::now();
        let mut guard = self.unavailable_services.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.unavailable_services.write", t0.elapsed().as_millis() as u64);
        let Some(map) = guard.get_mut(node_id) else {
            return false;
        };

        // 惰性清理过期条目
        map.retain(|_sid, v| v.expire_at_ms > now_ms);
        if map.is_empty() {
            guard.remove(node_id);
            return false;
        }

        required_model_ids.iter().any(|mid| map.contains_key(mid))
    }
}


