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
    if state
        .session_connections
        .send(
            session_id,
            WsMessage::Text(serde_json::to_string(&msg).unwrap_or_default()),
        )
        .await
    {
        return true;
    }
    let Some(rt) = state.phase2.as_ref() else { return false };

    let Some(owner) = rt.resolve_session_owner(session_id).await else { return false };
    if owner == rt.instance_id {
        return false;
    }
    rt.enqueue_to_instance(
        &owner,
        &InterInstanceEvent::SendToSession {
            session_id: session_id.to_string(),
            message: msg,
        },
    )
    .await
}

