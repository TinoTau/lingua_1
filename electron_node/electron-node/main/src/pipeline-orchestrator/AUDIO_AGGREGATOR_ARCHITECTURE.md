# AudioAggregator 架构设计

## 概述

`AudioAggregator` 负责在 ASR 之前聚合音频，根据不同的 finalize 标识（`is_manual_cut`、`is_timeout_triggered`）决定何时将音频发送给 ASR 处理。

## 核心功能

1. **音频聚合**：将多个音频块聚合成完整句子
2. **流式切分**：长音频按能量切分，组合成 ~5 秒批次发送给 ASR
3. **Session 隔离**：使用 `sessionId` 作为 key，确保不同 session 的缓冲区完全隔离
4. **Session Affinity**：超时 finalize 时记录 `sessionId->nodeId` 映射

## 依赖注入设计

### 为什么使用依赖注入而不是单例？

1. **支持热插拔**：每次 `InferenceService` 创建时都会创建新的 `AudioAggregator` 实例，状态干净
2. **便于测试**：可以轻松注入 mock 实例，测试隔离更好
3. **依赖关系清晰**：通过 `ServicesBundle` 显式传递依赖

### 实现方式

```typescript
// InferenceService 中创建实例
const audioAggregator = new AudioAggregator();
this.servicesBundle = {
  // ...
  audioAggregator: audioAggregator,
};

// asr-step.ts 中使用
const audioAggregator = services.audioAggregator;
```

## Buffer Key 与隔离机制（与 turn_id 合并方案一致）

缓冲区的 key **不是** sessionId，而是由 `buildBufferKey(job)` 决定：

- **有 turn_id 时**：`mergeKey = turnId + targetLang`（同一 turn、同一目标语言共用一个 buffer）
- **无 turn_id 时**：退化为 `job_id`（与原先「每 job 独立」一致）

```typescript
// audio-aggregator-buffer-key.ts
export function buildBufferKey(job: JobAssignMessage): string {
  if (job.turn_id && job.tgt_lang) {
    return `${job.turn_id}|${job.tgt_lang}`;
  }
  return job.job_id;
}
```

**与原先文档的差异**：原先本文档描述为「按 sessionId 隔离」；当前实现按 **turn_id + tgt_lang** 合并，同一 session 内不同 turn 的 buffer 相互隔离，同一 turn 内多 job 共享同一 buffer。详见《节点端 turnId 合并技术方案（补充冻结版）》。

## 缓冲区管理

### 缓冲区状态

- `audioChunks`: 当前累积的音频块
- `pendingTimeoutAudio`: 超时 finalize 的音频缓存（等待下一个 job 合并）
- `pendingSmallSegments`: 小片段缓存（<5秒），等待合并成 ≥5秒批次

### 清理机制

1. **自动清理**：调用 `cleanupExpiredBuffers()` 清理过期缓冲区
   - `pendingTimeoutAudio` 超过 TTL 的 2 倍
   - 缓冲区空闲超过 5 分钟

2. **手动清理**：调用 `clearBuffer(sessionId)` 清空指定 session 的缓冲区

## 处理流程

### 1. 超时 Finalize (`is_timeout_triggered`)

```
音频块 → 缓存到 pendingTimeoutAudio → 等待下一个 job 合并
```

- 如果 10 秒内没有手动 cut，强制处理
- 记录 `sessionId->nodeId` 映射（用于 session affinity）

### 2. 手动/Timeout Finalize (`is_manual_cut` 或 `is_timeout_triggered`)

```
音频块 → 合并 pendingTimeoutAudio（如果有）→ 按能量切分 → 发送给 ASR
```

- 立即处理，不等待
- 清除 session affinity 映射（可以随机分配）

### 3. 流式切分

- 长音频按能量切分（最大 10 秒，最小 2 秒）
- 组合成 ~5 秒批次发送给 ASR
- 剩余小片段缓存到 `pendingSmallSegments`

## 内存管理

### 防止内存泄漏

1. **定期清理**：建议在应用启动时启动定期清理任务
2. **Turn 失败 / 会话结束清理**：按 `clearBufferByKey(bufferKey)` 清理对应 buffer（同一 session 下可有多个 bufferKey，即多个 turn）
3. **TTL 机制**：`pendingTimeoutAudio` 有 10 秒 TTL，超时自动处理

### 清理示例

```typescript
// 定期清理（每 5 分钟）
setInterval(() => {
  audioAggregator.cleanupExpiredBuffers();
}, 5 * 60 * 1000);
```

## 测试

### 单元测试

测试使用 `new AudioAggregator()` 创建实例，确保测试隔离：

```typescript
beforeEach(() => {
  aggregator = new AudioAggregator();
});

afterEach(() => {
  // 按 bufferKey 清理（测试中可用 buildBufferKey(job) 或任意 key）
  aggregator.clearBufferByKey('test-turn-1|en');
  aggregator.clearBufferByKey('test-turn-2|en');
});
```

## 相关文档

- `session-affinity-manager.ts`: Session Affinity 管理器
