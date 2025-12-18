use super::message::handle_node_message;
use crate::app_state::AppState;
use crate::messages::NodeMessage;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

// 节点端 WebSocket 处理
pub async fn handle_node(socket: WebSocket, state: AppState) {
    info!("New node WebSocket connection");

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

    let mut node_id: Option<String> = None;

    // 接收消息循环
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                debug!("收到节点消息: {}", text);

                match serde_json::from_str::<NodeMessage>(&text) {
                    Ok(message) => {
                        if let Err(e) = handle_node_message(message, &state, &mut node_id, &tx).await
                        {
                            error!("处理节点消息失败: {}", e);
                        }
                    }
                    Err(e) => {
                        warn!("解析节点消息失败: {}", e);
                    }
                }
            }
            Ok(Message::Close(_)) => {
                info!("Node WebSocket connection closed");
                break;
            }
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    // 清理
    if let Some(ref nid) = node_id {
        state.node_connections.unregister(nid).await;
        state.node_registry.mark_node_offline(nid).await;
        info!("Node {} cleaned up", nid);
    }

    send_task.abort();
}


