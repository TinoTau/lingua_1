# WebSocket 连接状态同步修复

## 问题总结

之前发现的问题是：**WebSocket 连接状态与 Channel 状态不同步**，导致日志显示"Successfully sent translation result to session"，但客户端实际未收到消息。

## 根本原因

1. **`send_task` 失败时没有清理连接注册**
   - 当 WebSocket `sender.send(msg).await.is_err()` 时（连接断开），`send_task` 只是 `break`，没有通知主循环连接已断开
   - `SessionConnectionManager` 仍然认为连接存在

2. **`SessionConnectionManager::send` 只检查 Channel，不检查 WebSocket**
   - `send()` 只是把消息发送到 `UnboundedSender` channel
   - 即使 WebSocket 已断开，channel send 仍会成功，返回 `true`

## 修复内容

### 1. 修复 `session_handler.rs` - 添加发送失败检测

**修改点**：
- 添加 `oneshot::channel` 用于通知主循环发送任务失败
- 使用 `tokio::select!` 同时监听接收消息和发送失败通知
- 当检测到发送失败时，立即退出主循环并清理连接

**关键代码**：
```rust
// 创建通知 channel
let (send_failed_tx, send_failed_rx) = tokio::sync::oneshot::channel::<()>();
let send_failed_tx_arc = Arc::new(Mutex::new(Some(send_failed_tx)));

// 在 send_task 中，发送失败时通知主循环
if sender.send(msg).await.is_err() {
    error!("WebSocket 发送失败，连接可能已断开");
    if let Ok(mut tx_guard) = send_failed_tx_arc.lock() {
        if let Some(tx) = tx_guard.take() {
            let _ = tx.send(());  // 通知主循环
        }
    }
    break;
}

// 在主循环中检测发送失败
tokio::select! {
    result = send_failed_rx => {
        // 发送失败，立即清理并退出
        break;
    }
    msg = receiver.next() => {
        // 处理接收消息
    }
}
```

### 2. 改进连接清理逻辑

**修改点**：
- 在清理时，**立即**从 `session_connections` 中移除会话
- 添加详细的日志记录
- 改进错误处理

**关键改进**：
```rust
// 立即从连接管理器中移除（防止后续消息误发送）
state.session_connections.unregister(sess_id).await;
info!(session_id = %sess_id, "已从连接管理器移除会话");
```

### 3. 改进 `connection_manager.rs` - 改进错误处理

**修改点**：
- 当 channel send 失败时（receiver 已关闭），自动清理连接注册
- 添加更详细的错误日志

**关键代码**：
```rust
match sender.send(message) {
    Ok(()) => true,
    Err(e) => {
        error!("发送消息到会话 {} 失败（channel receiver 已关闭）", session_id);
        // 在锁外执行清理，避免死锁
        drop(connections);
        self.unregister(session_id).await;
        false
    }
}
```

## 修复效果

修复后，当 WebSocket 连接断开时：

1. ✅ **立即检测到发送失败**：`send_task` 检测到 `sender.send()` 失败
2. ✅ **立即通知主循环**：通过 `oneshot::channel` 通知主循环
3. ✅ **立即清理连接**：主循环退出并清理 `session_connections`
4. ✅ **防止误发送**：后续消息调用 `send()` 时，会立即返回 `false`
5. ✅ **正确记录日志**：不再有误导性的"Successfully sent"日志

## 测试建议

修复后，建议进行以下测试：

1. **正常流程测试**：验证正常消息收发仍然工作
2. **连接断开测试**：在任务处理期间断开 WebSocket 连接，验证：
   - 是否立即检测到连接断开
   - 是否立即清理连接注册
   - 是否不再有误导性的成功日志
3. **超时测试**：验证长时间任务处理时的连接稳定性

## 相关文件

- `central_server/scheduler/src/websocket/session_handler.rs` - 主修复
- `central_server/scheduler/src/managers/connection_manager.rs` - 错误处理改进
