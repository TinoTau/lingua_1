# 节点异常关闭通知机制

## 功能说明

节点端在异常关闭时会主动通知调度服务器，确保调度服务器能够及时检测到节点离线，而不是等待心跳超时。

## 实现机制

### 1. WebSocket 连接关闭

当节点关闭时，会调用 `nodeAgent.stop()`，该方法会：
- 停止心跳发送
- 关闭 WebSocket 连接
- 触发调度服务器的 `close` 事件处理

### 2. 调度服务器检测

调度服务器在 WebSocket 连接关闭时会：
- 调用 `mark_node_offline(node_id)` 标记节点为离线
- 从 Pool 索引中移除节点
- 更新节点缓存

**位置**：`central_server/scheduler/src/websocket/node_handler/connection.rs`

```rust
// WebSocket 连接关闭时
state.node_registry.mark_node_offline(nid).await;
```

## 覆盖的异常场景

### 1. 正常关闭

- **`window-all-closed`**: 所有窗口关闭
- **`before-quit`**: 应用退出前

**处理**：调用 `cleanupServices()` → `nodeAgent.stop()` → 关闭 WebSocket

### 2. 系统信号

- **`SIGTERM`**: 终止信号（如 `kill` 命令）
- **`SIGINT`**: 中断信号（如 Ctrl+C）

**处理**：
```typescript
(process as any).on('SIGTERM', async () => {
  try {
    await cleanupServices(...);
  } catch (error) {
    // 即使清理失败，也尝试通知调度服务器
    if (nodeAgent) {
      nodeAgent.stop();
    }
  }
  process.exit(0);
});
```

### 3. 未捕获异常

- **`uncaughtException`**: 未捕获的异常
- **`unhandledRejection`**: 未处理的 Promise 拒绝

**处理**：
```typescript
(process as any).on('uncaughtException', async (error: Error) => {
  try {
    // 设置超时保护（5秒）
    const cleanupPromise = cleanupServices(...);
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('Cleanup timeout')), 5000);
    });
    await Promise.race([cleanupPromise, timeoutPromise]);
  } catch (cleanupError) {
    // 即使清理失败或超时，也尝试通知调度服务器
    if (nodeAgent) {
      nodeAgent.stop();
    }
  }
  process.exit(1);
});
```

## 清理流程

### cleanupServices 函数

**位置**：`electron_node/electron-node/main/src/service-cleanup.ts`

**流程**：
1. 保存当前服务状态到配置文件
2. **停止 Node Agent（通知调度服务器）**
   ```typescript
   if (nodeAgent) {
     logger.info({}, 'Stopping Node Agent and notifying scheduler server...');
     nodeAgent.stop();
     // 给 WebSocket 一点时间发送关闭帧
     await new Promise(resolve => setTimeout(resolve, 100));
     logger.info({}, 'Node Agent stopped, scheduler server notified');
   }
   ```
3. 停止 Rust 服务
4. 停止所有 Python 服务
5. 停止所有语义修复服务

## 超时保护

为了防止清理过程阻塞应用退出，添加了超时保护：

- **正常清理超时**：30秒（Python 服务和语义修复服务）
- **异常清理超时**：5秒（uncaughtException, unhandledRejection）

即使清理超时，也会尝试调用 `nodeAgent.stop()` 来通知调度服务器。

## 调度服务器响应

### 立即响应

当 WebSocket 连接关闭时，调度服务器会：
1. 立即调用 `mark_node_offline(node_id)`
2. 从 Pool 索引中移除节点
3. 更新节点缓存

### 定期清理

调度服务器还有一个定期清理任务（每60秒）：
- 检查离线节点
- 从 Pool 索引中移除离线节点
- 检查空 Pool 并重建

**位置**：`central_server/scheduler/src/node_registry/phase3_pool.rs::start_pool_cleanup_task`

## 日志记录

### 节点端日志

```
[INFO] Stopping Node Agent and notifying scheduler server...
[INFO] Node Agent stopped, scheduler server notified
```

### 调度服务器日志

```
[INFO] Node WebSocket connection closed
[DEBUG] Marking node offline: node_id=node-XXXX
[DEBUG] Removed node from pool index: node_id=node-XXXX
```

## 测试建议

### 1. 正常关闭测试

1. 启动节点端和调度服务器
2. 确认节点已连接
3. 正常关闭节点端（关闭窗口）
4. 检查调度服务器日志，确认节点被标记为离线

### 2. 异常关闭测试

1. 启动节点端和调度服务器
2. 确认节点已连接
3. 使用 `kill -TERM <pid>` 发送 SIGTERM 信号
4. 检查调度服务器日志，确认节点被标记为离线

### 3. 崩溃测试

1. 启动节点端和调度服务器
2. 确认节点已连接
3. 在代码中触发未捕获异常（测试用）
4. 检查调度服务器日志，确认节点被标记为离线

### 4. 强制终止测试

1. 启动节点端和调度服务器
2. 确认节点已连接
3. 使用任务管理器强制终止进程
4. 检查调度服务器是否通过心跳超时检测到节点离线（这是预期行为，因为强制终止无法发送关闭通知）

## 注意事项

1. **强制终止**：如果进程被强制终止（如任务管理器），无法发送关闭通知，调度服务器会通过心跳超时检测到节点离线。

2. **超时保护**：异常情况下的清理有5秒超时，确保应用能够及时退出。

3. **WebSocket 关闭延迟**：在 `cleanupServices` 中，给 WebSocket 100ms 的时间发送关闭帧，确保调度服务器能够收到关闭通知。

4. **重连机制**：如果 WebSocket 连接意外断开（非正常关闭），节点端会自动尝试重连。但在应用退出时，`nodeAgent.stop()` 会阻止重连。

## 相关文件

- `electron_node/electron-node/main/src/index.ts`: 异常处理入口
- `electron_node/electron-node/main/src/service-cleanup.ts`: 清理逻辑
- `electron_node/electron-node/main/src/agent/node-agent.ts`: Node Agent 停止逻辑
- `central_server/scheduler/src/websocket/node_handler/connection.rs`: WebSocket 连接处理
- `central_server/scheduler/src/node_registry/core.rs`: 节点离线标记逻辑
