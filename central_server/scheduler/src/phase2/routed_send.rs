pub async fn send_node_message_routed(state: &AppState, node_id: &str, msg: NodeMessage) -> bool {
    // 先尝试本地直发
    if state
        .node_connections
        .send(node_id, WsMessage::Text(serde_json::to_string(&msg).unwrap_or_default()))
        .await
    {
        return true;
    }
    let Some(rt) = state.phase2.as_ref() else { return false };

    // resolve owner + 校验存活
    let Some(owner) = rt.resolve_node_owner(node_id).await else { return false };
    if owner == rt.instance_id {
        return false;
    }
    rt.enqueue_to_instance(
        &owner,
        &InterInstanceEvent::DispatchToNode {
            node_id: node_id.to_string(),
            message: msg,
        },
    )
    .await
}

/// Phase 2：发送 SessionMessage（本地直发；否则按 owner 投递到目标实例 Streams）
pub async fn send_session_message_routed(state: &AppState, session_id: &str, msg: SessionMessage) -> bool {
    use tracing::{debug, warn};
    use crate::messages::SessionMessage;
    
    // 尝试本地直发
    if state
        .session_connections
        .send(
            session_id,
            WsMessage::Text(serde_json::to_string(&msg).unwrap_or_default()),
        )
        .await
    {
        debug!(
            session_id = %session_id,
            msg_type = ?msg,
            "Sent session message locally"
        );
        return true;
    }
    
    // 本地发送失败，尝试跨实例投递
    let Some(rt) = state.phase2.as_ref() else {
        warn!(
            session_id = %session_id,
            "Failed to send session message: no local connection and Phase2 not enabled"
        );
        return false;
    };

    let Some(owner) = rt.resolve_session_owner(session_id).await else {
        warn!(
            session_id = %session_id,
            "Failed to send session message: cannot resolve session owner"
        );
        return false;
    };
    
    if owner == rt.instance_id {
        warn!(
            session_id = %session_id,
            instance_id = %rt.instance_id,
            "Failed to send session message: owner is current instance but local send failed"
        );
        return false;
    }
    
    debug!(
        session_id = %session_id,
        owner = %owner,
        instance_id = %rt.instance_id,
        "Forwarding session message to owner instance"
    );
    
    rt.enqueue_to_instance(
        &owner,
        &InterInstanceEvent::SendToSession {
            session_id: session_id.to_string(),
            message: msg,
        },
    )
    .await
}

