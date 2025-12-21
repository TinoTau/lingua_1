# Session Init 协议与 Opus 编码兼容性分析

## 分析时间
2025年1月

## 1. Session Init 协议字段分析

### 1.1 Scheduler 支持的字段

根据 `central_server/scheduler/src/messages/session.rs`，Scheduler 的 `SessionInit` 消息支持以下字段：

```rust
SessionInit {
    client_version: String,
    platform: String,
    src_lang: String,
    tgt_lang: String,
    dialect: Option<String>,
    features: Option<FeatureFlags>,
    pairing_code: Option<String>,
    tenant_id: Option<String>,              // ✅ 已支持
    mode: Option<String>,
    lang_a: Option<String>,
    lang_b: Option<String>,
    auto_langs: Option<Vec<String>>,
    enable_streaming_asr: Option<bool>,     // ✅ 已支持（但不需要实现）
    partial_update_interval_ms: Option<u64>, // ✅ 已支持（但不需要实现）
    trace_id: Option<String>,               // ✅ 已支持
}
```

### 1.2 Web Client 当前字段

根据 `webapp/web-client/src/types.ts`，Web Client 的 `SessionInitMessage` 包含：

```typescript
SessionInitMessage {
    // ... 基础字段 ...
    audio_format: string;        // ⚠️ Scheduler 不支持（只在 Utterance 中使用）
    sample_rate: number;         // ⚠️ Scheduler 不支持（只在 Utterance 中使用）
    channel_count: number;       // ⚠️ Scheduler 不支持（只在 Utterance 中使用）
    protocol_version?: string;  // ⚠️ Scheduler 不支持
    supports_binary_frame?: boolean; // ⚠️ Scheduler 不支持
    preferred_codec?: string;    // ⚠️ Scheduler 不支持
    // ... 其他字段 ...
    trace_id?: string;           // ❌ 缺失（需要添加）
    tenant_id?: string | null;   // ❌ 缺失（可选，需要添加）
}
```

### 1.3 已实现的字段 ✅

根据分析，**已实现以下字段**：

1. **`trace_id?: string`** ✅ **已实现**
   - ✅ Scheduler 已支持
   - ✅ 客户端自动生成 UUID v4
   - ✅ 用于可观测性和追踪
   - ✅ 如果客户端不提供，Scheduler 会生成并回传
   - ✅ 单元测试全部通过

2. **`tenant_id?: string | null`** ✅ **已实现**
   - ✅ Scheduler 已支持
   - ✅ 支持通过 `setTenantId()` 方法设置
   - ✅ 用于多租户场景
   - ✅ 如果不需要多租户支持，可以忽略
   - ✅ 单元测试全部通过

### 1.4 不需要实现的字段

以下字段**不需要实现**（用户已确认）：

- `enable_streaming_asr?: boolean` - 不需要流式 ASR
- `partial_update_interval_ms?: number` - 不需要流式 ASR

### 1.5 已移除的字段 ✅

以下字段**已从 SessionInit 消息中移除**（Scheduler 不支持）：

- ✅ `audio_format` - 已移除（只在 `Utterance` 消息中使用）
- ✅ `sample_rate` - 已移除（只在 `Utterance` 消息中使用）
- ✅ `channel_count` - 已移除（只在 `Utterance` 消息中使用）
- ✅ `protocol_version` - 已移除（Scheduler 不支持）
- ✅ `supports_binary_frame` - 已移除（Scheduler 不支持）
- ✅ `preferred_codec` - 已移除（Scheduler 不支持）

**状态**: ✅ 这些字段已从实际发送的 `SessionInitMessage` 中移除，确保与 Scheduler 兼容。

## 2. Opus 编码兼容性分析

### 2.1 当前系统状态

1. **Scheduler**：
   - 在 `Utterance` 消息中使用 `audio_format` 字段
   - 目前测试中都是使用 `"pcm16"`
   - 没有对 `"opus"` 格式的特殊处理
   - **结论**：Scheduler 只是传递 `audio_format` 字段，不做格式验证或转换

2. **Node 端**：
   - 在 `JobAssign` 消息中接收 `audio_format` 字段
   - 目前文档和测试中都是使用 `"pcm16"`
   - 没有找到对 Opus 解码的特殊处理代码
   - **结论**：需要确认 Node 端是否支持 Opus 解码

### 2.2 Opus 编码使用场景 ✅

**Web Client → Scheduler**：
- ✅ 使用 `audio_chunk` 消息（Binary Frame 协议）或 `Utterance` 消息
- ✅ 如果使用 Opus 编码，需要在 `Utterance` 消息的 `audio_format` 字段中指定 `"opus"`
- ✅ 音频数据仍然是 base64 编码的 Opus 帧

**Scheduler → Node**：
- ✅ 使用 `JobAssign` 消息
- ✅ `audio_format` 字段会传递给 Node
- ✅ Node 已支持 Opus 解码（使用 `opus-rs`）

**Node → Scheduler → Web Client**：
- ✅ TTS 音频仍然是 PCM16 格式（base64 编码）
- ✅ Web Client 使用 `OpusDecoder` 解码（如果需要）

### 2.3 兼容性结论 ✅

**✅ Opus 编码与 Scheduler 兼容**：
- ✅ Scheduler 只是传递 `audio_format` 字段，不做格式验证
- ✅ Node 端已支持 Opus 解码（使用 `opus-rs`）
- ✅ Web Client 端已实现 Opus 编码/解码（使用 `@minceraftmc/opus-encoder` 和 `opus-decoder`）

**✅ 实现状态**：
- ✅ Node 端已支持 Opus 解码
- ✅ Web Client 端已实现 Opus 编码/解码
- ✅ 往返编码/解码测试全部通过
- ✅ HTTP/WebSocket 接口中的 Opus 解码集成测试全部通过

## 3. 实现状态 ✅

### 3.1 Session Init 协议增强 ✅

**已实现**：
1. ✅ `trace_id?: string` - 用于追踪（自动生成 UUID v4）
2. ✅ `tenant_id?: string | null` - 可选，用于多租户（支持通过 `setTenantId()` 设置）

**已移除**（从实际发送的消息中）：
- ✅ `audio_format` - 已移除（不应该在 SessionInit 中发送）
- ✅ `sample_rate` - 已移除（不应该在 SessionInit 中发送）
- ✅ `channel_count` - 已移除（不应该在 SessionInit 中发送）
- ✅ `protocol_version` - 已移除（Scheduler 不支持）
- ✅ `supports_binary_frame` - 已移除（Scheduler 不支持）
- ✅ `preferred_codec` - 已移除（Scheduler 不支持）

**测试结果**：
- Web Client 端: 5/5 测试通过 ✅
- Scheduler 端: 6/6 测试通过 ✅

### 3.2 Opus 编码使用 ✅

**实现状态**：
- ✅ Web Client 已实现 Opus 编码/解码（使用 `@minceraftmc/opus-encoder` 和 `opus-decoder`）
- ✅ Node 端已支持 Opus 解码（使用 `opus-rs`）
- ✅ HTTP/WebSocket 接口中的 Opus 解码集成
- ✅ 往返编码/解码测试全部通过

**测试结果**：
- Web Client 端: 5/5 测试通过 ✅
- Node 端: 17/17 测试通过 ✅（包括往返编码/解码测试）

## 4. 总结 ✅

### Session Init 协议增强 ✅

**已实现**：
- ✅ `trace_id?: string` - 用于追踪（自动生成 UUID v4）
- ✅ `tenant_id?: string | null` - 可选，用于多租户（支持通过 `setTenantId()` 设置）

**已移除**：
- ✅ `audio_format`, `sample_rate`, `channel_count` - 已从 SessionInit 消息中移除（这些字段只在 Utterance 中使用）
- ✅ `protocol_version`, `supports_binary_frame`, `preferred_codec` - 已移除（Scheduler 不支持）

**测试结果**：
- Web Client 端: 5/5 测试通过 ✅
- Scheduler 端: 6/6 测试通过 ✅

### Opus 编码兼容性 ✅

**实现状态**：
- ✅ Opus 编码与 Scheduler 兼容（Scheduler 只是传递字段）
- ✅ Node 端已支持 Opus 解码（使用 `opus-rs`）
- ✅ Web Client 已实现 Opus 编码/解码功能（使用 `@minceraftmc/opus-encoder` 和 `opus-decoder`）
- ✅ 往返编码/解码测试全部通过

**测试结果**：
- Web Client 端: 5/5 测试通过 ✅
- Node 端: 17/17 测试通过 ✅（包括往返编码/解码测试）

**相关文档**：
- [Phase 3 测试完成报告](../../../docs/PHASE3_TESTING_COMPLETE_FINAL.md)
- [Session Init 协议增强文档](./SESSION_INIT_PROTOCOL_ENHANCEMENT.md)

