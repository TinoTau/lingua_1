# JobResult 去重机制实现

## 实现日期
2025-12-30

## 需求

根据用户需求，实现一个核销机制：
- 将收到节点端返回结果的job存放在该session里保留30秒
- 30秒内再收到同一个返回结果就直接过滤
- 在不调整超时时间的情况下避免重复返回结果

## 实现方案

### 1. 创建JobResultDeduplicator管理器

**文件**：`central_server/scheduler/src/core/job_result_deduplicator.rs`

**功能**：
- 按 `session_id` 和 `job_id` 进行去重
- 每个job_result记录保留30秒（TTL）
- 提供检查、记录、清理功能

**核心方法**：
- `check_and_record(session_id, job_id)`: 检查并记录job_result，返回true表示重复
- `cleanup_expired()`: 清理过期的记录
- `remove_session(session_id)`: 移除session的所有记录

### 2. 集成到AppState

**文件**：`central_server/scheduler/src/core/app_state.rs`

**修改**：
- 添加 `job_result_deduplicator: JobResultDeduplicator` 字段

### 3. 在handle_job_result中调用

**文件**：`central_server/scheduler/src/websocket/node_handler/message/job_result.rs`

**修改**：
- 在处理job_result之前，先调用 `check_and_record` 检查是否重复
- 如果返回true（重复），直接返回，不进行后续处理
- 如果返回false（新结果），继续正常处理

**代码位置**（第36-47行）：
```rust
// 核销机制：检查是否在30秒内已经收到过相同job_id的结果
// 如果是，直接过滤掉，避免重复输出
if state.job_result_deduplicator.check_and_record(&session_id, &job_id).await {
    warn!(
        trace_id = %trace_id,
        job_id = %job_id,
        session_id = %session_id,
        utterance_index = utterance_index,
        "Duplicate job_result filtered (received within 30 seconds), skipping processing"
    );
    return; // 直接返回，不进行后续处理
}
```

### 4. 启动清理任务

**文件**：`central_server/scheduler/src/main.rs`

**修改**：
- 启动后台任务，每30秒清理一次过期的记录

**代码位置**（第273-280行）：
```rust
// 启动JobResult去重管理器清理任务（每30秒清理一次过期记录）
let job_result_deduplicator_for_cleanup = app_state.job_result_deduplicator.clone();
tokio::spawn(async move {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
    loop {
        interval.tick().await;
        job_result_deduplicator_for_cleanup.cleanup_expired().await;
    }
});
```

### 5. Session清理时移除记录

**文件**：`central_server/scheduler/src/websocket/session_actor/actor.rs`

**修改**：
- 在session cleanup时，调用 `remove_session` 移除该session的所有记录

**代码位置**（第866行）：
```rust
// 清理JobResult去重记录
self.state.job_result_deduplicator.remove_session(&self.session_id).await;
```

## 工作流程

### 正常流程

1. 节点端返回job_result
2. 调度服务器收到job_result
3. 调用 `check_and_record(session_id, job_id)`
4. 检查是否在30秒内已经收到过相同job_id的结果
5. 如果没有，记录该job_id，继续处理
6. 如果有，直接过滤，不进行后续处理

### Failover场景

1. Job超时，调度服务器触发failover，重新派发job（attempt_id递增）
2. 节点端可能处理了多个attempt，返回多个job_result（相同的job_id）
3. 第一个job_result被记录，继续处理
4. 后续的job_result在30秒内到达，被检测为重复，直接过滤
5. 避免重复输出

## 优势

1. **不增加系统负担**：不需要延长超时时间，保持30秒超时机制
2. **简单有效**：基于时间窗口的去重，实现简单，性能好
3. **自动清理**：定期清理过期记录，避免内存泄漏
4. **Session隔离**：按session_id隔离，不同session之间不影响

## 配置

- **TTL时间**：30秒（硬编码在 `JobResultDeduplicator::default_ttl_ms`）
- **清理间隔**：30秒（后台任务清理间隔）

## 相关文件

- **JobResultDeduplicator**: `central_server/scheduler/src/core/job_result_deduplicator.rs`
- **AppState**: `central_server/scheduler/src/core/app_state.rs`
- **handle_job_result**: `central_server/scheduler/src/websocket/node_handler/message/job_result.rs`
- **main.rs**: `central_server/scheduler/src/main.rs`
- **SessionActor**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

---

**实现日期**：2025-12-30  
**实现人员**：AI Assistant  
**状态**：✅ 已实现，待测试验证

