use crate::core::AppState;
use crate::messages::{SessionMessage, UiEventStatus, UiEventType};
use crate::phase2::InterInstanceEvent;
use tracing::{debug, warn};

async fn forward_if_job_missing(state: &AppState, session_id: &str, msg: crate::messages::NodeMessage) -> bool {
    let Some(rt) = state.phase2.as_ref() else { return false };
    let Some(owner) = rt.resolve_session_owner(session_id).await else { return false };
    if owner == rt.instance_id {
        return false;
    }
    let ok = rt
        .enqueue_to_instance(&owner, &InterInstanceEvent::ForwardNodeMessage { message: msg })
        .await;
    ok
}

pub(super) async fn handle_job_ack(
    state: &AppState,
    job_id: String,
    attempt_id: u32,
    node_id: String,
    session_id: String,
    trace_id: String,
) {
    // Validate job belongs to attempt (avoid failover race condition)
    let job = state.dispatcher.get_job(&job_id).await;
    if let Some(ref j) = job {
        if matches!(
            j.status,
            crate::core::dispatcher::JobStatus::Completed | crate::core::dispatcher::JobStatus::Failed
        ) {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, "Received JobAck for terminated Job, ignoring");
            return;
        }
        if j.assigned_node_id.as_deref() != Some(&node_id) {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, current_node_id = ?j.assigned_node_id, "Received JobAck from non-current node, ignoring");
            return;
        }
        if j.dispatch_attempt_id != attempt_id {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, attempt_id = attempt_id, current_attempt_id = j.dispatch_attempt_id, "Received JobAck for non-current attempt, ignoring");
            return;
        }
    } else {
        // Phase 2: Cross-instance, forward to session owner
        let forwarded = crate::messages::NodeMessage::JobAck {
            job_id: job_id.clone(),
            attempt_id,
            node_id: node_id.clone(),
            session_id: session_id.clone(),
            trace_id: trace_id.clone(),
        };
        if forward_if_job_missing(state, &session_id, forwarded).await {
            debug!(
                trace_id = %trace_id,
                job_id = %job_id,
                node_id = %node_id,
                session_id = %session_id,
                "Local Job missing, forwarded JobAck to session owner"
            );
        } else {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, "Received JobAck but Job does not exist, ignoring");
        }
        return;
    }

    // Update job status to Processing (optional, but closer to FSM)
    let _ = state
        .dispatcher
        .update_job_status(&job_id, crate::core::dispatcher::JobStatus::Processing)
        .await;

    // Phase 2: FSM -> ACCEPTED (idempotent)
    if let Some(rt) = state.phase2.as_ref() {
        let _ = rt.job_fsm_to_accepted(&job_id, attempt_id).await;
    }

    // Send NODE_ACCEPTED event (unified UI event)
    let ui_event = SessionMessage::UiEvent {
        trace_id: trace_id.clone(),
        session_id: session_id.clone(),
        job_id: job_id.clone(),
        utterance_index: job.as_ref().map(|j| j.utterance_index).unwrap_or(0),
        event: UiEventType::NodeAccepted,
        elapsed_ms: None,
        status: UiEventStatus::Ok,
        error_code: None,
        hint: None,
    };
    let _ = crate::phase2::send_session_message_routed(state, &session_id, ui_event).await;
}

pub(super) async fn handle_job_started(
    state: &AppState,
    job_id: String,
    attempt_id: u32,
    node_id: String,
    session_id: String,
    trace_id: String,
) {
    // Strict RUNNING: only accept "current node + current attempt" started
    let job = state.dispatcher.get_job(&job_id).await;
    if let Some(ref j) = job {
        if matches!(
            j.status,
            crate::core::dispatcher::JobStatus::Completed | crate::core::dispatcher::JobStatus::Failed
        ) {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, "Received JobStarted for terminated Job, ignoring");
            return;
        }
        if j.assigned_node_id.as_deref() != Some(&node_id) {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, current_node_id = ?j.assigned_node_id, "Received JobStarted from non-current node, ignoring");
            return;
        }
        if j.dispatch_attempt_id != attempt_id {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, attempt_id = attempt_id, current_attempt_id = j.dispatch_attempt_id, "Received JobStarted for non-current attempt, ignoring");
            return;
        }
    } else {
        // Phase 2: Cross-instance, forward to session owner
        let forwarded = crate::messages::NodeMessage::JobStarted {
            job_id: job_id.clone(),
            attempt_id,
            node_id: node_id.clone(),
            session_id: session_id.clone(),
            trace_id: trace_id.clone(),
        };
        if forward_if_job_missing(state, &session_id, forwarded).await {
            debug!(
                trace_id = %trace_id,
                job_id = %job_id,
                node_id = %node_id,
                session_id = %session_id,
                "Local Job missing, forwarded JobStarted to session owner"
            );
        } else {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, "Received JobStarted but Job does not exist, ignoring");
        }
        return;
    }

    // Update job status to Processing (idempotent)
    let _ = state
        .dispatcher
        .update_job_status(&job_id, crate::core::dispatcher::JobStatus::Processing)
        .await;

    // Phase 2: FSM -> RUNNING (strict)
    if let Some(rt) = state.phase2.as_ref() {
        let _ = rt.job_fsm_to_running(&job_id).await;
    }
}

pub(super) async fn handle_asr_partial(
    state: &AppState,
    job_id: String,
    node_id: String,
    session_id: String,
    utterance_index: u64,
    text: String,
    is_final: bool,
    trace_id: String,
) {
    // Phase 2: If local job missing, forward partial result to session owner (result_queue on owner)
    if state.phase2.is_some() && state.dispatcher.get_job(&job_id).await.is_none() {
        let forwarded = crate::messages::NodeMessage::AsrPartial {
            job_id: job_id.clone(),
            node_id: node_id.clone(),
            session_id: session_id.clone(),
            utterance_index,
            text: text.clone(),
            is_final,
            trace_id: trace_id.clone(),
        };
        if forward_if_job_missing(state, &session_id, forwarded).await {
            debug!(
                trace_id = %trace_id,
                job_id = %job_id,
                node_id = %node_id,
                session_id = %session_id,
                "Local Job missing, forwarded AsrPartial to session owner"
            );
            return;
        }
    }

    // Phase 2: Receiving partial result can be considered RUNNING (ignore if job_id doesn't match current assigned node)
    if let Some(ref j) = state.dispatcher.get_job(&job_id).await {
        if j.assigned_node_id.as_deref() == Some(&node_id) {
            if let Some(rt) = state.phase2.as_ref() {
                let _ = rt.job_fsm_to_running(&job_id).await;
            }
        }
    }

    // Forward ASR partial result to client
    let partial_msg = SessionMessage::AsrPartial {
        session_id: session_id.clone(),
        utterance_index,
        job_id: String::new(), // Partial result doesn't need job_id
        text: text.clone(),
        is_final,
        trace_id: trace_id.clone(),
    };
    if !crate::phase2::send_session_message_routed(state, &session_id, partial_msg).await {
        warn!(trace_id = %trace_id, session_id = %session_id, "Failed to send ASR partial result to session");
    }

    // Send ASR_PARTIAL event
    let ui_event = SessionMessage::UiEvent {
        trace_id: trace_id.clone(),
        session_id: session_id.clone(),
        job_id: String::new(),
        utterance_index,
        event: UiEventType::AsrPartial,
        elapsed_ms: None,
        status: UiEventStatus::Ok,
        error_code: None,
        hint: None,
    };
    let _ = crate::phase2::send_session_message_routed(state, &session_id, ui_event).await;
}
