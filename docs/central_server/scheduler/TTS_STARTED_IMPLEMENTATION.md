# TTS_STARTED 消息实现

## 实现日期
2026-01-17

## 实现目标

在Web端按下播放键时，发送 `TTS_STARTED` 消息到调度服务器，通知调度服务器现在开始播放音频，停止计算chunk时间。从播放开始到播放结束期间，都不进行pause计时。

---

## 实现方案

### 核心逻辑

1. **Web端在播放开始时**：发送 `TTS_STARTED` 消息
2. **调度服务器记录播放开始时间**：更新 `last_tts_start_at_ms`
3. **立即更新last_chunk_at_ms**：停止计算chunk时间
4. **Pause检测逻辑**：从 `last_tts_start_at_ms` 到 `last_tts_end_at_ms` 期间，不进行pause计时

---

## 修改的文件

### 1. 消息协议 (`central_server/scheduler/src/messages/session.rs`)

**添加 `TTS_STARTED` 消息类型**：
```rust
#[serde(rename = "tts_started")]
TtsStarted {
    session_id: String,
    trace_id: String,
    group_id: String,
    ts_start_ms: u64,
},
```

---

### 2. 调度服务器消息处理 (`central_server/scheduler/src/websocket/session_message_handler/`)

#### 2.1 `mod.rs` - 添加消息路由

```rust
SessionMessage::TtsStarted {
    session_id: sess_id,
    trace_id: _,
    group_id,
    ts_start_ms,
} => {
    core::handle_tts_started(state, sess_id, group_id, ts_start_ms).await;
}
```

#### 2.2 `core.rs` - 添加处理函数

```rust
pub(super) async fn handle_tts_started(
    state: &AppState,
    sess_id: String,
    group_id: String,
    ts_start_ms: u64,
) {
    // Update Group's last_tts_start_at (Scheduler authoritative time)
    let timestamp_ms = chrono::Utc::now().timestamp_millis();
    let timestamp_ms_u64 = timestamp_ms as u64;
    state.group_manager.on_tts_started(&group_id, timestamp_ms_u64).await;
    
    // 立即更新last_chunk_at_ms（同步操作），停止计算chunk时间
    // 从播放开始到播放结束期间，都不进行pause计时
    state.audio_buffer.update_last_chunk_at_ms(&sess_id, timestamp_ms).await;
    
    // 记录日志...
}
```

---

### 3. GroupManager (`central_server/scheduler/src/managers/group_manager.rs`)

#### 3.1 添加字段

```rust
pub struct UtteranceGroup {
    // ...
    pub last_tts_start_at_ms: Option<u64>,  // TTS播放开始时间
    pub last_tts_end_at_ms: u64,
    // ...
}
```

#### 3.2 添加方法

```rust
/// 处理 TTS 播放开始
pub async fn on_tts_started(&self, group_id: &str, tts_start_ms: u64) {
    let mut groups = self.groups.write().await;
    if let Some(group) = groups.get_mut(group_id) {
        group.last_tts_start_at_ms = Some(tts_start_ms);
        // 记录日志...
    }
}

/// 检查是否在TTS播放期间（用于pause检测）
/// 从播放开始到播放结束期间，都不进行pause计时
pub async fn is_tts_playing(&self, group_id: &str, current_time_ms: i64) -> bool {
    let groups = self.groups.read().await;
    if let Some(group) = groups.get(group_id) {
        if let Some(tts_start_ms) = group.last_tts_start_at_ms {
            let tts_end_ms = group.last_tts_end_at_ms as i64;
            let tts_start_ms_i64 = tts_start_ms as i64;
            // 从播放开始到播放结束期间，都不进行pause计时
            current_time_ms >= tts_start_ms_i64 && current_time_ms <= tts_end_ms
        } else {
            false
        }
    } else {
        false
    }
}
```

---

### 4. Pause检测逻辑 (`central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs`)

**修改pause检测**：
```rust
if pause_exceeded {
    // 修复：检查是否在TTS播放期间
    // 从播放开始到播放结束期间，都不进行pause计时
    let is_tts_playing = {
        // 获取session的活跃group_id
        if let Some(group_id) = self.state.group_manager.get_active_group_id(&self.session_id).await {
            // 检查是否在TTS播放期间（从播放开始到播放结束）
            self.state.group_manager.is_tts_playing(&group_id, timestamp_ms).await
        } else {
            false
        }
    };
    
    if is_tts_playing {
        // 不触发pause finalize
    } else {
        should_finalize = true;
        finalize_reason = "Pause";
    }
}
```

---

### 5. Web端实现 (`webapp/web-client/src/`)

#### 5.1 `tts_player.ts` - 添加播放开始回调

```typescript
export type PlaybackStartedCallback = () => void;

// 添加字段
private playbackStartedCallback: PlaybackStartedCallback | null = null;

// 添加方法
setPlaybackStartedCallback(callback: PlaybackStartedCallback): void {
    this.playbackStartedCallback = callback;
}

// 在 startPlayback() 中调用回调
if (this.playbackStartedCallback) {
    console.log('[TtsPlayer] 调用 playbackStartedCallback');
    this.playbackStartedCallback();
}
```

#### 5.2 `websocket_client.ts` - 添加发送方法

```typescript
sendTtsStarted(traceId: string, groupId: string, tsStartMs: number): void {
    const message = {
        type: 'tts_started',
        session_id: sessionId,
        trace_id: traceId,
        group_id: groupId,
        ts_start_ms: tsStartMs,
    };
    this.connectionManager.send(JSON.stringify(message));
}
```

#### 5.3 `app.ts` - 添加播放开始处理

```typescript
// 设置播放开始回调
this.ttsPlayer.setPlaybackStartedCallback(() => {
    this.onPlaybackStarted();
});

// 添加处理方法
private onPlaybackStarted(): void {
    // 发送 TTS_STARTED 消息（如果 trace_id 和 group_id 存在）
    if (this.currentTraceId && this.currentGroupId) {
        const tsStartMs = Date.now();
        this.wsClient.sendTtsStarted(this.currentTraceId, this.currentGroupId, tsStartMs);
    }
}
```

#### 5.4 `types.ts` - 添加类型定义

```typescript
export interface TtsStartedMessage {
    type: 'tts_started';
    session_id: string;
    trace_id: string;
    group_id: string;
    ts_start_ms: number;
}
```

---

## 工作流程

### 完整流程

```
1. Web端用户按下播放键
   ↓
2. TtsPlayer.startPlayback() 被调用
   ↓
3. 调用 playbackStartedCallback()
   ↓
4. App.onPlaybackStarted() 被调用
   ↓
5. 发送 TTS_STARTED 消息到调度服务器
   ↓
6. 调度服务器 handle_tts_started() 处理
   ↓
7. 更新 last_tts_start_at_ms（调度服务器时间）
   ↓
8. 立即更新 last_chunk_at_ms（停止计算chunk时间）
   ↓
9. [TTS播放期间]
   - 用户说话，Web端不发送chunk（状态是PLAYING_TTS）
   - 即使收到chunk，pause检测也会判断是否在播放期间
   ↓
10. TTS播放完成
   ↓
11. 发送 TTS_PLAY_ENDED 消息
   ↓
12. 更新 last_tts_end_at_ms
   ↓
13. 重新开始pause计时
```

---

## Pause检测逻辑

### 判断是否在TTS播放期间

```rust
// 从播放开始到播放结束期间，都不进行pause计时
current_time_ms >= tts_start_ms && current_time_ms <= tts_end_ms
```

### 关键点

1. **使用调度服务器时间**：`timestamp_ms` 是调度服务器接收时间，与chunk的timestamp_ms基准一致
2. **精确时间窗口**：从 `last_tts_start_at_ms` 到 `last_tts_end_at_ms`，不依赖固定窗口
3. **不需要播放时长**：通过 `TTS_STARTED` 和 `TTS_PLAY_ENDED` 消息直接记录时间点，不需要计算播放时长
4. **支持播放倍速**：因为不依赖播放时长，所以不受播放倍速影响

---

## 优势

### 相比之前的方案（基于`last_tts_end_at`倒推）

1. ✅ **精确**：直接记录播放开始时间，不依赖倒推计算
2. ✅ **不受播放倍速影响**：不需要知道播放时长
3. ✅ **逻辑清晰**：明确知道播放开始和结束时间点
4. ✅ **无固定窗口限制**：不依赖60秒固定窗口

---

## 测试验证

### 测试场景

1. **正常播放**：
   - 用户按下播放键 → 发送 `TTS_STARTED`
   - TTS播放期间 → 不计算chunk时间
   - TTS播放完成 → 发送 `TTS_PLAY_ENDED`
   - 之后chunk到达 → 正常进行pause检测

2. **长音频播放**：
   - 播放时长 > 60秒
   - 验证不会触发pause finalize

3. **播放倍速**：
   - 1.5x、2.0x等倍速播放
   - 验证不受影响

---

## 相关文件

### 调度服务器
- `central_server/scheduler/src/messages/session.rs` - 消息协议
- `central_server/scheduler/src/websocket/session_message_handler/mod.rs` - 消息路由
- `central_server/scheduler/src/websocket/session_message_handler/core.rs` - `handle_tts_started`
- `central_server/scheduler/src/managers/group_manager.rs` - `on_tts_started`, `is_tts_playing`
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - Pause检测逻辑

### Web端
- `webapp/web-client/src/tts_player.ts` - 播放开始回调
- `webapp/web-client/src/websocket_client.ts` - `sendTtsStarted`
- `webapp/web-client/src/app.ts` - `onPlaybackStarted`
- `webapp/web-client/src/types.ts` - `TtsStartedMessage`

---

## 编译状态

✅ 所有修改已通过编译

---

## 总结

实现了通过 `TTS_STARTED` 消息在播放开始时通知调度服务器停止计算chunk时间的功能。从播放开始到播放结束期间，都不进行pause计时，解决了Job 4~7和Job 8~11之间误触发pause finalize的问题。
