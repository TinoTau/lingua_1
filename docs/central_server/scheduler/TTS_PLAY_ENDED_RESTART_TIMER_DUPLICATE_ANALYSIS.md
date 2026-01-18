# TTS_PLAY_ENDED 和 RestartTimer 事件重复逻辑分析

## 分析日期
2026-01-17

## 问题

检查文档和实际代码，确认TTS_PLAY_ENDED和RestartTimer事件是否属于重复逻辑。

---

## 代码分析

### 1. TTS_PLAY_ENDED 处理逻辑

**位置**: `central_server/scheduler/src/websocket/session_message_handler/core.rs` (第162-225行)

**执行的操作**：
```rust
pub(super) async fn handle_tts_play_ended(...) {
    // 1. 更新 Group 的 last_tts_end_at
    state.group_manager.on_tts_play_ended(&group_id, ts_end_ms).await;
    
    // 2. 立即更新 last_chunk_at_ms（同步操作）- 关键修复
    let timestamp_ms = chrono::Utc::now().timestamp_millis();
    state.audio_buffer.update_last_chunk_at_ms(&sess_id, timestamp_ms).await;
    
    // 3. 发送 RestartTimer 事件到 SessionActor（异步）
    if let Some(actor_handle) = state.session_manager.get_actor_handle(&sess_id).await {
        actor_handle.send(SessionEvent::RestartTimer { timestamp_ms }).await?;
    }
}
```

**关键点**：
- ✅ 同步更新 `last_chunk_at_ms`（立即执行，不依赖SessionActor事件队列）
- ✅ 发送 `RestartTimer` 事件到 SessionActor（异步）

---

### 2. RestartTimer 事件处理逻辑

**位置**: `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` (第324-361行)

**执行的操作**：
```rust
pub(crate) async fn handle_restart_timer(&mut self, timestamp_ms: i64) -> Result<(), anyhow::Error> {
    // 1. 再次更新 last_chunk_at_ms（实际上已经在上面的同步操作中更新了）
    self.state.audio_buffer.update_last_chunk_at_ms(&self.session_id, timestamp_ms).await;
    
    // 2. 重置超时计时器
    if self.pause_ms > 0 {
        self.reset_timers().await?;
    }
}
```

**关键点**：
- ❌ **重复更新 `last_chunk_at_ms`**（已经在TTS_PLAY_ENDED中同步更新了）
- ✅ 重置超时计时器（调用`reset_timers()`）

---

### 3. reset_timers() 函数逻辑

**位置**: `central_server/scheduler/src/websocket/session_actor/actor/actor_timers.rs` (第14-52行)

**执行的操作**：
```rust
pub(crate) async fn reset_timers(&mut self) -> Result<(), anyhow::Error> {
    // 1. 取消旧的超时计时器
    self.cancel_timers();
    
    // 2. 获取 last_chunk_at_ms（用于新的超时计时器）
    let timestamp_ms = self.state.audio_buffer.get_last_chunk_at_ms(&self.session_id).await
        .or_else(|| self.internal_state.last_chunk_timestamp_ms)
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    
    // 3. 启动新的超时计时器
    // 如果 pause_ms 时间内没有新 chunk，会触发 TimeoutFired 事件
    tokio::spawn(async move {
        sleep(Duration::from_millis(pause_ms)).await;
        // 检查时间戳是否仍然匹配
        if let Some(last_ts) = state.audio_buffer.get_last_chunk_at_ms(&session_id).await {
            if last_ts != timestamp_ms {
                return; // 时间戳已更新，说明有新 chunk，忽略本次超时
            }
        }
        // 发送超时事件
        event_tx.send(SessionEvent::TimeoutFired { generation, timestamp_ms });
    });
}
```

**关键点**：
- ✅ 取消旧的超时计时器
- ✅ 启动新的超时计时器（基于 `last_chunk_at_ms`）
- ✅ 超时计时器用于检测长时间无音频输入，触发 `TimeoutFired` 事件

---

## 重复逻辑分析

### 重复的部分

**1. `update_last_chunk_at_ms` 调用**：
- ✅ 在 `TTS_PLAY_ENDED` 处理中：**同步更新**（第185行）
- ❌ 在 `RestartTimer` 事件处理中：**重复更新**（第335行）

**结论**：`RestartTimer` 事件中的 `update_last_chunk_at_ms` 调用是**重复的**，因为 `last_chunk_at_ms` 已经在 `TTS_PLAY_ENDED` 处理中同步更新了。

### 不重复的部分

**2. `reset_timers()` 调用**：
- ❌ 在 `TTS_PLAY_ENDED` 处理中：**不调用**（因为 `reset_timers()` 需要访问 `SessionActor` 的内部状态）
- ✅ 在 `RestartTimer` 事件处理中：**调用**（第357行）

**结论**：`reset_timers()` 调用是**必要的**，因为：
1. `reset_timers()` 需要访问 `SessionActor` 的内部状态（`self.internal_state`、`self.current_timer_handle`等）
2. 它重置超时计时器，用于检测长时间无音频输入

---

## 结论

### 是否属于重复逻辑？

**部分重复**：

1. **`update_last_chunk_at_ms` 调用是重复的**：
   - `TTS_PLAY_ENDED` 处理中已经同步更新了 `last_chunk_at_ms`
   - `RestartTimer` 事件处理中再次更新是重复的
   - **建议**：可以从 `RestartTimer` 事件处理中移除 `update_last_chunk_at_ms` 调用

2. **`reset_timers()` 调用是必要的**：
   - `TTS_PLAY_ENDED` 处理中无法调用（需要访问 `SessionActor` 内部状态）
   - `RestartTimer` 事件处理中调用是必要的（重置超时计时器）
   - **保留**：`reset_timers()` 调用应该保留

---

## 建议修复

### 修复方案

**从 `RestartTimer` 事件处理中移除重复的 `update_last_chunk_at_ms` 调用**：

```rust
pub(crate) async fn handle_restart_timer(&mut self, timestamp_ms: i64) -> Result<(), anyhow::Error> {
    // 移除：不再重复更新 last_chunk_at_ms
    // 因为已经在 TTS_PLAY_ENDED 处理中同步更新了
    // self.state.audio_buffer.update_last_chunk_at_ms(&self.session_id, timestamp_ms).await;
    
    // 保留：重置超时计时器（这是 RestartTimer 事件的主要目的）
    if self.pause_ms > 0 {
        info!(
            session_id = %self.session_id,
            timestamp_ms = timestamp_ms,
            pause_ms = self.pause_ms,
            current_utterance_index = self.internal_state.current_utterance_index,
            "RestartTimer: 重置超时计时器（last_chunk_at_ms已在TTS_PLAY_ENDED中更新）"
        );
        self.reset_timers().await?;
    }
    
    Ok(())
}
```

### 修复理由

1. **消除重复逻辑**：
   - `last_chunk_at_ms` 已经在 `TTS_PLAY_ENDED` 处理中同步更新
   - `RestartTimer` 事件中的更新是多余的

2. **保持功能完整性**：
   - `reset_timers()` 调用仍然保留（这是 `RestartTimer` 事件的主要目的）
   - 超时计时器重置功能不受影响

3. **简化代码**：
   - 减少不必要的操作
   - 代码更容易理解和维护

---

## 相关文件

- `central_server/scheduler/src/websocket/session_message_handler/core.rs` - TTS_PLAY_ENDED处理
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - RestartTimer事件处理
- `central_server/scheduler/src/websocket/session_actor/actor/actor_timers.rs` - reset_timers实现
- `central_server/scheduler/src/managers/audio_buffer.rs` - update_last_chunk_at_ms实现

---

## 总结

**TTS_PLAY_ENDED 和 RestartTimer 事件有部分重复逻辑**：

1. ✅ **`update_last_chunk_at_ms` 调用是重复的**（建议移除）
2. ✅ **`reset_timers()` 调用是必要的**（应该保留）

**建议**：从 `RestartTimer` 事件处理中移除 `update_last_chunk_at_ms` 调用，只保留 `reset_timers()` 调用。
