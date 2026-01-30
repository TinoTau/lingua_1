# 节点端 Finalize 处理流程

**日期**: 2026-01-24  
**代码位置**: `electron_node/electron-node/main/src/pipeline-orchestrator/`

---

## 一、处理流程概览

### 1.1 三种 Finalize 类型

节点端接收到的 finalize 标识：
1. **手动 finalize** (`isManualCut = true`)
2. **Timeout finalize** (`isTimeoutTriggered = true`)
3. **MaxDuration finalize** (`isMaxDurationTriggered = true`)

### 1.2 处理路径对比

| Finalize 类型 | 处理路径 | 是否直接送入 ASR | 缓存条件 | 等待合并 |
|--------------|---------|----------------|---------|---------|
| **手动 finalize** | `shouldProcessNow` | ✅ 是 | ❌ 不缓存 | ❌ 不等待 |
| **Timeout finalize** | `shouldProcessNow` | ✅ 大部分是 | ⚠️ 短音频（< 1秒）才缓存 | ⚠️ 短音频时等待 |
| **MaxDuration finalize** | 独立路径 | ❌ 否（部分处理） | ✅ 无条件缓存剩余部分 | ✅ 总是等待 |

---

## 二、手动 Finalize 处理流程

### 2.1 处理路径

```
手动 finalize (isManualCut = true)
  ↓
shouldProcessNow = true（因为 isManualCut = true）
  ↓
finalizeHandler.handleFinalize()
  - 如果有 pendingTimeoutAudio，合并它
  - 处理 pendingSmallSegments（如果有）
  ↓
按能量切分音频
  ↓
发送给 ASR
```

### 2.2 特点

- ✅ **直接送入 ASR**（不缓存）
- ✅ 可能会合并之前的 `pendingTimeoutAudio`（如果有）
- ✅ 独立 utterance，不会缓存剩余片段
- ✅ 立即处理，响应快

### 2.3 代码逻辑

**代码位置**: `audio-aggregator.ts:290-298`

```typescript
const shouldProcessNow =
  isManualCut ||  // 手动截断：立即处理
  isTimeoutTriggered ||  // 超时finalize，立即处理
  isMaxDurationTriggered ||  // MaxDuration finalize：立即处理（部分）
  buffer.totalDurationMs >= this.MAX_BUFFER_DURATION_MS ||  // 超过最大缓冲时长（20秒）
  (buffer.totalDurationMs >= this.MIN_AUTO_PROCESS_DURATION_MS && !isTimeoutTriggered && !isMaxDurationTriggered);  // 达到最短自动处理时长（10秒）
```

---

## 三、Timeout Finalize 处理流程

### 3.1 处理路径

```
Timeout finalize (isTimeoutTriggered = true)
  ↓
shouldProcessNow = true（因为 isTimeoutTriggered = true）
  ↓
finalizeHandler.handleFinalize()
  - 如果有 pendingTimeoutAudio，合并它
  - 如果当前音频短（< 1秒）且没有合并，缓存到 pendingTimeoutAudio
  - 处理 pendingSmallSegments（如果有）
  ↓
条件判断：
  - 如果合并了 pendingTimeoutAudio → 按能量切分 → 发送给 ASR
  - 如果缓存了短音频 → 返回空结果，等待下一个 job
  - 否则 → 按能量切分 → 发送给 ASR
```

### 3.2 特点

- ✅ **大部分情况下直接送入 ASR**
- ✅ **特殊情况**：如果音频很短（< 1秒）且没有合并 `pendingTimeoutAudio`，会缓存等待下一个 job
- ✅ 可能会合并之前的 `pendingTimeoutAudio`（如果有）
- ✅ 独立 utterance，不会缓存剩余片段
- ✅ 有 TTL 机制（10 秒），防止短音频一直缓存

### 3.3 缓存逻辑

**代码位置**: `audio-aggregator-finalize-handler.ts`

```typescript
// 2. 如果当前timeout音频短且还没有缓存，保存到pendingTimeoutAudio
// 类似 pause finalize 的逻辑：只缓存短音频（< 1秒）
if (!hasMergedPendingAudio && !buffer.pendingTimeoutAudio && isTimeoutTriggered) {
  const currentDurationMs = (audioToProcess.length / this.BYTES_PER_SAMPLE / this.SAMPLE_RATE) * 1000;
  
  // ✅ 关键：只有短音频（< 1秒）才缓存
  if (currentDurationMs < this.SHORT_AUDIO_THRESHOLD_MS) {
    shouldCachePendingTimeout = true;
  }
}
```

**缓存条件**:
- ✅ 当前音频短（< 1 秒）
- ✅ 没有合并 `pendingTimeoutAudio`
- ✅ 是 Timeout finalize

### 3.4 TTL 机制

**代码位置**: `audio-aggregator-timeout-handler.ts`

```typescript
// 检查 pendingTimeoutAudio 是否超过 TTL（10秒）
const ttlCheckResult = this.checkTimeoutTTL(buffer, job, currentAudio, nowMs);

if (ttlCheckResult && ttlCheckResult.shouldProcess) {
  // 超过 TTL，强制处理 pendingTimeoutAudio
  // ...
}
```

**TTL 机制**:
- ✅ `pendingTimeoutAudio` 有 10 秒 TTL
- ✅ 如果 10 秒内没有新的 job，强制处理 `pendingTimeoutAudio`
- ✅ 作为兜底机制，防止短音频一直缓存

---

## 四、MaxDuration Finalize 处理流程

### 4.1 处理路径

```
MaxDuration finalize (isMaxDurationTriggered = true)
  ↓
独立处理路径（在 shouldProcessNow 之前）
  ↓
maxDurationHandler.handleMaxDurationFinalize()
  - 如果有 pendingTimeoutAudio，合并它
  - 按能量切片，处理前5秒（及以上）音频
  - 剩余部分缓存到 pendingMaxDurationAudio
  ↓
返回处理后的音频段（如果有≥5秒音频）
  ↓
等待下一个 job 合并剩余部分
```

### 4.2 特点

- ✅ **部分处理**：按能量切片，处理前 5+ 秒音频
- ✅ **无条件缓存剩余部分**：剩余部分缓存到 `pendingMaxDurationAudio`
- ✅ 不会进入 `shouldProcessNow` 的处理逻辑
- ✅ 可能会合并之前的 `pendingTimeoutAudio`（如果有）
- ✅ **没有 TTL 机制**：`pendingMaxDurationAudio` 没有 TTL，因为 MaxDuration 最终都会有手动/timeout finalize 收尾

### 4.3 处理逻辑

**代码位置**: `audio-aggregator.ts:303-380`

```typescript
// 特殊处理：MaxDuration finalize
if (isMaxDurationTriggered && buffer) {
  const maxDurationResult = this.maxDurationHandler.handleMaxDurationFinalize(
    buffer,
    job,
    currentAudio,
    nowMs,
    this.aggregateAudioChunks.bind(this),
    this.createStreamingBatchesWithPending.bind(this)
  );
  
  // ✅ 状态机：进入 PENDING_MAXDUR 状态
  if (maxDurationResult.remainingAudio) {
    buffer.state = 'PENDING_MAXDUR';
  }
  
  // ✅ 修复：清空当前缓冲区（但保留 pendingMaxDurationAudio，如果有剩余部分）
  buffer.audioChunks = [];
  buffer.totalDurationMs = 0;
  buffer.originalJobInfo = [];
  
  if (maxDurationResult.shouldProcess && maxDurationResult.audioSegments) {
    // 有≥5秒的音频需要处理，返回处理后的音频段
    return {
      audioSegments: maxDurationResult.audioSegments.map(seg => seg.toString('base64')),
      originalJobIds: maxDurationResult.originalJobIds,
      shouldReturnEmpty: false,
    };
  } else {
    // 没有≥5秒的音频，返回空结果，等待下一个 job
    return {
      audioSegments: [],
      shouldReturnEmpty: true,
      isTimeoutPending: true,
    };
  }
}
```

### 4.4 缓存逻辑

**代码位置**: `audio-aggregator-maxduration-handler.ts`

```typescript
// MaxDuration finalize 的处理逻辑：
// 1. 合并 pendingTimeoutAudio（如果有）
// 2. 按能量切片，处理前5秒（及以上）音频
// 3. 剩余部分缓存到 pendingMaxDurationAudio

// 缓存剩余部分（无条件）
buffer.pendingMaxDurationAudio = remainingAudio;
buffer.pendingMaxDurationAudioCreatedAt = nowMs;
buffer.pendingMaxDurationJobInfo = [...buffer.originalJobInfo];
```

**缓存特点**:
- ✅ 无条件缓存剩余部分（没有时长限制）
- ✅ 没有 TTL 机制（因为最终会有手动/timeout finalize 收尾）
- ✅ 使用独立的缓存字段（`pendingMaxDurationAudio`），不与 `pendingTimeoutAudio` 混用

### 4.5 与下一个 Job 的合并

**场景 1**: 下一个 job 也是 MaxDuration finalize

```
MaxDuration job 1: 处理前5秒，缓存剩余部分
  ↓
MaxDuration job 2: 合并 job 1 的剩余部分 + job 2 的音频
  ↓
按能量切片，处理前5秒，缓存新的剩余部分
  ↓
继续等待下一个 job...
```

**场景 2**: 下一个 job 是手动/timeout finalize

```
MaxDuration job 1: 处理前5秒，缓存剩余部分
  ↓
手动/timeout finalize job 2: 合并 job 1 的剩余部分 + job 2 的音频
  ↓
按能量切分，全部处理，不缓存
  ↓
返回结果
```

---

## 五、关键差异总结

### 5.1 手动 vs Timeout Finalize

**相同点**:
- ✅ 都进入 `shouldProcessNow` 处理路径
- ✅ 都可能会合并 `pendingTimeoutAudio`（如果有）
- ✅ 大部分情况下都直接送入 ASR

**不同点**:
- ⚠️ **Timeout finalize** 有特殊逻辑：短音频（< 1秒）会缓存等待合并
- ✅ **手动 finalize** 无条件直接送入 ASR
- ✅ **Timeout finalize** 有 TTL 机制（10 秒）

### 5.2 Timeout vs MaxDuration Finalize

**相同点**:
- ✅ 都使用缓存机制（`pendingTimeoutAudio` 和 `pendingMaxDurationAudio`）
- ✅ 都可能会合并之前的缓存（如果有）

**不同点**:
- ⚠️ **Timeout finalize**：大部分情况下直接送入 ASR，只有短音频才缓存
- ✅ **MaxDuration finalize**：部分处理（前 5+ 秒），剩余部分无条件缓存
- ⚠️ **Timeout finalize**：进入 `shouldProcessNow` 处理路径
- ✅ **MaxDuration finalize**：有独立的处理路径（在 `shouldProcessNow` 之前）
- ✅ **Timeout finalize**：有 TTL 机制（10 秒）
- ✅ **MaxDuration finalize**：没有 TTL 机制（因为最终会有手动/timeout finalize 收尾）

### 5.3 缓存机制对比

| 缓存字段 | Finalize 类型 | 缓存条件 | TTL 机制 | 用途 |
|---------|--------------|---------|---------|------|
| `pendingTimeoutAudio` | Timeout | 短音频（< 1秒） | ✅ 10 秒 | 等待下一个 job 合并短音频 |
| `pendingMaxDurationAudio` | MaxDuration | 剩余部分（无条件） | ❌ 无 | 等待下一个 job 合并剩余部分 |

---

## 六、状态机管理

### 6.1 Buffer 状态

**代码位置**: `audio-aggregator-types.ts`

```typescript
export enum BufferState {
  OPEN = 'OPEN',                    // 正常收集音频
  PENDING_TIMEOUT = 'PENDING_TIMEOUT',  // 等待 timeout finalize 合并
  PENDING_MAXDUR = 'PENDING_MAXDUR',    // 等待 MaxDuration finalize 合并
  FINALIZING = 'FINALIZING',            // 正在 finalize
  CLOSED = 'CLOSED',                    // 已关闭
}
```

### 6.2 状态转换

```
OPEN
  ↓ (Timeout finalize 缓存短音频)
PENDING_TIMEOUT
  ↓ (下一个 job 合并)
FINALIZING
  ↓ (处理完成)
CLOSED

OPEN
  ↓ (MaxDuration finalize 缓存剩余部分)
PENDING_MAXDUR
  ↓ (下一个 job 合并)
FINALIZING
  ↓ (处理完成)
CLOSED
```

---

## 七、处理时机和实际效果对比

### 7.1 处理时机

| Finalize 类型 | 处理时机 | 响应速度 |
|--------------|---------|---------|
| **手动 finalize** | 立即处理 | ✅ 快 |
| **Timeout finalize** | 立即处理（大部分情况） | ✅ 快 |
| **MaxDuration finalize** | 部分处理（前 5+ 秒） | ⚠️ 中等（部分处理） |

### 7.2 实际效果

| Finalize 类型 | 用户体验 | 音频完整性 |
|--------------|---------|-----------|
| **手动 finalize** | ✅ 响应快 | ✅ 完整 |
| **Timeout finalize** | ✅ 响应快 | ✅ 完整（短音频会合并） |
| **MaxDuration finalize** | ⚠️ 部分响应 | ✅ 完整（最终会合并） |

---

## 八、相关文档

- [调度服务器 Finalize 类型和触发条件](./scheduler_finalize_types.md)
- [调度服务器 Finalize 处理逻辑](./scheduler_finalize_processing.md)
- [Timeout Finalize](./timeout_finalize.md)
- [MaxDuration Finalize](./maxduration_finalize.md)
- [节点端音频处理和 ASR 结果聚合](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/architecture_and_flow.md)
