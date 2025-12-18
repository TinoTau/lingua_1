// 会话端 WebSocket 处理

use crate::app_state::AppState;
use crate::messages::{SessionMessage, ErrorCode};
use crate::websocket::{send_error, session_message_handler};
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{info, error, warn, debug};
use serde_json;

// 会话端 WebSocket 处理
pub async fn handle_session(socket: WebSocket, state: AppState) {
    info!("新的会话 WebSocket 连接");
    
    let (mut sender, mut receiver) = socket.split();
    
    // 创建消息通道
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
    
    // 启动发送任务
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });
    
    let mut session_id: Option<String> = None;
    
    // 接收消息循环
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                debug!("收到会话消息: {}", text);
                
                match serde_json::from_str::<SessionMessage>(&text) {
                    Ok(message) => {
                        match session_message_handler::handle_session_message(message, &state, &mut session_id, &tx).await {
                            Ok(()) => {}
                            Err(e) => {
                                error!("处理会话消息失败: {}", e);
                                send_error(&tx, ErrorCode::InternalError, &format!("处理消息失败: {}", e)).await;
                            }
                        }
                    }
                    Err(e) => {
                        warn!("解析会话消息失败: {}", e);
                        send_error(&tx, ErrorCode::InvalidMessage, &format!("无效的消息格式: {}", e)).await;
                    }
                }
            }
            Ok(Message::Close(_)) => {
                info!("会话 WebSocket 连接关闭");
                break;
            }
            Err(e) => {
                error!("WebSocket 错误: {}", e);
                break;
            }
            _ => {}
        }
    }
    
    // 清理
    if let Some(ref sess_id) = session_id {
        if let Some(rt) = state.phase2.as_ref() {
            rt.clear_session_owner(sess_id).await;
        }
        state.session_connections.unregister(sess_id).await;
        state.result_queue.remove_session(sess_id).await;
        state.session_manager.remove_session(sess_id).await;
        info!("会话 {} 已清理", sess_id);
    }
    
    send_task.abort();
}

