use crate::core::AppState;
use crate::core::dispatcher::Job;
use crate::messages::SessionMessage;
use tracing::{info, warn};

/// 发送结果到客户端（支持房间模式和单会话模式）
pub(crate) async fn send_results_to_clients(
    state: &AppState,
    session_id: &str,
    job: &Option<Job>,
    trace_id: &str,
    job_id: &str,
) {
    // Try to send ready results
    let ready_results = state.result_queue.get_ready_results(session_id).await;
    info!(
        trace_id = %trace_id,
        session_id = %session_id,
        ready_results_count = ready_results.len(),
        "Getting ready results from queue"
    );
    for mut result in ready_results {
        // 检查结果是否为空（空文本应该发送 MissingResult 而不是直接跳过）
        let should_send_missing = check_and_handle_empty_result(
            state,
            session_id,
            job,
            &mut result,
            trace_id,
            job_id,
        ).await;
        
        if should_send_missing {
            continue; // 跳过原始结果，因为已经发送了 MissingResult
        }
        
        // Check if Job is in target_session_ids (room mode)
        if let Some(ref job_info) = job {
            if let Some(target_session_ids) = &job_info.target_session_ids {
                // Update room last speaking time
                if let Some(room_code) = state.room_manager.find_room_by_session(session_id).await {
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
                send_result_single_session(state, session_id, &result, trace_id).await;
            }
        } else {
            // Job does not exist, fallback to single session mode
            send_result_single_session(state, session_id, &result, trace_id).await;
        }
    }
}

/// 检查并处理空结果
async fn check_and_handle_empty_result(
    state: &AppState,
    session_id: &str,
    job: &Option<Job>,
    result: &mut SessionMessage,
    trace_id: &str,
    job_id: &str,
) -> bool {
    if let SessionMessage::TranslationResult { text_asr, text_translated, tts_audio, utterance_index, .. } = result {
        let asr_empty = text_asr.trim().is_empty();
        let translated_empty = text_translated.trim().is_empty();
        let tts_empty = tts_audio.is_empty();
        let has_text = !asr_empty || !translated_empty;
        
        // 如果ASR、翻译和TTS都为空，发送 MissingResult 消息
        if asr_empty && translated_empty && tts_empty {
            warn!(
                trace_id = %trace_id,
                session_id = %session_id,
                job_id = %job_id,
                utterance_index = utterance_index,
                "Empty translation result (silence detected), sending MissingResult to maintain utterance_index continuity"
            );
            
            let missing_result = SessionMessage::MissingResult {
                session_id: session_id.to_string(),
                utterance_index: *utterance_index,
                reason: "silence_detected".to_string(),
                created_at_ms: chrono::Utc::now().timestamp_millis(),
                trace_id: Some(trace_id.to_string()),
            };
            
            send_missing_result(state, session_id, job, missing_result, trace_id).await;
            return true;
        } else if has_text && tts_empty {
            // 即使有文本显示，如果音频为空，也需要标记出音频丢失的原因
            warn!(
                trace_id = %trace_id,
                session_id = %session_id,
                job_id = %job_id,
                utterance_index = utterance_index,
                "Translation result has text but no audio, marking audio loss reason"
            );
            
            if let SessionMessage::TranslationResult { text_asr, text_translated, .. } = result {
                if !text_asr.trim().is_empty() {
                    *text_asr = format!("[音频丢失] {}", text_asr);
                }
                if !text_translated.trim().is_empty() {
                    *text_translated = format!("[音频丢失] {}", text_translated);
                }
            }
        }
    }
    false
}

/// 发送 MissingResult 消息
async fn send_missing_result(
    state: &AppState,
    session_id: &str,
    job: &Option<Job>,
    missing_result: SessionMessage,
    trace_id: &str,
) {
    if let Some(ref job_info) = job {
        if let Some(target_session_ids) = &job_info.target_session_ids {
            // Room mode: send to all target sessions
            for target_session_id in target_session_ids {
                if !crate::phase2::send_session_message_routed(state, target_session_id, missing_result.clone()).await {
                    tracing::warn!(
                        trace_id = %trace_id,
                        session_id = %target_session_id,
                        "Failed to send MissingResult to target session"
                    );
                }
            }
        } else {
            // Single session mode: send to sender
            if !crate::phase2::send_session_message_routed(state, session_id, missing_result).await {
                tracing::warn!(
                    trace_id = %trace_id,
                    session_id = %session_id,
                    "Failed to send MissingResult to session"
                );
            }
        }
    } else {
        // Job does not exist, fallback to single session mode
        if !crate::phase2::send_session_message_routed(state, session_id, missing_result).await {
            tracing::warn!(
                trace_id = %trace_id,
                session_id = %session_id,
                "Failed to send MissingResult to session (fallback mode)"
            );
        }
    }
}

/// 单会话模式发送结果
async fn send_result_single_session(
    state: &AppState,
    session_id: &str,
    result: &SessionMessage,
    trace_id: &str,
) {
    if let SessionMessage::TranslationResult { text_asr, text_translated, tts_audio, .. } = result {
        info!(
            trace_id = %trace_id,
            session_id = %session_id,
            text_asr = %text_asr,
            text_translated = %text_translated,
            tts_audio_len = tts_audio.len(),
            "Sending translation result to session"
        );
    } else {
        info!(
            trace_id = %trace_id,
            session_id = %session_id,
            "Sending translation result to session"
        );
    }
    if !crate::phase2::send_session_message_routed(state, session_id, result.clone()).await {
        warn!(trace_id = %trace_id, session_id = %session_id, "Failed to send result to session");
    } else {
        info!(
            trace_id = %trace_id,
            session_id = %session_id,
            "Successfully sent translation result to session"
        );
    }
}

