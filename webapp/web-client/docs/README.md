# Web 客户端文档

文档按模块放在各自源码目录的 `docs/` 下，根目录仅保留本索引与整体架构说明。

## 文档索引

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 整体架构、状态机、数据流与文档入口 |
| [src/app/docs/README.md](../src/app/docs/README.md) | 会话管理、播放控制、消息处理、翻译显示、VAD、调试 |
| [src/websocket/docs/README.md](../src/websocket/docs/README.md) | 连接、背压、Session Init、与调度服务器兼容 |
| [src/tts_player/docs/README.md](../src/tts_player/docs/README.md) | TTS 播放、缓冲、解码、内存管理 |
| [src/ui/docs/README.md](../src/ui/docs/README.md) | 主菜单、会话模式、房间模式 UI |
| [src/audio_codec/docs/README.md](../src/audio_codec/docs/README.md) | PCM16/Opus 编解码与协议 |

## 快速导航

- **了解整体**：先读 [ARCHITECTURE.md](./ARCHITECTURE.md)。
- **改会话/播放/显示**：看 [src/app/docs/README.md](../src/app/docs/README.md)。
- **改连接/背压/协议**：看 [src/websocket/docs/README.md](../src/websocket/docs/README.md)。
- **排查问题**：见 [src/app/docs/README.md](../src/app/docs/README.md) 中的「调试要点」与日志说明。
