use crate::core::AppState;
use crate::messages::{JobError, NodeMessage};
use crate::messages::common::ExtraResult;
use crate::redis_runtime::InterInstanceEvent;
use tracing::debug;

/// Phase 2: 跨实例转发 JobResult
/// 如果 Job 不在当前实例，转发到 session owner
/// 返回 true 表示已转发，应该返回；返回 false 表示需要继续处理
pub(crate) async fn forward_job_result_if_needed(
    state: &AppState,
    job_id: &str,
    attempt_id: u32,
    node_id: &str,
    session_id: &str,
    utterance_index: u64,
    success: bool,
    text_asr: &Option<String>,
    text_translated: &Option<String>,
    tts_audio: &Option<String>,
    tts_format: &Option<String>,
    extra: &Option<ExtraResult>,
    node_completed_at_ms: Option<i64>,
    job_error: &Option<JobError>,
    trace_id: &str,
    asr_quality_level: &Option<String>,
    reason_codes: &Option<Vec<String>>,
    quality_score: Option<f32>,
    rerun_count: Option<u32>,
    segments_meta: &Option<crate::messages::common::SegmentsMeta>,
) -> bool {
    // Phase 2: Cross-instance (node on A, job/session on B), local dispatcher may not have job
    // In this case, forward result to session owner, let owner instance complete result queue and downstream push
    if let Some(rt) = state.phase2.as_ref() {
        if let Some(owner) = rt.resolve_session_owner(session_id).await {
            if owner != rt.instance_id {
                let forwarded = NodeMessage::JobResult {
                    job_id: job_id.to_string(),
                    attempt_id,
                    node_id: node_id.to_string(),
                    session_id: session_id.to_string(),
                    utterance_index,
                    success,
                    text_asr: text_asr.clone(),
                    text_translated: text_translated.clone(),
                    tts_audio: tts_audio.clone(),
                    tts_format: tts_format.clone(),
                    extra: extra.clone(),
                    processing_time_ms: None,
                    node_completed_at_ms,
                    error: job_error.clone(),
                    trace_id: trace_id.to_string(),
                    group_id: None,
                    part_index: None,
                    // OBS-2: 透传 ASR 质量信息
                    asr_quality_level: asr_quality_level.clone(),
                    reason_codes: reason_codes.clone(),
                    quality_score,
                    rerun_count,
                    segments_meta: segments_meta.clone(),
                };
                let _ = rt
                    .enqueue_to_instance(&owner, &InterInstanceEvent::ForwardNodeMessage { message: forwarded })
                    .await;
                debug!(
                    trace_id = %trace_id,
                    job_id = %job_id,
                    node_id = %node_id,
                    session_id = %session_id,
                    owner = %owner,
                    "Local Job missing, forwarded JobResult to session owner"
                );
                return true;  // Phase 2 转发后返回，由 owner 实例处理
            }
        }
    }
    false
}

