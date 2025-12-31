use crate::core::dispatcher::Job;
use crate::messages::{SessionMessage, common::{ExtraResult, ServiceTimings, NetworkTimings}};
use tracing::info;

/// 计算耗时
pub(crate) fn calculate_elapsed_ms(job: &Option<Job>) -> Option<u64> {
    job.as_ref().map(|j| {
        chrono::Utc::now()
            .signed_duration_since(j.created_at)
            .num_milliseconds() as u64
    })
}

/// 创建 ServiceTimings
pub(crate) fn create_service_timings(
    extra: &Option<ExtraResult>,
    _processing_time_ms: Option<u64>,
) -> Option<ServiceTimings> {
    extra.as_ref()
        .and_then(|e| e.service_timings.clone())
        .or_else(|| {
            // 如果没有 service_timings，但有 processing_time_ms，创建一个包含总耗时的结构
            _processing_time_ms.map(|total| ServiceTimings {
                asr_ms: None,
                nmt_ms: None,
                tts_ms: None,
                total_ms: Some(total),
            })
        })
}

/// 创建 NetworkTimings
pub(crate) fn create_network_timings(
    job: &Option<Job>,
    node_completed_at_ms: Option<i64>,
) -> Option<NetworkTimings> {
    let now_ms = chrono::Utc::now().timestamp_millis();
    job.as_ref().and_then(|j| {
        let created_at_ms = j.created_at.timestamp_millis();
        let dispatched_at_ms = j.dispatched_at_ms?;
        
        // Web端到调度服务器：使用第一个音频块的客户端时间戳和调度服务器接收时间的差值
        let web_to_scheduler_ms = j.first_chunk_client_timestamp_ms.and_then(|client_ts| {
            if created_at_ms > client_ts {
                Some((created_at_ms - client_ts) as u64)
            } else {
                None // 时间戳异常
            }
        });
        
        // 调度服务器到节点端：dispatched_at_ms - created_at
        let scheduler_to_node_ms = if dispatched_at_ms > created_at_ms {
            Some((dispatched_at_ms - created_at_ms) as u64)
        } else {
            None
        };
        
        // 节点端返回结果到调度服务器：使用节点端处理完成时间戳和调度服务器接收时间的差值
        let node_to_scheduler_ms = node_completed_at_ms.and_then(|node_ts| {
            if now_ms > node_ts {
                Some((now_ms - node_ts) as u64)
            } else {
                None // 时间戳异常
            }
        });
        
        // 调度服务器返回结果到Web端：无法准确计算
        let scheduler_to_web_ms = None;
        
        Some(NetworkTimings {
            web_to_scheduler_ms,
            scheduler_to_node_ms,
            node_to_scheduler_ms,
            scheduler_to_web_ms,
        })
    })
}

/// 创建 TranslationResult 消息
pub(crate) fn create_translation_result(
    session_id: &str,
    utterance_index: u64,
    job_id: &str,
    text_asr: &Option<String>,
    text_translated: &Option<String>,
    tts_audio: &Option<String>,
    tts_format: &Option<String>,
    extra: &Option<ExtraResult>,
    trace_id: &str,
    group_id: &Option<String>,
    part_index: Option<u64>,
    service_timings: Option<ServiceTimings>,
    network_timings: Option<NetworkTimings>,
    scheduler_sent_at_ms: i64,
    asr_quality_level: &Option<String>,
    reason_codes: &Option<Vec<String>>,
    quality_score: Option<f32>,
    rerun_count: Option<u32>,
    segments_meta: &Option<crate::messages::common::SegmentsMeta>,
) -> SessionMessage {
    SessionMessage::TranslationResult {
        session_id: session_id.to_string(),
        utterance_index,
        job_id: job_id.to_string(),
        text_asr: text_asr.clone().unwrap_or_default(),
        text_translated: text_translated.clone().unwrap_or_default(),
        tts_audio: tts_audio.clone().unwrap_or_default(),
        tts_format: tts_format.clone().unwrap_or("pcm16".to_string()),
        extra: extra.clone(),
        trace_id: trace_id.to_string(),
        group_id: group_id.clone(),
        part_index,
        service_timings,
        network_timings,
        scheduler_sent_at_ms: Some(scheduler_sent_at_ms),
        // OBS-2: 透传 ASR 质量信息
        asr_quality_level: asr_quality_level.clone(),
        reason_codes: reason_codes.clone(),
        quality_score,
        rerun_count,
        segments_meta: segments_meta.clone(),
    }
}

/// 记录结果日志
pub(crate) fn log_translation_result(
    trace_id: &str,
    job_id: &str,
    session_id: &str,
    utterance_index: u64,
    text_asr: &Option<String>,
    text_translated: &Option<String>,
    tts_audio: &Option<String>,
    tts_format: &Option<String>,
    elapsed_ms: Option<u64>,
    service_timings: &Option<ServiceTimings>,
) {
    let elapsed_ms_str = elapsed_ms.map(|ms| format!("{}ms", ms)).unwrap_or_else(|| "N/A".to_string());
    let timings_str = service_timings.as_ref().map(|t| {
        format!(
            "ASR: {:?}ms, NMT: {:?}ms, TTS: {:?}ms, Total: {:?}ms",
            t.asr_ms, t.nmt_ms, t.tts_ms, t.total_ms
        )
    }).unwrap_or_else(|| "N/A".to_string());

    let asr_text = text_asr.as_deref().unwrap_or("(empty)");
    let translated_text = text_translated.as_deref().unwrap_or("(empty)");
    info!(
        trace_id = %trace_id,
        job_id = %job_id,
        session_id = %session_id,
        utterance_index = utterance_index,
        elapsed_ms = %elapsed_ms_str,
        service_timings = %timings_str,
        "Received JobResult, adding to result queue"
    );
    info!(
        trace_id = %trace_id,
        job_id = %job_id,
        "翻译结果详情 - 原文(ASR): \"{}\", 译文(NMT): \"{}\"",
        asr_text,
        translated_text
    );
    
    // 记录 TTS 音频信息（用于诊断）
    let tts_audio_len = tts_audio.as_ref().map(|s| s.len()).unwrap_or(0);
    let tts_format_str = tts_format.as_deref().unwrap_or("unknown");
    if tts_audio_len > 0 {
        info!(
            trace_id = %trace_id,
            job_id = %job_id,
            tts_audio_len = tts_audio_len,
            tts_format = %tts_format_str,
            "TTS 音频已接收（节点端返回）"
        );
    } else {
        tracing::warn!(
            trace_id = %trace_id,
            job_id = %job_id,
            tts_format = %tts_format_str,
            "⚠️ TTS 音频为空（节点端未返回音频数据）"
        );
    }
}

