use crate::core::AppState;
use crate::messages::{SessionMessage, UiEventStatus, UiEventType};

/// 发送 UI 事件（ASR_FINAL、NMT_DONE）
pub(crate) async fn send_ui_events_for_job_result(
    state: &AppState,
    session_id: &str,
    job_id: &str,
    utterance_index: u64,
    trace_id: &str,
    text_asr: &Option<String>,
    text_translated: &Option<String>,
    elapsed_ms: Option<u64>,
) {
    if let Some(ref text_asr) = text_asr {
        if !text_asr.is_empty() {
            let ui_event = SessionMessage::UiEvent {
                trace_id: trace_id.to_string(),
                session_id: session_id.to_string(),
                job_id: job_id.to_string(),
                utterance_index,
                event: UiEventType::AsrFinal,
                elapsed_ms,
                status: UiEventStatus::Ok,
                error_code: None,
                hint: None,
            };
            let _ = crate::redis_runtime::send_session_message_routed(state, session_id, ui_event).await;
        }
    }

    // Send NMT_DONE event (translation completed)
    if let Some(ref text_translated) = text_translated {
        if !text_translated.is_empty() {
            let ui_event = SessionMessage::UiEvent {
                trace_id: trace_id.to_string(),
                session_id: session_id.to_string(),
                job_id: job_id.to_string(),
                utterance_index,
                event: UiEventType::NmtDone,
                elapsed_ms,
                status: UiEventStatus::Ok,
                error_code: None,
                hint: None,
            };
            let _ = crate::redis_runtime::send_session_message_routed(state, session_id, ui_event).await;
        }
    }
}

