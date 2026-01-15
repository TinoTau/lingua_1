# Web 客户端音频处理流程（精简版）

> 本文是 Web 客户端音频处理的**单一权威文档**，已根据当前代码实现（2026-01）更新，去掉了过期描述和冗长调用链，总长度控制在约 500 行以内。  
> 目标读者：需要排查“录音 → 调度服务器 → 节点 → 回放”全链路问题的开发者。

---

## 1. 总体架构与关键模块

### 1.1 模块一览

- **`App`（`src/app.ts`）**  
  - 负责整体会话流程编排：开始/结束会话、控制录音与播放、管理 UI 状态。  
  - 维护 `StateMachine`，监听状态变化并驱动 `Recorder` / `SessionManager` / `TtsPlayer`。

- **`StateMachine`（`src/state_machine.ts`）**  
  - 会话状态：`INPUT_READY` → `INPUT_RECORDING` → `PLAYING_TTS`，支持“单次发送”和“连续会话（Session Mode）”。  
  - 提供 `startSession / endSession / startRecording / stopRecording / startPlaying / finishPlaying` 等原子事件。

- **`Recorder`（`src/recorder.ts`）**  
  - 采集麦克风音频（16kHz 单声道）、做 VAD 静音过滤和平滑（`attackFrames` / `releaseFrames`）。  
  - 保证 `AudioContext` 在每次 `start()` 时都从 `suspended` 恢复为 `running`，避免 `onaudioprocess` 不触发。  
  - 通过 `setAudioFrameCallback` 将经过 VAD 的音频帧推给 `SessionManager`。

- **`SessionManager`（`src/app/session_manager.ts`）**  
  - 维护“当前会话 / 当前 utterance”的状态、音频缓冲和 WebSocket 发送逻辑。  
  - 引入了 **`canSendChunks` + 动态 `framesPerChunk`**：
    - 决定何时允许向调度服务器发送音频 chunk；  
    - 目标 chunk 时长约 **200ms**，与调度服务器 3 秒 pause 检测和 10 秒 MaxDuration 更匹配。

- **`WebSocketClient`（`src/websocket_client.ts`）**  
  - 聚合 `ConnectionManager`、`MessageHandler`、`BackpressureManager`、`AudioSender` 四大子模块。  
  - 负责 Session Init 协议协商（Phase 1/2）、双工消息处理与背压响应。  
  - 提供 `sendAudioChunk` / `sendFinal` / `sendTtsPlayEnded` 等高层接口给 `SessionManager` 和 `App`。

- **`AudioSender`（`src/websocket/audio_sender.ts`）**  
  - 根据协商结果选择 JSON 或 Binary Frame；  
  - 编码 PCM16/Opus 音频并通过 `BackpressureManager` 控制发送节奏；  
  - 内部持有 `AudioEncoder`，在 `WebSocketClient.disconnect()` 时会被统一关闭并清理。

- **`TtsPlayer`（`src/tts_player.ts` + `tts_player/memory_manager.ts`）**  
  - 解码调度服务器回传的 TTS（PCM16 或 Opus），以 16kHz 在 `AudioContext` 中播放。  
  - 通过 `MemoryManager` 控制最大缓存时长（**默认 25 秒**），在超限时丢弃最旧音频，避免浏览器 OOM。

- **UI 层**  
  - `session_mode.ts` + `session_mode_template.ts`：会话模式 UI 与事件绑定完全分离，模板集中在 `template` 文件中。  
  - 通过 `App` 暴露的方法（`startSession / sendCurrentUtterance / stopSession` 等）驱动业务。

---

## 2. 麦克风 → 调度服务器：录音与发送

### 2.1 录音管线

**流程概览：**

```text
用户说话 → Recorder 采集 (16kHz) → VAD & 平滑过滤 → SessionManager.onAudioFrame
         → (按约 200ms 一包切 chunk) → AudioSender.encode → WebSocket 发送 audio_chunk
```

### 2.2 Recorder 行为（含关键修复）

- 初始化：`Recorder.initialize()`  
  - `getUserMedia({ audio: { sampleRate: 16000, channelCount: 1, … } })`  
  - `AudioContext({ sampleRate: 16000 })`  
  - `ScriptProcessorNode(bufferSize = 4096)` → 每帧约 `4096 / 16000 ≈ 256ms`。

- 启动：`Recorder.start()`  
  - 如果 `audioContext` 或 `mediaStream` 不存在，先初始化。  
  - **如果 `audioContext.state === 'suspended'`，强制 `await audioContext.resume()`**。  
  - 重置 VAD 状态（连续语音/静音帧计数）、设置恢复保护窗口（约 200ms），`isRecording = true`。

- VAD 默认配置（`DEFAULT_SILENCE_FILTER_CONFIG`）：
  - `threshold = 0.015`，`attackFrames = 3`，`releaseFrames = 20`，`windowMs = 100`。  
  - 语音检测需要 **连续 3 帧语音** 才起送，停止发送需要 **连续 20 帧静音**（约 200ms）。  

- `onaudioprocess` 回调：
  - 不录音时直接返回；  
  - 将缓冲数据复制为 `Float32Array`；  
  - 通过 `processSilenceFilter` 判断是否“语音帧”，再触发 `audioFrameCallback(audioData)`。

### 2.3 SessionManager：chunk 切分与发送节奏

#### 2.3.1 发送开关：`canSendChunks`

- 新增字段：

```typescript
private canSendChunks: boolean = true;
private samplesPerFrame: number | null = null;
private framesPerChunk: number = 1;
private readonly TARGET_CHUNK_DURATION_MS = 200;
```

- 行为：
  - TTS 播放期间，以及调度服务器 RestartTimer 触发前：`canSendChunks = false`，**只缓存，不发送**；  
  - `App.onPlaybackFinished()` 发送完 `TTS_PLAY_ENDED` 后：调用 `setCanSendChunks(true)`，**从此刻开始才允许发 chunk**；  
  - `setPlaybackFinishedTimestamp()` 内部会先 `canSendChunks = false`，确保“重启计时器 → 再开始发送”的顺序。

#### 2.3.2 动态 `framesPerChunk`（约 200ms 一包）

- 在收到 **首帧** 时，根据 `audioData.length` 推算帧时长：

```typescript
if (this.samplesPerFrame === null) {
  this.samplesPerFrame = audioData.length;
  const frameDurationMs = this.samplesPerFrame / 16; // 16kHz
  const framesPerChunk = Math.max(
    1,
    Math.round(this.TARGET_CHUNK_DURATION_MS / frameDurationMs)
  );
  this.framesPerChunk = framesPerChunk;
  // 日志中输出 samplesPerFrame / frameDurationMs / framesPerChunk
}
```

- 在当前实现中：`bufferSize = 4096` → `frameDurationMs ≈ 256` → `framesPerChunk = 1`，因此：  
  - **大约每 256ms 发送一个 chunk**，而不是旧逻辑中的“10 帧 ≈ 2.5 秒”一大包。  
  - 这与调度侧 `pause_ms = 3000ms`、`max_duration_ms = 10000ms` 更匹配，避免 3 秒内没有任何 chunk 导致 `Pause Finalize`。

#### 2.3.3 onAudioFrame 主逻辑（简化版）

```typescript
onAudioFrame(audioData: Float32Array) {
  // 仅在状态为 INPUT_RECORDING 且允许发送时处理
  if (!this.getIsSessionActive() || !this.stateMachine.isInputRecording()) return;

  this.audioBuffer.push(audioData);

  // RestartTimer 之前：只缓存不发
  if (!this.canSendChunks) return;

  // 首帧时初始化 framesPerChunk（见上）

  if (this.audioBuffer.length >= this.framesPerChunk) {
    const frames = this.audioBuffer.splice(0, this.framesPerChunk);
    const chunk = this.concatAudioBuffers(frames);
    this.wsClient.sendAudioChunk(chunk, false);
    this.hasSentAudioChunksForCurrentUtterance = true;
  }
}
```

> 单元测试：`tests/app/session_manager_test.ts` 中新增了用例，分别验证  
> - `canSendChunks=false` 时不发送；  
> - `canSendChunks=true` 时按帧长度连续发送，并正确标记 `hasSentAudioChunksForCurrentUtterance`。

---

## 3. 调度服务器 → TTS 播放

### 3.1 消息接收与解码

- `WebSocketClient` 在 `onMessage` 中将服务器消息交给 `MessageHandler`：  
  - 支持 Phase 1（JSON PCM16）与 Phase 2（二进制帧 + Opus/PCM16）；  
  - 解包后生成统一的 TTS 音频块（base64 PCM16 或 Opus packet），交给 `TtsPlayer.addAudioChunk(...)`。

- `TtsPlayer`：
  - 统一在 16kHz 上创建 `AudioContext`，必要时调用 `audioContext.resume()`；  
  - 内部维护 `audioBuffers: Array<{ audio: Float32Array; utteranceIndex: number }>`；  
  - 使用 `MemoryManager` 控制最大总时长，**默认 25 秒**，高于 20 秒以配合自动播放触发阈值。

### 3.2 内存与自动播放

- `MemoryManager`（`tts_player/memory_manager.ts`）：
  - `getMaxBufferDuration()` 默认返回 25 秒；  
  - 当累计缓存接近上限时，丢弃最旧 buffer，并打印详细日志；  
  - 在手机端页面进入后台时，只保留约 30% 缓存，减小内存压力。

- 自动播放与 UI 同步：
  - 当首段 TTS 缓冲达到一定阈值时，`TtsPlayer` 可触发自动播放（具体启用由配置控制）；  
  - 通过 `playbackIndexChangeCallback` 同步当前播放的 `utteranceIndex` 到 UI，高亮对应文本；  
  - 播放完成后调用 `playbackFinishedCallback`，`App.onPlaybackFinished()` 中会：
    - 发送 `TTS_PLAY_ENDED` 给调度服务器（触发 RestartTimer）；  
    - **重启录音并打开 `SessionManager.canSendChunks`**；  
    - 启动“播放结束 → 首帧到达”的监控逻辑，超时则自动尝试恢复 `AudioContext`。

---

## 4. 背压与断线处理（概览）

> 背压实现细节仍在 `BACKPRESSURE_IMPLEMENTATION.md`，这里只保留与音频流程强相关的关键点。

- 调度服务器可发送 `BackpressureMessage`（`BUSY` / `PAUSE` / `SLOW_DOWN`）。  
- `WebSocketClient` 将其交给 `BackpressureManager`，由 `AudioSender` 在发送前查询当前状态：  
  - `PAUSED`：非 final 帧丢弃，final 帧入队，等待恢复后发送；  
  - `BUSY/SLOW_DOWN`：所有帧入队，按较低频率（例如 500ms）发送；  
  - `NORMAL`：直接发送。  
- `WebSocketClient.disconnect()` 时：
  - 调用 `audioSender.setSessionId(null)`、`audioSender.setAudioEncoder(null)`；  
  - 重置发送序列号并清空背压队列，避免残留状态影响下次会话。

---

## 5. 与调度服务器超时逻辑的配合（重要）

### 5.1 调度侧关键参数（当前值）

- `pause_ms = 3000` ms：3 秒静音触发 `Pause Finalize`；  
- `max_duration_ms = 10000` ms：**10 秒最大音频时长触发 `MaxDuration Finalize`**。  

### 5.2 Web 客户端的配合策略

1. **RestartTimer 之前严禁发送 chunk**  
   - 播放 TTS 时 `SessionManager.canSendChunks = false`；  
   - `App.onPlaybackFinished()` 先发送 `TTS_PLAY_ENDED`，让调度服务器重置 `last_chunk_at_ms`，再 `setCanSendChunks(true)` 开始发新语音。

2. **持续输出 chunk，间隔远小于 3 秒**  
   - 以约 256ms/帧的节奏发送音频（或接近 200ms 的动态目标），确保 `record_chunk_and_check_pause` 始终认为“在阈值内”；  
   - 只要用户持续讲话，调度服务器就不会因 pause 而提前 finalize。

3. **对 MaxDuration 的预期**  
   - 当单个 utterance 累计音频时长超过 10 秒时，调度侧会以 `reason = "MaxDuration"` finalize；  
   - 节点端据此进行“最长静音切分 + 尾部拼接”，尽量避免语义被硬切断；  
   - Web 客户端不需要额外逻辑，只需保持稳定 chunk 输出即可。

---

## 6. 调试建议与常见问题

- **症状：TTS 播放后讲话，调度侧 Pause Finalize 过早触发**  
  - 检查前后日志：是否 `TTS_PLAY_ENDED` 已发送、`SessionManager.canSendChunks` 是否在播放结束后及时置为 `true`；  
  - 查看首帧到达延迟：`Recorder` 是否成功 `resume AudioContext`，`onAudioFrame` 是否在 1–2 秒内收到首帧。

- **症状：长句被 MaxDuration 截断**  
  - 这是预期行为（超过 10 秒）；  
  - 节点端会根据 `is_timeout_triggered=true` 做最长静音切分与拼接；  
  - 如需改变阈值，应修改调度服务器 `WebTaskSegmentationConfig.max_duration_ms` 配置。

- **症状：浏览器内存增长过快或卡顿**  
  - 检查 `TtsPlayer` 日志中缓存总时长是否长时间接近 25 秒；  
  - 如必要，可下调 `getMaxBufferDuration()` 的返回值，并同步更新相关单元测试期望。

---

> 如果需要更细节的实现（如 Binary Frame 编码格式、Opus 编解码细节、背压状态机等），请参考：  
> - `BACKPRESSURE_IMPLEMENTATION.md`  
> - `PHASE2_IMPLEMENTATION_SUMMARY.md`  
> - `SESSION_INIT_PROTOCOL_ENHANCEMENT.md`  
> 但本文件应作为排查音频路径问题时的首选入口文档。

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
