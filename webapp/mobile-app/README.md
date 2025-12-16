# Lingua 移动端客户端

基于 React Native + Expo 的实时语音翻译移动端应用（iOS 版本）。

## 项目结构

```
mobile-app/
├── src/
│   ├── models/              # 数据模型
│   │   ├── SessionConfig.ts      # 会话配置
│   │   ├── AudioChunk.ts         # 音频块模型
│   │   └── TranslationSegment.ts # 翻译片段模型
│   ├── services/            # 核心服务
│   │   ├── AudioCaptureService.ts  # 音频采集服务
│   │   ├── LightweightVAD.ts       # 轻量级 VAD
│   │   ├── AudioChunker.ts         # AudioChunk 打包器
│   │   ├── RealtimeClient.ts       # WebSocket 实时客户端
│   │   └── AudioPlayerService.ts   # TTS 音频播放服务
│   └── hooks/               # React Hooks
│       ├── useSession.ts          # 会话管理 Hook
│       ├── useAudioPipeline.ts    # 音频管线 Hook
│       ├── useWebSocket.ts        # WebSocket Hook（旧版，待迁移）
│       └── useVAD.ts              # VAD Hook（旧版，待迁移）
├── App.tsx                  # 主应用组件
├── package.json
└── README.md
```

## 功能特性

### ✅ 已完成

- **基础架构**
  - 数据模型定义（SessionConfig, AudioChunk, TranslationSegment）
  - 目录结构组织

- **音频处理**
  - 轻量级 VAD（RMS 能量阈值检测）
  - AudioChunk 打包器（200ms 打包）
  - 音频采集服务框架（需完善实时 PCM 获取）

- **WebSocket 通信**
  - 实时客户端（RealtimeClient）
  - 会话初始化和管理
  - 音频块发送
  - 心跳机制（25秒间隔）
  - 自动重连（指数退避）
  - 消息解析和委托回调

- **TTS 播放**
  - PCM16 音频播放服务
  - PCM16 转 WAV 格式转换

- **UI 界面**
  - 连接状态显示
  - 录音控制
  - 翻译结果展示
  - 语言检测结果显示

### ⏸️ 待完善

- **音频采集**
  - expo-av 无法直接获取实时 PCM 数据
  - 需要实现原生模块或使用 `react-native-audio-recorder-player`
  - 或定期读取录音文件并解析 PCM 数据

- **多会话管理**
  - 会话列表界面
  - 会话持久化

- **调试与监控**
  - 实时带宽监控
  - 延迟监控（RTT）
  - 调试面板

## 技术栈

- **框架**: React Native + Expo
- **语言**: TypeScript
- **音频**: expo-av
- **WebSocket**: 原生 WebSocket API
- **状态管理**: React Hooks

## 开发指南

### 安装依赖

```bash
cd mobile-app
npm install
```

### 运行项目

```bash
# iOS
npm run ios

# Android
npm run android

# Web
npm run web
```

### 配置

在 `App.tsx` 中配置调度服务器地址：

```typescript
const { connect } = useSession({
  schedulerUrl: 'ws://localhost:5010/ws/session', // 修改为实际地址
  platform: 'ios',
  clientVersion: '1.0.0',
});
```

## 架构说明

### 音频管线

```
[麦克风] 
  ↓
[AudioCaptureService] - 音频采集（16kHz, PCM16, 单声道）
  ↓
[LightweightVAD] - 静音过滤（RMS 能量阈值，-50dB）
  ↓
[AudioChunker] - 打包（每 200ms 一个 AudioChunk）
  ↓
[RealtimeClient] - WebSocket 发送
```

### 会话流程

1. **连接阶段**
   - 用户输入配对码（可选）
   - 调用 `connect()` 建立 WebSocket 连接
   - 发送 `session_init` 消息
   - 接收 `session_init_ack` 确认

2. **录音阶段**
   - 启动音频采集管线
   - VAD 过滤静音
   - Chunker 打包音频块
   - 自动发送到服务器

3. **接收阶段**
   - 接收 `translation_result` 消息
   - 解析翻译文本和 TTS 音频
   - 自动播放 TTS 音频
   - 更新 UI 显示

## 参考文档

- [iOS 客户端开发步骤](../docs/IOS/IOS_IMPLEMENTATION_STEPS.md)
- [iOS 音频采集与 VAD 设计](../docs/IOS/IOS_AUDIO_VAD_PIPELINE.md)
- [iOS WebSocket 实时通信设计](../docs/IOS/IOS_WEBSOCKET_REALTIME_DESIGN.md)
- [iOS 客户端架构与接口](../docs/IOS/IOS_CLIENT_DESIGN_AND_INTERFACES.md)
- [移动端 iOS 文档分析](../docs/IOS/MOBILE_APP_IOS_DOCS_ANALYSIS.md)

## 已知问题

1. **expo-av 限制**
   - `expo-av` 无法直接获取实时 PCM 数据
   - 当前 `AudioCaptureService` 为框架实现，需要完善
   - 建议使用原生模块或第三方库（如 `react-native-audio-recorder-player`）

2. **TTS 播放**
   - 当前使用 base64 data URI，expo-av 可能不支持
   - 建议将 WAV 数据写入临时文件后播放

## 下一步

1. 完善 `AudioCaptureService` 的实时 PCM 数据获取
2. 实现多会话管理功能
3. 添加调试与监控功能
4. 优化 UI 和用户体验

