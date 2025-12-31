use super::JobDispatcher;
use crate::core::dispatcher::Job;

impl JobDispatcher {
    pub async fn get_job(&self, job_id: &str) -> Option<Job> {
        let jobs = self.jobs.read().await;
        jobs.get(job_id).cloned()
    }

    pub async fn list_jobs_snapshot(&self) -> Vec<Job> {
        let jobs = self.jobs.read().await;
        jobs.values().cloned().collect()
    }

    pub async fn update_job_status(&self, job_id: &str, status: crate::core::dispatcher::JobStatus) -> bool {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            let is_terminal = matches!(status, crate::core::dispatcher::JobStatus::Completed | crate::core::dispatcher::JobStatus::Failed);
            job.status = status;
            // 完成/失败后清理 request_id 绑定（避免内存增长；任务级绑定不需要长期保留）
            if is_terminal && !job.request_id.is_empty() {
                self.request_bindings.write().await.remove(&job.request_id);
            }
            true
        } else {
            false
        }
    }

    /// Phase 1：用于超时/重派的内部状态更新
    /// - 设置新节点
    /// - 重置 dispatched 标记与 dispatched_at_ms
    /// - 递增 failover_attempts
    pub async fn set_job_assigned_node_for_failover(&self, job_id: &str, new_node_id: String) -> bool {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            if matches!(job.status, crate::core::dispatcher::JobStatus::Completed | crate::core::dispatcher::JobStatus::Failed) {
                return false;
            }
            let request_id = job.request_id.clone();
            let next_attempt = job.dispatch_attempt_id.saturating_add(1).max(1);
            job.assigned_node_id = Some(new_node_id.clone());
            job.status = crate::core::dispatcher::JobStatus::Assigned;
            job.dispatched_to_node = false;
            job.dispatched_at_ms = None;
            job.failover_attempts = job.failover_attempts.saturating_add(1);
            job.dispatch_attempt_id = next_attempt;
            // Phase 2：更新 bind 的 node_id，并清理 dispatched 标记
            if let Some(ref rt) = self.phase2 {
                if !request_id.is_empty() {
                    rt.update_request_binding_node(&request_id, &new_node_id).await;
                }
                // Phase 2：Job FSM reset -> CREATED（新 attempt）
                let fsm_ttl = std::cmp::max(self.lease_seconds, self.reserved_ttl_seconds).saturating_add(300);
                rt.job_fsm_reset_created(job_id, Some(&new_node_id), next_attempt, fsm_ttl).await;
            }
            true
        } else {
            false
        }
    }

    pub async fn required_types_for_job(&self, job: &Job) -> anyhow::Result<Vec<crate::messages::ServiceType>> {
        // get_required_types_for_features 在 job_selection.rs 中定义，可以直接调用
        self.get_required_types_for_features(&job.pipeline, job.features.as_ref(), &job.src_lang, &job.tgt_lang)
    }

    pub async fn mark_job_dispatched(&self, job_id: &str) -> bool {
        let mut jobs = self.jobs.write().await;
        if let Some(job) = jobs.get_mut(job_id) {
            job.dispatched_to_node = true;
            job.dispatched_at_ms = Some(chrono::Utc::now().timestamp_millis());
            // Phase 2：同步更新 request_id bind 的 dispatched 标记，避免跨实例重复派发
            if let Some(ref rt) = self.phase2 {
                if !job.request_id.is_empty() {
                    rt.mark_request_dispatched(&job.request_id).await;
                }
                // Phase 2：Job FSM -> DISPATCHED（幂等）
                let _ = rt.job_fsm_to_dispatched(&job.job_id, job.dispatch_attempt_id.max(1)).await;
            }
            if let Some(ref nid) = job.assigned_node_id {
                let now_ms = chrono::Utc::now().timestamp_millis();
                self.last_dispatched_node_by_session
                    .write()
                    .await
                    .insert(job.session_id.clone(), (nid.clone(), now_ms));
            }
            true
        } else {
            false
        }
    }
}

