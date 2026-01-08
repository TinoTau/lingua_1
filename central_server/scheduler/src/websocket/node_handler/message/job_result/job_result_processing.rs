use crate::core::AppState;
use crate::messages::{JobError, common::ExtraResult};

use super::job_result_deduplication::check_job_result_deduplication;
use super::job_result_phase2::forward_job_result_if_needed;
use super::job_result_job_management::{check_should_process_job, process_job_operations};
use super::job_result_group::process_group_for_job_result;
use super::job_result_events::send_ui_events_for_job_result;
use super::job_result_metrics::record_asr_metrics;
use super::job_result_creation::{
    calculate_elapsed_ms, create_service_timings, create_network_timings,
    create_translation_result, log_translation_result,
};
use super::job_result_sending::send_results_to_clients;
use super::job_result_error::handle_job_result_error;

pub(crate) async fn handle_job_result(
    state: &AppState,
    job_id: String,
    attempt_id: u32,
    node_id: String,
    session_id: String,
    utterance_index: u64,
    success: bool,
    text_asr: Option<String>,
    text_translated: Option<String>,
    tts_audio: Option<String>,
    tts_format: Option<String>,
    extra: Option<ExtraResult>,
    _processing_time_ms: Option<u64>,
    job_error: Option<JobError>,
    trace_id: String,
    _group_id: Option<String>,
    _part_index: Option<u64>,
    node_completed_at_ms: Option<i64>,
    // OBS-2: ASR 质量信息
    asr_quality_level: Option<String>,
    reason_codes: Option<Vec<String>>,
    quality_score: Option<f32>,
    rerun_count: Option<u32>,
    segments_meta: Option<crate::messages::common::SegmentsMeta>,
) {
    use tracing::info;
    
    info!(
        trace_id = %trace_id,
        job_id = %job_id,
        node_id = %node_id,
        session_id = %session_id,
        utterance_index = utterance_index,
        success = success,
        attempt_id = attempt_id,
        "收到节点返回的 JobResult"
    );
    
    // 核销机制：检查是否在30秒内已经收到过相同job_id的结果
    if check_job_result_deduplication(&state, &session_id, &job_id, &trace_id, utterance_index).await {
        info!(
            trace_id = %trace_id,
            job_id = %job_id,
            session_id = %session_id,
            "JobResult 重复，已跳过处理"
        );
        return; // 直接返回，不进行后续处理
    }

    // Phase 2: 跨实例转发（如果需要）
    if forward_job_result_if_needed(
        &state,
        &job_id,
        attempt_id,
        &node_id,
        &session_id,
        utterance_index,
        success,
        &text_asr,
        &text_translated,
        &tts_audio,
        &tts_format,
        &extra,
        node_completed_at_ms,
        &job_error,
        &trace_id,
        &asr_quality_level,
        &reason_codes,
        quality_score,
        rerun_count,
        &segments_meta,
    ).await {
        return; // Phase 2 转发后返回，由 owner 实例处理
    }

    // 检查是否应该处理 Job
    let (should_process_job, job) = check_should_process_job(
        &state,
        &job_id,
        &node_id,
        attempt_id,
        &trace_id,
    ).await;

    // 只有在 should_process_job 为 true 时才执行 Job 相关操作
    if should_process_job {
        process_job_operations(
            &state,
            &job_id,
            &node_id,
            attempt_id,
            success,
        ).await;
    }

    // Calculate elapsed_ms
    let elapsed_ms = calculate_elapsed_ms(&job);

    // Utterance Group processing
    let (group_id, part_index) = process_group_for_job_result(
        &state,
        &session_id,
        &trace_id,
        utterance_index,
        &text_asr,
        &text_translated,
    ).await;

    if success {
        // Send UI events (ASR_FINAL, NMT_DONE)
        send_ui_events_for_job_result(
            &state,
            &session_id,
            &job_id,
            utterance_index,
            &trace_id,
            &text_asr,
            &text_translated,
            elapsed_ms,
        ).await;

        // 创建 ServiceTimings 和 NetworkTimings
        let service_timings = create_service_timings(&extra, _processing_time_ms);
        let network_timings = create_network_timings(&job, node_completed_at_ms);
        let now_ms = chrono::Utc::now().timestamp_millis();
        let scheduler_sent_at_ms = now_ms;

        // 记录指标
        record_asr_metrics(
            elapsed_ms,
            &extra,
            &asr_quality_level,
            rerun_count,
        );

        // 创建 TranslationResult 消息
        let result = create_translation_result(
            &session_id,
            utterance_index,
            &job_id,
            &text_asr,
            &text_translated,
            &tts_audio,
            &tts_format,
            &extra,
            &trace_id,
            &group_id,
            part_index,
            service_timings.clone(),
            network_timings,
            scheduler_sent_at_ms,
            &asr_quality_level,
            &reason_codes,
            quality_score,
            rerun_count,
            &segments_meta,
        );

        // 记录日志
        log_translation_result(
            &trace_id,
            &job_id,
            &session_id,
            utterance_index,
            &text_asr,
            &text_translated,
            &tts_audio,
            &tts_format,
            elapsed_ms,
            &service_timings,
        );

        // Add to result queue
        state
            .result_queue
            .add_result(&session_id, utterance_index, result.clone())
            .await;

        // 发送结果到客户端
        send_results_to_clients(
            &state,
            &session_id,
            &job,
            &trace_id,
            &job_id,
        ).await;
    } else {
        // 处理错误情况
        handle_job_result_error(
            &state,
            &session_id,
            &job_id,
            utterance_index,
            &trace_id,
            &job_error,
            elapsed_ms,
            &node_id,
        ).await;
    }
}
