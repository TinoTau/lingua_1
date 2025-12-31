use crate::core::AppState;
use crate::websocket::node_handler::util::extract_service_from_details;
use crate::messages::{ErrorCode, JobError, SessionMessage, UiEventStatus, UiEventType};
use crate::model_not_available::ModelNotAvailableEvent;
use tracing::error;

/// 处理错误情况
pub(crate) async fn handle_job_result_error(
    state: &AppState,
    session_id: &str,
    job_id: &str,
    utterance_index: u64,
    trace_id: &str,
    job_error: &Option<JobError>,
    elapsed_ms: Option<u64>,
    node_id: &str,
) {
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
                node_id: node_id.to_string(),
                service_id,
                service_version,
                reason,
            });
        }
    }

    let ui_event = SessionMessage::UiEvent {
        trace_id: trace_id.to_string(),
        session_id: session_id.to_string(),
        job_id: job_id.to_string(),
        utterance_index,
        event: UiEventType::Error,
        elapsed_ms,
        status: UiEventStatus::Error,
        error_code: error_code.clone(),
        hint: error_code
            .as_ref()
            .map(|code| crate::messages::get_error_hint(code).to_string()),
    };
    let _ = crate::phase2::send_session_message_routed(state, session_id, ui_event).await;

    // Send error to client
    error!(
        trace_id = %trace_id,
        job_id = %job_id,
        session_id = %session_id,
        "Job processing failed"
    );
    if let Some(err) = job_error {
        let error_msg = SessionMessage::Error {
            code: err.code.clone(),
            message: err.message.clone(),
            details: err.details.clone(),
        };
        let _ = crate::phase2::send_session_message_routed(state, session_id, error_msg).await;
    }
}

