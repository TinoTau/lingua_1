# 原声传递带宽优化策略

**日期**: 2025-01-XX  
**目的**: 说明原声传递的带宽优化策略，确保用户屏蔽其他用户原声时，不占用不必要的带宽

---

## 📋 架构说明

### 原声传递方式

根据 [Web↔Web 原声通话 + 翻译接管方案 v1.1](./Web_RawVoice_Translation_Handover_Spec_v1.1.md)：

1. **原声音频（Raw Voice）**：
   - ✅ **P2P WebRTC 连接**，不经过调度服务器
   - ✅ 直接端到端传输，不占用调度服务器带宽
   - ✅ 只有信令（offer/answer/ICE candidate）经过调度服务器转发

2. **翻译音频（Translated Audio）**：
   - ✅ 经过调度服务器 → Node → 调度服务器 → 客户端
   - ✅ 占用调度服务器带宽

### 带宽占用分析

**原声传递**：
- ❌ **不占用调度服务器带宽**（P2P 传输）
- ✅ 占用客户端之间的带宽（P2P 连接）
- ✅ 占用调度服务器的信令转发带宽（较小）

**翻译音频**：
- ✅ 占用调度服务器带宽（音频数据经过服务器）

---

## 🎯 带宽优化策略

### 问题

如果用户屏蔽了某个成员的原声，但仍然建立 WebRTC 连接，会导致：
- ❌ 发送端仍然发送音频数据（浪费发送端带宽）
- ❌ 接收端仍然接收音频数据（浪费接收端带宽）
- ❌ 虽然可以在接收端静音，但带宽仍然被占用

### 解决方案

**在信令层面阻止连接建立**：

1. **WebRTC 信令转发时检查偏好**：
   - 当收到 `webrtc_offer` 时，检查接收者是否愿意接收发送者的原声
   - 如果不愿意，**不转发信令**，阻止连接建立
   - 这样可以避免：
     - ✅ 发送端不发送音频数据（节省发送端带宽）
     - ✅ 接收端不接收音频数据（节省接收端带宽）
     - ✅ 调度服务器不转发信令（节省信令带宽）

2. **Web Client 端连接管理**：
   - 在建立 WebRTC 连接前，检查 `raw_voice_preferences`
   - 如果用户屏蔽了某个成员，**不发起连接**
   - 这样可以避免不必要的信令交换

---

## 🔧 实现细节

### 1. Scheduler 端信令转发检查

**位置**: `scheduler/src/websocket/session_handler.rs`

**逻辑**:
```rust
// 在转发 WebRTC 信令前检查偏好
let should_forward = state.room_manager.should_receive_raw_voice(
    &room_code,
    &to, // 接收者
    sess_id, // 发送者
).await;

if !should_forward {
    // 接收者屏蔽了发送者的原声，不转发信令
    return Ok(());
}
```

**处理的信令类型**:
- `webrtc_offer`: 检查后转发
- `webrtc_answer`: 检查后转发
- `webrtc_ice`: 检查后转发（ICE candidate 消息较多，不记录日志）

### 2. Web Client 端连接管理

**位置**: `web-client/src/app.ts` (未来实现 `webrtc_manager.ts`)

**逻辑**:
```typescript
// 在建立 WebRTC 连接前检查偏好
const shouldConnect = shouldReceiveRawVoice(memberId);
if (!shouldConnect) {
    // 不建立连接
    return;
}

// 建立连接
createPeerConnection(memberId);
```

---

## 📊 带宽节省效果

### 场景：3 人房间，用户 A 屏蔽了用户 B 的原声

**优化前**：
- 用户 A ↔ 用户 B: 建立连接，占用带宽（虽然静音）
- 用户 A ↔ 用户 C: 建立连接，占用带宽
- 用户 B ↔ 用户 C: 建立连接，占用带宽
- **总连接数**: 3 个（全连接）

**优化后**：
- 用户 A ↔ 用户 B: **不建立连接**，节省带宽 ✅
- 用户 A ↔ 用户 C: 建立连接，占用带宽
- 用户 B ↔ 用户 C: 建立连接，占用带宽
- **总连接数**: 2 个（部分连接）

**带宽节省**：
- ✅ 用户 A 的发送带宽：节省 1 个连接
- ✅ 用户 B 的接收带宽：节省 1 个连接
- ✅ 调度服务器信令带宽：节省 offer/answer/ICE 消息

---

## ✅ 实现状态

### 已完成

- ✅ Scheduler 端信令转发检查
  - ✅ `webrtc_offer` 转发前检查偏好
  - ✅ `webrtc_answer` 转发前检查偏好
  - ✅ `webrtc_ice` 转发前检查偏好
- ✅ 消息类型定义
  - ✅ `WebRTCOfferMessage`
  - ✅ `WebRTCAnswerMessage`
  - ✅ `WebRTCIceMessage`

### 已完成

- ✅ Web Client 端 WebRTC 连接管理
  - ✅ 根据偏好决定是否建立连接
  - ✅ 偏好变更时实时断开/建立连接
  - ✅ 成员列表更新时自动同步连接状态
  - ✅ 处理 WebRTC 信令（offer/answer/ICE）
  - ✅ 连接生命周期管理（建立、断开、清理）

---

## 🔗 相关文档

- [Web↔Web 原声通话 + 翻译接管方案 v1.1](./Web_RawVoice_Translation_Handover_Spec_v1.1.md)
- [会议室模式调度逻辑](./ROOM_MODE_SCHEDULING_LOGIC.md)

---

**完成时间**: 2025-01-XX

