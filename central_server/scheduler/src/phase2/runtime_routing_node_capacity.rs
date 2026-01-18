// Phase 2 节点容量同步

use crate::messages::ErrorCode;

impl Phase2Runtime {
    /// Phase 2：节点并发占用（从 Redis Hash 读取）
    pub async fn node_reserved_count(&self, node_id: &str) -> u64 {
        let key = self.node_cap_key(node_id);
        match self.redis.query::<i64>({
            let mut c = redis::cmd("HGET");
            c.arg(&key).arg("reserved");
            c
        }).await {
            Ok(v) if v > 0 => v as u64,
            _ => 0,
        }
    }

    /// Phase 2：预留节点槽位（使用新的 Redis Hash 实现）
    /// 返回: Ok(true) 表示成功, Ok(false) 表示失败（节点已满等）, Err(SchedulerDependencyDown) 表示 Redis 不可用
    pub async fn reserve_node_slot(
        &self,
        node_id: &str,
        job_id: &str,
        attempt_id: u32,
        ttl_seconds: u64,
    ) -> Result<bool, ErrorCode> {
        let node_cap_key = self.node_cap_key(node_id);
        let node_meta_key = self.node_meta_key(node_id);
        let resv_id = format!("{}:{}:{}", job_id, attempt_id, node_id);
        let resv_key = self.resv_key(&resv_id);
        
        let resv_value = serde_json::json!({
            "node_id": node_id,
            "job_id": job_id,
            "attempt_id": attempt_id,
            "created_ms": chrono::Utc::now().timestamp_millis(),
            "ttl_ms": ttl_seconds * 1000,
        });
        let resv_value_json = match serde_json::to_string(&resv_value) {
            Ok(v) => v,
            Err(e) => {
                warn!(error = %e, "预留值序列化失败");
                return Ok(false);
            }
        };
        
        match self.redis.try_reserve(&node_cap_key, &node_meta_key, &resv_key, ttl_seconds * 1000, &resv_value_json).await {
            Ok((1, _)) => {
                // 记录成功
                crate::metrics::prometheus_metrics::on_reserve_attempt(true);
                Ok(true)
            }
            Ok((status, reason)) => {
                // 记录失败原因
                crate::metrics::prometheus_metrics::on_reserve_attempt(false);
                if status == 2 {
                    // FULL - 节点过载
                    crate::metrics::prometheus_metrics::on_node_overload_reject(node_id, "full");
                } else if status == 3 {
                    // NOT_READY - 节点不健康
                    crate::metrics::prometheus_metrics::on_node_overload_reject(node_id, "not_ready");
                } else {
                    crate::metrics::prometheus_metrics::on_node_overload_reject(node_id, "other");
                }
                warn!(
                    node_id = %node_id,
                    job_id = %job_id,
                    attempt_id = attempt_id,
                    status = status,
                    reason = %reason,
                    "预留节点槽位失败"
                );
                Ok(false)
            }
            Err(e) => {
                // Redis 连接错误：返回 SCHEDULER_DEPENDENCY_DOWN
                crate::metrics::prometheus_metrics::on_reserve_error();
                error!(
                    error = %e,
                    node_id = %node_id,
                    job_id = %job_id,
                    attempt_id = attempt_id,
                    "Redis 不可用，无法预留节点槽位"
                );
                Err(ErrorCode::SchedulerDependencyDown)
            }
        }
    }

    /// Phase 2：释放节点槽位（使用新的 Redis Hash 实现）
    pub async fn release_node_slot(&self, node_id: &str, job_id: &str, attempt_id: u32) {
        let node_cap_key = self.node_cap_key(node_id);
        let resv_id = format!("{}:{}:{}", job_id, attempt_id, node_id);
        let resv_key = self.resv_key(&resv_id);
        let _ = self.redis.release_reserve(&node_cap_key, &resv_key).await;
    }

    /// Phase 2：提交预留（reserved -> running）
    pub async fn commit_node_reservation(&self, node_id: &str, job_id: &str, attempt_id: u32) -> bool {
        let node_cap_key = self.node_cap_key(node_id);
        let resv_id = format!("{}:{}:{}", job_id, attempt_id, node_id);
        let resv_key = self.resv_key(&resv_id);
        self.redis.commit_reserve(&node_cap_key, &resv_key).await.unwrap_or(false)
    }

}
