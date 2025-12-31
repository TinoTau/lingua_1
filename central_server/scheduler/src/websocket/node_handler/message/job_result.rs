use super::super::util::extract_service_from_details;
use crate::core::AppState;
use crate::messages::{ErrorCode, JobError, SessionMessage, UiEventStatus, UiEventType};
use crate::messages::common::ExtraResult;
use crate::model_not_available::ModelNotAvailableEvent;
use crate::phase2::InterInstanceEvent;
use crate::metrics::metrics;
use tracing::{debug, error, info, warn};

pub(super) async fn handle_job_result(
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
    // 核销机制：检查是否在30秒内已经收到过相同job_id的结果
    // 如果是，直接过滤掉，避免重复输出
    if state.job_result_deduplicator.check_and_record(&session_id, &job_id).await {
        warn!(
            trace_id = %trace_id,
            job_id = %job_id,
            session_id = %session_id,
            utterance_index = utterance_index,
            "Duplicate job_result filtered (received within 30 seconds), skipping processing"
        );
        return; // 直接返回，不进行后续处理
    }

    // Phase 1: Support failover retry, must ignore "stale node" results (avoid race condition)
    // 但是，为了确保 utterance_index 的连续性，即使 Job 状态不匹配，也应该将结果添加到队列
    let job = state.dispatcher.get_job(&job_id).await;
    let should_process_job = if let Some(ref j) = job {
        if matches!(
            j.status,
            crate::core::dispatcher::JobStatus::Completed | crate::core::dispatcher::JobStatus::Failed
        ) {
            warn!(
                trace_id = %trace_id,
                job_id = %job_id,
                node_id = %node_id,
                current_node_id = ?j.assigned_node_id,
                "Received result for terminated Job, will still add to result queue for utterance_index continuity"
            );
            false  // 不处理 Job 相关操作（释放 slot、更新状态等），但仍添加到队列
        } else if j.assigned_node_id.as_deref() != Some(&node_id) {
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
        // Phase 2: Cross-instance (node on A, job/session on B), local dispatcher may not have job
        // In this case, forward result to session owner, let owner instance complete result queue and downstream push
        if let Some(rt) = state.phase2.as_ref() {
            if let Some(owner) = rt.resolve_session_owner(&session_id).await {
                if owner != rt.instance_id {
                    let forwarded = crate::messages::NodeMessage::JobResult {
                        job_id: job_id.clone(),
                        attempt_id,
                        node_id: node_id.clone(),
                        session_id: session_id.clone(),
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
                        trace_id: trace_id.clone(),
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
                    return;  // Phase 2 转发后返回，由 owner 实例处理
                }
            }
        }

        warn!(
            trace_id = %trace_id,
            job_id = %job_id,
            node_id = %node_id,
            "Received JobResult but Job does not exist, will still add to result queue for utterance_index continuity"
        );
        false  // 不处理 Job 相关操作，但仍添加到队列
    };

    // 只有在 should_process_job 为 true 时才执行 Job 相关操作（释放 slot、更新状态等）
    if should_process_job {
        // Phase 1: Only release reserved when receiving "valid result" (idempotent)
        state.node_registry.release_job_slot(&node_id, &job_id).await;
        // Phase 2: Release Redis reservation (idempotent)
        if let Some(rt) = state.phase2.as_ref() {
            rt.release_node_slot(&node_id, &job_id).await;
        }

        // Phase 2: Job FSM -> FINISHED
        if let Some(rt) = state.phase2.as_ref() {
            let _ = rt.job_fsm_to_finished(&job_id, attempt_id, success).await;
            // Mark RELEASED after release (follow FSM: FINISHED -> RELEASED)
            let _ = rt.job_fsm_to_released(&job_id).await;
        }

        // Update job status (only when node_id == assigned_node_id)
        if success {
            state
                .dispatcher
                .update_job_status(&job_id, crate::core::dispatcher::JobStatus::Completed)
                .await;
        } else {
            state
                .dispatcher
                .update_job_status(&job_id, crate::core::dispatcher::JobStatus::Failed)
                .await;
        }
    }


    // Calculate elapsed_ms
    let elapsed_ms = job.as_ref().map(|j| {
        chrono::Utc::now()
            .signed_duration_since(j.created_at)
            .num_milliseconds() as u64
    });

    // Utterance Group processing: when receiving JobResult, if ASR result exists, call GroupManager
    let (group_id, part_index) = if let Some(ref text_asr) = text_asr {
        if !text_asr.is_empty() {
            let now_ms = chrono::Utc::now().timestamp_millis() as u64;
            let (gid, _context, pidx) = state
                .group_manager
                .on_asr_final(&session_id, &trace_id, utterance_index, text_asr.clone(), now_ms)
                .await;

            // If translation result exists, update Group
            if let Some(ref text_translated) = text_translated {
                if !text_translated.is_empty() {
                    state
                        .group_manager
                        .on_nmt_done(&gid, pidx, Some(text_translated.clone()), None)
                        .await;
                }
            }

            (Some(gid), Some(pidx))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    if success {
        // Send ASR_FINAL event (ASR completed)
        if let Some(ref text_asr) = text_asr {
            if !text_asr.is_empty() {
                let ui_event = SessionMessage::UiEvent {
                    trace_id: trace_id.clone(),
                    session_id: session_id.clone(),
                    job_id: job_id.clone(),
                    utterance_index,
                    event: UiEventType::AsrFinal,
                    elapsed_ms,
                    status: UiEventStatus::Ok,
                    error_code: None,
                    hint: None,
                };
                let _ = crate::phase2::send_session_message_routed(state, &session_id, ui_event).await;
            }
        }

        // Send NMT_DONE event (translation completed)
        if let Some(ref text_translated) = text_translated {
            if !text_translated.is_empty() {
                let ui_event = SessionMessage::UiEvent {
                    trace_id: trace_id.clone(),
                    session_id: session_id.clone(),
                    job_id: job_id.clone(),
                    utterance_index,
                    event: UiEventType::NmtDone,
                    elapsed_ms,
                    status: UiEventStatus::Ok,
                    error_code: None,
                    hint: None,
                };
                let _ = crate::phase2::send_session_message_routed(state, &session_id, ui_event).await;
            }
        }

        // 从 extra 中提取 service_timings，如果没有则尝试从 processing_time_ms 构造
        let service_timings = extra.as_ref()
            .and_then(|e| e.service_timings.clone())
            .or_else(|| {
                // 如果没有 service_timings，但有 processing_time_ms，创建一个包含总耗时的结构
                _processing_time_ms.map(|total| crate::messages::common::ServiceTimings {
                    asr_ms: None,
                    nmt_ms: None,
                    tts_ms: None,
                    total_ms: Some(total),
                })
            });

        // 计算网络传输耗时（使用时间戳+时区）
        let now_ms = chrono::Utc::now().timestamp_millis();
        let scheduler_sent_at_ms = now_ms; // 记录调度服务器发送结果的时间戳
        let network_timings = job.as_ref().and_then(|j| {
            let created_at_ms = j.created_at.timestamp_millis();
            let dispatched_at_ms = j.dispatched_at_ms?;
            
            // Web端到调度服务器：使用第一个音频块的客户端时间戳和调度服务器接收时间的差值
            // 如果客户端时间戳存在，使用 created_at_ms - first_chunk_client_timestamp_ms
            // 否则使用 None（无法准确计算）
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
            // 如果节点端时间戳存在，使用 now_ms - node_completed_at_ms
            // 否则使用 None（无法准确计算）
            let node_to_scheduler_ms = node_completed_at_ms.and_then(|node_ts| {
                if now_ms > node_ts {
                    Some((now_ms - node_ts) as u64)
                } else {
                    None // 时间戳异常
                }
            });
            
            // 调度服务器返回结果到Web端：无法准确计算，因为不知道Web端接收时间
            // 这里我们设为 None，实际应该在Web端计算（使用 scheduler_sent_at_ms 和客户端接收时间的差值）
            let scheduler_to_web_ms = None;
            
            Some(crate::messages::common::NetworkTimings {
                web_to_scheduler_ms,
                scheduler_to_node_ms,
                node_to_scheduler_ms,
                scheduler_to_web_ms,
            })
        });

        // OBS-1: 记录 ASR 指标
        if let Some(elapsed) = elapsed_ms {
            metrics::record_asr_e2e_latency(elapsed);
        }
        if let Some(ref extra) = extra {
            if let Some(lang_prob) = extra.language_probability {
                metrics::record_lang_probability(lang_prob);
            }
        }
        if asr_quality_level.as_deref() == Some("bad") {
            metrics::record_bad_segment();
        }
        if rerun_count.is_some() && rerun_count.unwrap_or(0) > 0 {
            metrics::record_rerun_trigger();
        }

        // 准备日志输出（在移动 service_timings 之前）
        let elapsed_ms_str = elapsed_ms.map(|ms| format!("{}ms", ms)).unwrap_or_else(|| "N/A".to_string());
        let timings_str = service_timings.as_ref().map(|t| {
            format!(
                "ASR: {:?}ms, NMT: {:?}ms, TTS: {:?}ms, Total: {:?}ms",
                t.asr_ms, t.nmt_ms, t.tts_ms, t.total_ms
            )
        }).unwrap_or_else(|| "N/A".to_string());

        // Create translation result message
        let result = SessionMessage::TranslationResult {
            session_id: session_id.clone(),
            utterance_index,
            job_id: job_id.clone(),
            text_asr: text_asr.clone().unwrap_or_default(),
            text_translated: text_translated.clone().unwrap_or_default(),
            tts_audio: tts_audio.clone().unwrap_or_default(),
            tts_format: tts_format.clone().unwrap_or("pcm16".to_string()),
            extra: extra.clone(),
            trace_id: trace_id.clone(),
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
        };
        // 记录详细的翻译结果日志（便于检查翻译准确性）
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
            warn!(
                trace_id = %trace_id,
                job_id = %job_id,
                tts_format = %tts_format_str,
                "⚠️ TTS 音频为空（节点端未返回音频数据）"
            );
        }

        // Add to result queue (use sender's session_id)
        state
            .result_queue
            .add_result(&session_id, utterance_index, result.clone())
            .await;

        // Try to send ready results
        let ready_results = state.result_queue.get_ready_results(&session_id).await;
        info!(
            trace_id = %trace_id,
            session_id = %session_id,
            ready_results_count = ready_results.len(),
            "Getting ready results from queue"
        );
        for mut result in ready_results {
            // 检查结果是否为空（空文本应该发送 MissingResult 而不是直接跳过）
            // 修复：即使有文本显示，如果音频为空，也需要标记出音频丢失的原因
            let should_send_missing = if let SessionMessage::TranslationResult { text_asr, text_translated, tts_audio, utterance_index, .. } = &result {
                let asr_empty = text_asr.trim().is_empty();
                let translated_empty = text_translated.trim().is_empty();
                let tts_empty = tts_audio.is_empty();
                let has_text = !asr_empty || !translated_empty;
                
                // 如果ASR、翻译和TTS都为空，发送 MissingResult 消息（保持 utterance_index 连续性）
                if asr_empty && translated_empty && tts_empty {
                    warn!(
                        trace_id = %trace_id,
                        session_id = %session_id,
                        job_id = %job_id,
                        utterance_index = utterance_index,
                        "Empty translation result (silence detected), sending MissingResult to maintain utterance_index continuity"
                    );
                    
                    // 创建 MissingResult 消息
                    let missing_result = SessionMessage::MissingResult {
                        session_id: session_id.clone(),
                        utterance_index: *utterance_index,
                        reason: "silence_detected".to_string(),
                        created_at_ms: chrono::Utc::now().timestamp_millis(),
                        trace_id: Some(trace_id.clone()),
                    };
                    
                    // 发送 MissingResult 消息（支持房间模式和单会话模式）
                    if let Some(ref job_info) = job {
                        if let Some(target_session_ids) = &job_info.target_session_ids {
                            // Room mode: send to all target sessions
                            for target_session_id in target_session_ids {
                                if !crate::phase2::send_session_message_routed(state, target_session_id, missing_result.clone()).await {
                                    warn!(
                                        trace_id = %trace_id,
                                        session_id = %target_session_id,
                                        "Failed to send MissingResult to target session"
                                    );
                                }
                            }
                        } else {
                            // Single session mode: send to sender
                            if !crate::phase2::send_session_message_routed(state, &session_id, missing_result).await {
                                warn!(
                                    trace_id = %trace_id,
                                    session_id = %session_id,
                                    "Failed to send MissingResult to session"
                                );
                            }
                        }
                    } else {
                        // Job does not exist, fallback to single session mode
                        if !crate::phase2::send_session_message_routed(state, &session_id, missing_result).await {
                            warn!(
                                trace_id = %trace_id,
                                session_id = %session_id,
                                "Failed to send MissingResult to session (fallback mode)"
                            );
                        }
                    }
                    
                    true
                } else if has_text && tts_empty {
                    // 修复：即使有文本显示，如果音频为空，也需要标记出音频丢失的原因
                    // 修改 TranslationResult，在文本前添加 [音频丢失] 标记
                    warn!(
                        trace_id = %trace_id,
                        session_id = %session_id,
                        job_id = %job_id,
                        utterance_index = utterance_index,
                        "Translation result has text but no audio, marking audio loss reason"
                    );
                    
                    // 修改 result 中的文本，添加音频丢失标记
                    if let SessionMessage::TranslationResult { text_asr, text_translated, .. } = &mut result {
                        if !text_asr.trim().is_empty() {
                            *text_asr = format!("[音频丢失] {}", text_asr);
                        }
                        if !text_translated.trim().is_empty() {
                            *text_translated = format!("[音频丢失] {}", text_translated);
                        }
                    }
                    
                    false // 不发送 MissingResult，而是修改原始结果
                } else {
                    false
                }
            } else {
                false
            };
            
            if should_send_missing {
                continue; // 跳过原始结果，因为已经发送了 MissingResult
            }
            
            // Check if Job is in target_session_ids (room mode)
            if let Some(ref job_info) = job {
                if let Some(target_session_ids) = &job_info.target_session_ids {
                    // Update room last speaking time
                    if let Some(room_code) = state.room_manager.find_room_by_session(&session_id).await {
                        state.room_manager.update_last_speaking_at(&room_code).await;
                    }

                    for target_session_id in target_session_ids {
                        if !crate::phase2::send_session_message_routed(state, target_session_id, result.clone()).await {
                            warn!(
                                trace_id = %trace_id,
                                session_id = %target_session_id,
                                "Failed to send result to target session"
                            );
                        }
                    }
                } else {
                    // Single session mode: only send to sender
                    // 只打印摘要信息，不打印完整的 tts_audio 内容
                    if let SessionMessage::TranslationResult { text_asr, text_translated, tts_audio, .. } = &result {
                        info!(
                            trace_id = %trace_id,
                            session_id = %session_id,
                            text_asr = %text_asr,
                            text_translated = %text_translated,
                            tts_audio_len = tts_audio.len(),
                            "Sending translation result to session (single mode)"
                        );
                    } else {
                        info!(
                            trace_id = %trace_id,
                            session_id = %session_id,
                            "Sending translation result to session (single mode)"
                        );
                    }
                    if !crate::phase2::send_session_message_routed(state, &session_id, result.clone()).await {
                        warn!(trace_id = %trace_id, session_id = %session_id, "Failed to send result to session");
                    } else {
                        info!(
                            trace_id = %trace_id,
                            session_id = %session_id,
                            "Successfully sent translation result to session"
                        );
                    }
                }
            } else {
                // Job does not exist, fallback to single session mode
                // 只打印摘要信息，不打印完整的 tts_audio 内容
                if let SessionMessage::TranslationResult { text_asr, text_translated, tts_audio, .. } = &result {
                    info!(
                        trace_id = %trace_id,
                        session_id = %session_id,
                        text_asr = %text_asr,
                        text_translated = %text_translated,
                        tts_audio_len = tts_audio.len(),
                        "Sending translation result to session (fallback mode, job not found)"
                    );
                } else {
                    info!(
                        trace_id = %trace_id,
                        session_id = %session_id,
                        "Sending translation result to session (fallback mode, job not found)"
                    );
                }
                if !crate::phase2::send_session_message_routed(state, &session_id, result.clone()).await {
                    warn!(trace_id = %trace_id, session_id = %session_id, "Failed to send result to session");
                } else {
                    info!(
                        trace_id = %trace_id,
                        session_id = %session_id,
                        "Successfully sent translation result to session (fallback)"
                    );
                }
            }
        }
    } else {
        // Send ERROR event
        let error_code = job_error.as_ref().and_then(|e| match e.code.as_str() {
            "NO_AVAILABLE_NODE" => Some(ErrorCode::NoAvailableNode),
            "MODEL_NOT_AVAILABLE" => Some(ErrorCode::ModelNotAvailable),
            "WS_DISCONNECTED" => Some(ErrorCode::WsDisconnected),
            "NMT_TIMEOUT" => Some(ErrorCode::NmtTimeout),
            "TTS_TIMEOUT" => Some(ErrorCode::TtsTimeout),
            "MODEL_VERIFY_FAILED" => Some(ErrorCode::ModelVerifyFailed),
            "MODEL_CORRUPTED" => Some(ErrorCode::ModelCorrupted),
            _ => None,
        });

        // Phase 1: MODEL_NOT_AVAILABLE main path only enqueues, background does "temporarily unavailable marking"
        if job_error.as_ref().map(|e| e.code.as_str()) == Some("MODEL_NOT_AVAILABLE") {
            if let Some((service_id, service_version, reason)) = job_error
                .as_ref()
                .and_then(|e| e.details.as_ref())
                .and_then(|details| extract_service_from_details(details))
            {
                state.model_not_available_bus.enqueue(ModelNotAvailableEvent {
                    node_id: node_id.clone(),
                    service_id,
                    service_version,
                    reason,
                });
            }
        }

        let ui_event = SessionMessage::UiEvent {
            trace_id: trace_id.clone(),
            session_id: session_id.clone(),
            job_id: job_id.clone(),
            utterance_index,
            event: UiEventType::Error,
            elapsed_ms,
            status: UiEventStatus::Error,
            error_code: error_code.clone(),
            hint: error_code
                .as_ref()
                .map(|code| crate::messages::get_error_hint(code).to_string()),
        };
        let _ = crate::phase2::send_session_message_routed(state, &session_id, ui_event).await;

        // Send error to client
        error!(
            trace_id = %trace_id,
            job_id = %job_id,
            session_id = %session_id,
            "Job processing failed"
        );
        if let Some(err) = job_error {
            let error_msg = SessionMessage::Error {
                code: err.code,
                message: err.message,
                details: err.details,
            };
            let _ = crate::phase2::send_session_message_routed(state, &session_id, error_msg).await;
        }
    }
}
