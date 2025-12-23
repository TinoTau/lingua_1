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
        if let Some(rt) = state.phase2.as_ref() {
            rt.clear_node_owner(nid).await;
            rt.clear_node_presence(nid).await;
        }
        // Phase 3: Remove from pool index (node disconnects, no longer participates in pool member selection; re-register will re-add)
        state.node_registry.phase3_remove_node_from_pool_index(nid).await;
        state.node_connections.unregister(nid).await;
        state.node_registry.mark_node_offline(nid).await;
        info!("Node {} cleaned up", nid);
    }

    send_task.abort();
}
