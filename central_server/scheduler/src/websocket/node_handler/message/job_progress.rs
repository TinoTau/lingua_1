use crate::app_state::AppState;
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
    // 校验 job 归属与 attempt（避免 failover 竞态）
    let job = state.dispatcher.get_job(&job_id).await;
    if let Some(ref j) = job {
        if matches!(
            j.status,
            crate::dispatcher::JobStatus::Completed | crate::dispatcher::JobStatus::Failed
        ) {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, "收到已终态 Job 的 JobAck，忽略");
            return;
        }
        if j.assigned_node_id.as_deref() != Some(&node_id) {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, current_node_id = ?j.assigned_node_id, "收到非当前节点的 JobAck，忽略");
            return;
        }
        if j.dispatch_attempt_id != attempt_id {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, attempt_id = attempt_id, current_attempt_id = j.dispatch_attempt_id, "收到非当前 attempt 的 JobAck，忽略");
            return;
        }
    } else {
        // Phase 2：跨实例时转发给 session owner
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
                "本地无 Job，已将 JobAck 转发给 session owner"
            );
        } else {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, "收到 JobAck，但 Job 不存在，忽略");
        }
        return;
    }

    // 更新 job 状态为 Processing（可选，但更贴近 FSM）
    let _ = state
        .dispatcher
        .update_job_status(&job_id, crate::dispatcher::JobStatus::Processing)
        .await;

    // Phase 2：FSM -> ACCEPTED（幂等）
    if let Some(rt) = state.phase2.as_ref() {
        let _ = rt.job_fsm_to_accepted(&job_id, attempt_id).await;
    }

    // 推送 NODE_ACCEPTED 事件（弱一致 UI 事件）
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
    // 严格 RUNNING：只接受“当前节点 + 当前 attempt”的 started
    let job = state.dispatcher.get_job(&job_id).await;
    if let Some(ref j) = job {
        if matches!(
            j.status,
            crate::dispatcher::JobStatus::Completed | crate::dispatcher::JobStatus::Failed
        ) {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, "收到已终态 Job 的 JobStarted，忽略");
            return;
        }
        if j.assigned_node_id.as_deref() != Some(&node_id) {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, current_node_id = ?j.assigned_node_id, "收到非当前节点的 JobStarted，忽略");
            return;
        }
        if j.dispatch_attempt_id != attempt_id {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, attempt_id = attempt_id, current_attempt_id = j.dispatch_attempt_id, "收到非当前 attempt 的 JobStarted，忽略");
            return;
        }
    } else {
        // Phase 2：跨实例时转发给 session owner
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
                "本地无 Job，已将 JobStarted 转发给 session owner"
            );
        } else {
            warn!(trace_id = %trace_id, job_id = %job_id, node_id = %node_id, "收到 JobStarted，但 Job 不存在，忽略");
        }
        return;
    }

    // 更新 job 状态为 Processing（幂等）
    let _ = state
        .dispatcher
        .update_job_status(&job_id, crate::dispatcher::JobStatus::Processing)
        .await;

    // Phase 2：FSM -> RUNNING（严格）
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
    // Phase 2：如果本地没有 job，则将部分结果转发到 session owner（result_queue 在 owner 上）
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
                "本地无 Job，已将 AsrPartial 转发给 session owner"
            );
            return;
        }
    }

    // Phase 2：收到部分结果可视为 RUNNING（若 job_id 与当前分配节点不一致则忽略）
    if let Some(ref j) = state.dispatcher.get_job(&job_id).await {
        if j.assigned_node_id.as_deref() == Some(&node_id) {
            if let Some(rt) = state.phase2.as_ref() {
                let _ = rt.job_fsm_to_running(&job_id).await;
            }
        }
    }

    // 转发 ASR 部分结果给客户端
    let partial_msg = SessionMessage::AsrPartial {
        session_id: session_id.clone(),
        utterance_index,
        job_id: String::new(), // 部分结果不需要 job_id
        text: text.clone(),
        is_final,
        trace_id: trace_id.clone(),
    };
    if !crate::phase2::send_session_message_routed(state, &session_id, partial_msg).await {
        warn!(trace_id = %trace_id, session_id = %session_id, "无法发送 ASR 部分结果到会话");
    }

    // 推送 ASR_PARTIAL 事件
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


