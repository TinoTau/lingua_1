# Web↔Web 原声通话 + 翻译接管 功能说明与技术方案（v1.1）
## Presence Raw Voice + Translated TTS Handover (Room-Based Conference)

版本：v1.1  
状态：**可实施设计（规则冻结）**  
适用范围：Web Client / Scheduler（信令与调度）/ Node（翻译链路）  
前提：原声通话为 Web↔Web 端到端；翻译链路走 Scheduler→Node；不考虑安全/隐私前置。

---

## 0. v1.1 变更摘要（相对 v1.0）

- 信令改为“会议室”模式：**6 位数房间码**加入房间；**人数暂不设上限**  
- 明确“对端仍在说话”判定：采用 **方案 B（发送端 VAD 事件经 WebSocket 通知）**  
- 明确 TTS 播放规则：**不打断、不抢占**，按顺序播放完整音频  
- 增加 WebRTC 失败降级状态机与超时重试规则  
- 明确 getUserMedia 复用：**只采集一次**，同时供 WebRTC 与翻译通道使用  
- 增加最小可观测指标与验收标准
- 明确按钮功能：**开始/结束控制整个会话，发送控制说话节奏，退出退出会议室**

---

## 1. 目标与非目标

### 1.1 目标
- 让远距离通话呈现“面对面交谈”氛围：对端一开口即可听到原声（语气/情绪/节奏）
- 翻译语音到达后自动接管（原声淡出 + 翻译播报）
- 不追求对齐、不追求自然停顿，降低工程复杂度

### 1.2 非目标（明确不做）
- 不做字幕先行
- 不做原声与译后语音时间轴对齐
- 不做 TTS 抢占/跳过/听最新
- 不做安全与隐私相关机制（后续版本再议）

---

## 2. 总体架构（双通道并行）

1) **原声通话（Raw Voice / Presence）**  
- WebRTC 音频会议（会议室内任意人与任意人互听）

2) **翻译接管（Translated TTS Handover）**  
- 每个发送端本地音频同时送入翻译链路  
- 译后语音按“目标听众语言”下发到对应接收端并播放  
- 接收端播放策略：原声 →（译后到达）淡出原声 → 播译后 →（译后结束）恢复原声（若对端仍在说话）

---

## 3. 会议室与信令（规则冻结）

### 3.1 房间模型
- `room_code`: 6 位数字字符串（例如 `"483920"`）
- `room_id`: 服务器内部唯一 ID（可选）
- 人数：**暂不设上限**
- 每个用户连接会话：`session_id`
- 每个成员：`participant_id`（可以等同 session_id）

### 3.2 创建房间
- Web Client → Scheduler：`room_create`
- Scheduler 生成一个 **6 位数 room_code**（允许冲突重试）
- 返回：`room_create_ack(room_code, room_id?)`

### 3.3 加入房间
- **第一个成员**：通过创建房间自动加入（无需额外步骤）
- **其他成员**：通过 6 位数房间码加入
- Web Client → Scheduler：`room_join(room_code, display_name?, preferred_lang?)`
- Scheduler 验证 room_code 存在，加入成功后广播成员列表变更事件
- **注意**：暂时不考虑邀请方式，所有成员都通过房间码加入

### 3.4 退出房间
- Web Client → Scheduler：`room_leave(room_code)`
- Scheduler 移除成员，广播成员列表变更事件
- **房间生命周期**：最后一个成员离开时自动清理房间
- **UI 要求**：房间界面必须提供退出按钮

### 3.5 房间过期机制（自动清理）
- **过期条件**：房间超过 30 分钟无人说话
- **检测机制**：Scheduler 跟踪每个房间的最后说话时间（`last_speaking_at`）
  - 当收到 `audio_chunk` 或 `remote_speaking_start` 事件时，更新 `last_speaking_at`
- **过期处理**：
  1. Scheduler 检测到房间过期（当前时间 - `last_speaking_at` > 30 分钟）
  2. 向所有房间成员发送 `room_expired` 消息（提示："30分钟无人发言，房间过期"）
  3. 将所有成员踢出房间
  4. 清理房间数据
- **定时扫描**：Scheduler 每 1 分钟扫描一次所有房间，检查是否过期

### 3.6 房间模式入口（UI 设计）

**重要**：房间模式独立于现有 Session 模式，需要单独的入口。

**主界面设计**：
- 提供两个独立入口：
  1. **单会话模式**：现有的一对一翻译模式
  2. **房间模式**：多人会议室模式
     - 创建房间按钮
     - 加入房间按钮（输入房间码）

**房间界面**：
- 显示房间码
- 显示成员列表
- **四个核心按钮**（必须提供）：
  1. **开始按钮**：开始整个会话（持续输入+输出模式）
     - 点击后进入持续监听和翻译状态
     - 不是每句话的开始，而是整个会话的开始
  2. **结束按钮**：结束整个会话
     - 点击后停止监听和翻译，结束会话
     - 不是每句话的结束，而是整个会话的结束
  3. **发送按钮**：手动控制说话节奏
     - 通知系统立即翻译当前说的话
     - 用于用户主动控制说话节奏
  4. **退出按钮**：退出会议室
     - 退出当前房间，返回主界面
     - 不影响其他成员

**重要说明**：
- **开始/结束**：控制整个会话的生命周期（持续输入+输出）
- **发送**：控制说话节奏（立即翻译当前说的话）
- **退出**：退出会议室（仅会议室模式）

### 3.7 信令消息（WebSocket）
建议最小集合（可按你们现有协议风格落地）：

```json
// client -> scheduler
{ "type": "room_create", "client_ts": 0, "display_name": "Alice", "preferred_lang": "en" }
{ "type": "room_join", "room_code": "483920", "display_name": "Bob", "preferred_lang": "zh" }
{ "type": "room_leave", "room_code": "483920" }
{ "type": "webrtc_offer", "room_code": "483920", "to": "participant_id", "sdp": "..." }
{ "type": "webrtc_answer", "room_code": "483920", "to": "participant_id", "sdp": "..." }
{ "type": "webrtc_ice", "room_code": "483920", "to": "participant_id", "candidate": {...} }

// scheduler -> client
{ "type": "room_create_ack", "room_code": "483920" }
{ "type": "room_members", "room_code": "483920", "members": [...] }
{ "type": "room_error", "code": "ROOM_NOT_FOUND" }
```

> 说明：本方案允许房间内多对多 WebRTC 连接（mesh）。v1.1 不强制引入 SFU；如后续人数较多，可演进为 SFU。

### 3.8 信令时序约束（最小闭环）
- 加入房间成功后，客户端才可开始 WebRTC 建联
- 房间成员变更时，客户端负责：
  - 对新成员发起 offer 或等待 offer（选择一方发起，建议“后加入者发起”）
- 需要固定超时与重试策略（见第 6 章）

---

## 4. 原声通话通道（WebRTC）

### 4.1 getUserMedia 复用（强制规则）
- **只调用一次** `getUserMedia({audio: ...})` 获取 `localStream`
- 同一个 `localStream`：
  - addTrack 至 WebRTC（原声）
  - 同时供翻译通道采样/编码/上传（避免设备占用冲突与参数不一致）

### 4.2 推荐参数
- echoCancellation: true
- noiseSuppression: true
- autoGainControl: true

---

## 5. 翻译通道与“对端仍在说话”判定（采用方案 B）

### 5.1 VAD 事件上报（发送端 → Scheduler）
发送端在本地对 **同一音轨** 做 VAD，发送事件：

```json
{ "type": "remote_speaking_start", "room_code": "483920", "from": "participant_id", "ts_ms": 0 }
{ "type": "remote_speaking_end",   "room_code": "483920", "from": "participant_id", "ts_ms": 0 }
```

Scheduler 将事件广播给房间其他成员（或按订阅关系下发）。

### 5.2 为什么不用接收端 RMS 判定
- RMS 阈值在不同设备/环境差异大
- VAD 在发送端更可控，且可复用翻译切分的 VAD 结果

---

## 6. WebRTC 失败降级与重试（冻结）

### 6.1 超时阈值（建议默认）
- ICE Gathering 超时：**5s**
- 建联（DTLS/connected）超时：**10s**
- 重试次数：**1 次**

### 6.2 降级策略
若 WebRTC 建联失败：
- 进入 `RAW_DISABLED`
- **翻译通道继续可用**（仍可实现“翻译语音通话”）
- UI 展示：原声通话不可用（无需复杂文案）

---

## 7. 接收端接管播放策略（核心）

### 7.1 音频混控（WebAudio）
- Raw Voice：
  - MediaStreamAudioSourceNode → GainNode(rawGain) → destination
- Translated TTS：
  - AudioBufferSourceNode / MediaElementSourceNode → GainNode(ttsGain) → destination

### 7.2 接管规则（冻结）
- 初始：rawGain=1.0，ttsGain=0.0
- 当译后音频段到达：
  - rawGain：1.0 → 0.0（200–400ms fade out）
  - 播放译后段（ttsGain=1.0，可选轻微 fade in）
- 译后段播放结束：
  - 若收到 `remote_speaking_start` 且尚未收到 end：
    - rawGain：0.0 → 1.0（200ms fade in）
  - 否则保持 0.0 或回到默认（由 UI 状态决定）

---

## 8. TTS 分段播放队列（冻结：不打断、不抢占）

### 8.1 规则
- 不存在“完全重叠”的播放需求：译后音频按顺序依次播放
- **不打断当前正在播放的译后段**
- 同一 `utterance_id` 多段（如未来流式）：
  - 以 `segment_index` 递增顺序入队
- 不提供“跳过/听最新”等交互

### 8.2 最小数据结构建议（客户端）
- `ttsQueue: FIFO`
- 入队：收到 `translated_audio_segment`
- 出队：当前播放结束后播放下一段

---

## 9. 翻译链路（保持兼容）

- 发送端将音频按 VAD / 最大时长切分 utterance（推荐 1.2–4s）
- Scheduler：
  - 可选 Sticky Node（会话/房间级别）
  - 继续使用 NodeStatus=ready 过滤策略
- Node：ASR → NMT → TTS
- 下发：译后音频段给房间内目标听众（按语言配置路由）

---

## 10. 最小可观测指标（建议 v1.1 必做）

- `raw_rtt_ms`（WebRTC stats）
- `translation_e2e_ms`（utterance_end → 接收端 tts_first_audio）
- `handover_count`（每次译后到达触发一次）
- `webrtc_connect_fail_count` / `fallback_raw_disabled_count`
- `queue_depth_peak`（TTS 队列峰值）

---

## 11. 验收标准（v1.1）

- A1：加入同一 room_code 后可建立原声通话（多人房间可互听）
- A2：对端一开口，其他端在 <300ms 内能听到原声
- A3：译后音频到达时，原声以淡出方式停止，译后音频播放无爆音/卡顿
- A4：TTS 播放遵循 FIFO，不打断、不抢占
- A5：WebRTC 失败能在限定时间内降级 RAW_DISABLED，翻译通道仍可通话
- A6：remote_speaking_start/end 事件能稳定驱动“译后结束后恢复原声”的行为

---

## 12. 实施建议（开发拆分）

- Web Client：
  - Room UI（创建/加入）
  - WebRTC mesh 建联（offer/answer/ice）
  - 单次 getUserMedia 复用
  - VAD 事件上报
  - WebAudio 混控与接管
  - TTS 队列播放（FIFO）

- Scheduler：
  - 房间管理（room_code → members）
  - 房间生命周期管理（最后一个成员离开时清理）
  - WebRTC 信令转发
  - VAD speaking 事件广播
  - 翻译任务调度与路由（按房间成员语言）

- Node：
  - 无需改动原声通道
  - 翻译链路按现有能力输出 TTS

---

**END OF SPEC v1.1**
