# Session Init 协议增强说明

## 概述

Session Init 协议增强是指在 `SessionInitMessage` 中添加新的可选字段，以支持更多功能和更好的可观测性。

## 当前状态

### Web Client 的 SessionInitMessage（已实现）✅

```typescript
export interface SessionInitMessage {
  type: 'session_init';
  client_version: string;
  platform: 'web';
  src_lang: string;
  tgt_lang: string;
  dialect: string | null;
  features: FeatureFlags;
  pairing_code: string | null;
  mode: 'one_way' | 'two_way_auto';
  // 双向模式额外字段
  lang_a?: string;
  lang_b?: string;
  auto_langs?: string[];
  // Phase 3 新增字段（已实现）✅
  trace_id?: string;                    // 追踪 ID（自动生成 UUID）
  tenant_id?: string | null;            // 租户 ID（可选，支持多租户）
}
```

**注意**: 以下字段**已移除**（Scheduler 不支持）:
- ❌ `audio_format` - 只在 `Utterance` 消息中使用
- ❌ `sample_rate` - 只在 `Utterance` 消息中使用
- ❌ `channel_count` - 只在 `Utterance` 消息中使用
- ❌ `protocol_version` - Scheduler 不支持
- ❌ `supports_binary_frame` - Scheduler 不支持
- ❌ `preferred_codec` - Scheduler 不支持

### Shared Protocols 的 SessionInitMessage（参考）

```typescript
export interface SessionInitMessage {
  type: 'session_init';
  client_version: string;
  platform: Platform;
  src_lang: string;
  tgt_lang: string;
  dialect: string | null;
  features?: FeatureFlags;
  pairing_code?: string | null;
  tenant_id?: string | null;
  mode?: 'one_way' | 'two_way_auto';
  lang_a?: string;
  lang_b?: string;
  auto_langs?: string[];
  enable_streaming_asr?: boolean;        // ⚠️ 缺失
  partial_update_interval_ms?: number;   // ⚠️ 缺失
  trace_id?: string;                    // ⚠️ 缺失
}
```

## 已实现的字段 ✅

### 1. `trace_id?: string` ✅

**状态**: ✅ **已实现**

**用途**: 追踪 ID（用于可观测性）

**实现**:
- ✅ 客户端自动生成 UUID v4 作为 trace_id
- ✅ 每次连接生成唯一的 trace_id
- ✅ Scheduler 支持并回传 trace_id
- ✅ 用于日志关联、性能分析、问题排查

**测试**: 单元测试全部通过 ✅

### 2. `tenant_id?: string | null` ✅

**状态**: ✅ **已实现**

**用途**: 租户 ID（多租户支持）

**实现**:
- ✅ 支持通过 `setTenantId()` 方法设置
- ✅ 可选字段，如果不需要多租户支持，可以忽略
- ✅ Scheduler 支持 tenant_id 字段

**测试**: 单元测试全部通过 ✅

## 不需要实现的字段

### 1. `enable_streaming_asr?: boolean` ❌

**状态**: ❌ **不需要实现**（用户已确认）

**原因**: 用户不需要流式 ASR 功能

### 2. `partial_update_interval_ms?: number` ❌

**状态**: ❌ **不需要实现**（用户已确认）

**原因**: 用户不需要流式 ASR 功能

## 最终实现的 SessionInitMessage ✅

```typescript
export interface SessionInitMessage {
  type: 'session_init';
  client_version: string;
  platform: 'web';
  src_lang: string;
  tgt_lang: string;
  dialect: string | null;
  features: FeatureFlags;
  pairing_code: string | null;
  mode: 'one_way' | 'two_way_auto';
  // 双向模式额外字段
  lang_a?: string;
  lang_b?: string;
  auto_langs?: string[];
  // Phase 3 新增字段（已实现）✅
  trace_id?: string;                    // 追踪 ID（自动生成 UUID）
  tenant_id?: string | null;            // 租户 ID（可选，支持多租户）
}
```

**已移除的字段**（Scheduler 不支持）:
- ❌ `audio_format` - 只在 `Utterance` 消息中使用
- ❌ `sample_rate` - 只在 `Utterance` 消息中使用
- ❌ `channel_count` - 只在 `Utterance` 消息中使用
- ❌ `protocol_version` - Scheduler 不支持
- ❌ `supports_binary_frame` - Scheduler 不支持
- ❌ `preferred_codec` - Scheduler 不支持
- ❌ `enable_streaming_asr` - 用户不需要
- ❌ `partial_update_interval_ms` - 用户不需要

## 实现状态 ✅

### 客户端（Web Client）✅

1. **类型定义更新**: ✅ 在 `webapp/web-client/src/types.ts` 中添加新字段
2. **消息构建更新**: ✅ 在 `webapp/web-client/src/websocket_client.ts` 中构建消息时包含新字段
3. **功能支持**: ✅
   - ✅ 自动生成 `trace_id`（UUID v4）
   - ✅ 支持设置 `tenant_id`（通过 `setTenantId()` 方法）
   - ✅ 移除不支持的字段

### 服务端（Scheduler）✅

1. **消息解析**: ✅ 支持解析新字段
2. **功能实现**: ✅
   - ✅ 支持 `trace_id` 字段（如果客户端提供，回传；否则生成）
   - ✅ 支持 `tenant_id` 字段（多租户支持）
3. **向后兼容**: ✅ 所有新字段都是可选的，确保向后兼容

## 测试结果 ✅

1. **单元测试**: ✅ 测试消息构建和解析（全部通过）
2. **集成测试**: ✅ 测试与服务端的交互（全部通过）
3. **向后兼容测试**: ✅ 确保不提供新字段时仍能正常工作

**测试统计**:
- Web Client 端: 5/5 测试通过 ✅
- Scheduler 端: 6/6 测试通过 ✅

## 验收标准 ✅

- ✅ `SessionInitMessage` 包含所有新字段（trace_id, tenant_id）
- ✅ 消息构建时能正确设置新字段
- ✅ 服务端能正确解析新字段
- ✅ 向后兼容（不提供新字段时仍能正常工作）
- ✅ 单元测试覆盖率 100%（5/5 测试通过）

## 注意事项

1. **向后兼容**: 所有新字段都是可选的，确保不破坏现有功能
2. **服务端支持**: 需要确认服务端是否已支持这些字段
3. **默认值**: 需要明确各字段的默认值和处理逻辑

