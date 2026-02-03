# WebSocket 模块文档

连接管理、消息处理、背压与音频发送。对应目录 `src/websocket/`。

## 模块与职责

| 文件 | 职责 |
|------|------|
| `connection_manager.ts` | WebSocket 连接建立、重连、心跳、发送封装 |
| `message_handler.ts` | 收包解析（string/Blob/ArrayBuffer 转 JSON）、session_init_ack、背压消息、协议协商、转发 App 回调 |
| `backpressure_manager.ts` | 背压状态（NORMAL/BUSY/PAUSED/SLOW_DOWN）、发送队列、去抖与自动恢复 |
| `audio_sender.ts` | 编码后音频发送、受背压策略控制（间隔/排队/丢弃） |
| `connect_handlers.ts` | 组装 onOpen/onMessage/onClose 回调，连接 MessageHandler 与 ConnectionManager |

入口与对外 API 在 `src/websocket_client.ts`：`WebSocketClient` 聚合上述模块，对外提供 `doConnect`、`sendAudioChunk`、`setMessageCallback`、`setBackpressureStateCallback` 等。

## 背压机制

- **状态**：`BackpressureState`（`backpressure_manager.ts`）— NORMAL、BUSY、PAUSED、SLOW_DOWN。
- **消息**：服务器下发 `type: 'backpressure'`，`action: 'BUSY' | 'PAUSE' | 'SLOW_DOWN'`，可选 `resume_after_ms`。
- **行为**：NORMAL 直接发；BUSY/SLOW_DOWN 降速（如 500ms 间隔）排队发送；PAUSED 时非结束帧丢弃，结束帧入队，到期或恢复后发送。去抖（如 500ms）避免频繁切换。
- **回调**：`setBackpressureStateCallback` 用于 UI 显示“服务端繁忙”等。
- **清理**：断线时清空队列、重置状态。

## Session Init 与协议

- **session_init**：客户端发送 `SessionInitMessage`（`types.ts`）：`client_version`、`platform`、`src_lang`、`tgt_lang`、`dialect`、`features`、`pairing_code`、`mode`、`lang_a`/`lang_b`（双向）、`trace_id`、`tenant_id` 等。不在 session_init 里带音频格式/采样率/编解码（调度端不解析）。
- **session_init_ack**：服务器返回 `session_id`、`trace_id` 等；客户端保存 `sessionId`，后续 `audio_chunk` 等消息需带 `session_id`。
- **协议协商**：若 ack 中带编解码或能力字段，MessageHandler 可设置 `negotiatedCodec`（如 opus）；音频编码由 `AudioCodecConfig` 与 `createAudioEncoder` 在客户端配置，与 session_init 解耦。

## 与调度服务器的兼容

- **audio_chunk**：必须包含 `session_id`（与 session_init_ack 一致），否则调度端无法关联会话。
- **session_init_ack**：客户端类型需包含 `trace_id` 等字段以便日志与追踪。
- **消息体**：支持文本 JSON 与二进制（若使用 binary frame）；MessageHandler 将 Blob/ArrayBuffer 转为字符串再解析，确保 translation_result 等可正常解析。

## 消息流简述

1. 连接建立 → 发送 session_init → 收到 session_init_ack → 设置 sessionId，可选协商 codec。
2. 上行：音频经编码 → AudioSender → 背压策略决定立即发送或入队/丢弃。
3. 下行：onMessage → MessageHandler 解析 → 按 type 处理（背压、session_init_ack、translation_result、ui_event、server_heartbeat 等）→ 转发 App 回调。
4. 断线/重连：ConnectionManager 负责重连；重连后需重新 session_init，背压与发送队列在断开时清理。
