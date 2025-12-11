use crate::AppState;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tracing::{info, error, warn};

pub async fn handle_session(socket: WebSocket, state: AppState) {
    info!("新的会话 WebSocket 连接");
    
    let (mut sender, mut receiver) = socket.split();
    
    // TODO: 实现会话消息处理
    // 1. 接收客户端消息（utterance）
    // 2. 创建 job 并分发给节点
    // 3. 接收节点结果并转发给客户端
    
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                info!("收到会话消息: {}", text);
                // TODO: 解析消息并处理
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
}

pub async fn handle_node(socket: WebSocket, state: AppState) {
    info!("新的节点 WebSocket 连接");
    
    let (mut sender, mut receiver) = socket.split();
    
    // TODO: 实现节点消息处理
    // 1. 接收节点注册/心跳消息
    // 2. 下发 job 给节点
    // 3. 接收节点处理结果
    
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                info!("收到节点消息: {}", text);
                // TODO: 解析消息并处理
            }
            Ok(Message::Close(_)) => {
                info!("节点 WebSocket 连接关闭");
                break;
            }
            Err(e) => {
                error!("WebSocket 错误: {}", e);
                break;
            }
            _ => {}
        }
    }
}

