# RestartTimer 是调度服务器内部处理流程

## 确认

**是的，RestartTimer是调度服务器内部的处理流程。**

---

## 证据

### 1. RestartTimer 只在调度服务器内部使用

**调度服务器（central_server/scheduler）**：
- ✅ `SessionEvent::RestartTimer` 定义在 `session_actor/events.rs`
- ✅ 在 `session_message_handler/core.rs` 中发送（当收到TTS_PLAY_ENDED时）
- ✅ 在 `session_actor/actor/actor_event_handling.rs` 中处理

**Web端（webapp）**：
- ❌ 不发送 RestartTimer 事件
- ✅ 只发送 `TTS_PLAY_ENDED` 消息
- ✅ 注释中提到的"RestartTimer"只是对调度服务器内部流程的理解

**节点端（electron_node）**：
- ❌ 没有 RestartTimer 相关代码

---

## 完整流程

```
┌─────────────────────────────────────────────────────────────┐
│ Web端（webapp）                                              │
│                                                              │
│ TTS播放完成                                                  │
│   ↓                                                          │
│ 发送 TTS_PLAY_ENDED 消息（WebSocket消息）                   │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ 调度服务器（central_server/scheduler）                       │
│                                                              │
│ 1. 收到 TTS_PLAY_ENDED 消息                                  │
│    ↓                                                          │
│ 2. handle_tts_play_ended() 处理                             │
│    ├─ 更新 Group 的 last_tts_end_at                          │
│    ├─ 立即更新 last_chunk_at_ms（同步操作）                  │
│    └─ 发送 RestartTimer 事件到 SessionActor（内部事件）      │
│         ↓                                                     │
│ 3. SessionActor 收到 RestartTimer 事件                       │
│    ├─ 再次更新 last_chunk_at_ms（重复）❌                    │
│    └─ 调用 reset_timers()（重置超时计时器）✅                │
└─────────────────────────────────────────────────────────────┘
```

---

## 关键点

### 1. RestartTimer 是内部事件

- **类型**：`SessionEvent::RestartTimer`（调度服务器内部事件）
- **发送位置**：`session_message_handler/core.rs`（调度服务器内部）
- **处理位置**：`session_actor/actor/actor_event_handling.rs`（调度服务器内部）
- **不涉及**：Web端、节点端

### 2. Web端只发送 TTS_PLAY_ENDED

- **Web端发送**：`TTS_PLAY_ENDED` 消息（WebSocket消息）
- **Web端不发送**：RestartTimer 事件
- **Web端注释**：只是说明"在RestartTimer之前不要发送chunk"，这是对调度服务器内部流程的理解

### 3. 为什么需要 RestartTimer？

**原因**：架构设计（Actor模式）
- `TTS_PLAY_ENDED` 处理在 `session_message_handler` 中，无法直接访问 `SessionActor` 的内部状态
- `reset_timers()` 需要访问 `SessionActor` 的内部状态（`current_timer_handle`、`internal_state` 等）
- 只能通过消息传递（RestartTimer事件）来触发 `reset_timers()`

---

## 总结

**RestartTimer是调度服务器内部的处理流程**：
- ✅ 完全在调度服务器内部
- ✅ 不涉及Web端或节点端
- ✅ 由TTS_PLAY_ENDED消息触发
- ✅ 用于重置SessionActor的超时计时器

---

## 相关文件

- `central_server/scheduler/src/websocket/session_message_handler/core.rs` - 发送RestartTimer事件
- `central_server/scheduler/src/websocket/session_actor/actor/actor_event_handling.rs` - 处理RestartTimer事件
- `central_server/scheduler/src/websocket/session_actor/events.rs` - RestartTimer事件定义
- `webapp/web-client/src/app.ts` - 发送TTS_PLAY_ENDED消息（不发送RestartTimer）
