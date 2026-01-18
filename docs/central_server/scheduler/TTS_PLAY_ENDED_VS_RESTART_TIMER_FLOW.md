# TTS_PLAY_ENDED 和 RestartTimer 事件流程说明

## 问题

用户问：TTS_PLAY_ENDED和RestartTimer是由同一个web端事件触发的吗？为什么还不一样呢？

---

## 流程分析

### 完整流程

```
Web端：TTS播放完成
  ↓
Web端：发送 TTS_PLAY_ENDED 消息（WebSocket消息）
  ↓
调度服务器：收到 TTS_PLAY_ENDED 消息
  ↓
调度服务器：handle_tts_play_ended() 处理
  ├─ 1. 更新 Group 的 last_tts_end_at
  ├─ 2. 立即更新 last_chunk_at_ms（同步操作）✅
  └─ 3. 发送 RestartTimer 事件到 SessionActor（异步事件）✅
       ↓
SessionActor：收到 RestartTimer 事件
  ├─ 1. 再次更新 last_chunk_at_ms（重复）❌
  └─ 2. 调用 reset_timers()（重置超时计时器）✅
```

---

## 关键发现

### 1. 它们确实是由同一个Web端事件触发的

**Web端事件**：
- TTS播放完成 → 发送 `TTS_PLAY_ENDED` 消息（WebSocket消息）

**调度服务器处理**：
- 收到 `TTS_PLAY_ENDED` 消息 → 在 `handle_tts_play_ended` 中处理
- 在同一个处理函数中，发送 `RestartTimer` 事件到 SessionActor

**结论**：✅ 是的，它们都是由同一个Web端事件（TTS播放完成）触发的。

---

### 2. 为什么需要两个步骤？

**原因：架构设计（Actor模式）**

1. **TTS_PLAY_ENDED 处理**：
   - 位置：`session_message_handler/core.rs`（WebSocket消息处理层）
   - 只能访问：`AppState`、`SessionManager`、`AudioBuffer`等共享状态
   - **无法直接访问**：`SessionActor`的内部状态（`current_timer_handle`、`internal_state`等）

2. **RestartTimer 事件**：
   - 位置：`SessionActor`（单线程Actor）
   - 需要访问：`SessionActor`的内部状态（`current_timer_handle`、`internal_state`等）
   - **只能通过消息传递**：因为SessionActor是单线程的，只能通过事件与之交互

3. **reset_timers() 的需求**：
   - 需要 `&mut self`，访问SessionActor的内部状态
   - 无法从外部（`session_message_handler`）直接调用

---

## 问题：为什么不能直接在TTS_PLAY_ENDED处理中完成所有操作？

### 理论上可以，但需要架构改变

**当前架构**：
```
Web端 → TTS_PLAY_ENDED消息 → session_message_handler → SessionActor（通过事件）
```

**如果要在TTS_PLAY_ENDED处理中直接调用reset_timers()**：
- 需要让`session_message_handler`能够直接访问`SessionActor`的内部状态
- 这违反了Actor模式的设计原则（单线程、消息传递）

**但是**，我们可以简化RestartTimer事件：
- 移除重复的`update_last_chunk_at_ms`调用
- 只保留`reset_timers()`调用

---

## 简化方案

### 方案：简化RestartTimer事件（移除重复逻辑）

**修改前**：
```rust
// TTS_PLAY_ENDED处理中
pub(super) async fn handle_tts_play_ended(...) {
    // 1. 更新 last_chunk_at_ms（同步操作）
    state.audio_buffer.update_last_chunk_at_ms(&sess_id, timestamp_ms).await;
    
    // 2. 发送 RestartTimer 事件
    actor_handle.send(SessionEvent::RestartTimer { timestamp_ms }).await?;
}

// RestartTimer事件处理中
pub(crate) async fn handle_restart_timer(&mut self, timestamp_ms: i64) {
    // 1. 再次更新 last_chunk_at_ms（重复）❌
    self.state.audio_buffer.update_last_chunk_at_ms(&self.session_id, timestamp_ms).await;
    
    // 2. 重置超时计时器
    self.reset_timers().await?;
}
```

**修改后**：
```rust
// TTS_PLAY_ENDED处理中
pub(super) async fn handle_tts_play_ended(...) {
    // 1. 更新 last_chunk_at_ms（同步操作）
    state.audio_buffer.update_last_chunk_at_ms(&sess_id, timestamp_ms).await;
    
    // 2. 发送 RestartTimer 事件（只用于重置计时器）
    actor_handle.send(SessionEvent::RestartTimer { timestamp_ms }).await?;
}

// RestartTimer事件处理中（简化）
pub(crate) async fn handle_restart_timer(&mut self, _timestamp_ms: i64) {
    // 移除：不再重复更新 last_chunk_at_ms（已经在TTS_PLAY_ENDED中同步更新了）
    
    // 保留：重置超时计时器（这是RestartTimer事件的主要目的）
    if self.pause_ms > 0 {
        self.reset_timers().await?;
    }
}
```

---

## 总结

### 回答用户的问题

1. **TTS_PLAY_ENDED和RestartTimer是由同一个web端事件触发的吗？**
   - ✅ **是的**，它们都是由同一个Web端事件（TTS播放完成）触发的

2. **为什么还不一样呢？**
   - **TTS_PLAY_ENDED**：Web端发送的WebSocket消息（外部消息）
   - **RestartTimer**：调度服务器内部发送给SessionActor的事件（内部事件）
   - **原因**：架构设计（Actor模式），SessionActor只能通过消息传递与之交互

3. **为什么需要两个步骤？**
   - **TTS_PLAY_ENDED处理**：在`session_message_handler`中，无法直接访问SessionActor的内部状态
   - **RestartTimer事件**：在SessionActor中，可以访问内部状态，调用`reset_timers()`

4. **可以简化吗？**
   - ✅ **可以**，移除RestartTimer事件中的重复`update_last_chunk_at_ms`调用
   - ✅ **保留**RestartTimer事件，因为它需要访问SessionActor的内部状态来重置计时器

---

## 相关文件

- `webapp/web-client/src/app.ts` - Web端发送TTS_PLAY_ENDED消息
- `central_server/scheduler/src/websocket/session_message_handler/core.rs` - TTS_PLAY_ENDED处理
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - RestartTimer事件处理
- `central_server/scheduler/src/websocket/session_actor/actor/actor_timers.rs` - reset_timers实现
