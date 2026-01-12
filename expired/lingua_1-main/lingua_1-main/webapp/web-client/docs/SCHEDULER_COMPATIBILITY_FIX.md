# Web-Client 与调度服务器兼容性修复

## 问题概述

在检查 web-client 与改造后的调度服务器（Phase2/Phase3）的兼容性时，发现了几个消息格式不匹配的问题。

## 发现的问题

### 1. `audio_chunk` 消息缺少 `session_id` 字段

**问题描述**：
- Web-client 发送的 `audio_chunk` 消息不包含 `session_id` 字段
- 调度服务器期望 `audio_chunk` 消息必须包含 `session_id` 字段

**影响**：
- 服务器无法正确解析 `audio_chunk` 消息
- 可能导致消息处理失败或会话无法正常工作

**修复内容**：
- 更新 `AudioChunkMessage` 类型定义，添加 `session_id: string` 字段
- 修改 `sendAudioChunk()` 方法，在发送消息时包含 `session_id`
- 修改 `sendFinal()` 方法，在发送结束帧时也包含 `session_id`

### 2. `session_init_ack` 消息缺少 `trace_id` 字段

**问题描述**：
- Web-client 的 `SessionInitAckMessage` 类型定义中缺少 `trace_id` 字段
- 调度服务器返回的 `session_init_ack` 消息包含 `trace_id` 字段（用于全链路追踪）

**影响**：
- 虽然不会导致解析错误（JSON 会忽略未知字段），但客户端无法获取 `trace_id` 用于追踪

**修复内容**：
- 更新 `SessionInitAckMessage` 类型定义，添加 `trace_id: string` 字段

## 修复的文件

1. `webapp/web-client/src/types.ts`
   - 更新 `AudioChunkMessage` 接口，添加 `session_id` 字段
   - 更新 `SessionInitAckMessage` 接口，添加 `trace_id` 字段

2. `webapp/web-client/src/websocket_client.ts`
   - 修改 `sendAudioChunk()` 方法，在消息中包含 `session_id`
   - 修改 `sendFinal()` 方法，在消息中包含 `session_id` 并添加连接检查

## 消息格式对比

### `audio_chunk` 消息（修复后）

**客户端发送**：
```typescript
{
  type: 'audio_chunk',
  session_id: string,  // ✅ 已添加
  seq: number,
  is_final: boolean,
  payload?: string
}
```

**服务器期望**：
```rust
AudioChunk {
    session_id: String,  // ✅ 匹配
    seq: u64,
    is_final: bool,
    payload: Option<String>
}
```

### `session_init_ack` 消息（修复后）

**服务器发送**：
```rust
SessionInitAck {
    session_id: String,
    assigned_node_id: Option<String>,
    message: String,
    trace_id: String  // ✅ 已添加
}
```

**客户端接收**：
```typescript
{
  type: 'session_init_ack',
  session_id: string,
  assigned_node_id: string | null,
  message: string,
  trace_id: string  // ✅ 已添加
}
```

## 验证建议

1. **连接测试**：
   - 启动调度服务器
   - 启动 web-client
   - 验证 WebSocket 连接是否成功建立
   - 验证 `session_init_ack` 消息是否正常接收

2. **音频传输测试**：
   - 发送音频块（`audio_chunk`）
   - 验证服务器是否能正确解析消息
   - 验证翻译结果是否正常返回

3. **双向模式测试**：
   - 测试双向翻译模式
   - 验证所有消息格式是否匹配

## Phase2/Phase3 兼容性说明

Phase2/Phase3 的改动主要涉及：
- 多实例支持（横向扩展）
- Redis 状态管理
- 跨实例消息路由

**重要**：这些改动**没有改变 WebSocket 消息协议**，只是修复了 web-client 中原本就存在的消息格式不匹配问题。

## 相关文档

- 调度服务器消息协议：`central_server/scheduler/src/messages/session.rs`
- Phase2 实现文档：`central_server/scheduler/docs/phase2_implementation.md`
- Web-client 快速开始：`webapp/docs/QUICK_START.md`

