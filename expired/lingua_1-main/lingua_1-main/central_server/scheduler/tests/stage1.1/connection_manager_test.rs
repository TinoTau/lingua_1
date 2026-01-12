// 连接管理单元测试

use lingua_scheduler::managers::{SessionConnectionManager, NodeConnectionManager};
use axum::extract::ws::Message;
use tokio::sync::mpsc;

#[tokio::test]
async fn test_session_connection_register() {
    let manager = SessionConnectionManager::new();
    
    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    manager.register("session-1".to_string(), tx).await;
    
    // 注册后应该能够发送消息
    let success = manager.send("session-1", Message::Text("test".to_string())).await;
    assert!(success);
}

#[tokio::test]
async fn test_session_connection_send_to_nonexistent() {
    let manager = SessionConnectionManager::new();
    
    let success = manager.send("nonexistent", Message::Text("test".to_string())).await;
    assert!(!success);
}

#[tokio::test]
async fn test_session_connection_unregister() {
    let manager = SessionConnectionManager::new();
    
    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    manager.register("session-2".to_string(), tx).await;
    
    manager.unregister("session-2").await;
    
    // 注销后应该无法发送消息
    let success = manager.send("session-2", Message::Text("test".to_string())).await;
    assert!(!success);
}

#[tokio::test]
async fn test_session_connection_multiple() {
    let manager = SessionConnectionManager::new();
    
    let (tx1, _rx1) = mpsc::unbounded_channel::<Message>();
    let (tx2, _rx2) = mpsc::unbounded_channel::<Message>();
    
    manager.register("session-3".to_string(), tx1).await;
    manager.register("session-4".to_string(), tx2).await;
    
    let success1 = manager.send("session-3", Message::Text("test1".to_string())).await;
    let success2 = manager.send("session-4", Message::Text("test2".to_string())).await;
    
    assert!(success1);
    assert!(success2);
}

#[tokio::test]
async fn test_node_connection_register() {
    let manager = NodeConnectionManager::new();
    
    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    manager.register("node-1".to_string(), tx).await;
    
    let success = manager.send("node-1", Message::Text("test".to_string())).await;
    assert!(success);
}

#[tokio::test]
async fn test_node_connection_send_to_nonexistent() {
    let manager = NodeConnectionManager::new();
    
    let success = manager.send("nonexistent", Message::Text("test".to_string())).await;
    assert!(!success);
}

#[tokio::test]
async fn test_node_connection_unregister() {
    let manager = NodeConnectionManager::new();
    
    let (tx, _rx) = mpsc::unbounded_channel::<Message>();
    manager.register("node-2".to_string(), tx).await;
    
    manager.unregister("node-2").await;
    
    let success = manager.send("node-2", Message::Text("test".to_string())).await;
    assert!(!success);
}

#[tokio::test]
async fn test_node_connection_multiple() {
    let manager = NodeConnectionManager::new();
    
    let (tx1, _rx1) = mpsc::unbounded_channel::<Message>();
    let (tx2, _rx2) = mpsc::unbounded_channel::<Message>();
    
    manager.register("node-3".to_string(), tx1).await;
    manager.register("node-4".to_string(), tx2).await;
    
    let success1 = manager.send("node-3", Message::Text("test1".to_string())).await;
    let success2 = manager.send("node-4", Message::Text("test2".to_string())).await;
    
    assert!(success1);
    assert!(success2);
}

