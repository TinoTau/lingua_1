use crate::app_state::AppState;
use crate::messages::{ErrorCode, SessionMessage};
use crate::session::SessionUpdate;
use crate::websocket::{send_error, send_message};
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::info;

pub(super) async fn handle_session_init(
    state: &AppState,
    session_id: &mut Option<String>,
    tx: &mpsc::UnboundedSender<Message>,
    client_version: String,
    platform: String,
    src_lang: String,
    tgt_lang: String,
    dialect: Option<String>,
    features: Option<crate::messages::FeatureFlags>,
    pairing_code: Option<String>,
    tenant_id: Option<String>,
    mode: Option<String>,
    lang_a: Option<String>,
    lang_b: Option<String>,
    auto_langs: Option<Vec<String>>,
    trace_id: Option<String>,
) -> Result<(), anyhow::Error> {
    // 处理配对码
    let paired_node_id = if let Some(code) = pairing_code {
        state.pairing_service.validate_pairing_code(&code).await
    } else {
        None
    };

    // 创建会话（传递 trace_id）
    let session = state
        .session_manager
        .create_session(
            client_version,
            platform,
            src_lang,
            tgt_lang,
            dialect.clone(),
            features.clone(),
            tenant_id,
            mode.clone(),
            lang_a.clone(),
            lang_b.clone(),
            auto_langs.clone(),
            trace_id,
        )
        .await;

    // 如果配对成功，更新会话
    if let Some(ref node_id) = paired_node_id {
        state
            .session_manager
            .update_session(&session.session_id, SessionUpdate::PairNode(node_id.clone()))
            .await;
    }

    *session_id = Some(session.session_id.clone());

    // 注册连接
    state
        .session_connections
        .register(session.session_id.clone(), tx.clone())
        .await;

    // Phase 2：写入 session owner（带 TTL；用于跨实例投递）
    if let Some(rt) = state.phase2.as_ref() {
        rt.set_session_owner(&session.session_id).await;
        // Schema compat：若是“配对节点”模式，补写 v1:sessions:bind（默认关闭）
        if let Some(ref node_id) = paired_node_id {
            rt.schema_set_session_bind(&session.session_id, node_id, Some(&session.trace_id))
                .await;
        }
    }

    // 初始化结果队列
    state
        .result_queue
        .initialize_session(session.session_id.clone())
        .await;

    // 发送确认消息（包含 trace_id）
    let ack = SessionMessage::SessionInitAck {
        session_id: session.session_id.clone(),
        assigned_node_id: paired_node_id,
        message: "session created".to_string(),
        trace_id: session.trace_id.clone(),
    };

    send_message(tx, &ack).await?;
    info!(trace_id = %session.trace_id, session_id = %session.session_id, "会话已创建");
    Ok(())
}

pub(super) async fn handle_client_heartbeat(
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
    sess_id: String,
) -> Result<(), anyhow::Error> {
    // 验证会话存在
    if state.session_manager.get_session(&sess_id).await.is_none() {
        send_error(tx, ErrorCode::InvalidSession, "会话不存在").await;
        return Ok(());
    }

    // 发送服务器心跳响应
    let heartbeat = SessionMessage::ServerHeartbeat {
        session_id: sess_id,
        timestamp: chrono::Utc::now().timestamp_millis(),
    };
    send_message(tx, &heartbeat).await?;
    Ok(())
}

pub(super) async fn handle_tts_play_ended(
    state: &AppState,
    sess_id: String,
    group_id: String,
    ts_end_ms: u64,
) {
    // 更新 Group 的 last_tts_end_at（Scheduler 权威时间）
    state.group_manager.on_tts_play_ended(&group_id, ts_end_ms).await;
    info!(
        session_id = %sess_id,
        group_id = %group_id,
        ts_end_ms = ts_end_ms,
        "TTS 播放结束，更新 Group last_tts_end_at"
    );
}

pub(super) async fn handle_session_close(
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
    sess_id: String,
    reason: String,
) -> Result<(), anyhow::Error> {
    // 清理 Group（必须在清理会话之前）
    state.group_manager.on_session_end(&sess_id, &reason).await;

    // 如果会话在房间中，退出房间
    if let Some(room_code) = state.room_manager.find_room_by_session(&sess_id).await {
        let _ = state.room_manager.leave_room(&room_code, &sess_id).await;
        // 广播成员列表更新
        if let Some(members) = state.room_manager.get_room_members(&room_code).await {
            let members_msg = SessionMessage::RoomMembers {
                room_code: room_code.clone(),
                members: members.clone(),
            };
            // 向房间内所有成员广播
            for member in members {
                if member.session_id != sess_id {
                    if let Some(member_tx) = state.session_connections.get(&member.session_id).await {
                        let _ = send_message(&member_tx, &members_msg).await;
                    }
                }
            }
        }
    }

    // 清理会话
    state.session_connections.unregister(&sess_id).await;
    state.result_queue.remove_session(&sess_id).await;
    state.session_manager.remove_session(&sess_id).await;
    // Schema compat：清理 v1:sessions:bind（默认关闭）
    if let Some(rt) = state.phase2.as_ref() {
        rt.schema_clear_session_bind(&sess_id).await;
    }

    // 发送确认
    let ack = SessionMessage::SessionCloseAck {
        session_id: sess_id.clone(),
    };
    send_message(tx, &ack).await?;
    info!("会话 {} 已关闭", sess_id);
    Ok(())
}


