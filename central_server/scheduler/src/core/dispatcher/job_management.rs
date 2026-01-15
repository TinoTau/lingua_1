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
            // Phase2: request_id 绑定由 Redis 管理，自动过期，无需手动清理
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
        use tracing::{info, warn};
        
        // 优化：快速读取 Job 信息，立即释放锁（在 Session 层级尽量减少锁操作）
        let (session_id_opt, assigned_node_id, request_id, dispatch_attempt_id) = {
            let jobs = self.jobs.read().await;
            if let Some(job) = jobs.get(job_id) {
                (
                    Some(job.session_id.clone()),
                    job.assigned_node_id.clone(),
                    job.request_id.clone(),
                    job.dispatch_attempt_id,
                )
            } else {
                warn!(
                    job_id = %job_id,
                    "mark_job_dispatched: Job 不存在"
                );
                return false;
            }
        }; // 锁立即释放
        
        let session_id = session_id_opt.as_deref().unwrap_or("unknown");
        let node_id_str = assigned_node_id.as_deref().unwrap_or("unknown");
        
        info!(
            job_id = %job_id,
            session_id = %session_id,
            node_id = %node_id_str,
            request_id = %request_id,
            dispatch_attempt_id = dispatch_attempt_id,
            "mark_job_dispatched: 开始标记任务为已分发"
        );
        
        // 在锁外更新 Job 状态（快速更新，立即释放）
        {
            let mut jobs = self.jobs.write().await;
            if let Some(job) = jobs.get_mut(job_id) {
                if job.dispatched_to_node {
                    warn!(
                        job_id = %job_id,
                        session_id = %session_id,
                        node_id = %node_id_str,
                        "mark_job_dispatched: Job 已经被标记为已分发（幂等调用）"
                    );
                    return true;
                }
                job.dispatched_to_node = true;
                job.dispatched_at_ms = Some(chrono::Utc::now().timestamp_millis());
                info!(
                    job_id = %job_id,
                    session_id = %session_id,
                    node_id = %node_id_str,
                    dispatched_at_ms = job.dispatched_at_ms,
                    "mark_job_dispatched: Job 状态已更新为已分发"
                );
            } else {
                warn!(
                    job_id = %job_id,
                    session_id = %session_id,
                    "mark_job_dispatched: Job 在写入时不存在（可能已被删除）"
                );
                return false;
            }
        } // 快速释放 Job 锁
        
        // Phase 2：同步更新 request_id bind 的 dispatched 标记（在锁外进行 I/O，避免阻塞）
        if let Some(ref rt) = self.phase2 {
            if !request_id.is_empty() {
                info!(
                    job_id = %job_id,
                    session_id = %session_id,
                    request_id = %request_id,
                    "mark_job_dispatched: 更新 request_id 绑定为已分发"
                );
                rt.mark_request_dispatched(&request_id).await;
            }
            // Phase 2：Job FSM -> DISPATCHED（幂等）
            info!(
                job_id = %job_id,
                session_id = %session_id,
                dispatch_attempt_id = dispatch_attempt_id,
                "mark_job_dispatched: 更新 Job FSM 状态为 DISPATCHED"
            );
            let _ = rt.job_fsm_to_dispatched(job_id, dispatch_attempt_id.max(1)).await;
        }
        
        // 根据 v3.0 设计，Session 状态由 SessionRuntimeManager 管理
        // 这里不再需要更新 last_dispatched_node_by_session（已移除）
        
        info!(
            job_id = %job_id,
            session_id = %session_id,
            node_id = %node_id_str,
            "mark_job_dispatched: 任务标记为已分发完成"
        );
        
        true
    }
}

