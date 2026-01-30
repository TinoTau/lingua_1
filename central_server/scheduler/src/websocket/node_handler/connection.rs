use super::message::handle_node_message;
use crate::core::AppState;
use crate::messages::NodeMessage;
use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

// Node-side WebSocket handler
pub async fn handle_node(socket: WebSocket, state: AppState) {
    info!("New node WebSocket connection");

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

    let mut node_id: Option<String> = None;

    // Receive message loop
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                info!("Received node message (length: {}): {}", text.len(), text);
                
                match serde_json::from_str::<NodeMessage>(&text) {
                    Ok(message) => {
                        info!("Successfully parsed node message, type: {:?}", std::mem::discriminant(&message));
                        match handle_node_message(message, &state, &mut node_id, &tx).await {
                            Ok(()) => {}
                            Err(e) => {
                                error!("Failed to handle node message: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        // 使用硬编码 500 字符（AppState 不包含 config）
                        // TODO: 考虑将常用配置添加到 AppState 中
                        warn!("Failed to parse node message: {}. Raw message (first 500 chars): {}", e, &text[..text.len().min(500)]);
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

    // Cleanup
    if let Some(ref nid) = node_id {
        // 流程日志 1: 下线流程开始
        info!(
            step = "offline_start",
            node_id = %nid,
            "【节点管理流程】节点下线流程开始"
        );

        if let Some(rt) = state.phase2.as_ref() {
            rt.clear_node_owner(nid).await;
            // clear_node_presence 已废弃（Redis 直查架构不再需要）
            
            // 流程日志 2: Phase2 清理完成
            debug!(
                step = "offline_phase2_cleared",
                node_id = %nid,
                "【节点管理流程】Phase2 状态已清理"
            );
        }
        
        // 流程日志 3: 准备调用 Redis 清理
        let t0 = std::time::Instant::now();
        if let Some(pool_service) = state.pool_service.as_ref() {
            match pool_service.as_ref().node_offline(nid).await {
                Ok(_) => {
                    // 流程日志 4: Redis Pool 清理成功
                    info!(
                        step = "offline_redis_cleanup_success",
                        node_id = %nid,
                        elapsed_ms = t0.elapsed().as_millis(),
                        "【节点管理流程】Redis Pool 清理成功（node_offline.lua 已执行）"
                    );
                }
                Err(e) => {
                    warn!(
                        step = "offline_redis_cleanup_failed",
                        node_id = %nid,
                        error = %e,
                        elapsed_ms = t0.elapsed().as_millis(),
                        "【节点管理流程】Redis Pool 清理失败"
                    );
                }
            }
        }
        
        // Pool 管理已由 PoolService 处理，不需要手动从 pool index 移除
        let _phase2_runtime = state.phase2.as_ref().map(|rt| rt.as_ref());
        
        // 流程日志 5: 注销 WebSocket 连接
        state.node_connections.unregister(nid).await;
        info!(
            step = "offline_connection_unregistered",
            node_id = %nid,
            "【节点管理流程】WebSocket 连接已注销"
        );
        
        // 流程日志 6: 节点离线由 Redis TTL 自动处理（无需显式标记）
        info!(
            step = "offline_ttl",
            node_id = %nid,
            "节点将在心跳 TTL 到期后自动下线（Redis 直查架构）"
        );
        
        // 流程日志 7: 下线流程完成
        info!(
            step = "offline_complete",
            node_id = %nid,
            "【节点管理流程】节点下线流程完成✅"
        );
    }

    send_task.abort();
}
