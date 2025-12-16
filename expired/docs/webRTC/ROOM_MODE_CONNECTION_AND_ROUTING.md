# 会议室模式连接与消息转发机制

**日期**: 2025-01-XX  
**目的**: 说明会议室模式的连接机制和消息转发流程

---

## 📋 结论

**答案**: ✅ **是的，会议室模式的每个成员都通过 WebSocket 连接到调度服务器，调度服务器负责消息转发**

---

## 🔧 连接机制

### 1. 每个成员独立的 WebSocket 连接

会议室模式的每个成员都有：
- ✅ **独立的 WebSocket 连接**到调度服务器
- ✅ **独立的 Session**（会话）
- ✅ **独立的 session_id**

### 2. 连接流程

#### 创建房间（第一个成员）

```
[Web Client A]
    │
    ├─ 1. 用户点击"创建房间"
    ├─ 2. 建立 WebSocket 连接
    │   └─ new WebSocket(schedulerUrl)
    │
    ├─ 3. 发送 room_create 消息
    │   {
    │     type: "room_create",
    │     display_name: "Alice",
    │     preferred_lang: "en"
    │   }
    │
    └─ 4. 收到 room_create_ack
        {
          type: "room_create_ack",
          room_code: "483920"
        }
        ↓
        5. 收到 room_members 消息
        {
          type: "room_members",
          room_code: "483920",
          members: [
            { session_id: "sess_A", display_name: "Alice", preferred_lang: "en" }
          ]
        }
```

#### 加入房间（其他成员）

```
[Web Client B]
    │
    ├─ 1. 用户输入房间码 "483920"
    ├─ 2. 建立 WebSocket 连接
    │   └─ new WebSocket(schedulerUrl)
    │
    ├─ 3. 发送 room_join 消息
    │   {
    │     type: "room_join",
    │     room_code: "483920",
    │     display_name: "Bob",
    │     preferred_lang: "zh"
    │   }
    │
    └─ 4. 收到 room_members 消息
        {
          type: "room_members",
          room_code: "483920",
          members: [
            { session_id: "sess_A", display_name: "Alice", preferred_lang: "en" },
            { session_id: "sess_B", display_name: "Bob", preferred_lang: "zh" }
          ]
        }
        ↓
        5. 房间内其他成员也收到 room_members 更新
```

---

## 📊 消息转发机制

### 1. 翻译结果路由

**关键点**: 调度服务器根据 `preferred_lang` 将翻译结果路由给房间内所有匹配的成员。

#### 单会话模式（对比）

```
客户端A发送音频 → Scheduler → Node → 翻译结果
                                          ↓
                                    只发送给客户端A
```

#### 会议室模式

```
客户端A发送音频（中文） → Scheduler → Node → 翻译结果（英文）
                                                      ↓
                                    Scheduler 检查房间成员
                                                      ↓
                                    preferred_lang="en" 的成员：
                                    - 客户端A ✅ (如果 preferred_lang="en")
                                    - 客户端B ✅ (preferred_lang="en")
                                    - 客户端C ❌ (preferred_lang="zh")
                                                      ↓
                                    通过 WebSocket 发送给匹配的成员
```

### 2. 实现代码

**位置**: `scheduler/src/websocket/node_handler.rs`

```rust
// 检查 Job 是否有 target_session_ids（会议室模式）
if let Some(ref job_info) = job {
    if let Some(target_session_ids) = &job_info.target_session_ids {
        // 会议室模式：将翻译结果发送给 Job 中指定的所有目标接收者
        for target_session_id in target_session_ids {
            state.session_connections.send(
                target_session_id,
                Message::Text(result_json.clone())
            ).await;
        }
    } else {
        // 单会话模式：只发送给发送者
        state.session_connections.send(&session_id, Message::Text(result_json)).await;
    }
}
```

### 3. Job 创建时的目标接收者确定

**位置**: `scheduler/src/websocket/job_creator.rs`

```rust
// 检查是否在房间中
if let Some(room_code) = state.room_manager.find_room_by_session(session_id).await {
    // 会议室模式：为每个不同的 preferred_lang 创建独立的 Job
    let lang_groups = state.room_manager.get_distinct_target_languages(&room_code, session_id).await;
    
    // 为每个不同的 preferred_lang 创建 Job
    for (target_lang, members) in lang_groups {
        let target_session_ids: Vec<String> = members.iter()
            .map(|m| m.session_id.clone())
            .collect();
        
        let job = state.dispatcher.create_job(
            // ...
            Some(target_session_ids), // 指定目标接收者
        ).await;
    }
}
```

---

## 🔄 完整消息流

### 场景：3 人会议室

**成员**:
- 客户端A: `session_id="sess_A"`, `preferred_lang="en"`
- 客户端B: `session_id="sess_B"`, `preferred_lang="en"`
- 客户端C: `session_id="sess_C"`, `preferred_lang="zh"`

**流程**:

```
1. 客户端A说话（中文）
   ↓
2. 客户端A通过 WebSocket 发送 audio_chunk 到 Scheduler
   ↓
3. Scheduler 创建 Job（会议室模式）
   - 检测到客户端A在房间中
   - 获取房间内所有不同的 preferred_lang: ["en", "zh"]
   - 为每个语言创建独立的 Job:
     * Job1: src_lang="zh", tgt_lang="en", target_session_ids=["sess_A", "sess_B"]
     * Job2: src_lang="zh", tgt_lang="zh", target_session_ids=["sess_C"]
   ↓
4. Scheduler 将 Job 发送到 Node
   ↓
5. Node 处理完成，返回翻译结果
   ↓
6. Scheduler 接收翻译结果
   ↓
7. Scheduler 根据 Job 的 target_session_ids 转发结果:
   - 英文翻译结果 → 通过 WebSocket 发送给 sess_A 和 sess_B
   - 中文翻译结果 → 通过 WebSocket 发送给 sess_C
   ↓
8. 客户端A、B、C 分别收到对应的翻译结果
```

---

## 📋 关键组件

### 1. SessionConnectionManager

**职责**: 管理所有客户端的 WebSocket 连接

**位置**: `scheduler/src/connection_manager.rs`

**功能**:
- 存储 `session_id` → `WebSocket` 连接的映射
- 提供 `send()` 方法向指定 `session_id` 发送消息

### 2. RoomManager

**职责**: 管理会议室和成员

**位置**: `scheduler/src/room_manager.rs`

**功能**:
- 创建和删除房间
- 添加和移除成员
- 根据 `preferred_lang` 查询成员
- 获取房间内所有不同的目标语言

### 3. 消息转发逻辑

**位置**: `scheduler/src/websocket/node_handler.rs`

**逻辑**:
1. 收到 Node 返回的翻译结果
2. 检查 Job 是否有 `target_session_ids`
3. 如果有（会议室模式），遍历所有目标接收者
4. 通过 `SessionConnectionManager` 向每个接收者发送消息

---

## 🔍 与单会话模式的对比

| 维度 | 单会话模式 | 会议室模式 |
|------|-----------|-----------|
| **WebSocket 连接** | ✅ 每个客户端一个连接 | ✅ 每个成员一个连接 |
| **Session** | ✅ 每个客户端一个 Session | ✅ 每个成员一个 Session |
| **初始化消息** | `session_init` | `room_create` / `room_join` |
| **翻译结果路由** | 只发送给发送者 | 按 `preferred_lang` 路由给所有匹配成员 |
| **消息转发** | ❌ 不需要转发 | ✅ 需要转发（调度服务器负责） |

---

## 💡 关键点说明

### 1. 每个成员都有独立的 WebSocket 连接

**原因**:
- 每个成员需要独立接收翻译结果
- 每个成员需要独立发送音频
- 每个成员需要独立管理 WebRTC 连接

### 2. 调度服务器负责消息转发

**原因**:
- 调度服务器知道所有成员的 `preferred_lang`
- 调度服务器知道房间内所有成员
- 调度服务器可以按语言路由翻译结果

### 3. 多语言翻译支持

**机制**:
- 为每个不同的 `preferred_lang` 创建独立的 Job
- 每个 Job 有独立的 `target_session_ids`
- 翻译结果按 Job 的 `target_session_ids` 转发

### 4. WebRTC 信令也通过 WebSocket

**WebRTC 信令消息**:
- `webrtc_offer`
- `webrtc_answer`
- `webrtc_ice`

这些消息也通过 WebSocket 发送到调度服务器，然后由调度服务器转发给目标成员。

---

## 📊 完整架构图

```
┌─────────────┐
│ Web Client A│ (session_id="sess_A", preferred_lang="en")
│             │
│ WebSocket ──┼─────────────────┐
└─────────────┘                 │
                                │
┌─────────────┐                 │
│ Web Client B│ (session_id="sess_B", preferred_lang="en")
│             │                 │
│ WebSocket ──┼─────────────────┼──┐
└─────────────┘                 │  │
                                │  │
┌─────────────┐                 │  │
│ Web Client C│ (session_id="sess_C", preferred_lang="zh")
│             │                 │  │
│ WebSocket ──┼─────────────────┼──┼──┐
└─────────────┘                 │  │  │
                                ▼  ▼  ▼
                        ┌─────────────────────┐
                        │   Scheduler         │
                        │                     │
                        │  - RoomManager      │
                        │  - SessionConnMgr   │
                        │  - Job Dispatcher   │
                        └──────────┬──────────┘
                                   │
                                   │ WebSocket
                                   ▼
                        ┌─────────────────────┐
                        │   Node Client       │
                        │   (Electron)        │
                        └──────────┬──────────┘
                                   │
                                   │ HTTP
                                   ▼
                        ┌─────────────────────┐
                        │  Node Inference     │
                        │  (ASR/NMT/TTS)      │
                        └─────────────────────┘
```

---

## ✅ 总结

1. **每个成员都有独立的 WebSocket 连接** ✅
2. **每个成员都有独立的 Session 和 session_id** ✅
3. **调度服务器负责消息转发** ✅
4. **翻译结果按 preferred_lang 路由给所有匹配成员** ✅
5. **WebRTC 信令也通过 WebSocket 转发** ✅

---

## 🔗 相关文档

- [会议室模式调度逻辑](./ROOM_MODE_SCHEDULING_LOGIC.md)
- [会议室成员加入流程](./ROOM_MEMBER_JOIN_FLOW.md)
- [Web↔Web 原声通话 + 翻译接管方案 v1.1](./Web_RawVoice_Translation_Handover_Spec_v1.1.md)
- [面对面模式连接机制](../webClient/FACE_TO_FACE_MODE_CONNECTION.md)

---

**最后更新**: 2025-01-XX

