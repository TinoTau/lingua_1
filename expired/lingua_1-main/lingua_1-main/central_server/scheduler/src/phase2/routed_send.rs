// 注意：此文件通过 include! 宏包含在 phase2.rs 中，因此不需要重复导入已在父模块中导入的类型

pub async fn send_node_message_routed(state: &AppState, node_id: &str, msg: NodeMessage) -> bool {
    let msg_type = match &msg {
        NodeMessage::JobAssign { job_id, .. } => {
            format!("JobAssign(job_id={})", job_id)
        }
        _ => format!("{:?}", msg),
    };
    
    // 先尝试本地直发
    let msg_json = serde_json::to_string(&msg).unwrap_or_default();
    tracing::info!(
        node_id = %node_id,
        msg_type = %msg_type,
        msg_length = msg_json.len(),
        "尝试发送消息到节点（本地直发）"
    );
    
    if state
        .node_connections
        .send(node_id, WsMessage::Text(msg_json.clone()))
        .await
    {
        tracing::info!(
            node_id = %node_id,
            msg_type = %msg_type,
            "消息成功发送到节点（本地直发）"
        );
        return true;
    }
    
    tracing::warn!(
        node_id = %node_id,
        msg_type = %msg_type,
        "本地直发失败，尝试跨实例投递"
    );
    
    let Some(rt) = state.phase2.as_ref() else {
        tracing::warn!(
            node_id = %node_id,
            msg_type = %msg_type,
            "消息发送失败：本地直发失败且 Phase2 未启用"
        );
        return false;
    };

    // resolve owner + 校验存活
    let Some(owner) = rt.resolve_node_owner(node_id).await else {
        tracing::warn!(
            node_id = %node_id,
            msg_type = %msg_type,
            "消息发送失败：无法解析节点所有者"
        );
        return false;
    };
    
    if owner == rt.instance_id {
        tracing::warn!(
            node_id = %node_id,
            msg_type = %msg_type,
            owner = %owner,
            instance_id = %rt.instance_id,
            "消息发送失败：节点所有者为当前实例但本地直发失败"
        );
        return false;
    }
    
    tracing::info!(
        node_id = %node_id,
        msg_type = %msg_type,
        owner = %owner,
        instance_id = %rt.instance_id,
        "跨实例投递消息到节点所有者"
    );
    
    let ok = rt.enqueue_to_instance(
        &owner,
        &InterInstanceEvent::DispatchToNode {
            node_id: node_id.to_string(),
            message: msg,
        },
    )
    .await;
    
    if ok {
        tracing::info!(
            node_id = %node_id,
            msg_type = %msg_type,
            owner = %owner,
            "消息成功投递到节点所有者实例"
        );
    } else {
        tracing::warn!(
            node_id = %node_id,
            msg_type = %msg_type,
            owner = %owner,
            "消息投递到节点所有者实例失败"
        );
    }
    
    ok
}

/// Phase 2：发送 SessionMessage（本地直发；否则按 owner 投递到目标实例 Streams）
pub async fn send_session_message_routed(state: &AppState, session_id: &str, msg: SessionMessage) -> bool {
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

