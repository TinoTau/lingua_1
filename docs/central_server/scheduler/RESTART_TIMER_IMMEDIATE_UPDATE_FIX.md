# RestartTimer时序问题修复 - 立即更新last_chunk_at_ms

## 修复日期
2026-01-17

## 问题描述

用户发现：**用户一直连续说话，根本没有停顿**，但调度服务器却检测到了pause并触发了finalize，特别是长语音的最后一个job出问题。

**根本原因**：RestartTimer事件和audio_chunk事件的时序竞争导致pause检测误触发。

### 问题场景

**关键问题**：
```
TTS播放完成，Web端发送TTS_PLAY_ENDED
  ↓
调度服务器收到TTS_PLAY_ENDED，发送RestartTimer事件（异步）
  ↓
Web端延迟500ms后，发送audio_chunk（异步）
  ↓
【问题】如果audio_chunk在RestartTimer事件之前到达SessionActor
  ↓
pause检测：audio_chunk_timestamp - last_utterance_chunk_time > 3000ms
  ↓
【触发pause finalize】❌ 错误！
  ↓
然后RestartTimer事件才处理，更新last_chunk_at_ms（已经太晚了）
```

**关键发现**：
1. RestartTimer事件和audio_chunk事件都是异步到达SessionActor
2. SessionActor是单线程处理事件，按顺序处理
3. 如果audio_chunk在RestartTimer之前到达，pause检测使用的是旧的`last_chunk_at_ms`（上一个utterance的时间戳）
4. 导致时间差>3秒，触发pause finalize

---

## 修复方案

### 修复位置
**文件**: `central_server/scheduler/src/websocket/session_message_handler/core.rs`
**位置**: 第175-203行（TTS_PLAY_ENDED处理逻辑）

### 修复内容

**在TTS_PLAY_ENDED处理时，立即更新`last_chunk_at_ms`**（同步操作），而不是等到RestartTimer事件处理：

```rust
// 修复：在TTS_PLAY_ENDED处理时，立即更新last_chunk_at_ms（同步操作）
// 这样可以确保在audio_chunk到达之前，last_chunk_at_ms已经更新
// 避免RestartTimer事件延迟处理导致的pause检测误触发
let timestamp_ms = chrono::Utc::now().timestamp_millis();
state.audio_buffer.update_last_chunk_at_ms(&sess_id, timestamp_ms).await;

// 然后发送RestartTimer事件（用于重置计时器等其他操作）
// 注意：last_chunk_at_ms已经在上面的同步操作中更新，所以即使RestartTimer事件延迟处理，也不会影响pause检测
if let Some(actor_handle) = state.session_manager.get_actor_handle(&sess_id).await {
    actor_handle.send(SessionEvent::RestartTimer { timestamp_ms }).await?;
}
```

### 关键改进

1. **同步更新last_chunk_at_ms**：
   - 在TTS_PLAY_ENDED处理时，立即更新`last_chunk_at_ms`（同步操作）
   - 这样在audio_chunk到达时，`last_chunk_at_ms`已经更新了
   - 即使RestartTimer事件延迟处理，也不会影响pause检测

2. **RestartTimer事件仍然需要发送**：
   - 用于重置计时器等其他操作
   - 但不影响pause检测（因为`last_chunk_at_ms`已经更新）

### 修复后的流程

```
TTS播放完成，Web端发送TTS_PLAY_ENDED
  ↓
调度服务器收到TTS_PLAY_ENDED
  ↓
【立即更新last_chunk_at_ms】（同步操作）✅
  ↓
发送RestartTimer事件（异步）
  ↓
Web端延迟500ms后，发送audio_chunk（异步）
  ↓
调度服务器收到audio_chunk
  ↓
pause检测：audio_chunk_timestamp - last_chunk_at_ms（已经是RestartTimer时间戳）
  ↓
时间差 < 500ms（< 3秒），不触发pause finalize ✅
```

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
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - 之前的补丁修复（现在可能不再需要）
- `docs/central_server/scheduler/restart_flow_summary.md` - RestartTimer流程说明
- `docs/electron_node/JOB_8_11_MERGE_ROOT_CAUSE.md` - 合并问题根本原因分析

---

## 注意事项

这个修复解决了根本问题：**在TTS_PLAY_ENDED处理时立即更新last_chunk_at_ms**，确保audio_chunk到达时，pause检测使用的是正确的时间戳。

之前的补丁修复（在pause检测时检查是否是RestartTimer延迟）可能不再需要，但保留它可以作为额外的保护措施。
