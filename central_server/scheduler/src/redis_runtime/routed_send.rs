// 注意：此文件通过 include! 宏包含在 phase2.rs 中，因此不需要重复导入已在父模块中导入的类型

/// 发送 NodeMessage 到节点（生产环境：节点与调度器不在同一设备，本地直发已移除，统一走跨实例投递）
pub async fn send_node_message_routed(state: &AppState, node_id: &str, msg: NodeMessage) -> bool {
    let msg_type = match &msg {
        NodeMessage::JobAssign { job_id, .. } => format!("JobAssign(job_id={})", job_id),
        _ => format!("{:?}", msg),
    };
    
    let Some(rt) = state.phase2.as_ref() else {
        tracing::warn!(node_id = %node_id, msg_type = %msg_type, "消息发送失败：Phase2 未启用");
        return false;
    };
    let Some(owner) = rt.resolve_node_owner(node_id).await else {
        tracing::warn!(node_id = %node_id, msg_type = %msg_type, "消息发送失败：无法解析节点所有者");
        return false;
    };
    
    tracing::info!(node_id = %node_id, msg_type = %msg_type, owner = %owner, "跨实例投递消息到节点所有者");
    let ok = rt.enqueue_to_instance(&owner, &InterInstanceEvent::DispatchToNode {
        node_id: node_id.to_string(),
        message: msg,
    }).await;
    if ok {
        tracing::info!(node_id = %node_id, msg_type = %msg_type, owner = %owner, "消息成功投递到节点所有者实例");
    } else {
        tracing::warn!(node_id = %node_id, msg_type = %msg_type, owner = %owner, "消息投递到节点所有者实例失败");
    }
    ok
}

/// 发送 SessionMessage 到会话（生产环境：会话与调度器不在同一设备，本地直发已移除，统一走跨实例投递）
pub async fn send_session_message_routed(state: &AppState, session_id: &str, msg: SessionMessage) -> bool {
    let Some(rt) = state.phase2.as_ref() else {
        warn!(session_id = %session_id, "Failed to send session message: Phase2 not enabled");
        return false;
    };
    let Some(owner) = rt.resolve_session_owner(session_id).await else {
        warn!(session_id = %session_id, "Failed to send session message: cannot resolve session owner");
        return false;
    };
    debug!(session_id = %session_id, owner = %owner, "Forwarding session message to owner instance");
    rt.enqueue_to_instance(&owner, &InterInstanceEvent::SendToSession {
        session_id: session_id.to_string(),
        message: msg,
    }).await
}

