# 会议室模式概述

**状态**: ✅ **已实现**

## 概述

会议室模式支持多人实时语音翻译，通过 WebRTC 实现原声端到端传输，通过翻译链路提供多语言支持。

## 核心特性

### 1. 房间管理

- **6位数房间码**: 简单易用的房间标识
- **自动加入**: 创建房间时自动成为第一个成员
- **成员列表**: 实时同步房间成员信息
- **房间生命周期**: 最后一个成员离开时自动清理

### 2. WebRTC 原声传输

- **P2P 连接**: 支持直接点对点连接，延迟低（<100ms）
- **Mesh 架构**: 小规模房间（<10人）使用全连接
- **TURN 支持**: NAT 穿透失败时使用 TURN 服务器
- **降级机制**: WebRTC 失败时自动降级，翻译通道仍可用

### 3. 翻译接管

- **双通道并行**: 原声通道 + 翻译通道
- **自动接管**: 翻译音频到达时原声淡出，翻译播放
- **FIFO 队列**: TTS 播放遵循先进先出，不打断、不抢占
- **多语言路由**: 按房间成员偏好语言路由翻译结果

## 工作流程

### 创建房间

1. 用户点击"创建房间"
2. 发送 `room_create` 消息
3. 服务器生成房间码并返回
4. 创建者自动成为第一个成员
5. 收到 `room_members` 消息，显示成员列表

### 加入房间

1. 用户输入6位数房间码
2. 发送 `room_join` 消息
3. 服务器验证并加入房间
4. 收到 `room_members` 消息
5. 其他成员收到成员列表更新

### WebRTC 连接

1. 成员加入后，后加入者发起 offer
2. 通过 Scheduler 转发信令（offer/answer/ice）
3. 建立 P2P 连接
4. 开始原声传输

### 翻译流程

1. 成员A说话，音频同时进入：
   - WebRTC 原声通道（立即传输给其他成员）
   - 翻译通道（发送到 Scheduler）
2. Scheduler 创建翻译任务，分发到节点
3. 节点处理完成后返回翻译结果
4. Scheduler 按房间成员偏好语言路由翻译结果
5. 接收端播放翻译音频，原声淡出

## 消息类型

### 房间管理

- `room_create`: 创建房间
- `room_create_ack`: 房间创建确认
- `room_join`: 加入房间
- `room_join_ack`: 加入确认
- `room_members`: 成员列表更新
- `room_leave`: 离开房间
- `room_error`: 房间错误

### WebRTC 信令

- `webrtc_offer`: WebRTC offer
- `webrtc_answer`: WebRTC answer
- `webrtc_ice`: ICE candidate

## 实现位置

### Web Client

- `src/app/room_manager.ts`: 房间管理
- `src/app/webrtc_manager.ts`: WebRTC 连接管理
- `src/audio_mixer.ts`: 音频混控

### Scheduler

- `src/websocket/room_manager.rs`: 房间管理
- `src/websocket/session_actor/actor.rs`: WebRTC 信令转发

## 相关文档

- [Web↔Web 原声通话 + 翻译接管方案 v1.1](./Web_RawVoice_Translation_Handover_Spec_v1.1.md) - 详细技术方案
- [会议室模式连接与路由](./ROOM_MODE_CONNECTION_AND_ROUTING.md) - 连接机制
- [会议室模式调度逻辑](./ROOM_MODE_SCHEDULING_LOGIC.md) - 调度逻辑
- [会议室成员加入流程](./ROOM_MEMBER_JOIN_FLOW.md) - 成员加入流程

