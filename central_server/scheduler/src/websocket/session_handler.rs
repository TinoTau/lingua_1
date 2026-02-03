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
    
    // Create notification channel for send task failure
    // 使用 Arc<Mutex<>> 包装，以便在 send_task 中访问
    let (send_failed_tx, send_failed_rx) = tokio::sync::oneshot::channel::<()>();
    let send_failed_tx_arc = std::sync::Arc::new(std::sync::Mutex::new(Some(send_failed_tx)));
    let send_failed_tx_clone = send_failed_tx_arc.clone();
    
    // Start send task
    let send_task = tokio::spawn(async move {
        let mut send_failed = false;
        while let Some(msg) = rx.recv().await {
            if sender.send(msg).await.is_err() {
                error!("WebSocket 发送失败，连接可能已断开");
                send_failed = true;
                // 通知主循环连接已断开
                if let Ok(mut tx_guard) = send_failed_tx_clone.lock() {
                    if let Some(tx) = tx_guard.take() {
                        let _ = tx.send(());
                    }
                }
                break;
            }
        }
        if !send_failed {
            debug!("Send task 正常退出（channel 关闭）");
        }
    });
    
    let mut session_id: Option<String> = None;
    
    // Receive message loop with send task failure detection
    // 使用 Box::pin 来固定 future，以便在 select! 中使用
    let mut send_failed_rx = Box::pin(send_failed_rx);
    
    loop {
        tokio::select! {
            // Check for send task failure
            result = send_failed_rx.as_mut() => {
                match result {
                    Ok(_) => {
                        error!(
                            session_id = session_id.as_deref().unwrap_or("unknown"),
                            "WebSocket 发送任务失败，连接已断开，开始清理"
                        );
                        break;
                    }
                    Err(_) => {
                        // oneshot channel 的 sender 被 drop 了（不应该发生）
                        // 如果发生了，说明发送任务可能已经异常退出，应该退出主循环
                        warn!(
                            session_id = session_id.as_deref().unwrap_or("unknown"),
                            "Send failed notification channel closed unexpectedly, cleaning up"
                        );
                        break;
                    }
                }
            }
            // Receive message from client
            msg = receiver.next() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
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
                    Some(Ok(Message::Close(_))) => {
                        info!(
                            session_id = session_id.as_deref().unwrap_or("unknown"),
                            "Session WebSocket connection closed by client"
                        );
                        break;
                    }
                    Some(Err(e)) => {
                        error!(
                            session_id = session_id.as_deref().unwrap_or("unknown"),
                            error = %e,
                            "WebSocket error, closing connection"
                        );
                        break;
                    }
                    None => {
                        // Receiver stream ended
                        info!(
                            session_id = session_id.as_deref().unwrap_or("unknown"),
                            "WebSocket receiver stream ended"
                        );
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
    
    // Cleanup: 无论是否检测到发送失败，都执行清理
    if let Some(ref sess_id) = session_id {
        info!(
            session_id = %sess_id,
            "开始清理会话资源"
        );
        
        // Phase 2: 清除会话所有者
        if let Some(rt) = state.redis_runtime.as_ref() {
            rt.clear_session_owner(sess_id).await;
        }
        
        // 立即从连接管理器中移除（防止后续消息误发送）
        state.session_connections.unregister(sess_id).await;
        info!(
            session_id = %sess_id,
            "已从连接管理器移除会话"
        );
        
        // RF-4 增强：在删除结果队列前，flush 所有待发送的结果
        // 注意：此时 WebSocket 连接可能已经关闭，但尝试发送结果（best-effort）
        let pending_results = state.result_queue.remove_session(sess_id).await;
        if !pending_results.is_empty() {
            warn!(
                session_id = %sess_id,
                pending_count = pending_results.len(),
                "会话关闭时发现待发送的结果（WebSocket 连接可能已断开）"
            );
            // 注意：此时连接已从 session_connections 中移除，无法再发送
            // 这些结果将丢失，但这是预期的行为（连接已断开）
        }
        
        // 清理会话管理器
        state.session_manager.remove_session(sess_id).await;
        
        info!(
            session_id = %sess_id,
            "会话资源清理完成"
        );
    } else {
        warn!("会话 ID 为空，跳过清理");
    }
    
    // 等待或中止发送任务
    if send_task.is_finished() {
        debug!("发送任务已自然结束");
    } else {
        send_task.abort();
        debug!("已中止发送任务");
    }
}
