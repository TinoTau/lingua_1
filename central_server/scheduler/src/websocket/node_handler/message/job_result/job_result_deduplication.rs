use crate::core::AppState;
use tracing::warn;

/// 检查并记录 JobResult 去重
/// 返回 true 表示是重复结果，应该跳过处理
pub(crate) async fn check_job_result_deduplication(
    state: &AppState,
    session_id: &str,
    job_id: &str,
    trace_id: &str,
    utterance_index: u64,
    is_empty: bool,
) -> bool {
    if state.job_result_deduplicator.check_and_record(session_id, job_id, is_empty).await {
        warn!(
            trace_id = %trace_id,
            job_id = %job_id,
            session_id = %session_id,
            utterance_index = utterance_index,
            result_type = if is_empty { "empty" } else { "complete" },
            "Duplicate job_result filtered (received within 30 seconds), skipping processing"
        );
        true
    } else {
        false
    }
}

