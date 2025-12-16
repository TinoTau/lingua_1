# WebRTC 音频混控器实现文档

## 概述

本文档描述了会议室模式中 WebRTC P2P 连接和音频混控功能的实现。

## 功能特性

### 1. WebRTC P2P 连接

- **连接建立**：当用户加入会议室并选择接收某个成员的原声时，自动建立 WebRTC P2P 连接
- **连接管理**：使用 `Map<string, RTCPeerConnection>` 管理多个成员的连接
- **信令处理**：支持 WebRTC offer、answer 和 ICE candidate 的交换
- **连接优化**：根据用户的原声接收偏好动态建立/关闭连接，节省带宽

### 2. 音频混控

- **双通道模型**：
  - **原声通道**：来自 WebRTC 的远程音频流（MediaStreamAudioSourceNode）
  - **翻译通道**：来自服务器的翻译音频（AudioBufferSourceNode）
- **混控策略**：
  - 初始状态：原声音量 = 1.0，翻译音量 = 0.0
  - 翻译音频到达时：原声淡出（300ms），翻译淡入（200ms）
  - 翻译播放结束后：如果远程成员仍在说话，原声淡入（200ms）

### 3. 淡入淡出效果

- **原声淡出**：300ms 线性淡出
- **原声淡入**：200ms 线性淡入
- **翻译淡入**：200ms 线性淡入
- **翻译淡出**：300ms 线性淡出

## 实现细节

### 文件结构

```
web-client/src/
├── audio_mixer.ts      # 音频混控器核心实现
├── app.ts              # 主应用类，集成 WebRTC 和音频混控
└── ui/
    └── renderers.ts    # UI 渲染函数
```

### AudioMixer 类

#### 主要方法

- `addRemoteStream(memberId: string, stream: MediaStream)`: 添加远程音频流
- `removeRemoteStream(memberId: string)`: 移除远程音频流
- `addTtsAudio(audioData: Float32Array)`: 添加翻译音频
- `setRemoteSpeakingStatus(memberId: string, isSpeaking: boolean)`: 设置远程成员说话状态
- `getOutputStream()`: 获取混控后的输出流
- `stop()`: 停止所有播放并清理资源

#### 音频节点结构

```
原声通道（每个成员）:
  MediaStreamAudioSourceNode → GainNode → destination

翻译通道:
  AudioBufferSourceNode → GainNode → destination
```

### App 类集成

#### WebRTC 连接管理

- `ensurePeerConnection(roomCode: string, targetSessionId: string)`: 确保与目标成员的连接存在
- `closePeerConnection(targetSessionId: string)`: 关闭与目标成员的连接
- `handleWebRTCOffer(...)`: 处理 WebRTC offer
- `handleWebRTCAnswer(...)`: 处理 WebRTC answer
- `handleWebRTCIce(...)`: 处理 WebRTC ICE candidate

#### 音频处理流程

1. **远程音频流接收**：
   - WebRTC `ontrack` 事件触发
   - 将远程流添加到 `AudioMixer`
   - 自动开始播放原声

2. **翻译音频处理**：
   - 收到 `translation_result` 或 `tts_audio` 消息
   - 在房间模式下，将音频发送到 `AudioMixer` 而不是 `TtsPlayer`
   - `AudioMixer` 自动处理淡入淡出和混控

3. **输出播放**：
   - `AudioMixer` 输出到 `MediaStreamAudioDestinationNode`
   - 通过隐藏的 `<audio>` 元素播放混控后的音频

## 使用示例

### 基本使用

```typescript
// 创建应用实例
const app = new App();

// 加入会议室
app.joinRoom('123456', 'Alice', 'zh');

// 开始会话（自动建立 WebRTC 连接）
app.startSession();

// 发送音频
app.sendCurrentUtterance();

// 退出房间（自动清理所有连接）
app.leaveRoom();
```

### 原声接收偏好控制

```typescript
// 设置是否接收某个成员的原声
app.setRawVoicePreference('123456', 'member-session-id', true);

// 这会自动建立或关闭 WebRTC 连接
```

## 技术细节

### WebRTC 配置

- **ICE 服务器**：使用 Google STUN 服务器（`stun:stun.l.google.com:19302`）
- **音频参数**：
  - `echoCancellation: true`
  - `noiseSuppression: true`
  - `autoGainControl: true`

### 音频格式

- **采样率**：16kHz
- **声道**：Mono
- **格式**：PCM16（翻译音频），WebRTC 音频流（原声）

### 性能考虑

- **连接管理**：只建立必要的 WebRTC 连接（根据用户偏好）
- **资源清理**：离开房间时自动清理所有连接和音频节点
- **内存管理**：使用队列管理 TTS 音频块，避免内存泄漏

## 待实现功能

1. **远程成员说话状态检测**：
   - 需要服务器发送 `remote_speaking_start` 和 `remote_speaking_end` 消息
   - 用于判断翻译播放结束后是否恢复原声

2. **TTS 队列管理**：
   - 当前实现已支持队列，但需要完善错误处理
   - 需要处理播放中断和恢复

3. **音频质量优化**：
   - 动态调整音量平衡
   - 支持用户自定义混控参数

## 测试建议

1. **单元测试**：
   - `AudioMixer` 类的各个方法
   - WebRTC 连接建立和关闭
   - 淡入淡出效果

2. **集成测试**：
   - 多成员会议室场景
   - 原声接收偏好切换
   - 翻译音频和原声的混控效果

3. **端到端测试**：
   - 完整的会议室会话流程
   - 网络异常情况处理
   - 浏览器兼容性测试

## 参考文档

- [WebRTC 规范](https://www.w3.org/TR/webrtc/)
- [Web Audio API](https://www.w3.org/TR/webaudio/)
- [会议室模式设计文档](./Web_RawVoice_Translation_Handover_Spec_v1.1.md)

