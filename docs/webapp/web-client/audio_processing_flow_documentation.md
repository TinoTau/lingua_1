# Web 客户端音频处理流程完整文档

## 概述

本文档详细描述了 Web 客户端中音频的接收、发送和播放的完整流程，包括每个方法的调用链和关键节点。

---

## 一、音频接收流程（麦克风 → 调度服务器）

### 1.1 流程概览

```
用户说话 → Recorder 采集 → SessionManager 处理 → AudioSender 编码 → WebSocket 发送 → 调度服务器
```

### 1.2 详细调用链

#### 1.2.1 初始化阶段

**1. App 构造**
- 文件：`webapp/web-client/src/app.ts`
- 方法：`constructor(config)`
- 调用链：
  ```
  App.constructor()
    ├─> StateMachine (new)
    ├─> Recorder (new, stateMachine, config)
    ├─> WebSocketClient (new, stateMachine, schedulerUrl, ...)
    ├─> SessionManager (new, stateMachine, recorder, wsClient, ttsPlayer, ...)
    └─> setupCallbacks() // 设置回调函数
  ```

**2. 设置回调函数**
- 文件：`webapp/web-client/src/app.ts`
- 方法：`setupCallbacks()`
- 关键回调设置：
  ```typescript
  // 音频帧回调：Recorder → SessionManager
  recorder.setAudioFrameCallback((audioData) => {
    sessionManager.onAudioFrame(audioData);
  });
  
  // 静音检测回调：Recorder → SessionManager
  recorder.setSilenceDetectedCallback(() => {
    sessionManager.onSilenceDetected();
  });
  ```

**3. Recorder 初始化**
- 文件：`webapp/web-client/src/recorder.ts`
- 方法：`initialize()`
- 调用链：
  ```
  Recorder.initialize()
    ├─> navigator.mediaDevices.getUserMedia() // 请求麦克风权限
    ├─> AudioContext (new, sampleRate: 16000)
    ├─> MediaStreamAudioSourceNode (create)
    ├─> AnalyserNode (create, fftSize: 256) // 用于音量检测
    ├─> ScriptProcessorNode (create, bufferSize: 4096) // 用于获取 PCM 数据
    └─> processor.onaudioprocess = (event) => { ... } // 音频处理回调
  ```

#### 1.2.2 开始录音阶段

**1. 用户点击"开始"按钮**
- 文件：`webapp/web-client/src/ui/session_mode.ts`
- 方法：`setupSessionModeEventHandlers()`
- 事件处理：
  ```typescript
  startBtn.addEventListener('click', async () => {
    await app.startSession();
  });
  ```

**2. 开始会话**
- 文件：`webapp/web-client/src/app.ts`
- 方法：`startSession()`
- 调用链：
  ```
  App.startSession()
    └─> SessionManager.startSession()
  ```

**3. SessionManager 开始会话**
- 文件：`webapp/web-client/src/app/session_manager.ts`
- 方法：`startSession()`
- 调用链：
  ```
  SessionManager.startSession()
    ├─> isSessionActive = true
    ├─> audioBuffer = [] // 清空音频缓冲区
    ├─> currentUtteranceIndex = 0 // 重置 utterance 索引
    ├─> StateMachine.startSession() // 状态机切换到 INPUT_RECORDING
    └─> Recorder.start() // 如果未启动，启动录音器
  ```

**4. Recorder 启动**
- 文件：`webapp/web-client/src/recorder.ts`
- 方法：`start()`
- 调用链：
  ```
  Recorder.start()
    ├─> 检查 AudioContext 和 MediaStream 是否存在
    │   └─> 如果不存在，调用 initialize()
    ├─> 检查 AudioContext.state === 'suspended'
    │   └─> 如果是，调用 audioContext.resume() // ⚠️ 关键修复：恢复 AudioContext
    ├─> isRecording = true
    ├─> 重置 VAD 状态（根据停止时长智能恢复）
    ├─> 设置恢复保护窗口（200ms）
    └─> startSilenceDetection() // 开始静音检测
  ```

**5. 状态机状态变化**
- 文件：`webapp/web-client/src/app.ts`
- 方法：`onStateChange(newState, oldState)`
- 当状态变为 `INPUT_RECORDING` 时：
  ```
  App.onStateChange(INPUT_RECORDING, ...)
    └─> 检查 recorder.getIsRecording()
        └─> 如果为 false，调用 recorder.start()
  ```

#### 1.2.3 音频帧处理阶段

**1. Recorder 音频处理回调**
- 文件：`webapp/web-client/src/recorder.ts`
- 方法：`processor.onaudioprocess(event)`
- 处理流程：
  ```typescript
  processor.onaudioprocess = (event) => {
    if (!this.isRecording) return; // 如果未录音，跳过
    
    const inputData = inputBuffer.getChannelData(0);
    const audioData = new Float32Array(inputData);
    
    // 静音过滤处理
    if (this.silenceFilterConfig.enabled) {
      const shouldSend = this.processSilenceFilter(audioData);
      if (shouldSend && this.audioFrameCallback) {
        this.audioFrameCallback(audioData); // 调用回调
      }
    } else {
      if (this.audioFrameCallback) {
        this.audioFrameCallback(audioData); // 直接调用回调
      }
    }
  };
  ```

**2. SessionManager 处理音频帧**
- 文件：`webapp/web-client/src/app/session_manager.ts`
- 方法：`onAudioFrame(audioData: Float32Array)`
- 完整调用链：
  ```
  SessionManager.onAudioFrame(audioData)
    ├─> 检查状态是否为 INPUT_RECORDING
    │   └─> 如果不是，记录跳过并返回
    ├─> 如果是播放完成后首次接收，记录日志
    ├─> 将音频数据添加到 audioBuffer
    ├─> 检查是否在播放完成延迟期间（500ms）
    │   └─> 如果是，缓存到 playbackFinishedDelayBuffer
    ├─> 延迟期间结束后，合并缓存的音频数据
    └─> 如果 audioBuffer.length >= 10（100ms 音频）
        ├─> 提取前 10 帧并合并为 chunk
        ├─> 记录首次发送日志（如果是播放后首次）
        ├─> WebSocketClient.sendAudioChunk(chunk, false)
        └─> hasSentAudioChunksForCurrentUtterance = true
  ```

**3. WebSocketClient 发送音频**
- 文件：`webapp/web-client/src/websocket_client.ts`
- 方法：`sendAudioChunk(audioData: Float32Array, isFinal: boolean)`
- 调用链：
  ```
  WebSocketClient.sendAudioChunk(audioData, isFinal)
    └─> AudioSender.sendAudioChunk(audioData, isFinal)
  ```

**4. AudioSender 编码并发送**
- 文件：`webapp/web-client/src/websocket/audio_sender.ts`
- 方法：`sendAudioChunk(audioData: Float32Array, isFinal: boolean)`
- 调用链：
  ```
  AudioSender.sendAudioChunk(audioData, isFinal)
    ├─> 检查背压状态（BackpressureManager）
    ├─> 如果正常，调用 sendAudioChunkInternal()
    │   ├─> AudioEncoder.encode(audioData) // Opus 编码
    │   ├─> encodeAudioChunkFrame() // 构建二进制帧
    │   └─> sendCallback(encodedData) // 通过 WebSocket 发送
    └─> 如果背压，加入队列等待发送
  ```

#### 1.2.4 手动发送（用户点击"发送"按钮）

**1. 用户点击"发送"按钮**
- 文件：`webapp/web-client/src/ui/session_mode.ts`
- 方法：`setupSessionModeEventHandlers()`
- 事件处理：
  ```typescript
  sendBtn.addEventListener('click', () => {
    app.sendCurrentUtterance();
  });
  ```

**2. App 发送当前话语**
- 文件：`webapp/web-client/src/app.ts`
- 方法：`sendCurrentUtterance()`
- 调用链：
  ```
  App.sendCurrentUtterance()
    └─> SessionManager.sendCurrentUtterance()
  ```

**3. SessionManager 发送当前话语**
- 文件：`webapp/web-client/src/app/session_manager.ts`
- 方法：`sendCurrentUtterance()`
- 调用链：
  ```
  SessionManager.sendCurrentUtterance()
    ├─> 检查状态是否为 INPUT_RECORDING
    ├─> 如果 audioBuffer.length > 0
    │   ├─> 合并所有音频数据为 chunk
    │   ├─> WebSocketClient.sendAudioChunk(chunk, false)
    │   ├─> audioBuffer = [] // 清空缓冲区
    │   └─> hasSentAudioChunksForCurrentUtterance = true
    ├─> WebSocketClient.sendFinal() // 发送 finalize 信号
    └─> currentUtteranceIndex++ // 递增 utterance 索引
  ```

**4. WebSocketClient 发送 Finalize**
- 文件：`webapp/web-client/src/websocket_client.ts`
- 方法：`sendFinal()`
- 调用链：
  ```
  WebSocketClient.sendFinal()
    └─> AudioSender.sendFinal()
        ├─> AudioEncoder.encode(new Float32Array(0)) // 空音频
        ├─> encodeFinalFrame() // 构建 finalize 帧
        └─> sendCallback(encodedData) // 通过 WebSocket 发送
  ```

---

## 二、音频发送流程（调度服务器 → 播放）

### 2.1 流程概览

```
调度服务器 → WebSocket 接收 → App 处理 → TtsPlayer 解码缓存 → 用户点击播放 → AudioContext 播放
```

### 2.2 详细调用链

#### 2.2.1 接收服务器消息

**1. WebSocket 消息接收**
- 文件：`webapp/web-client/src/websocket_client.ts`
- 方法：`onMessage(event)`
- 调用链：
  ```
  WebSocketClient.onMessage(event)
    ├─> 解析消息（JSON 或二进制）
    ├─> MessageHandler.handleMessage(message)
    └─> messageCallback(message) // 触发 App 的回调
  ```

**2. App 处理服务器消息**
- 文件：`webapp/web-client/src/app.ts`
- 方法：`onServerMessage(message: ServerMessage)`
- 根据消息类型分发：
  ```
  App.onServerMessage(message)
    ├─> message.type === 'session_created'
    │   └─> 保存 session_id
    ├─> message.type === 'translation_result'
    │   └─> handleTranslationResult(message)
    ├─> message.type === 'tts_audio_chunk'
    │   └─> handleTtsAudioChunk(message)
    └─> message.type === 'ui_event'
        └─> 更新 UI 状态
  ```

#### 2.2.2 处理翻译结果消息

**1. 处理翻译结果**
- 文件：`webapp/web-client/src/app.ts`
- 方法：`handleTranslationResult(message)`
- 调用链：
  ```
  App.handleTranslationResult(message)
    ├─> TranslationDisplayManager.saveTranslationResult()
    │   └─> 保存翻译结果到 Map
    ├─> TranslationDisplayManager.displayTranslationResult()
    │   └─> 显示翻译文本到 UI
    ├─> 检查是否有 TTS 音频
    │   └─> 如果有，调用 handleTtsAudioChunk()
    └─> 根据 autoPlay 配置决定是否自动播放
  ```

**2. 处理 TTS 音频块**
- 文件：`webapp/web-client/src/app.ts`
- 方法：`handleTtsAudioChunk(message)` 或 `handleTranslationResult()` 中的 TTS 处理
- 调用链：
  ```
  App.handleTtsAudioChunk(message)
    ├─> 保存 trace_id 和 group_id（用于 TTS_PLAY_ENDED）
    ├─> TtsPlayer.addAudioChunk(base64Data, utteranceIndex, format)
    └─> notifyTtsAudioAvailable() // 通知 UI 更新
  ```

#### 2.2.3 TtsPlayer 添加音频块

**1. 添加音频块**
- 文件：`webapp/web-client/src/tts_player.ts`
- 方法：`addAudioChunk(base64Data: string, utteranceIndex: number, ttsFormat: string)`
- 完整调用链：
  ```
  TtsPlayer.addAudioChunk(base64Data, utteranceIndex, ttsFormat)
    ├─> ensureAudioContext() // 确保 AudioContext 已初始化
    │   ├─> 如果 audioContext 不存在，创建新的 AudioContext
    │   └─> 如果 state === 'suspended'，调用 audioContext.resume()
    ├─> Base64 解码
    ├─> 创建 AudioDecoder（如果格式变化或不存在）
    ├─> AudioDecoder.decode() // Opus 或 PCM16 解码
    │   └─> 返回 Float32Array（PCM 数据）
    ├─> 按 utteranceIndex 排序插入到 audioBuffers
    ├─> 检查内存限制
    │   ├─> 如果超过限制，移除最旧的音频块
    │   └─> 如果总时长超过限制且未播放，触发自动播放
    └─> 记录日志
  ```

**2. 通知 UI 更新**
- 文件：`webapp/web-client/src/app.ts`
- 方法：`notifyTtsAudioAvailable()`
- 调用链：
  ```
  App.notifyTtsAudioAvailable()
    ├─> TtsPlayer.getTotalDuration() // 获取总时长
    ├─> TtsPlayer.hasPendingAudio() // 检查是否有待播放音频
    ├─> window.onTtsAudioAvailable(duration) // 触发全局回调（如果存在）
    └─> StateMachine.notifyUIUpdate() // 通知状态机更新 UI
  ```

---

## 三、播放按钮流程

### 3.1 流程概览

```
用户点击播放按钮 → App.startTtsPlayback() → TtsPlayer.startPlayback() → 音频播放 → 播放完成回调
```

### 3.2 详细调用链

#### 3.2.1 用户点击播放按钮

**1. 播放按钮事件处理**
- 文件：`webapp/web-client/src/ui/session_mode.ts`
- 方法：`setupSessionModeEventHandlers()`
- 事件处理：
  ```typescript
  playPauseBtn.addEventListener('click', async () => {
    const isPlaying = app.isTtsPlaying();
    if (isPlaying) {
      app.pauseTtsPlayback(); // 如果正在播放，暂停
    } else {
      // 如果未播放，先发送当前话语（手动截断），然后播放
      await app.sendCurrentUtterance();
      await app.startTtsPlayback();
    }
  });
  ```

**2. App 开始播放**
- 文件：`webapp/web-client/src/app.ts`
- 方法：`startTtsPlayback()`
- 调用链：
  ```
  App.startTtsPlayback()
    ├─> 检查是否有待播放音频（TtsPlayer.hasPendingAudio()）
    ├─> displayPendingTranslationResults() // 显示待显示的翻译结果
    └─> TtsPlayer.startPlayback()
  ```

#### 3.2.2 TtsPlayer 开始播放

**1. 开始播放**
- 文件：`webapp/web-client/src/tts_player.ts`
- 方法：`startPlayback()`
- 完整调用链：
  ```
  TtsPlayer.startPlayback()
    ├─> 检查是否已暂停（isPaused）
    │   └─> 如果已暂停，恢复播放并返回
    ├─> 检查是否正在播放或缓冲区为空
    │   └─> 如果是，跳过
    ├─> ensureAudioContext() // 确保 AudioContext 已初始化
    ├─> isPlaying = true
    ├─> isPaused = false
    ├─> currentPlaybackIndex = -1 // 重置播放索引
    ├─> StateMachine.startPlaying() // 状态切换到 PLAYING_TTS
    └─> playNext() // 开始播放第一个音频块
  ```

**2. 播放下一个音频块（递归）**
- 文件：`webapp/web-client/src/tts_player.ts`
- 方法：`playNext()`（内部异步函数）
- 完整调用链：
  ```
  TtsPlayer.playNext()
    ├─> 检查是否被暂停
    │   └─> 如果是，返回
    ├─> 如果 audioBuffers.length === 0
    │   └─> finishPlaying() // 所有音频播放完成
    ├─> 获取第一个音频块（按 utteranceIndex 排序）
    ├─> 创建 AudioBuffer（从 Float32Array）
    ├─> 创建 AudioBufferSourceNode
    ├─> 设置播放倍速（playbackRate）
    ├─> 连接音频节点
    ├─> 监听播放结束事件（onended）
    │   ├─> 当前音频块播放完成
    │   ├─> 调用 playbackIndexChangeCallback(currentPlaybackIndex) // 通知索引变化
    │   ├─> 从 audioBuffers 移除已播放的音频块
    │   ├─> currentPlaybackIndex++ // 递增播放索引
    │   └─> playNext() // 递归播放下一个音频块
    └─> 开始播放（source.start(0)）
  ```

**3. 播放完成处理**
- 文件：`webapp/web-client/src/tts_player.ts`
- 方法：`finishPlaying()`（内部方法）
- 调用链：
  ```
  TtsPlayer.finishPlaying()
    ├─> isPlaying = false
    ├─> isPaused = false
    ├─> currentSource = null
    ├─> currentPlaybackIndex = -1
    ├─> StateMachine.finishPlaying() // 状态切换回 INPUT_RECORDING
    └─> playbackFinishedCallback() // 调用回调
  ```

#### 3.2.3 播放完成回调

**1. App 播放完成处理**
- 文件：`webapp/web-client/src/app.ts`
- 方法：`onPlaybackFinished()`
- 完整调用链：
  ```
  App.onPlaybackFinished()
    ├─> 获取当前 trace_id 和 group_id
    ├─> WebSocketClient.sendTtsPlayEnded(traceId, groupId, tsEndMs)
    │   └─> 发送 TTS_PLAY_ENDED 消息到调度服务器
    ├─> SessionManager.setPlaybackFinishedTimestamp(timestamp)
    │   └─> 设置播放结束时间戳（用于计算到首次音频发送的延迟）
    └─> 如果录音器未恢复，使用事件驱动恢复录音
        ├─> requestAnimationFrame() // 确保状态转换完成
        └─> Recorder.start() // 恢复录音器
  ```

**2. SessionManager 设置播放结束时间戳**
- 文件：`webapp/web-client/src/app/session_manager.ts`
- 方法：`setPlaybackFinishedTimestamp(timestamp: number)`
- 调用链：
  ```
  SessionManager.setPlaybackFinishedTimestamp(timestamp)
    ├─> playbackFinishedTimestamp = timestamp
    ├─> playbackFinishedDelayEndTime = timestamp + 500ms // 设置延迟结束时间
    └─> 记录日志
  ```

**3. 状态机状态切换**
- 文件：`webapp/web-client/src/state_machine.ts`
- 方法：`finishPlaying()`
- 调用链：
  ```
  StateMachine.finishPlaying()
    ├─> 状态从 PLAYING_TTS 切换到 INPUT_RECORDING
    ├─> 触发状态变化回调
    └─> App.onStateChange(INPUT_RECORDING, PLAYING_TTS)
        └─> 恢复录音器（如果未运行）
  ```

---

## 四、关键时间点和延迟

### 4.1 音频接收延迟

**1. 播放完成后首次音频帧接收延迟**
- **位置**：`SessionManager.onAudioFrame()`
- **记录点**：`🎙️ 播放完成后首次接收到音频帧`
- **预期延迟**：0-100ms（取决于 `AudioContext.resume()` 的执行时间）
- **实际延迟**：可能因 `AudioContext` 处于 `suspended` 状态而延迟

**2. 播放完成后首次音频 chunk 发送延迟**
- **位置**：`SessionManager.onAudioFrame()`
- **记录点**：`🎤 首次发送音频chunk（播放结束后）`
- **预期延迟**：500ms（`PLAYBACK_FINISHED_DELAY_MS`）+ 音频累积时间（约100ms）= 600ms
- **实际延迟**：可能因音频帧接收延迟而增加

### 4.2 播放完成后录音器恢复延迟

**1. 状态切换延迟**
- **位置**：`TtsPlayer.finishPlaying()` → `StateMachine.finishPlaying()`
- **预期延迟**：< 1ms（同步操作）

**2. 录音器启动延迟**
- **位置**：`App.onStateChange()` → `Recorder.start()`
- **预期延迟**：
  - 如果 `AudioContext` 状态正常：< 10ms
  - 如果 `AudioContext` 处于 `suspended` 状态：`resume()` 可能需要 0-50ms

**3. 首次音频帧接收延迟**
- **位置**：`Recorder.processor.onaudioprocess()`
- **预期延迟**：
  - 如果 `AudioContext` 状态正常：< 100ms（第一个 bufferSize）
  - 如果 `AudioContext` 处于 `suspended` 状态：可能延迟数秒

---

## 五、关键问题和修复

### 5.1 AudioContext 状态问题

**问题**：TTS 播放完成后，`AudioContext` 可能处于 `suspended` 状态，导致 `ScriptProcessorNode` 的 `onaudioprocess` 事件不会被触发。

**修复位置**：`webapp/web-client/src/recorder.ts`
```typescript
// Recorder.start()
if (this.audioContext && this.audioContext.state === 'suspended') {
  await this.audioContext.resume();
}
```

**影响**：确保录音器启动后，音频帧能够立即被接收和处理。

### 5.2 播放完成延迟机制

**目的**：避免播放结束后的回声被误判为新的语音输入。

**实现位置**：`webapp/web-client/src/app/session_manager.ts`
```typescript
// SessionManager.onAudioFrame()
if (this.playbackFinishedDelayEndTime !== null && now < this.playbackFinishedDelayEndTime) {
  // 在延迟期间，缓存音频数据，不发送
  this.playbackFinishedDelayBuffer.push(new Float32Array(audioData));
  return;
}
```

**延迟时长**：500ms（`PLAYBACK_FINISHED_DELAY_MS`）

---

## 六、状态机状态转换

### 6.1 状态定义

- `INPUT_READY`：准备就绪，等待用户开始
- `INPUT_RECORDING`：正在录音，接收音频输入
- `PLAYING_TTS`：正在播放 TTS 音频

### 6.2 状态转换流程

**1. 开始会话**
```
INPUT_READY → INPUT_RECORDING
触发：StateMachine.startSession()
```

**2. 开始播放**
```
INPUT_RECORDING → PLAYING_TTS
触发：StateMachine.startPlaying()
```

**3. 播放完成**
```
PLAYING_TTS → INPUT_RECORDING
触发：StateMachine.finishPlaying()
```

**4. 手动发送**
```
INPUT_RECORDING → INPUT_RECORDING（状态不变）
触发：SessionManager.sendCurrentUtterance()
```

---

## 七、关键数据结构

### 7.1 SessionManager

- `audioBuffer: Float32Array[]`：当前 utterance 的音频缓冲区
- `playbackFinishedDelayBuffer: Float32Array[]`：播放完成延迟期间的音频缓冲区
- `currentUtteranceIndex: number`：当前 utterance 索引
- `playbackFinishedTimestamp: number | null`：播放结束时间戳
- `hasSentAudioChunksForCurrentUtterance: boolean`：当前 utterance 是否已发送过音频块

### 7.2 TtsPlayer

- `audioBuffers: AudioBufferWithIndex[]`：待播放的音频缓冲区（按 utteranceIndex 排序）
- `currentPlaybackIndex: number`：当前播放的索引
- `isPlaying: boolean`：是否正在播放
- `isPaused: boolean`：是否已暂停

### 7.3 Recorder

- `isRecording: boolean`：是否正在录音
- `audioContext: AudioContext`：音频上下文
- `mediaStream: MediaStream`：媒体流
- `processor: ScriptProcessorNode`：音频处理节点

---

## 八、关键日志点

### 8.1 音频接收相关日志

1. **`🎙️ 播放完成后首次接收到音频帧`**
   - 位置：`SessionManager.onAudioFrame()`
   - 记录：播放完成后首次接收到音频帧的时间点

2. **`🎤 首次发送音频chunk（播放结束后）`**
   - 位置：`SessionManager.onAudioFrame()`
   - 记录：播放完成后首次发送音频 chunk 的时间点和延迟

3. **`📤 发送第一批音频chunk到调度服务器`**
   - 位置：`SessionManager.onAudioFrame()`
   - 记录：第一批音频 chunk 发送的详细信息

### 8.2 播放相关日志

1. **`🎵 播放完成`**
   - 位置：`App.onPlaybackFinished()`
   - 记录：TTS 播放完成的时间点

2. **`设置播放结束时间戳和延迟发送`**
   - 位置：`SessionManager.setPlaybackFinishedTimestamp()`
   - 记录：播放结束时间戳和延迟配置

### 8.3 状态转换相关日志

1. **`State transition: playing_tts -> input_recording`**
   - 位置：`StateMachine.finishPlaying()`
   - 记录：状态从播放切换到录音

2. **`✅ 录音器已成功启动`**
   - 位置：`Recorder.start()`
   - 记录：录音器启动完成

---

## 九、性能指标

### 9.1 预期延迟

- **播放完成后首次音频帧接收**：0-100ms
- **播放完成后首次音频 chunk 发送**：600ms（500ms 延迟 + 100ms 累积）
- **录音器启动**：< 10ms（正常情况）
- **状态切换**：< 1ms（同步操作）

### 9.2 潜在问题延迟

- **AudioContext 恢复延迟**：0-50ms
- **ScriptProcessorNode 首次触发延迟**：0-100ms（如果 AudioContext 处于 suspended 状态，可能延迟数秒）

---

## 十、相关文件清单

### 10.1 核心文件

- `webapp/web-client/src/app.ts`：主应用类
- `webapp/web-client/src/app/session_manager.ts`：会话管理器
- `webapp/web-client/src/recorder.ts`：录音器
- `webapp/web-client/src/tts_player.ts`：TTS 播放器
- `webapp/web-client/src/websocket/audio_sender.ts`：音频发送器
- `webapp/web-client/src/websocket_client.ts`：WebSocket 客户端
- `webapp/web-client/src/state_machine.ts`：状态机

### 10.2 UI 文件

- `webapp/web-client/src/ui/session_mode.ts`：单会话模式 UI
- `webapp/web-client/src/ui/room_mode.ts`：房间模式 UI

### 10.3 配置文件

- `webapp/web-client/src/types.ts`：类型定义和默认配置

---

## 十一、注意事项

### 11.1 AudioContext 状态管理

- TTS 播放完成后，`Recorder` 的 `AudioContext` 可能处于 `suspended` 状态
- 必须在 `Recorder.start()` 时检查并恢复 `AudioContext` 状态
- 否则 `ScriptProcessorNode` 的 `onaudioprocess` 事件不会被触发

### 11.2 播放完成延迟机制

- 播放完成后有 500ms 的延迟，用于避免回声被误判为新的语音输入
- 在延迟期间，音频数据会被缓存到 `playbackFinishedDelayBuffer`
- 延迟结束后，缓存的音频数据会被合并到 `audioBuffer` 并发送

### 11.3 状态检查和同步

- `SessionManager.onAudioFrame()` 会检查状态是否为 `INPUT_RECORDING`
- 如果状态不正确，音频帧会被跳过（但会记录日志）
- 状态恢复后，跳过的音频帧计数会被重置

---

## 十二、决策要点

### 12.1 当前实现的特点

1. **手动播放模式**：默认情况下，TTS 音频不会自动播放，需要用户手动点击播放按钮
2. **自动音频发送**：录音过程中，音频会自动发送到调度服务器（每 100ms 一个 chunk）
3. **播放完成延迟**：播放完成后有 500ms 延迟，避免回声干扰
4. **AudioContext 状态管理**：已实现自动恢复 `suspended` 状态的 `AudioContext`

### 12.2 潜在问题

1. **首次音频帧接收延迟**：如果 `AudioContext` 处于 `suspended` 状态，首次音频帧接收可能延迟数秒
2. **状态切换延迟**：状态切换和录音器恢复存在异步延迟，可能导致音频帧丢失
3. **播放完成延迟**：500ms 的延迟可能影响用户体验，但有助于避免回声问题

### 12.3 改进建议

1. **减少播放完成延迟**：可以考虑将延迟从 500ms 减少到 200-300ms
2. **提前恢复录音器**：可以在播放完成前几秒开始准备录音器，减少恢复延迟
3. **更细粒度的状态检查**：可以考虑在状态切换过程中允许短暂的音频帧缓存

---

## 附录：方法调用关系图

### A.1 音频接收完整调用链

```
用户说话
  ↓
Recorder.processor.onaudioprocess()
  ↓
Recorder.audioFrameCallback()
  ↓
SessionManager.onAudioFrame()
  ↓
  ├─> 检查状态（INPUT_RECORDING）
  ├─> 添加到 audioBuffer
  ├─> 检查延迟期间
  └─> 如果 buffer.length >= 10
      ↓
      WebSocketClient.sendAudioChunk()
      ↓
      AudioSender.sendAudioChunk()
      ↓
      AudioSender.sendAudioChunkInternal()
      ↓
      AudioEncoder.encode()
      ↓
      WebSocket.send()
      ↓
      调度服务器
```

### A.2 播放按钮完整调用链

```
用户点击播放按钮
  ↓
UI: playPauseBtn.addEventListener('click')
  ↓
App.sendCurrentUtterance()（如果未播放）
  ↓
App.startTtsPlayback()
  ↓
TtsPlayer.startPlayback()
  ↓
StateMachine.startPlaying()
  ↓
App.onStateChange(PLAYING_TTS, INPUT_RECORDING)
  ↓
Recorder.stop()
  ↓
TtsPlayer.playNext()（递归）
  ↓
AudioContext.createBufferSource()
  ↓
AudioBufferSourceNode.start()
  ↓
播放音频
  ↓
播放完成
  ↓
TtsPlayer.finishPlaying()
  ↓
StateMachine.finishPlaying()
  ↓
App.onStateChange(INPUT_RECORDING, PLAYING_TTS)
  ↓
Recorder.start()
  ↓
App.onPlaybackFinished()
  ↓
WebSocketClient.sendTtsPlayEnded()
  ↓
SessionManager.setPlaybackFinishedTimestamp()
```

---

**文档版本**：1.0  
**最后更新**：2026-01-15  
**作者**：AI Assistant
