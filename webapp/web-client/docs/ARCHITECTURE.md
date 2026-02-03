# Web 客户端架构设计

## 概述

Web 客户端负责音频采集、与调度服务器通信、翻译结果展示与 TTS 播放。文档按模块分布在各自目录的 `docs/` 下，此处为整体架构与数据流概览。

## 目录与模块

| 路径 | 职责 |
|------|------|
| `src/app.ts` | 主应用：整合 StateMachine、Recorder、WebSocketClient、TtsPlayer、SessionManager、AppPlayback 等 |
| `src/state_machine.ts` | 会话状态：INPUT_READY / INPUT_RECORDING / PLAYING_TTS |
| `src/recorder.ts` | 麦克风采集、VAD 静音过滤、音频帧回调 |
| `src/websocket_client.ts` | WebSocket 入口，聚合连接、消息、背压、音频发送 |
| `src/tts_player.ts` | TTS 缓冲、解码、播放、倍速、内存监控 |
| `src/app/` | 会话管理、播放控制、消息处理、翻译显示、状态回调、房间与 WebRTC |
| `src/websocket/` | 连接管理、消息解析、背压、音频发送 |
| `src/tts_player/` | 内存管理、解码辅助 |
| `src/ui/` | 主菜单、会话模式、房间模式界面 |
| `src/audio_codec/` | PCM16/Opus 编解码 |

各模块详细说明见：`src/<模块>/docs/README.md`（如 `src/app/docs/README.md`）。

## 状态机

- **INPUT_READY**：未开始会话。
- **INPUT_RECORDING**：录音中，VAD 过滤静音，可发送 finalize；有 TTS 时可点击播放。
- **PLAYING_TTS**：播放 TTS 中，麦克风关闭；播放结束或暂停后回到 INPUT_RECORDING。

定义在 `src/types.ts`（`SessionState`），实现在 `src/state_machine.ts`。

## 数据流概览

1. **上行**：Recorder（VAD 后）→ 编码（audio_codec）→ WebSocketClient（AudioSender，受背压控制）→ 调度服务器。
2. **下行**：服务器 → WebSocket MessageHandler 解析 → App 消息处理（translation_result、asr_partial、ui_event 等）→ 翻译显示、TtsPlayer 缓冲与播放。
3. **会话**：连接后 session_init → session_init_ack；audio_chunk 带 session_id；finalize 触发调度端 end 当前 utterance。

## 音频与协议要点

- **采集**：16kHz 单声道，VAD 在 Recorder 中（RMS + Attack/Release），仅有效语音触发回调。
- **编码**：支持 PCM16 或 Opus，由 `AudioCodecConfig` 与 `createAudioEncoder` 配置；Session Init 不携带音频格式字段。
- **播放**：TTS 为 base64，解码为 Float32Array 后经 AudioContext 播放；AudioContext 需在用户手势下创建/恢复（如 startSession 时 prepareAudioContext）。

## 配置与调试

- 默认调度地址等见 `src/types.ts` 的 `DEFAULT_CONFIG`。
- 静音阈值等 VAD 参数在 `src/recorder.ts` 中配置。
- 日志：关键路径使用 `logger`；浏览器控制台可查看；`window.logHelper.exportLogs()` 或 URL 参数 `?logAutoSave=true` 可导出日志。翻译不显示、无声音等排查见 `src/app/docs/README.md` 的调试要点。

## 文档索引

- [App 层](src/app/docs/README.md) — 会话、播放、消息处理、翻译显示、VAD 与调试
- [WebSocket](src/websocket/docs/README.md) — 连接、背压、Session Init、与调度兼容
- [TTS 播放器](src/tts_player/docs/README.md) — 缓冲、解码、内存
- [UI](src/ui/docs/README.md) — 主菜单、会话模式、房间模式
- [音频编解码](src/audio_codec/docs/README.md) — PCM16/Opus 与协议
