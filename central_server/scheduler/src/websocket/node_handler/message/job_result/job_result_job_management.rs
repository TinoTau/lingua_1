use crate::core::AppState;
use crate::core::dispatcher::{Job, JobStatus};
use crate::services::minimal_scheduler::CompleteTaskRequest;
use tracing::warn;

/// 检查是否应该处理 Job（基于 Job 状态和节点匹配）
/// 返回 (should_process_job, job)
pub(crate) async fn check_should_process_job(
    state: &AppState,
    job_id: &str,
    node_id: &str,
    attempt_id: u32,
    trace_id: &str,
) -> (bool, Option<Job>) {
    let job = state.dispatcher.get_job(job_id).await;
    let should_process_job = if let Some(ref j) = job {
        if matches!(
            j.status,
            JobStatus::Completed | JobStatus::Failed
        ) {
            warn!(
                trace_id = %trace_id,
                job_id = %job_id,
                node_id = %node_id,
                current_node_id = ?j.assigned_node_id,
                "Received result for terminated Job, will still add to result queue for utterance_index continuity"
            );
            false  // 不处理 Job 相关操作（释放 slot、更新状态等），但仍添加到队列
        } else if j.assigned_node_id.as_deref() != Some(node_id) {
            warn!(
                trace_id = %trace_id,
                job_id = %job_id,
                node_id = %node_id,
                current_node_id = ?j.assigned_node_id,
                "Received JobResult from non-current node (possible failover), will still add to result queue for utterance_index continuity"
            );
            false  // 不处理 Job 相关操作，但仍添加到队列
        } else if j.dispatch_attempt_id != attempt_id {
            warn!(
                trace_id = %trace_id,
                job_id = %job_id,
                node_id = %node_id,
                attempt_id = attempt_id,
                current_attempt_id = j.dispatch_attempt_id,
                "Received JobResult for non-current attempt (possible cancel/retry), will still add to result queue for utterance_index continuity"
            );
            false  // 不处理 Job 相关操作，但仍添加到队列
        } else {
            true  // 正常情况，处理 Job 相关操作
        }
    } else {
        warn!(
            trace_id = %trace_id,
            job_id = %job_id,
            node_id = %node_id,
            "Received JobResult but Job does not exist, will still add to result queue for utterance_index continuity"
        );
        false  // 不处理 Job 相关操作，但仍添加到队列
    };
    (should_process_job, job)
}

/// 处理 Job 相关操作（释放 slot、更新状态）
/// 使用极简无锁调度服务
pub(crate) async fn process_job_operations(
    state: &AppState,
    job_id: &str,
    node_id: &str,
    _attempt_id: u32,
    success: bool,
) {
    // 使用新的极简无锁调度服务
    if let Some(scheduler) = state.minimal_scheduler.as_ref() {
        let status = if success { "finished" } else { "failed" };
        
        if let Err(e) = scheduler.complete_task(CompleteTaskRequest {
            job_id: job_id.to_string(),
            node_id: node_id.to_string(),
            status: status.to_string(),
        }).await {
            warn!(
                job_id = %job_id,
                node_id = %node_id,
                error = %e,
                "任务完成失败（极简无锁调度服务）"
            );
        }
    }

    // Update job status (本地状态，用于其他模块查询)
    if success {
        state
            .dispatcher
            .update_job_status(job_id, JobStatus::Completed)
            .await;
    } else {
        state
            .dispatcher
            .update_job_status(job_id, JobStatus::Failed)
            .await;
    }
}

