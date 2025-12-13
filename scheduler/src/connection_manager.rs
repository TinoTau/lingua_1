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
            if let Err(e) = sender.send(message) {
                error!("发送消息到会话 {} 失败: {}", session_id, e);
                return false;
            }
            true
        } else {
            warn!("会话 {} 的连接不存在", session_id);
            false
        }
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
    
    /// 获取节点的发送器（用于发送消息）
    pub async fn get_sender(&self, node_id: &str) -> Option<tokio::sync::mpsc::UnboundedSender<Message>> {
        let connections = self.connections.read().await;
        connections.get(node_id).cloned()
    }
}

