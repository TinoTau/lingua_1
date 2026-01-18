# 移除RestartTimer事件可行性分析

## 分析日期
2026-01-17

## 问题

如果直接在TTS_PLAY_ENDED中重置超时计时器，是否可以完全移除RestartTimer事件？

---

## 架构分析

### 1. SessionActorHandle 的限制

**位置**: `central_server/scheduler/src/websocket/session_actor/actor/actor_handle.rs`

```rust
pub struct SessionActorHandle {
    pub(crate) sender: mpsc::UnboundedSender<SessionEvent>,
}

impl SessionActorHandle {
    pub fn send(&self, event: SessionEvent) -> Result<..., ...> {
        self.sender.send(event)
    }
}
```

**关键点**：
- `SessionActorHandle`只是一个`mpsc::UnboundedSender<SessionEvent>`的包装
- **只能发送事件**，不能直接调用SessionActor的方法
- 这是典型的Actor模式：通过消息传递，而非直接方法调用

---

### 2. reset_timers() 的需求

**位置**: `central_server/scheduler/src/websocket/session_actor/actor/actor_timers.rs`

```rust
pub(crate) async fn reset_timers(&mut self) -> Result<(), anyhow::Error> {
    // 需要访问SessionActor的内部状态：
    // - self.current_timer_handle (取消旧计时器)
    // - self.internal_state (increment_timer_generation)
    // - self.state.audio_buffer (获取last_chunk_at_ms)
    // - self.session_id (克隆)
    // - self.event_tx (发送TimeoutFired事件)
    // - self.pause_ms (超时时间)
    
    self.cancel_timers();
    let generation = self.internal_state.increment_timer_generation();
    let timestamp_ms = self.state.audio_buffer.get_last_chunk_at_ms(&self.session_id).await
        .or_else(|| self.internal_state.last_chunk_timestamp_ms)
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    
    // 启动新计时器
    let handle = tokio::spawn(async move { ... });
    self.current_timer_handle = Some(handle);
    
    Ok(())
}
```

**关键点**：
- `reset_timers()`需要`&mut self`，需要访问SessionActor的内部状态
- 无法从外部（TTS_PLAY_ENDED处理）直接调用

---

### 3. TTS_PLAY_ENDED 处理的位置

**位置**: `central_server/scheduler/src/websocket/session_message_handler/core.rs`

```rust
pub(super) async fn handle_tts_play_ended(...) {
    // 只能通过actor_handle发送事件，无法直接调用SessionActor的方法
    if let Some(actor_handle) = state.session_manager.get_actor_handle(&sess_id).await {
        actor_handle.send(SessionEvent::RestartTimer { timestamp_ms }).await?;
    }
}
```

**关键点**：
- TTS_PLAY_ENDED处理在`session_message_handler`中
- 只有`SessionActorHandle`（只能发送事件），没有`SessionActor`的直接访问权限
- 这是架构设计：SessionActor是单线程的，只能通过消息传递与之交互

---

## 结论

### 是否可以直接在TTS_PLAY_ENDED中重置超时计时器？

**❌ 不可以**，因为：

1. **架构限制**：
   - `SessionActorHandle`只能发送事件，不能直接调用SessionActor的方法
   - `reset_timers()`需要`&mut self`，需要访问SessionActor的内部状态
   - SessionActor是单线程的，只能通过消息传递与之交互

2. **需要事件机制**：
   - 无论如何，都需要发送一个事件来触发`reset_timers()`
   - 即使移除`RestartTimer`事件，也需要创建另一个事件

---

## 可行性方案

### 方案1：保留RestartTimer事件，但简化它（推荐）

**修改**：移除RestartTimer事件中的`update_last_chunk_at_ms`调用，只保留`reset_timers()`调用

```rust
// TTS_PLAY_ENDED处理中
pub(super) async fn handle_tts_play_ended(...) {
    // 同步更新last_chunk_at_ms（关键修复）
    let timestamp_ms = chrono::Utc::now().timestamp_millis();
    state.audio_buffer.update_last_chunk_at_ms(&sess_id, timestamp_ms).await;
    
    // 发送RestartTimer事件，只用于重置计时器（不再更新last_chunk_at_ms）
    if let Some(actor_handle) = state.session_manager.get_actor_handle(&sess_id).await {
        actor_handle.send(SessionEvent::RestartTimer { timestamp_ms }).await?;
    }
}

// RestartTimer事件处理中
pub(crate) async fn handle_restart_timer(&mut self, timestamp_ms: i64) -> Result<(), anyhow::Error> {
    // 移除：不再重复更新last_chunk_at_ms（已经在TTS_PLAY_ENDED中同步更新了）
    
    // 保留：重置超时计时器（这是RestartTimer事件的主要目的）
    if self.pause_ms > 0 {
        self.reset_timers().await?;
    }
    
    Ok(())
}
```

**优点**：
- ✅ 消除重复逻辑（不再重复更新`last_chunk_at_ms`）
- ✅ 保留必要功能（重置超时计时器）
- ✅ 代码更清晰

---

### 方案2：重命名RestartTimer为ResetTimer

**修改**：重命名`RestartTimer`为`ResetTimer`，使其更清晰地表达目的

```rust
// SessionEvent枚举
pub enum SessionEvent {
    // ...
    /// 重置超时计时器（用于播放完成后重置计时器）
    ResetTimer {
        timestamp_ms: i64, // 时间戳（用于日志）
    },
}

// 处理
pub(crate) async fn handle_reset_timer(&mut self, _timestamp_ms: i64) -> Result<(), anyhow::Error> {
    // 只重置超时计时器，不更新last_chunk_at_ms
    if self.pause_ms > 0 {
        self.reset_timers().await?;
    }
    Ok(())
}
```

**优点**：
- ✅ 名称更清晰（`ResetTimer`比`RestartTimer`更准确）
- ✅ 语义更明确（只重置计时器，不重启其他东西）

---

### 方案3：完全移除RestartTimer事件（❌ 不可行）

**问题**：
- ❌ 无法直接调用`reset_timers()`
- ❌ 仍然需要某种事件机制来触发重置
- ❌ 如果移除`RestartTimer`，需要创建另一个事件（本质上是一样的）

**结论**：**不可行**，因为架构限制

---

## 推荐方案

### 推荐：方案1 + 方案2（重命名）

1. **移除重复的`update_last_chunk_at_ms`调用**：
   - 从`handle_restart_timer`中移除
   - 保留在`TTS_PLAY_ENDED`处理中的同步更新

2. **重命名`RestartTimer`为`ResetTimer`**（可选）：
   - 使名称更清晰
   - 语义更明确

3. **简化`handle_reset_timer`**：
   - 只调用`reset_timers()`
   - 不再更新`last_chunk_at_ms`

---

## 总结

**是否可以直接在TTS_PLAY_ENDED中重置超时计时器？**

**❌ 不可以**，因为：
1. `SessionActorHandle`只能发送事件，不能直接调用方法
2. `reset_timers()`需要访问SessionActor的内部状态
3. 无论如何都需要事件机制来触发重置

**但是，我们可以简化RestartTimer事件**：
1. ✅ 移除重复的`update_last_chunk_at_ms`调用
2. ✅ 只保留`reset_timers()`调用
3. ✅ 可选：重命名为`ResetTimer`使其更清晰

**建议**：采用方案1（移除重复逻辑），可选方案2（重命名）。
