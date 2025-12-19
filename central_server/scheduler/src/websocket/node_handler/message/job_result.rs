use super::super::util::extract_service_from_details;
use crate::core::AppState;
use crate::messages::{ErrorCode, JobError, SessionMessage, UiEventStatus, UiEventType};
use crate::messages::common::ExtraResult;
use crate::model_not_available::ModelNotAvailableEvent;
use crate::phase2::InterInstanceEvent;
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
) {
    // Phase 1: Support failover retry, must ignore "stale node" results (avoid race condition)
    let job = state.dispatcher.get_job(&job_id).await;
    if let Some(ref j) = job {
        if matches!(
            j.status,
            crate::core::dispatcher::JobStatus::Completed | crate::core::dispatcher::JobStatus::Failed
        ) {
            warn!(
                trace_id = %trace_id,
                job_id = %job_id,
                node_id = %node_id,
                current_node_id = ?j.assigned_node_id,
                "Received result for terminated Job, ignoring"
            );
            return;
        }
        if j.assigned_node_id.as_deref() != Some(&node_id) {
            warn!(
                trace_id = %trace_id,
                job_id = %job_id,
                node_id = %node_id,
                current_node_id = ?j.assigned_node_id,
                "Received JobResult from non-current node (possible failover), ignoring"
            );
            return;
        }
        if j.dispatch_attempt_id != attempt_id {
            warn!(
                trace_id = %trace_id,
                job_id = %job_id,
                node_id = %node_id,
                attempt_id = attempt_id,
                current_attempt_id = j.dispatch_attempt_id,
                "Received JobResult for non-current attempt (possible cancel/retry), ignoring"
            );
            return;
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
                        error: job_error.clone(),
                        trace_id: trace_id.clone(),
                        group_id: None,
                        part_index: None,
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
                    return;
                }
            }
        }

        warn!(
            trace_id = %trace_id,
            job_id = %job_id,
            node_id = %node_id,
            "Received JobResult but Job does not exist, ignoring"
        );
        return;
    }

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
        };

        info!(
            trace_id = %trace_id,
            job_id = %job_id,
            session_id = %session_id,
            utterance_index = utterance_index,
            "Received JobResult, adding to result queue"
        );

        // Add to result queue (use sender's session_id)
        state
            .result_queue
            .add_result(&session_id, utterance_index, result.clone())
            .await;

        // Try to send ready results
        let ready_results = state.result_queue.get_ready_results(&session_id).await;
        for result in ready_results {
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
                    if !crate::phase2::send_session_message_routed(state, &session_id, result.clone()).await {
                        warn!(trace_id = %trace_id, session_id = %session_id, "Failed to send result to session");
                    }
                }
            } else {
                // Job does not exist, fallback to single session mode
                if !crate::phase2::send_session_message_routed(state, &session_id, result.clone()).await {
                    warn!(trace_id = %trace_id, session_id = %session_id, "Failed to send result to session");
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
