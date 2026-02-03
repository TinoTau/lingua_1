# App 层文档

会话管理、播放控制、消息处理、翻译显示与状态机联动。对应目录 `src/app/`。

## 模块与职责

| 文件 | 职责 |
|------|------|
| `session_manager.ts` | 会话生命周期、音频块切分与发送、finalize 触发 |
| `playback.ts` | TTS 播放控制（开始/暂停/倍速）、播放索引与 UI 联动 |
| `message_handler.ts` | 服务器消息分发与处理（translation_result、asr_partial、ui_event 等） |
| `translation_display.ts` | 翻译结果缓存、去重、按 utterance_index 显示与待显示队列 |
| `state_callbacks.ts` | 状态变化时的录音/播放/UI 联动 |
| `init_callbacks.ts` | 连接、消息、状态等回调注册与上下文 |
| `room_manager.ts` | 房间模式下的房间与成员管理 |
| `room_tts.ts` | 房间模式下 TTS 送入混音器 |
| `webrtc_manager.ts` | WebRTC 连接与信令 |

## 状态机

- **INPUT_READY**：未开始会话，等待用户操作。
- **INPUT_RECORDING**：会话进行中，录音中，VAD 过滤静音，只发送有效语音；可手动发送 finalize。
- **PLAYING_TTS**：正在播放 TTS，麦克风关闭，播放完成后可回到 INPUT_RECORDING。

状态机定义在 `src/types.ts`（`SessionState`），实现在 `src/state_machine.ts`。`notifyUIUpdate()` 用于在状态不变时触发 UI 更新（如 TTS 缓冲更新后刷新播放按钮）。

## 会话与 VAD

- **开始会话**：`SessionManager.startSession()` → 创建 AudioContext（用户手势下）、清空显示与缓冲、状态切到 INPUT_RECORDING、启动录音。
- **VAD**：在 `src/recorder.ts` 中做静音过滤（RMS 阈值、Attack/Release 帧数），只有有效语音触发 `audioFrameCallback`，静音不发送。
- **发送 finalize**：`SessionManager.sendCurrentUtterance()` 发送 `is_final: true` 的 audio_chunk，触发调度端 finalize 已累积音频。
- **结束会话**：停止录音、停止播放并清空 TtsPlayer 缓冲、清空 WebSocket 发送队列与待显示/已显示翻译结果，状态回到 INPUT_READY。

## 翻译结果与显示

- **收到 translation_result**：`message_handler` 分支中保存到 `TranslationDisplayManager`（按 `utterance_index`），添加 TTS 到 `TtsPlayer`，可选“立即显示”或“播放时按索引显示”。
- **手动播放模式**：用户点击播放 → `AppPlayback.startTtsPlayback()` → `displayPendingTranslationResults()` 先刷出待显示文本，再 `ttsPlayer.startPlayback()`。
- **去重**：`TranslationDisplayManager` 用 `isDisplayed()` 等避免同一 utterance 重复显示。

## 播放与 UI 联动

- **TTS 可用**：`message_handler` 在添加完音频后调用 `notifyTtsAudioAvailable()`，触发主界面启用播放按钮并显示时长。
- **播放索引**：`TtsPlayer` 播放时通过回调通知当前 `utteranceIndex`，可用于高亮或同步显示（若采用“播放时显示”策略）。
- **倍速 / 暂停**：由 `AppPlayback` 委托 `ttsPlayer`，UI 在 `session_mode` 等处绑定播放、暂停、倍速按钮。

## 内存与自动播放

- **内存压力**：由 `tts_player` 侧的内存检查产生（Performance API 或缓冲时长占比），通过回调上报 `normal` / `warning` / `critical`。
- **App 侧行为**：在 `critical` 且处于 INPUT_RECORDING、有待播放且未在播放时，可自动调用 `startTtsPlayback()` 以释放缓冲；UI 可在 `warning` 时对播放按钮做闪烁等提示。具体逻辑见 `app/playback.ts` 与 `init_callbacks` 中的内存回调注册。

## 调试要点

- **翻译不显示**：在浏览器 Console 看是否出现 `[MessageHandler] 收到 translation_result`、`[App] 收到服务器消息回调`（type: translation_result）、以及 message_handler 中 translation_result 分支的日志；若会话已结束会丢弃结果。
- **播放无声音**：确认用户手势下已创建/恢复 AudioContext（startSession 时 `ttsPlayer.prepareAudioContext()`）；检查 TtsPlayer 是否真的 `addAudioChunk` 成功并 `startPlayback()`。
- **日志**：关键路径已使用 `logger`，可通过 `window.logHelper.exportLogs()` 或 URL 参数 `?logAutoSave=true` 导出日志便于排查。

## 依赖关系

- App 层依赖：`state_machine`、`recorder`、`websocket_client`、`tts_player`、`asr_subtitle`、`audio_mixer`、`types`。
- `playback.ts` 通过 deps 注入 `sessionManager`、`stateMachine`、`ttsPlayer`、`translationDisplay.displayPendingTranslationResults` 等，由 `app.ts` 构造时传入。
