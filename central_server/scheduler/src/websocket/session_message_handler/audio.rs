use base64::{engine::general_purpose, Engine as _};
use crate::core::AppState;
use crate::websocket::session_actor::SessionEvent;
use axum::extract::ws::Message;
use tokio::sync::mpsc;
use tracing::debug;


pub(super) async fn handle_audio_chunk(
    state: &AppState,
    _tx: &mpsc::UnboundedSender<Message>,
    sess_id: String,
    is_final: bool,
    payload: Option<String>,
    client_timestamp_ms: Option<i64>,
) -> Result<(), anyhow::Error> {
    // 验证会话
    let _session = state
        .session_manager
        .get_session(&sess_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("Session does not exist: {}", sess_id))?;

    // 获取 Session Actor Handle
    let actor_handle = state
        .session_manager
        .get_actor_handle(&sess_id)
        .await
        .ok_or_else(|| anyhow::anyhow!("Session Actor not found: {}", sess_id))?;

    // 解码音频数据
    let chunk = if let Some(payload_str) = payload {
        general_purpose::STANDARD
            .decode(&payload_str)
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let now_ms = chrono::Utc::now().timestamp_millis();

    // 发送音频块事件到 Actor
    // 如果 channel 已关闭（session 已断开），优雅处理而不是报错
    if let Err(_) = actor_handle.send(SessionEvent::AudioChunkReceived {
        chunk,
        is_final,
        timestamp_ms: now_ms,
        client_timestamp_ms,
    }) {
        // Session Actor channel 已关闭，说明 session 已断开
        // 这是正常情况，不需要报错
        debug!(session_id = %sess_id, "Session Actor channel closed, session may have disconnected");
        return Ok(());
    }

    // 注意：is_final 的处理已经在 handle_audio_chunk 中完成（在添加音频块之后）
    // 这里不需要再发送 IsFinalReceived 事件，避免重复 finalize
    // 如果 is_final=true，handle_audio_chunk 会在添加音频块后自动触发 finalize
    // 如果再次发送 IsFinalReceived，会导致重复 finalize，可能造成空缓冲区

    Ok(())
}

