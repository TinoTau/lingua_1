# 音频编解码模块文档

上行编码（麦克风→服务器）与下行解码（TTS→播放）。对应目录 `src/audio_codec/` 与入口 `src/audio_codec.ts`。

## 模块与职责

| 文件 | 职责 |
|------|------|
| `types.ts` | `AudioCodecConfig`、`AudioEncoder`、`AudioDecoder` 等接口定义 |
| `pcm16_codec.ts` | PCM16 编码/解码（Int16 ↔ Float32，base64） |
| `opus_codec.ts` | Opus 编码/解码（基于浏览器/Worker 或 libopus）；编码可选码率等 |
| `audio_codec.ts`（根） | `createAudioEncoder(config)`、`createAudioDecoder(config)`、`isOpusSupported()` |

## 配置与使用

- **配置**：`AudioCodecConfig` 含 `codec: 'pcm16' | 'opus'`、`sampleRate`、`channelCount`、`frameSizeMs`、`application`（voip 等）、`bitrate`（Opus）等。由 App/WebSocketClient 在初始化时设置（如 16kHz、单声道、opus）。
- **上行**：WebSocket 的 MessageHandler 持有一个 `AudioEncoder`，对采集到的音频帧编码后通过 AudioSender 发送；格式与 session_init 解耦，调度端按约定解析。
- **下行**：TtsPlayer 收到 base64 的 TTS 时，用 `createAudioDecoder(config)` 得到的 `AudioDecoder` 解码为 Float32Array 再播放。

## 与协议的关系

- Session Init 消息中**不**携带 `audio_format`、`sample_rate`、`preferred_codec` 等（调度端不解析）；编解码能力由客户端配置决定，服务器按约定格式收发即可。
- 若未来服务端在 session_init_ack 中返回协商 codec，客户端可据此切换 `AudioCodecConfig` 并重建 encoder/decoder。
