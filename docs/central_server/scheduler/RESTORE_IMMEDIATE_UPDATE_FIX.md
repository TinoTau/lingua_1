# 恢复TTS_PLAY_ENDED中立即更新last_chunk_at_ms的修复

## 修复日期
2026-01-17

## 修复内容

恢复了在TTS_PLAY_ENDED处理时立即更新`last_chunk_at_ms`的修复，避免RestartTimer事件延迟导致的pause检测误触发。

---

## 修复位置

**文件**: `central_server/scheduler/src/websocket/session_message_handler/core.rs`
**位置**: 第178-194行（TTS_PLAY_ENDED处理逻辑）

---

## 修复代码

```rust
pub(super) async fn handle_tts_play_ended(...) {
    // 1. 更新Group的last_tts_end_at
    state.group_manager.on_tts_play_ended(&group_id, ts_end_ms).await;
    
    // 2. 立即更新last_chunk_at_ms（同步操作）- 关键修复
    let timestamp_ms = chrono::Utc::now().timestamp_millis();
    state.audio_buffer.update_last_chunk_at_ms(&sess_id, timestamp_ms).await;
    
    // 3. 发送RestartTimer事件（异步，用于重置计时器）
    // 注意：last_chunk_at_ms已经在上面的同步操作中更新，这里只是发送RestartTimer事件用于重置计时器
    if let Some(actor_handle) = state.session_manager.get_actor_handle(&sess_id).await {
        actor_handle.send(SessionEvent::RestartTimer { timestamp_ms }).await?;
    }
}
```

---

## 修复原因

### 问题

1. **Web端固定延迟**：Web端固定延迟500ms后发送audio_chunk，无法适应调度服务器的实际处理时间
2. **网络延迟**：TTS_PLAY_ENDED消息的网络延迟
3. **队列延迟**：SessionActor的事件队列可能繁忙，导致RestartTimer事件延迟处理

### 问题场景

```
时间轴（Web端）：
T0: TTS播放完成，发送TTS_PLAY_ENDED消息
    ↓
T0: 设置playbackFinishedDelayEndTime = T0 + 500ms
    ↓
T0 + 500ms: 延迟结束，开始发送audio_chunk

时间轴（调度服务器）：
T1: 收到TTS_PLAY_ENDED消息（T1可能比T0晚，因为网络延迟）
    ↓
T2: 发送RestartTimer事件到SessionActor（T2可能比T1晚）
    ↓
T3: RestartTimer事件进入SessionActor队列（T3可能比T2晚，因为队列延迟）
    ↓
T4: SessionActor处理RestartTimer事件（T4可能比T3晚，因为队列处理延迟）

问题：如果T0 + 500ms < T4（RestartTimer事件处理时间）
  ↓
Web端在RestartTimer事件处理之前发送audio_chunk ❌
  ↓
audio_chunk到达SessionActor时，last_chunk_at_ms还没有更新 ❌
  ↓
pause检测使用旧的last_chunk_at_ms，导致pause finalize误触发 ❌
```

---

## 修复效果

### 修复后的流程

```
TTS_PLAY_ENDED 消息到达
  ↓
立即更新 last_chunk_at_ms（同步操作）✅
  ↓
发送 RestartTimer 事件（异步）
  ↓
Web端延迟500ms后，发送audio_chunk（异步）
  ↓
如果audio_chunk在RestartTimer之前到达
  ↓
pause检测：audio_chunk_timestamp - last_chunk_at_ms（已经更新）✅
  ↓
时间差 < 500ms（< 3秒），不触发pause finalize ✅
```

### 关键改进

1. **同步更新last_chunk_at_ms**：
   - 在TTS_PLAY_ENDED处理时，立即更新`last_chunk_at_ms`（同步操作）
   - 这样在audio_chunk到达时，`last_chunk_at_ms`已经更新了
   - 即使RestartTimer事件延迟处理，也不会影响pause检测

2. **RestartTimer事件仍然需要发送**：
   - 用于重置超时计时器等其他操作
   - 但不影响pause检测（因为`last_chunk_at_ms`已经更新）

---

## 修复效果

修复后：
- ✅ 在TTS_PLAY_ENDED处理时，立即更新`last_chunk_at_ms`（同步操作）
- ✅ 即使RestartTimer事件延迟处理，也不会影响pause检测
- ✅ 避免因为RestartTimer时序问题导致的pause finalize误触发

**预期效果**：
- Job 4~7：如果Job 7是播放完成后的第一个chunk，时间差<500ms（<3秒），不触发pause finalize
- Job 8~11：如果Job 11是播放完成后的第一个chunk，时间差<500ms（<3秒），不触发pause finalize
- 避免错误切分导致的重复翻译

---

## 相关文件

- `central_server/scheduler/src/websocket/session_message_handler/core.rs` - 已修复
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - RestartTimer事件处理（仍然会更新last_chunk_at_ms，但这是重复的，不影响功能）
- `docs/central_server/scheduler/PAUSE_FINALIZE_ROOT_CAUSE_FIX.md` - 根本原因和修复说明
- `docs/webapp/WEB_CLIENT_AUDIO_CHUNK_TIMING_ANALYSIS.md` - Web端时序问题分析

---

## 注意事项

这个修复解决了根本问题：**在TTS_PLAY_ENDED处理时立即更新last_chunk_at_ms**，确保audio_chunk到达时，pause检测使用的是正确的时间戳。

RestartTimer事件中的`update_last_chunk_at_ms`调用是重复的，但不影响功能（因为已经在上面的同步操作中更新了）。
