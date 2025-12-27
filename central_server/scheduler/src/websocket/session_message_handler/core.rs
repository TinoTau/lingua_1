use crate::core::AppState;
use crate::messages::{ErrorCode, SessionMessage};
use crate::core::session::SessionUpdate;
use crate::websocket::{send_error, send_message};
use crate::websocket::session_actor::{SessionActor, SessionEvent};
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
    // Handle pairing code
    let paired_node_id = if let Some(code) = pairing_code {
        state.pairing_service.validate_pairing_code(&code).await
    } else {
        None
    };

    // Create session (pass trace_id)
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
            // 默认使用 opus 格式（web 端现在使用 opus 编码）
            // 如果将来需要从 SessionInit 消息中获取，可以添加 audio_format 字段
            Some("opus".to_string()),
            Some(16000),
        )
        .await;

    // If pairing successful, update session
    if let Some(ref node_id) = paired_node_id {
        state
            .session_manager
            .update_session(&session.session_id, SessionUpdate::PairNode(node_id.clone()))
            .await;
    }

    *session_id = Some(session.session_id.clone());

    // Register connection
    state
        .session_connections
        .register(session.session_id.clone(), tx.clone())
        .await;

    // Phase 2: Write session owner (with TTL; for cross-instance delivery)
    if let Some(rt) = state.phase2.as_ref() {
        rt.set_session_owner(&session.session_id).await;
        // Schema compat: If "paired node" mode, write v1:sessions:bind (default off)
        if let Some(ref node_id) = paired_node_id {
            rt.schema_set_session_bind(&session.session_id, node_id, Some(&session.trace_id))
                .await;
        }
    }

    // Initialize result queue
    state
        .result_queue
        .initialize_session(session.session_id.clone())
        .await;

    // Create and start Session Actor
    let pause_ms = state.web_task_segmentation.pause_ms;
    let max_duration_ms = state.web_task_segmentation.max_duration_ms;
    let edge_config = state.web_task_segmentation.edge_stabilization.clone();
    let (actor, actor_handle) = SessionActor::new(
        session.session_id.clone(),
        state.clone(),
        tx.clone(),
        session.utterance_index,
        pause_ms,
        max_duration_ms,
        edge_config,
    );
    
    // Register actor handle
    state
        .session_manager
        .register_actor(session.session_id.clone(), actor_handle.clone())
        .await;
    
    // Spawn actor task
    tokio::spawn(async move {
        actor.run().await;
    });

    // Send acknowledgment message (include trace_id and protocol negotiation)
    let ack = SessionMessage::SessionInitAck {
        session_id: session.session_id.clone(),
        assigned_node_id: paired_node_id,
        message: "session created".to_string(),
        trace_id: session.trace_id.clone(),
        // 协议协商结果：从 session 配置中获取
        protocol_version: Some("1.0".to_string()),
        use_binary_frame: Some(false), // Phase 2: 暂时不使用 Binary Frame
        negotiated_codec: session.audio_format.clone(),
        negotiated_audio_format: session.audio_format.clone(), // 兼容字段
        negotiated_sample_rate: session.sample_rate,
        negotiated_channel_count: Some(1), // 单声道
    };

    send_message(tx, &ack).await?;
    info!(
        trace_id = %session.trace_id,
        session_id = %session.session_id,
        src_lang = %session.src_lang,
        tgt_lang = %session.tgt_lang,
        mode = ?session.mode,
        "Session created"
    );
    Ok(())
}

pub(super) async fn handle_client_heartbeat(
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
    sess_id: String,
) -> Result<(), anyhow::Error> {
    // Verify session exists
    if state.session_manager.get_session(&sess_id).await.is_none() {
        send_error(tx, ErrorCode::InvalidSession, "Session does not exist").await;
        return Ok(());
    }

    // Send server heartbeat response
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
    // Update Group's last_tts_end_at (Scheduler authoritative time)
    state.group_manager.on_tts_play_ended(&group_id, ts_end_ms).await;
    info!(
        session_id = %sess_id,
        group_id = %group_id,
        ts_end_ms = ts_end_ms,
        "TTS playback ended, updated Group last_tts_end_at"
    );
}

pub(super) async fn handle_session_close(
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
    sess_id: String,
    reason: String,
) -> Result<(), anyhow::Error> {
    // Cleanup Group (must be before session cleanup)
    state.group_manager.on_session_end(&sess_id, &reason).await;

    // If session is in room, leave room
    if let Some(room_code) = state.room_manager.find_room_by_session(&sess_id).await {
        let _ = state.room_manager.leave_room(&room_code, &sess_id).await;
        // Broadcast member list update
        if let Some(members) = state.room_manager.get_room_members(&room_code).await {
            let members_msg = SessionMessage::RoomMembers {
                room_code: room_code.clone(),
                members: members.clone(),
            };
            // Broadcast to all members in room
            for member in members {
                if member.session_id != sess_id {
                    if let Some(member_tx) = state.session_connections.get(&member.session_id).await {
                        let _ = send_message(&member_tx, &members_msg).await;
                    }
                }
            }
        }
    }

    // Close Session Actor
    if let Some(actor_handle) = state.session_manager.get_actor_handle(&sess_id).await {
        let _ = actor_handle.send(SessionEvent::CloseSession);
        state.session_manager.remove_actor(&sess_id).await;
    }

    // Cleanup session
    state.session_connections.unregister(&sess_id).await;
    state.result_queue.remove_session(&sess_id).await;
    state.session_manager.remove_session(&sess_id).await;
    // Schema compat: Clear v1:sessions:bind (default off)
    if let Some(rt) = state.phase2.as_ref() {
        rt.schema_clear_session_bind(&sess_id).await;
    }

    // Send acknowledgment
    let ack = SessionMessage::SessionCloseAck {
        session_id: sess_id.clone(),
    };
    send_message(tx, &ack).await?;
    info!("Session {} closed", sess_id);
    Ok(())
}
