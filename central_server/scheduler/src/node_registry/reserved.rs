use super::{NodeRegistry, ReservedJobEntry};
use crate::messages::NodeStatus;
use std::collections::HashMap;
use std::time::{Duration, Instant};

impl NodeRegistry {
    /// 预占用一个并发槽（reserve job slot）。成功返回 true。
    pub async fn reserve_job_slot(&self, node_id: &str, job_id: &str, ttl: Duration) -> bool {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let expire_at_ms = now_ms + ttl.as_millis() as i64;

        // 读取节点 max_concurrent_jobs 与 current_jobs（锁顺序：nodes -> reserved_jobs）
        let t0 = Instant::now();
        let nodes = self.nodes.read().await;
        crate::metrics::observability::record_lock_wait("node_registry.nodes.read", t0.elapsed().as_millis() as u64);
        let Some(node) = nodes.get(node_id) else {
            return false;
        };
        if !node.online || node.status != NodeStatus::Ready {
            return false;
        }
        let max_jobs = node.max_concurrent_jobs;
        let current_jobs = node.current_jobs;
        drop(nodes);

        let t0 = Instant::now();
        let mut reserved = self.reserved_jobs.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.reserved_jobs.write", t0.elapsed().as_millis() as u64);
        let entry = reserved.entry(node_id.to_string()).or_insert_with(HashMap::new);

        // 惰性清理过期 reserved
        entry.retain(|_jid, v| v.expire_at_ms > now_ms);
        let reserved_count = entry.len();

        // effective_jobs：取 max(current_jobs, reserved_count)，避免心跳延迟造成超卖
        let effective_jobs = std::cmp::max(current_jobs, reserved_count);
        if effective_jobs >= max_jobs {
            return false;
        }

        entry.insert(job_id.to_string(), ReservedJobEntry { expire_at_ms });
        true
    }

    /// 释放预占用的并发槽（幂等）
    pub async fn release_job_slot(&self, node_id: &str, job_id: &str) {
        let t0 = Instant::now();
        let mut reserved = self.reserved_jobs.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.reserved_jobs.write", t0.elapsed().as_millis() as u64);
        if let Some(map) = reserved.get_mut(node_id) {
            map.remove(job_id);
            if map.is_empty() {
                reserved.remove(node_id);
            }
        }
    }

    pub(super) async fn reserved_counts_snapshot(&self) -> HashMap<String, usize> {
        let now_ms = chrono::Utc::now().timestamp_millis();
        let t0 = Instant::now();
        let mut reserved = self.reserved_jobs.write().await;
        crate::metrics::observability::record_lock_wait("node_registry.reserved_jobs.write", t0.elapsed().as_millis() as u64);
        let mut result = HashMap::new();
        reserved.retain(|_nid, map| {
            map.retain(|_jid, v| v.expire_at_ms > now_ms);
            !map.is_empty()
        });
        for (nid, map) in reserved.iter() {
            result.insert(nid.clone(), map.len());
        }
        result
    }
}


