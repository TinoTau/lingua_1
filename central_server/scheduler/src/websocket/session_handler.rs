// Session-side WebSocket handler

use crate::core::AppState;
use crate::messages::{SessionMessage, ErrorCode};
use crate::websocket::{send_error, session_message_handler};
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{info, error, warn, debug};
use serde_json;

// Session-side WebSocket handler
pub async fn handle_session(socket: WebSocket, state: AppState) {
    info!("New session WebSocket connection");
    
    let (mut sender, mut receiver) = socket.split();
    
    // Create message channel
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    
    // Start send task
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });
    
    let mut session_id: Option<String> = None;
    
    // Receive message loop
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                debug!("Received session message: {}", text);
                
                match serde_json::from_str::<SessionMessage>(&text) {
                    Ok(message) => {
                        match session_message_handler::handle_session_message(message, &state, &mut session_id, &tx).await {
                            Ok(()) => {}
                            Err(e) => {
                                error!("Failed to handle session message: {}", e);
                                send_error(&tx, ErrorCode::InternalError, &format!("Failed to process message: {}", e)).await;
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to parse session message: {}", e);
                        send_error(&tx, ErrorCode::InvalidMessage, &format!("Invalid message format: {}", e)).await;
                    }
                }
            }
            Ok(Message::Close(_)) => {
                info!("Session WebSocket connection closed");
                break;
            }
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }
    
    // Cleanup
    if let Some(ref sess_id) = session_id {
        if let Some(rt) = state.phase2.as_ref() {
            rt.clear_session_owner(sess_id).await;
        }
        state.session_connections.unregister(sess_id).await;
        
        // RF-4 增强：在删除结果队列前，flush 所有待发送的结果
        // 注意：此时 WebSocket 连接可能已经关闭，但尝试发送结果（best-effort）
        let pending_results = state.result_queue.remove_session(sess_id).await;
        if !pending_results.is_empty() {
            info!(
                session_id = %sess_id,
                pending_count = pending_results.len(),
                "Flushing pending results before session cleanup (WebSocket may be closed)"
            );
            // 尝试通过 session_connections 发送结果（如果连接仍然存在）
            if let Some(conn_tx) = state.session_connections.get(sess_id).await {
                for result in pending_results {
                    if let Err(e) = crate::websocket::send_message(&conn_tx, &result).await {
                        warn!(
                            session_id = %sess_id,
                            error = %e,
                            "Failed to send pending result during session cleanup (connection may be closed)"
                        );
                    }
                }
            }
        }
        
        state.session_manager.remove_session(sess_id).await;
        info!("Session {} cleaned up", sess_id);
    }
    
    send_task.abort();
}
