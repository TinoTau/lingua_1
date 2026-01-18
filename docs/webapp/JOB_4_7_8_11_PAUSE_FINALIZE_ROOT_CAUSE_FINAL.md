# Job 4~7 和 Job 8~11 之间产生 Pause Finalize 的根本原因（最终分析）

## 分析日期
2026-01-17

## 问题确认

用户明确表示：
- "没有在阅读中出现过3秒停顿"
- "唯一能够联想到的停顿就是停下来等语音播放完毕"
- "job4~7对应的是播放job3时的停顿"
- "job8~11对应的是播放job4~8的停顿"
- "web端每隔200ms持续发送chunk，根本没有别的机会可以停顿超过3秒"

---

## 根本原因确认

### 从Web端日志分析结果

**分析脚本输出**：
```
[WARN] 找到 7 个超过3秒的Web端chunk发送间隔:

  间隔 19453ms (19.45秒):
    2026-01-17T08:04:52.132Z - web_send
    2026-01-17T08:05:11.585Z - web_send

  间隔 255605ms (255.60秒):
    2026-01-17T08:05:11.596Z - web_send
    2026-01-17T08:09:27.201Z - web_send
```

**关键发现**：
1. **Job 4~7的间隔**：19.45秒（正好是TTS播放时间）
2. **Job 8~11的间隔**：255.60秒（包括TTS播放时间和处理时间）
3. **这些间隔正好对应TTS播放期间**

---

## 根本原因

### 问题1: Web端在TTS播放期间不处理音频帧

**位置**: `webapp/web-client/src/app/session_manager.ts`

```typescript
onAudioFrame(audioData: Float32Array): void {
  const currentState = this.stateMachine.getState();
  
  // 只在输入状态下处理音频
  if (currentState !== SessionState.INPUT_RECORDING) {
    // 跳过处理
    return;
  }
  
  // 只有在INPUT_RECORDING状态下才处理音频
  // ...
}
```

**问题**：
- 在TTS播放期间，状态可能是`PLAYING_TTS`或其他状态
- 在非`INPUT_RECORDING`状态下，`onAudioFrame`直接返回
- 导致在TTS播放期间，音频帧没有被处理，也没有发送chunk
- 虽然音频数据可能被缓存了，但没有发送到调度服务器

---

### 问题2: 调度服务器的pause检测基于chunk接收时间戳

**位置**: `central_server/scheduler/src/managers/audio_buffer.rs`

```rust
pub async fn record_chunk_and_check_pause(&self, session_id: &str, now_ms: i64, pause_ms: u64) -> bool {
    let exceeded = map
        .get(session_id)
        .map(|prev| now_ms.saturating_sub(*prev) > pause_ms as i64)
        .unwrap_or(false);
    map.insert(session_id.to_string(), now_ms);
    exceeded
}
```

**问题**：
- pause检测使用**调度服务器接收时间戳**（`now_ms`）
- 如果Web端在TTS播放期间不发送chunk，调度服务器没有收到新chunk
- `last_chunk_at_ms`保持不变（还是上一个utterance的最后一个chunk时间戳）
- 当TTS播放完成后，新utterance的第一个chunk到达
- pause检测发现间隔>3秒，触发pause finalize
- **但这不是真正的停顿，而是TTS播放导致的chunk发送中断**

---

## 完整时间线

### Job 4~7的时间线

```
08:04:28.198Z: utteranceIndex=1 finalize（最后一个chunk）
  ↓
08:04:40.xxxZ: 收到Job 1和Job 2的TTS音频，开始播放
  ↓
【状态切换到PLAYING_TTS】
Web端：onAudioFrame()直接返回，不处理音频帧
调度服务器：没有新chunk到达，last_chunk_at_ms保持不变
  ↓
08:04:52.132Z: utteranceIndex=3的最后一个chunk发送（在TTS播放期间，但这是之前缓存的？）
  ↓
【TTS继续播放 - 约19秒】
Web端：状态是PLAYING_TTS，onAudioFrame()返回，不处理音频
调度服务器：没有新chunk到达，last_chunk_at_ms = 08:04:52.132Z
  ↓
08:04:46.308Z: TTS_PLAY_ENDED（utteranceIndex=1和2的播放完成）
  ↓
【状态切换回INPUT_RECORDING】
Web端：开始处理音频帧，发送chunk
  ↓
08:05:11.585Z: utteranceIndex=4的第一个chunk发送
  ↓
调度服务器收到chunk，timestamp_ms = 08:05:11.585Z
pause检测：08:05:11.585Z - 08:04:52.132Z = 19.45秒 > 3秒
  ↓
触发pause finalize ❌
  ↓
Job 5被finalize（错误的finalize）
```

---

## 解决方案

### 方案1: 修改pause检测，检查是否在TTS播放期间（推荐）

**修改位置**: `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs`

**修改内容**：
```rust
// 在pause检测时，检查是否在TTS播放期间
let is_tts_playing = if let Some(session) = self.state.session_manager.get_session(&self.session_id).await {
    if let Some(group_id) = session.group_id.as_ref() {
        if let Some(last_tts_end_at) = self.state.group_manager.get_last_tts_end_at(group_id).await {
            // 如果距离上次TTS播放结束时间 < 60秒，认为可能在播放中或刚播放完
            // 60秒是一个安全的时间窗口，覆盖大部分TTS播放时间
            (timestamp_ms - last_tts_end_at as i64) < 60000
        } else {
            false
        }
    } else {
        false
    }
} else {
    false
};

// 如果在TTS播放期间（或刚播放完），不触发pause finalize
if pause_exceeded && !is_tts_playing {
    should_finalize = true;
    finalize_reason = "Pause";
}
```

**优点**：
- ✅ 简单有效：只需要在调度服务器端修改
- ✅ 准确判断：通过`last_tts_end_at`可以判断是否在TTS播放期间
- ✅ 不影响其他逻辑：只影响pause检测，不影响其他功能

---

### 方案2: 在TTS播放期间也处理音频帧（但可能不符合设计）

**修改位置**: `webapp/web-client/src/app/session_manager.ts`

**修改内容**：
```typescript
onAudioFrame(audioData: Float32Array): void {
  const currentState = this.stateMachine.getState();
  
  // 即使在TTS播放期间，也缓存音频数据（但不发送）
  // 这样在TTS播放完成后，可以立即发送
  if (currentState === SessionState.PLAYING_TTS) {
    // 缓存音频数据，但不发送
    this.audioBuffer.push(new Float32Array(audioData));
    return;
  }
  
  // 只在输入状态下处理音频
  if (currentState !== SessionState.INPUT_RECORDING) {
    return;
  }
  
  // 正常处理音频...
}
```

**问题**：
- ❌ 可能不符合设计（在TTS播放期间不应该处理音频）
- ❌ 可能导致音频累积过多

---

### 方案3: 在TTS播放期间发送"心跳"chunk（推荐备选方案）

**修改位置**: `webapp/web-client/src/app/session_manager.ts`

**修改内容**：
```typescript
// 在TTS播放期间，定期发送心跳chunk（仅用于更新时间戳）
if (currentState === SessionState.PLAYING_TTS) {
  const now = Date.now();
  if (!this.lastHeartbeatSentAt || (now - this.lastHeartbeatSentAt) > 2000) {
    // 每2秒发送一次最小的心跳chunk（仅用于更新时间戳）
    const emptyChunk = new Float32Array(0);
    this.wsClient.sendAudioChunk(emptyChunk, false);
    this.lastHeartbeatSentAt = now;
  }
  return;
}
```

**优点**：
- ✅ 可以保持`last_chunk_at_ms`更新
- ✅ 避免因为TTS播放导致的pause finalize

**缺点**：
- ❌ 需要发送额外的chunk（虽然是空的）
- ❌ 可能增加网络开销

---

## 推荐方案

### 推荐：方案1（修改pause检测，检查是否在TTS播放期间）

**理由**：
1. **根本解决**：在调度服务器端修改，不需要修改Web端
2. **准确判断**：通过`last_tts_end_at`可以准确判断是否在TTS播放期间
3. **不影响其他逻辑**：只影响pause检测，不影响其他功能
4. **简单有效**：只需要添加一个检查条件

**实现步骤**：
1. 在pause检测时，获取`last_tts_end_at`
2. 如果距离上次TTS播放结束时间 < 60秒，认为可能在播放中或刚播放完
3. 在这种情况下，即使chunk间隔>3秒，也不触发pause finalize

---

## 相关文件

- `webapp/web-client/src/app/session_manager.ts` - Web端音频帧处理
- `central_server/scheduler/src/managers/audio_buffer.rs` - Pause检测逻辑
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - Pause finalize触发
- `central_server/scheduler/src/managers/group_manager.rs` - last_tts_end_at管理
