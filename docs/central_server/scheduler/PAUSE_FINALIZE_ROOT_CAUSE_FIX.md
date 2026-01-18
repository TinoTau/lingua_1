# Pause Finalize误触发问题 - 根本原因和修复

## 修复日期
2026-01-17

## 问题描述

用户发现：**用户一直连续说话，根本没有停顿**，但调度服务器却检测到了pause并触发了finalize，特别是长语音的最后一个job出问题。

**根本原因**：RestartTimer事件和audio_chunk事件的时序竞争导致pause检测误触发。

---

## 根本原因分析

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

### 关键发现

1. **SessionActor的事件处理是单线程的**：
   - RestartTimer事件和audio_chunk事件都通过同一个channel到达SessionActor
   - SessionActor按顺序处理事件
   - 如果audio_chunk在RestartTimer之前到达，pause检测会先执行

2. **pause检测使用的时间戳**：
   - pause检测使用`last_chunk_at_ms`（上一个utterance的最后一个chunk时间戳）
   - 如果RestartTimer事件还没处理，`last_chunk_at_ms`还是旧的时间戳
   - 导致pause检测发现时间差>3秒，触发pause finalize

3. **为什么长语音的最后一个job出问题**：
   - 长语音通常有多个TTS播放完成事件
   - 每次播放完成后，如果RestartTimer延迟，就会触发pause finalize
   - 导致连续的pause finalize（Job 4→7, Job 8→11）

---

## 修复方案

### 修复位置
**文件**: `central_server/scheduler/src/websocket/session_message_handler/core.rs`
**位置**: 第178-194行（TTS_PLAY_ENDED处理逻辑）

### 修复内容

**在TTS_PLAY_ENDED处理时，立即更新`last_chunk_at_ms`**（同步操作），而不是等到RestartTimer事件处理：

```rust
// 修复：立即更新last_chunk_at_ms（同步操作），避免RestartTimer事件延迟导致的pause检测误触发
let timestamp_ms = chrono::Utc::now().timestamp_millis();

// 立即更新last_chunk_at_ms（同步操作）
// 这样可以确保在audio_chunk到达之前，last_chunk_at_ms已经更新
// 即使RestartTimer事件延迟处理，也不会影响pause检测
state.audio_buffer.update_last_chunk_at_ms(&sess_id, timestamp_ms).await;

// 然后发送RestartTimer事件（用于重置计时器等其他操作）
// 注意：last_chunk_at_ms已经在上面的同步操作中更新，这里只是发送RestartTimer事件用于重置计时器
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

## 相关修复

### 1. 调度服务器pause检测修复
- `central_server/scheduler/src/websocket/session_message_handler/core.rs` - 立即更新last_chunk_at_ms（已修复）

### 2. 调度服务器pause检测补丁
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - 检查RestartTimer延迟（补丁修复）

### 3. 节点端AudioAggregator补丁
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts` - pendingPauseAudio机制（补丁修复）

---

## 相关文件

- `central_server/scheduler/src/websocket/session_message_handler/core.rs` - 已修复（根本解决方案）
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - 补丁修复（额外保护）
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts` - 补丁修复（额外保护）
- `docs/central_server/scheduler/restart_flow_summary.md` - RestartTimer流程说明
- `docs/electron_node/JOB_8_11_MERGE_ROOT_CAUSE.md` - 合并问题根本原因分析

---

## 总结

**根本解决方案**：在TTS_PLAY_ENDED处理时立即更新last_chunk_at_ms（同步操作），确保audio_chunk到达时，pause检测使用的是正确的时间戳。

**补丁修复**：在pause检测和AudioAggregator中增加额外的检查，作为保护措施。

这样可以从根本上解决问题，同时保留补丁作为额外的保护措施。
