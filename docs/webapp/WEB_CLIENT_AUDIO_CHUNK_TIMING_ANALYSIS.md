# Web端音频Chunk时序问题分析

## 分析日期
2026-01-17

## 问题

检查Web端的代码逻辑，audio_chunk是否还有可能造成时序问题？

---

## Web端延迟机制

### 当前实现

**1. TTS_PLAY_ENDED发送**（`app.ts`）：
```typescript
onPlaybackFinished() {
  // 立即发送TTS_PLAY_ENDED消息
  this.wsClient.sendTtsPlayEnded(this.currentTraceId, this.currentGroupId, tsEndMs);
  
  // 设置播放结束时间戳，延迟500ms后发送音频
  this.sessionManager.setPlaybackFinishedTimestamp(playbackEndTimestamp);
  this.sessionManager.setCanSendChunks(true); // 允许发送
}
```

**2. 延迟机制**（`session_manager.ts`）：
```typescript
setPlaybackFinishedTimestamp(timestamp: number): void {
  this.playbackFinishedTimestamp = timestamp;
  // 设置延迟结束时间：timestamp + 500ms
  this.playbackFinishedDelayEndTime = timestamp + this.PLAYBACK_FINISHED_DELAY_MS; // 500ms
}

onAudioFrame(audioData: Float32Array): void {
  const now = Date.now();
  
  // 如果在延迟期间，缓存音频数据，不发送
  if (this.playbackFinishedDelayEndTime !== null && now < this.playbackFinishedDelayEndTime) {
    this.playbackFinishedDelayBuffer.push(new Float32Array(audioData));
    return; // 不发送
  }
  
  // 延迟结束后，发送音频chunk
  if (this.canSendChunks) {
    // 发送音频chunk
    this.wsClient.sendAudioChunk(chunk, false);
  }
}
```

---

## 潜在时序问题

### 问题1: 固定延迟vs事件处理延迟

**Web端的延迟机制**：
- ✅ 基于**本地时间戳**的固定延迟（500ms）
- ✅ 不等待RestartTimer事件完成
- ❌ 无法感知调度服务器的RestartTimer事件处理状态

**问题场景**：
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
T2: 发送RestartTimer事件到SessionActor（T2可能比T1晚，因为处理延迟）
    ↓
T3: RestartTimer事件进入SessionActor队列（T3可能比T2晚，因为队列延迟）
    ↓
T4: SessionActor处理RestartTimer事件（T4可能比T3晚，因为队列处理延迟）

问题：如果T0 + 500ms < T4（RestartTimer事件处理时间）
  ↓
Web端在RestartTimer事件处理之前发送audio_chunk
  ↓
audio_chunk到达SessionActor时，last_chunk_at_ms还没有更新
  ↓
pause检测使用旧的last_chunk_at_ms，导致pause finalize误触发 ❌
```

---

## 问题分析

### 问题1: 网络延迟

**Web端 → 调度服务器**：
- TTS_PLAY_ENDED消息的网络延迟：通常<100ms，但可能达到数百毫秒
- 如果网络延迟大，调度服务器收到TTS_PLAY_ENDED时，Web端已经接近500ms延迟结束

### 问题2: 调度服务器处理延迟

**TTS_PLAY_ENDED处理 → RestartTimer事件处理**：
- TTS_PLAY_ENDED处理时间：通常<10ms
- RestartTimer事件发送：通常<1ms
- **但SessionActor的事件队列可能繁忙**，导致RestartTimer事件延迟处理

### 问题3: SessionActor队列延迟

**RestartTimer事件 → 实际处理**：
- SessionActor是单线程的，按顺序处理事件
- 如果队列中有其他事件（如audio_chunk），RestartTimer事件可能延迟处理
- 延迟可能达到数百毫秒

---

## 关键发现

### 当前延迟机制的问题

**1. 固定延迟，无法适应实际情况**：
- Web端固定延迟500ms
- 但调度服务器的RestartTimer事件处理时间是不确定的（取决于网络延迟、队列状态等）

**2. 无法确保RestartTimer先处理**：
- Web端只能基于本地时间戳延迟
- 无法感知调度服务器的RestartTimer事件处理状态
- 无法确保RestartTimer事件在audio_chunk之前处理

---

## 解决方案

### 方案1: 增加Web端延迟时间（临时方案）

**修改**：将`PLAYBACK_FINISHED_DELAY_MS`从500ms增加到1000ms或更长

**优点**：
- ✅ 实现简单
- ✅ 增加RestartTimer事件处理的时间窗口

**缺点**：
- ❌ 增加用户感知延迟（用户说话后500ms才发送音频）
- ❌ 仍然不能完全保证时序（如果延迟更大）
- ❌ 治标不治本

---

### 方案2: 恢复在TTS_PLAY_ENDED中立即更新last_chunk_at_ms（推荐）

**修改**：在调度服务器的`handle_tts_play_ended()`中，立即更新`last_chunk_at_ms`（同步操作）

**优点**：
- ✅ 从根本上解决时序问题
- ✅ 即使RestartTimer事件延迟，pause检测也能使用正确的时间戳
- ✅ 不需要增加Web端延迟

**缺点**：
- ❌ RestartTimer事件中仍然需要更新last_chunk_at_ms（重复）

---

### 方案3: 调度服务器发送确认消息（理想方案，但实现复杂）

**修改**：
1. Web端发送TTS_PLAY_ENDED
2. 调度服务器处理TTS_PLAY_ENDED，立即更新last_chunk_at_ms，发送RestartTimer事件
3. 调度服务器等待RestartTimer事件处理完成
4. 调度服务器发送`RESTART_TIMER_COMPLETED`消息到Web端
5. Web端收到确认消息后，才开始发送audio_chunk

**优点**：
- ✅ 完全保证时序
- ✅ 自适应延迟（根据实际情况）

**缺点**：
- ❌ 实现复杂，需要修改消息协议
- ❌ 增加额外的网络往返时间

---

## 推荐方案

### 推荐：方案2（恢复在TTS_PLAY_ENDED中立即更新last_chunk_at_ms）

**理由**：
1. **根本解决**：在TTS_PLAY_ENDED处理时立即更新last_chunk_at_ms（同步操作），确保pause检测使用正确的时间戳
2. **简单有效**：不需要修改消息协议，不需要增加Web端延迟
3. **已经验证**：之前的修复已经证明了这种方法有效

**修改内容**：
```rust
pub(super) async fn handle_tts_play_ended(...) {
    // 1. 更新Group的last_tts_end_at
    state.group_manager.on_tts_play_ended(&group_id, ts_end_ms).await;
    
    // 2. 立即更新last_chunk_at_ms（同步操作）- 关键修复
    let timestamp_ms = chrono::Utc::now().timestamp_millis();
    state.audio_buffer.update_last_chunk_at_ms(&sess_id, timestamp_ms).await;
    
    // 3. 发送RestartTimer事件（异步，用于重置计时器）
    if let Some(actor_handle) = state.session_manager.get_actor_handle(&sess_id).await {
        actor_handle.send(SessionEvent::RestartTimer { timestamp_ms }).await?;
    }
}
```

---

## 结论

**Web端的audio_chunk确实可能造成时序问题**，因为：

1. **固定延迟**：Web端固定延迟500ms，无法适应调度服务器的实际处理时间
2. **网络延迟**：TTS_PLAY_ENDED消息的网络延迟
3. **队列延迟**：SessionActor的事件队列可能繁忙，导致RestartTimer事件延迟处理

**推荐解决方案**：
- ✅ **恢复在TTS_PLAY_ENDED中立即更新last_chunk_at_ms**（同步操作）
- ✅ 这样即使RestartTimer事件延迟，pause检测也能使用正确的时间戳

---

## 相关文件

- `webapp/web-client/src/app.ts` - TTS_PLAY_ENDED发送和延迟设置
- `webapp/web-client/src/app/session_manager.ts` - 音频延迟机制
- `central_server/scheduler/src/websocket/session_message_handler/core.rs` - TTS_PLAY_ENDED处理
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - RestartTimer事件处理
