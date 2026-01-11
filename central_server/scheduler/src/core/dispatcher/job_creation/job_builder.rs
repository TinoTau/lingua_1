//! Job 构造辅助模块
//! 提取重复的 Job 构造逻辑，避免代码重复

use super::super::job::{Job, JobStatus};
use crate::messages::{FeatureFlags, PipelineConfig};

/// 从 RequestBinding 创建 Job 对象
/// 用于幂等性检查时恢复已存在的 Job
pub(crate) fn build_job_from_binding(
    job_id: String,
    request_id: String,
    session_id: String,
    utterance_index: u64,
    src_lang: String,
    tgt_lang: String,
    dialect: Option<String>,
    features: Option<FeatureFlags>,
    pipeline: PipelineConfig,
    audio_data: Vec<u8>,
    audio_format: String,
    sample_rate: u32,
    assigned_node_id: Option<String>,
    dispatched_to_node: bool,
    mode: Option<String>,
    lang_a: Option<String>,
    lang_b: Option<String>,
    auto_langs: Option<Vec<String>>,
    enable_streaming_asr: Option<bool>,
    partial_update_interval_ms: Option<u64>,
    trace_id: String,
    tenant_id: Option<String>,
    target_session_ids: Option<Vec<String>>,
    first_chunk_client_timestamp_ms: Option<i64>,
    padding_ms: Option<u64>,
    is_manual_cut: bool,
    is_pause_triggered: bool,
    is_timeout_triggered: bool,
) -> Job {
    Job {
        job_id: job_id.clone(),
        request_id,
        dispatched_to_node,
        dispatched_at_ms: None,
        failover_attempts: 0,
        dispatch_attempt_id: if assigned_node_id.is_some() { 1 } else { 0 },
        session_id,
        utterance_index,
        src_lang,
        tgt_lang,
        dialect,
        features,
        pipeline,
        audio_data,
        audio_format,
        sample_rate,
        assigned_node_id: assigned_node_id.clone(),
        status: if assigned_node_id.is_some() {
            JobStatus::Assigned
        } else {
            JobStatus::Pending
        },
        created_at: chrono::Utc::now(),
        trace_id,
        mode,
        lang_a,
        lang_b,
        auto_langs,
        enable_streaming_asr,
        partial_update_interval_ms,
        target_session_ids,
        tenant_id,
        first_chunk_client_timestamp_ms,
        padding_ms,
        is_manual_cut,
        is_pause_triggered,
        is_timeout_triggered,
    }
}
