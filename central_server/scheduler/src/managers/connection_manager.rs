use axum::extract::ws::Message;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::sync::mpsc;
use tracing::{error, warn};

// 会话连接管理器
#[derive(Clone)]
pub struct SessionConnectionManager {
    // session_id -> sender
    connections: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<Message>>>>,
}

impl SessionConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register(&self, session_id: String, sender: mpsc::UnboundedSender<Message>) {
        let mut connections = self.connections.write().await;
        connections.insert(session_id, sender);
    }

    pub async fn unregister(&self, session_id: &str) {
        let mut connections = self.connections.write().await;
        connections.remove(session_id);
    }

    pub async fn send(&self, session_id: &str, message: Message) -> bool {
        let connections = self.connections.read().await;
        if let Some(sender) = connections.get(session_id) {
            // 注意：UnboundedSender::send 只在 receiver 已关闭时失败
            // 但即使返回 Ok，也不保证 WebSocket 真的发送成功
            // WebSocket 发送失败会在 send_task 中检测，并通过连接清理机制处理
            match sender.send(message) {
                Ok(()) => {
                    // Channel send 成功，但实际 WebSocket 发送可能在 send_task 中失败
                    // 这种情况下，send_task 会触发连接清理
                    true
                }
                Err(e) => {
                    error!(
                        session_id = %session_id,
                        error = %e,
                        "发送消息到会话失败（channel receiver 已关闭）"
                    );
                    // Channel receiver 已关闭，说明连接已断开
                    // 触发连接清理（延迟清理，避免在持有锁时清理）
                    drop(connections);
                    // 在锁外执行清理，避免死锁
                    self.unregister(session_id).await;
                    false
                }
            }
        } else {
            warn!(
                session_id = %session_id,
                "会话连接不存在（可能已断开或未注册）"
            );
            false
        }
    }
    
    /// 获取会话的发送器（用于发送消息）
    pub async fn get(&self, session_id: &str) -> Option<mpsc::UnboundedSender<Message>> {
        let connections = self.connections.read().await;
        connections.get(session_id).cloned()
    }
    
    /// 获取活跃连接数
    pub async fn count(&self) -> usize {
        let connections = self.connections.read().await;
        connections.len()
    }

    /// Phase 2：用于 owner 续约，获取当前活跃 session_id 列表快照
    pub async fn list_session_ids(&self) -> Vec<String> {
        let connections = self.connections.read().await;
        connections.keys().cloned().collect()
    }
}

// 节点连接管理器
#[derive(Clone)]
pub struct NodeConnectionManager {
    // node_id -> sender
    connections: Arc<RwLock<HashMap<String, mpsc::UnboundedSender<Message>>>>,
}

impl NodeConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn register(&self, node_id: String, sender: mpsc::UnboundedSender<Message>) {
        let mut connections = self.connections.write().await;
        connections.insert(node_id, sender);
    }

    pub async fn unregister(&self, node_id: &str) {
        let mut connections = self.connections.write().await;
        connections.remove(node_id);
    }

    pub async fn send(&self, node_id: &str, message: Message) -> bool {
        let connections = self.connections.read().await;
        if let Some(sender) = connections.get(node_id) {
            if let Err(e) = sender.send(message) {
                error!("发送消息到节点 {} 失败: {}", node_id, e);
                return false;
            }
            true
        } else {
            warn!("节点 {} 的连接不存在", node_id);
            false
        }
    }
    

    /// Phase 2：用于 owner 续约，获取当前活跃 node_id 列表快照
    pub async fn list_node_ids(&self) -> Vec<String> {
        let connections = self.connections.read().await;
        connections.keys().cloned().collect()
    }
}

