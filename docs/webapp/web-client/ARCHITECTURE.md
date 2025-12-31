# Web 客户端架构设计

## 概述

Web 客户端是 Lingua 系统的前端应用，负责音频采集、与调度服务器通信、以及翻译结果的展示和播放。

## 核心模块

### 1. App (主应用类)

**文件**: `src/app.ts`

**职责**: 整合所有模块，协调各组件工作

**主要功能**:
- 状态管理（通过 StateMachine）
- 音频处理流程控制
- 会话管理（单向/双向模式）
- 房间管理（会议室模式）
- WebRTC 连接管理
- 静音检测和过滤

**关键方法**:
- `onAudioFrame()`: 处理音频帧，进行静音检测
- `onSilenceDetected()`: 处理静音检测事件
- `sendCurrentUtterance()`: 发送当前话语
- `startSession()`: 开始会话
- `endSession()`: 结束会话

### 2. StateMachine (状态机)

**文件**: `src/state_machine.ts`

**职责**: 管理应用状态转换

**状态定义**:
- `INPUT_READY`: 准备就绪，等待用户操作
- `INPUT_RECORDING`: 正在录音，采集音频
- `OUTPUT_PLAYING`: 正在播放 TTS 音频
- `SESSION_ACTIVE`: 会话激活状态

**状态转换规则**:
- `INPUT_READY` → `INPUT_RECORDING`: 开始录音
- `INPUT_RECORDING` → `OUTPUT_PLAYING`: 发送音频，等待结果
- `OUTPUT_PLAYING` → `INPUT_RECORDING`: 播放完成，继续录音
- `INPUT_RECORDING` → `INPUT_READY`: 停止录音

### 3. Recorder (录音模块)

**文件**: `src/recorder.ts`

**职责**: 音频采集和静音检测

**主要功能**:
- 麦克风权限请求
- 音频流采集（16kHz, 单声道, PCM）
- 实时静音检测
- 音频帧回调

**技术细节**:
- 使用 `getUserMedia` API 获取音频流
- 使用 `AudioContext` 和 `ScriptProcessorNode` 处理音频
- 使用 `AnalyserNode` 进行音量分析

### 4. WebSocketClient (WebSocket 客户端)

**文件**: `src/websocket_client.ts`

**职责**: 与调度服务器通信

**主要功能**:
- WebSocket 连接管理
- 音频块发送（PCM16, base64 编码）
- 服务器消息接收和处理
- 会话初始化

**消息类型**:
- `session_init`: 会话初始化
- `audio_chunk`: 音频块
- `translation_result`: 翻译结果
- `asr_partial`: ASR 部分结果

### 5. TtsPlayer (TTS 播放器)

**文件**: `src/tts_player.ts`

**职责**: 播放服务器返回的 TTS 音频

**主要功能**:
- 流式音频播放
- PCM16 音频解码
- 播放状态管理
- 音频缓冲管理

### 6. AsrSubtitle (ASR 字幕)

**文件**: `src/asr_subtitle.ts`

**职责**: 显示实时语音识别结果

**主要功能**:
- 部分结果更新
- 最终结果显示
- 字幕界面渲染

### 7. AudioMixer (音频混控器)

**文件**: `src/audio_mixer.ts`

**职责**: 音频混合处理（会议室模式）

**主要功能**:
- 多路音频混合
- WebRTC 音频处理

## 音频处理流程

### 采集流程

```
麦克风输入
    ↓
Recorder.initialize()
    ↓
getUserMedia() 获取音频流
    ↓
AudioContext 创建音频上下文
    ↓
ScriptProcessorNode 处理音频帧
    ↓
onAudioFrame() 回调
```

### 静音检测和过滤

```
音频帧 (Float32Array)
    ↓
isSilence() 检测 (RMS 值计算)
    ↓
[静音] → 丢弃，不发送
    ↓
[非静音] → 缓存到 audioBuffer
    ↓
累积到 100ms (10 帧)
    ↓
再次检测整个块
    ↓
[非静音] → 发送到调度服务器
```

### 静音检测机制

**检测方法**: RMS (Root Mean Square) 值计算

**计算公式**:
```typescript
rms = sqrt(sum(sample²) / length)
```

**阈值**: 默认 0.01（可配置）

**过滤位置**:
1. **单帧检测**: 在 `onAudioFrame` 中检测每个音频帧
2. **块级检测**: 在发送音频块前再次检测整个块
3. **剩余数据检测**: 在 `onSilenceDetected` 和 `sendCurrentUtterance` 中检测

### 发送流程

```
累积音频块
    ↓
转换为 PCM16 (Int16Array)
    ↓
转换为 base64
    ↓
构建 AudioChunkMessage
    ↓
通过 WebSocket 发送
```

### 接收和播放流程

```
接收 TranslationResult
    ↓
提取 TTS 音频 (base64)
    ↓
TtsPlayer.addAudioChunk()
    ↓
解码 base64 → Int16Array → Float32Array
    ↓
添加到音频缓冲区
    ↓
开始播放
```

## 支持的模式

### 1. 单向模式

**特点**:
- 固定源语言和目标语言
- 单向翻译流程

**流程**:
```
用户说话 (源语言) → ASR → NMT → TTS → 播放 (目标语言)
```

### 2. 双向模式

**特点**:
- 自动识别语言方向
- 支持两种语言互译

**流程**:
```
用户说话 → 语言检测 → 确定翻译方向 → ASR → NMT → TTS → 播放
```

### 3. 会话模式

**特点**:
- 持续输入+输出
- 自动状态切换
- 支持流式 ASR

**流程**:
```
开始会话 → 持续录音 → 自动发送 → 接收结果 → 播放 → 继续录音
```

### 4. 会议室模式

**特点**:
- 多人会话
- WebRTC 原声传递
- 房间管理

**流程**:
```
创建/加入房间 → WebRTC 连接 → 原声传递 + 翻译结果
```

## 数据流

### 完整翻译流程

```
1. 用户说话
   ↓
2. Recorder 采集音频
   ↓
3. 静音检测和过滤（Web 端）
   ↓
4. 发送 AudioChunk 到 Scheduler
   ↓
5. Scheduler 缓冲音频块
   ↓
6. 检测停顿，触发任务创建
   ↓
7. Scheduler 分发任务到 Node
   ↓
8. Node 执行 ASR（带文本过滤）
   ↓
9. Node 执行 NMT（如果 ASR 结果非空）
   ↓
10. Node 执行 TTS（如果 ASR 结果非空）
    ↓
11. 返回结果到 Scheduler
    ↓
12. Scheduler 发送结果到 Web Client
    ↓
13. Web Client 接收并播放
```

## 性能优化

### 1. 静音过滤

- **位置**: Web 端
- **效果**: 减少网络传输，降低服务器负载
- **实现**: RMS 值检测，阈值 0.01

### 2. 音频缓冲

- **策略**: 累积 100ms 音频后发送
- **效果**: 减少消息数量，降低网络开销

### 3. 状态管理

- **实现**: 使用状态机管理复杂的状态转换
- **效果**: 避免状态混乱，提高代码可维护性

### 4. 流式处理

- **ASR**: 支持部分结果实时显示
- **TTS**: 支持流式播放，减少延迟

## 错误处理

### 1. WebSocket 连接错误

- **检测**: 监听 `onerror` 和 `onclose` 事件
- **处理**: 显示错误信息，尝试重连

### 2. 音频采集错误

- **检测**: `getUserMedia` 失败
- **处理**: 提示用户授权麦克风权限

### 3. 播放错误

- **检测**: 音频解码或播放失败
- **处理**: 跳过当前音频块，继续处理下一个

## 配置

### 默认配置

```typescript
export const DEFAULT_CONFIG: Config = {
  schedulerUrl: 'ws://localhost:5010/ws/session',
  // ...
};
```

### 静音阈值

```typescript
private silenceThreshold: number = 0.01;
```

可以通过修改 `app.ts` 中的 `silenceThreshold` 来调整静音检测的敏感度。

## 测试

测试文件位于 `tests/` 目录：

- **单元测试**: 各模块的独立测试
- **集成测试**: 模块间协作测试
- **模式测试**: 不同模式的测试

运行测试：
```bash
npm test
```

## 相关文档

- [调试指南](./DEBUGGING_GUIDE.md) - 日志查看和问题诊断
- [Phase 2 实现总结](./PHASE2_IMPLEMENTATION_SUMMARY.md) - Phase 2 功能实现
- [Phase 3 开发计划](./DEVELOPMENT_PLAN_PHASE3.md) - Phase 3 开发计划
- [文本显示与同步](./TEXT_DISPLAY_AND_SYNC.md) - 文本显示同步机制
- [TTS 播放与 UI](./TTS_PLAYBACK_AND_UI.md) - TTS 播放实现
- [背压实现](./BACKPRESSURE_IMPLEMENTATION.md) - 客户端背压机制

