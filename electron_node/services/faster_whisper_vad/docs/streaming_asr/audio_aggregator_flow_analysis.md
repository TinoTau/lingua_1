# 节点端 AudioAggregator 完整流程与代码逻辑分析

**日期**: 2026-01-24  
**文档版本**: v1.0  
**审核状态**: 待决策部门审议

---

## 一、概述

本文档详细描述节点端 `AudioAggregator` 的完整处理流程，包括：
1. 完整的调用链（从入口到各个处理器的每个方法）
2. 三种 finalize 类型的处理流程
3. 状态机转换逻辑
4. 代码逻辑重复和矛盾检查
5. 关键设计决策和架构模式

---

## 二、调用链总览

### 2.1 入口调用链

```
PipelineOrchestratorAudioProcessor.processAudio()
  └─> AudioAggregator.processAudioChunk()
      ├─> buildBufferKey()                    // 构建 bufferKey
      ├─> decodeAudioChunk()                  // 解码音频（统一格式验证）
      ├─> timeoutHandler.checkTimeoutTTL()    // 检查 pendingTimeoutAudio TTL
      ├─> maxDurationHandler.handleMaxDurationFinalize()  // MaxDuration finalize 处理
      ├─> finalizeHandler.handleFinalize()    // 手动/timeout finalize 处理
      │   ├─> mergePendingTimeoutAudio()      // 合并 pendingTimeoutAudio
      │   ├─> mergePendingMaxDurationAudio()  // 合并 pendingMaxDurationAudio
      │   └─> mergePendingSmallSegments()    // 合并 pendingSmallSegments
      ├─> audioUtils.splitAudioByEnergy()     // 按能量切分音频
      ├─> createStreamingBatchesWithPending() // 流式批次组合
      │   └─> streamBatcher.createStreamingBatchesWithPending()
      ├─> aggregateAudioChunks()              // 聚合音频块
      │   └─> audioMerger.aggregateAudioChunks()
      └─> deleteBuffer()                       // 删除缓冲区（如果需要）
```

### 2.2 核心组件职责

| 组件 | 职责 | 关键方法 |
|------|------|----------|
| `AudioAggregator` | 主控制器，协调所有处理流程 | `processAudioChunk()` |
| `AudioAggregatorFinalizeHandler` | 处理手动/timeout finalize，合并 pending 音频 | `handleFinalize()`, `mergePendingTimeoutAudio()`, `mergePendingMaxDurationAudio()` |
| `AudioAggregatorMaxDurationHandler` | 处理 MaxDuration finalize，按能量切片并缓存剩余部分 | `handleMaxDurationFinalize()` |
| `AudioAggregatorTimeoutHandler` | 检查 pendingTimeoutAudio TTL，处理超时 finalize | `checkTimeoutTTL()`, `handleTimeoutFinalize()` |
| `AudioAggregatorStreamBatcher` | 流式批次组合，将音频段组合成~5秒批次 | `createStreamingBatchesWithPending()` |
| `AudioAggregatorUtils` | 音频分析工具（能量切分、RMS计算等） | `splitAudioByEnergy()`, `calculateRMS()` |
| `AudioAggregatorMerger` | 音频合并工具 | `aggregateAudioChunks()` |

---

## 三、主流程：processAudioChunk()

### 3.1 流程步骤（按代码执行顺序）

#### 步骤1：初始化与解码
```typescript
// 1.1 提取 finalize 标识
const isManualCut = (job as any).is_manual_cut || false;
const isTimeoutTriggered = (job as any).is_timeout_triggered || false;
const isMaxDurationTriggered = (job as any).is_max_duration_triggered || false;

// 1.2 构建 bufferKey（唯一、稳定、显式）
const bufferKey = buildBufferKey(job);
// bufferKey = session_id [+ room_code] [+ input_stream_id / speaker_id]

// 1.3 解码音频（统一格式验证）
const decodeResult = await decodeAudioChunk(job, SAMPLE_RATE, BYTES_PER_SAMPLE);
let currentAudio = decodeResult.audio;  // PCM16 Buffer
let currentDurationMs = decodeResult.durationMs;
```

**调用链**:
- `buildBufferKey()` → `audio-aggregator-buffer-key.ts:buildBufferKey()`
- `decodeAudioChunk()` → `audio-aggregator-decoder.ts:decodeAudioChunk()`

#### 步骤2：获取或创建缓冲区
```typescript
// 2.1 查找现有缓冲区
let buffer = this.buffers.get(bufferKey);

// 2.2 如果不存在，创建新缓冲区
if (!buffer) {
  buffer = {
    state: 'OPEN',
    epoch: 0,
    bufferKey,
    audioChunks: [],
    totalDurationMs: 0,
    // ... 其他字段
  };
  this.buffers.set(bufferKey, buffer);
}

// 2.3 状态机检查：如果 buffer 处于 FINALIZING 或 CLOSED，切换到新 epoch
if (buffer.state === 'FINALIZING' || buffer.state === 'CLOSED') {
  const newEpoch = buffer.epoch + 1;
  buffer = { /* 创建新 epoch 的 buffer */ };
  this.buffers.set(bufferKey, buffer);
}
```

**状态转换**:
- `OPEN` → `OPEN` (正常接收)
- `FINALIZING/CLOSED` → `OPEN` (新 epoch，避免写入旧 buffer)

#### 步骤3：检查 pendingTimeoutAudio TTL
```typescript
// 3.1 检查 TTL（仅在 buffer 存在时）
const ttlCheckResult = buffer 
  ? this.timeoutHandler.checkTimeoutTTL(buffer, job, currentAudio, nowMs)
  : null;

// 3.2 如果 TTL 超时，处理 pendingTimeoutAudio
if (ttlCheckResult?.shouldProcess) {
  // 合并 pendingTimeoutAudio + currentAudio
  // 按能量切分
  // 返回处理后的音频段
  return {
    audioSegments: ttlCheckResult.audioSegments.map(seg => seg.toString('base64')),
    originalJobIds: ttlCheckResult.originalJobIds,
    shouldReturnEmpty: false,
  };
}
```

**调用链**:
- `timeoutHandler.checkTimeoutTTL()` → `audio-aggregator-timeout-handler.ts:checkTimeoutTTL()`
  - 检查 `pendingTimeoutAudioCreatedAt` 是否超过 10 秒
  - 检查 `utteranceIndex` 差值（允许差值 ≤ 2）
  - 如果 TTL 超时且 utteranceIndex 连续，合并并切分

#### 步骤4：更新缓冲区
```typescript
// 4.1 添加当前音频块到缓冲区
buffer.audioChunks.push(currentAudio);
buffer.totalDurationMs += currentDurationMs;
buffer.lastChunkTimeMs = nowMs;
buffer.isManualCut = buffer.isManualCut || isManualCut;
buffer.isTimeoutTriggered = buffer.isTimeoutTriggered || isTimeoutTriggered;

// 4.2 记录 originalJobInfo（用于 originalJobIds 分配）
const aggregatedAudioLength = this.aggregateAudioChunks(buffer.audioChunks).length;
const currentJobStartOffset = aggregatedAudioLength - currentAudio.length;
const currentJobEndOffset = aggregatedAudioLength;

buffer.originalJobInfo.push({
  jobId: job.job_id,
  startOffset: currentJobStartOffset,
  endOffset: currentJobEndOffset,
  utteranceIndex: job.utterance_index,
  expectedDurationMs: (job as any).expected_duration_ms || Math.ceil(currentDurationMs * 1.2),
});
```

**调用链**:
- `aggregateAudioChunks()` → `audio-aggregator-merger.ts:aggregateAudioChunks()`

#### 步骤5：MaxDuration Finalize 处理（优先级最高）
```typescript
if (isMaxDurationTriggered && buffer) {
  // 5.1 调用 MaxDuration 处理器
  const maxDurationResult = this.maxDurationHandler.handleMaxDurationFinalize(
    buffer,
    job,
    currentAudio,
    nowMs,
    this.aggregateAudioChunks.bind(this),
    this.createStreamingBatchesWithPending.bind(this)
  );
  
  // 5.2 处理结果
  if (maxDurationResult.clearBuffer) {
    // 空音频，删除缓冲区
    this.deleteBuffer(bufferKey, buffer, 'MaxDuration finalize with empty audio', nowMs);
    return { audioSegments: [], shouldReturnEmpty: true, isTimeoutPending: true };
  }
  
  // 5.3 状态机：如果有剩余部分，进入 PENDING_MAXDUR 状态
  if (maxDurationResult.remainingAudio) {
    buffer.state = 'PENDING_MAXDUR';
  }
  
  // 5.4 清空当前缓冲区（但保留 pendingMaxDurationAudio）
  buffer.audioChunks = [];
  buffer.totalDurationMs = 0;
  buffer.originalJobInfo = [];
  buffer.isTimeoutTriggered = false;
  
  // 5.5 返回处理结果
  if (maxDurationResult.shouldProcess) {
    return {
      audioSegments: maxDurationResult.audioSegments,
      originalJobIds: maxDurationResult.originalJobIds,
      originalJobInfo: maxDurationResult.originalJobInfo,
      shouldReturnEmpty: false,
    };
  } else {
    // 全部缓存（<5秒）
    return { audioSegments: [], shouldReturnEmpty: true, isTimeoutPending: true };
  }
}
```

**调用链**:
- `maxDurationHandler.handleMaxDurationFinalize()` → `audio-aggregator-maxduration-handler.ts:handleMaxDurationFinalize()`
  - 合并 `pendingMaxDurationAudio`（如果有）
  - 按能量切分：`audioUtils.splitAudioByEnergy()`
  - 流式批次组合：`createStreamingBatchesWithPending()`
  - 缓存剩余部分（<5秒）到 `pendingMaxDurationAudio`

**状态转换**:
- `OPEN` → `PENDING_MAXDUR` (如果有剩余部分)
- `PENDING_MAXDUR` → `PENDING_MAXDUR` (连续 MaxDuration finalize)

#### 步骤6：判断是否应该立即处理（手动/timeout finalize）
```typescript
const shouldProcessNow =
  isManualCut ||                                    // 手动截断：立即处理
  isTimeoutTriggered ||                             // 超时finalize：立即处理（即使时长小于10秒）
  buffer.totalDurationMs >= MAX_BUFFER_DURATION_MS ||  // 超过20秒：立即处理
  (buffer.totalDurationMs >= MIN_AUTO_PROCESS_DURATION_MS && 
   !isTimeoutTriggered && 
   !isMaxDurationTriggered);                        // 达到10秒且不是超时/MaxDuration：立即处理
```

**处理条件**:
- ✅ `isManualCut = true` → 立即处理
- ✅ `isTimeoutTriggered = true` → 立即处理（即使 < 10秒）
- ✅ `totalDurationMs >= 20秒` → 立即处理（保护机制）
- ✅ `totalDurationMs >= 10秒` 且不是 timeout/MaxDuration → 立即处理

#### 步骤7：手动/Timeout Finalize 处理
```typescript
if (shouldProcessNow) {
  // 7.1 状态机：进入 FINALIZING 状态（冻结写入）
  buffer.state = 'FINALIZING';
  buffer.lastFinalizeAt = nowMs;
  
  // 7.2 聚合当前音频
  const currentAggregated = this.aggregateAudioChunks(buffer.audioChunks);
  
  // 7.3 使用 finalizeHandler 处理合并逻辑
  const finalizeResult = this.finalizeHandler.handleFinalize(
    buffer,
    job,
    currentAggregated,
    nowMs,
    isManualCut,
    isTimeoutTriggered
  );
  
  // 7.4 处理合并结果
  let audioToProcess = finalizeResult.audioToProcess;
  let jobInfoToProcess = finalizeResult.jobInfoToProcess;
  const hasMergedPendingAudio = finalizeResult.hasMergedPendingAudio;
  const shouldCachePendingTimeout = finalizeResult.shouldCachePendingTimeout || false;
  
  // 7.5 清空 pendingTimeoutAudio（如果已合并）
  if (hasMergedPendingAudio) {
    buffer.pendingTimeoutAudio = undefined;
    buffer.pendingTimeoutAudioCreatedAt = undefined;
    buffer.pendingTimeoutJobInfo = undefined;
  } else if (shouldCachePendingTimeout) {
    // 7.6 缓存短音频到 pendingTimeoutAudio（<1秒）
    buffer.pendingTimeoutAudio = audioToProcess;
    buffer.pendingTimeoutAudioCreatedAt = nowMs;
    buffer.pendingTimeoutJobInfo = jobInfoToProcess;
    buffer.state = 'PENDING_TIMEOUT';
  }
  
  // 7.7 按能量切分
  const audioSegments = this.audioUtils.splitAudioByEnergy(
    audioToProcess,
    10000,  // maxSegmentDurationMs: 10秒
    2000,   // minSegmentDurationMs: 2秒
    SPLIT_HANGOVER_MS  // 600ms
  );
  
  // 7.8 流式批次组合
  const isIndependentUtterance = isManualCut;
  const shouldCacheRemaining = !isIndependentUtterance;
  const { batches, batchJobInfo, remainingSmallSegments, remainingSmallSegmentsJobInfo } =
    this.createStreamingBatchesWithPending(audioSegments, jobInfoToProcess, shouldCacheRemaining);
  
  // 7.9 手动发送时，将剩余片段也加入到 batches 中
  if (isIndependentUtterance && remainingSmallSegments.length > 0) {
    batches.push(Buffer.concat(remainingSmallSegments));
    // 为剩余 batch 添加 jobInfo（使用最后一个 job 的容器）
  }
  
  // 7.10 缓存剩余小片段（如果不是独立 utterance）
  if (remainingSmallSegments.length > 0 && !isIndependentUtterance) {
    buffer.pendingSmallSegments = remainingSmallSegments;
    buffer.pendingSmallSegmentsJobInfo = remainingSmallSegmentsJobInfo;
  }
  
  // 7.11 统一 batch → originalJobId 归属策略：头部对齐
  const originalJobIds = batchJobInfo.map(info => info.jobId);
  
  // 7.12 清理缓冲区
  if (buffer.pendingTimeoutAudio || buffer.pendingMaxDurationAudio) {
    // 保留 pending 音频，只清空已处理的状态
    buffer.audioChunks = [];
    buffer.totalDurationMs = 0;
    buffer.originalJobInfo = [];
    // 保持 PENDING_TIMEOUT 或 PENDING_MAXDUR 状态
  } else {
    // 没有 pending 音频，删除缓冲区
    this.deleteBuffer(bufferKey, buffer, 'No pending audio after finalize', nowMs);
  }
  
  // 7.13 返回结果
  return {
    audioSegments: batches.map(batch => batch.toString('base64')),
    originalJobIds,
    originalJobInfo: jobInfoToProcess,
    shouldReturnEmpty: false,
  };
}
```

**调用链**:
- `finalizeHandler.handleFinalize()` → `audio-aggregator-finalize-handler.ts:handleFinalize()`
  - `mergePendingTimeoutAudio()` → 合并 pendingTimeoutAudio（检查 utteranceIndex 差值）
  - `mergePendingMaxDurationAudio()` → 合并 pendingMaxDurationAudio（检查 utteranceIndex 差值）
  - `mergePendingSmallSegments()` → 合并 pendingSmallSegments（检查 utteranceIndex 差值）
- `audioUtils.splitAudioByEnergy()` → `audio-aggregator-utils.ts:splitAudioByEnergy()`
- `createStreamingBatchesWithPending()` → `streamBatcher.createStreamingBatchesWithPending()`

**状态转换**:
- `OPEN` → `FINALIZING` → `PENDING_TIMEOUT` (如果缓存了短音频)
- `OPEN` → `FINALIZING` → `CLOSED` (如果没有 pending 音频)
- `PENDING_TIMEOUT` → `FINALIZING` → `PENDING_TIMEOUT` (连续 timeout finalize)
- `PENDING_MAXDUR` → `FINALIZING` → `CLOSED` (手动/timeout finalize 合并 MaxDuration 缓存)

#### 步骤8：继续缓冲
```typescript
// 如果不需要立即处理，继续缓冲
return {
  audioSegments: [],
  shouldReturnEmpty: true,
};
```

---

## 四、三种 Finalize 类型的处理流程对比

### 4.1 手动 Finalize (`isManualCut = true`)

**触发条件**: 用户手动发送

**处理流程**:
1. ✅ 立即处理（`shouldProcessNow = true`）
2. ✅ 合并 `pendingTimeoutAudio`（如果有，且 utteranceIndex 连续）
3. ✅ 合并 `pendingMaxDurationAudio`（如果有，且 utteranceIndex 连续）
4. ✅ 合并 `pendingSmallSegments`（如果有，且 utteranceIndex 连续）
5. ✅ 按能量切分音频
6. ✅ 流式批次组合（`shouldCacheRemaining = false`，剩余片段也处理）
7. ✅ 头部对齐策略分配 `originalJobIds`
8. ✅ 清理缓冲区（如果没有 pending 音频）

**特点**:
- 不缓存短音频（所有音频都处理）
- 剩余小片段也加入到 batches 中
- 清除所有 session affinity 映射

### 4.2 Timeout Finalize (`isTimeoutTriggered = true`)

**触发条件**: 调度服务器检测到没有更多 chunk（3秒静音）

**处理流程**:
1. ✅ 立即处理（`shouldProcessNow = true`，即使时长 < 10秒）
2. ✅ 合并 `pendingTimeoutAudio`（如果有，且 utteranceIndex 连续）
3. ✅ 合并 `pendingMaxDurationAudio`（如果有，且 utteranceIndex 连续）
4. ✅ 合并 `pendingSmallSegments`（如果有，且 utteranceIndex 连续）
5. ✅ 如果当前音频短（<1秒）且没有合并 pending，缓存到 `pendingTimeoutAudio`
6. ✅ 按能量切分音频
7. ✅ 流式批次组合（`shouldCacheRemaining = true`，剩余片段缓存）
8. ✅ 头部对齐策略分配 `originalJobIds`
9. ✅ 记录 session affinity（如果缓存了短音频）
10. ✅ 清理缓冲区（如果没有 pending 音频）

**特点**:
- 短音频（<1秒）缓存到 `pendingTimeoutAudio`，等待下一个 job 合并
- 剩余小片段缓存到 `pendingSmallSegments`
- 记录 session affinity 映射（用于路由下一个 job 到同一节点）

**TTL 机制**:
- `pendingTimeoutAudio` 有 10 秒 TTL
- 如果超过 TTL 且 utteranceIndex 连续（差值 ≤ 2），强制合并处理
- 如果超过 TTL 且 utteranceIndex 跳跃太大（差值 > 2），清除 pending

### 4.3 MaxDuration Finalize (`isMaxDurationTriggered = true`)

**触发条件**: 调度服务器检测到音频超过最大时长（通常 10 秒）

**处理流程**:
1. ✅ 合并 `pendingMaxDurationAudio`（如果有，连续 MaxDuration finalize）
2. ✅ 按能量切分音频
3. ✅ 流式批次组合（`shouldCacheRemaining = true`）
4. ✅ 处理前 5 秒（及以上）的批次，返回给 ASR
5. ✅ 缓存剩余部分（<5秒）到 `pendingMaxDurationAudio`
6. ✅ 头部对齐策略分配 `originalJobIds`（每个 batch 使用第一个片段所属的 job 容器）
7. ✅ 清空当前缓冲区（但保留 `pendingMaxDurationAudio`）
8. ✅ 记录 session affinity（用于路由下一个 MaxDuration job 到同一节点）

**特点**:
- 不立即处理所有音频，只处理前 5 秒（及以上）
- 剩余部分缓存到 `pendingMaxDurationAudio`，等待下一个 job 合并
- **没有 TTL 机制**（因为 MaxDuration 最终都会有手动/timeout finalize 收尾）
- 每个 ASR 批次使用第一个音频片段所属的 job 容器（头部对齐策略）

**状态转换**:
- `OPEN` → `PENDING_MAXDUR` (如果有剩余部分)
- `PENDING_MAXDUR` → `PENDING_MAXDUR` (连续 MaxDuration finalize)

---

## 五、关键处理器的详细流程

### 5.1 AudioAggregatorFinalizeHandler.handleFinalize()

**职责**: 处理手动/timeout finalize，合并所有 pending 音频

**调用链**:
```
handleFinalize()
  ├─> mergePendingTimeoutAudio()      // 合并 pendingTimeoutAudio
  │   └─> 检查 utteranceIndex 差值（允许差值 ≤ 2）
  │   └─> 如果差值 > 2，强制 finalize pending（丢弃）
  │   └─> 如果差值 = 0，清除 pending（重复 job）
  │   └─> 如果差值 = 1 或 2，合并音频和 jobInfo
  ├─> mergePendingMaxDurationAudio()  // 合并 pendingMaxDurationAudio
  │   └─> 检查 utteranceIndex 差值（允许差值 ≤ 2）
  │   └─> 如果差值 > 2，强制 finalize pending（丢弃）
  │   └─> 如果差值 = 0，清除 pending（重复 job）
  │   └─> 如果差值 = 1 或 2，合并音频和 jobInfo
  └─> mergePendingSmallSegments()     // 合并 pendingSmallSegments
      └─> 检查 utteranceIndex 差值（允许差值 ≤ 2）
      └─> 如果差值 > 2，清除 pending
      └─> 如果差值 = 0，清除 pending（重复 job）
      └─> 如果差值 = 1 或 2，合并音频和 jobInfo
```

**utteranceIndex 检查逻辑**:
- ✅ `utteranceIndexDiff = 1 或 2` → 允许合并（正常延续）
- ❌ `utteranceIndexDiff = 0` → 清除 pending（重复 job）
- ❌ `utteranceIndexDiff > 2` → 强制 finalize pending（丢弃，中间有其他独立 utterance）

**返回值**:
```typescript
{
  audioToProcess: Buffer,              // 合并后的音频
  jobInfoToProcess: OriginalJobInfo[], // 合并后的 jobInfo
  hasMergedPendingAudio: boolean,      // 是否合并了 pending 音频
  shouldCachePendingTimeout?: boolean  // 是否应该缓存短音频到 pendingTimeoutAudio
}
```

### 5.2 AudioAggregatorMaxDurationHandler.handleMaxDurationFinalize()

**职责**: 处理 MaxDuration finalize，按能量切片并缓存剩余部分

**调用链**:
```
handleMaxDurationFinalize()
  ├─> 检查空音频 → 返回 clearBuffer = true
  ├─> 合并 pendingMaxDurationAudio（如果有）
  │   └─> Buffer.concat([existingPendingAudio, currentAggregated])
  │   └─> 调整 currentJobInfo 的偏移量
  ├─> 记录 session affinity
  ├─> 按能量切分
  │   └─> audioUtils.splitAudioByEnergy(audioToProcess, 10000, 2000, 600)
  ├─> 流式批次组合
  │   └─> createStreamingBatchesWithPending(audioSegments, jobInfoToProcess, true)
  │       └─> 组合成 ~5 秒批次
  │       └─> 返回每个 batch 的第一个片段对应的 jobInfo（头部对齐）
  ├─> 分配 originalJobIds
  │   └─> batchJobInfo.map(info => info.jobId)  // 头部对齐策略
  └─> 处理剩余部分
      ├─> 如果有剩余（<5秒），缓存到 pendingMaxDurationAudio
      │   └─> 使用第一个切片的 job 容器（不是 remainingSmallSegmentsJobInfo）
      └─> 如果没有剩余，清空 pendingMaxDurationAudio
```

**关键设计**:
- ✅ 剩余部分使用第一个切片的 job 容器（头部对齐）
- ✅ 每个 batch 使用其第一个片段所属的 job 容器
- ✅ 没有 TTL 机制（MaxDuration 最终都会有手动/timeout finalize 收尾）

**返回值**:
```typescript
{
  shouldProcess: boolean,              // 是否有 ≥5 秒的音频需要处理
  audioSegments?: string[],           // 处理后的音频段（base64编码）
  originalJobIds?: string[],         // 每个音频段对应的 originalJobId
  originalJobInfo?: OriginalJobInfo[], // 原始job信息
  remainingAudio?: Buffer,            // 剩余音频（<5秒，需要缓存）
  remainingJobInfo?: OriginalJobInfo[], // 剩余音频对应的job信息
  clearBuffer: boolean                 // 是否应该清空缓冲区
}
```

### 5.3 AudioAggregatorTimeoutHandler.checkTimeoutTTL()

**职责**: 检查 pendingTimeoutAudio 是否超过 TTL，如果超过则强制处理

**调用链**:
```
checkTimeoutTTL()
  ├─> 检查 pendingTimeoutAudio 是否存在
  ├─> 检查 TTL（10秒）
  ├─> 检查 utteranceIndex 差值
  │   ├─> 如果差值 > 2 → 清除 pending（中间有其他独立 utterance）
  │   ├─> 如果差值 = 0 → 清除 pending（重复 job）
  │   └─> 如果差值 = 1 或 2 → 允许合并（即使 TTL 过期）
  ├─> 合并 pendingTimeoutAudio + currentAudio
  ├─> 按能量切分
  └─> 分配 originalJobIds
```

**关键逻辑**:
- ✅ TTL 过期但 utteranceIndex 连续（差值 ≤ 2）→ 允许合并（超时 finalize 的正常场景）
- ❌ TTL 过期且 utteranceIndex 跳跃太大（差值 > 2）→ 清除 pending

**返回值**:
```typescript
{
  shouldProcess: boolean,        // 是否应该处理
  audioSegments: Buffer[],      // 处理后的音频段
  originalJobIds?: string[],    // 每个音频段对应的 originalJobId
  clearPendingTimeout: boolean  // 是否应该清除 pendingTimeoutAudio
}
```

### 5.4 AudioAggregatorStreamBatcher.createStreamingBatchesWithPending()

**职责**: 将切分后的音频段组合成 ~5 秒批次，管理小片段缓存

**调用链**:
```
createStreamingBatchesWithPending()
  ├─> 遍历音频段，组合成 ~5 秒批次
  │   ├─> 如果当前批次 + 新片段 >= 5秒 → 创建新批次
  │   └─> 否则 → 添加到当前批次
  ├─> 记录每个 batch 的第一个片段对应的 jobInfo（头部对齐）
  └─> 处理最后一个批次
      ├─> 如果 <5秒 且 shouldCacheRemaining = true → 缓存到 remainingSmallSegments
      └─> 如果 >=5秒 或 shouldCacheRemaining = false → 作为批次发送
```

**关键逻辑**:
- ✅ 每个 batch 的第一个片段对应的 jobInfo 被记录（用于头部对齐策略）
- ✅ 剩余小片段（<5秒）可以缓存，等待下一个 job 合并

**返回值**:
```typescript
{
  batches: Buffer[],                    // ~5 秒批次数组
  batchJobInfo: OriginalJobInfo[],     // 每个 batch 的第一个片段对应的 jobInfo
  remainingSmallSegments: Buffer[],    // 剩余小片段（<5秒）
  remainingSmallSegmentsJobInfo: OriginalJobInfo[]  // 剩余小片段对应的 jobInfo
}
```

---

## 六、状态机转换

### 6.1 状态定义

```typescript
type BufferState = 
  | 'OPEN'                    // 正常接收音频块
  | 'PENDING_TIMEOUT'         // 超时 finalize，pendingTimeoutAudio 已设置
  | 'PENDING_MAXDUR'          // MaxDuration finalize，pendingMaxDurationAudio 已设置
  | 'FINALIZING'              // 正在 finalize，冻结写入
  | 'CLOSED';                 // 已关闭，清理完成
```

### 6.2 状态转换图

```
[初始] → OPEN
  │
  ├─> 接收音频块 → OPEN (继续接收)
  │
  ├─> MaxDuration finalize (有剩余部分) → PENDING_MAXDUR
  │   └─> 连续 MaxDuration finalize → PENDING_MAXDUR
  │   └─> 手动/timeout finalize → FINALIZING → CLOSED (合并 MaxDuration 缓存)
  │
  ├─> Timeout finalize (短音频缓存) → PENDING_TIMEOUT
  │   └─> 连续 Timeout finalize → PENDING_TIMEOUT
  │   └─> 手动/timeout finalize → FINALIZING → CLOSED (合并 Timeout 缓存)
  │
  └─> 手动/timeout finalize (无 pending) → FINALIZING → CLOSED
```

### 6.3 状态转换规则

| 当前状态 | 触发事件 | 新状态 | 说明 |
|---------|---------|--------|------|
| `OPEN` | 接收音频块 | `OPEN` | 正常接收 |
| `OPEN` | MaxDuration finalize（有剩余部分） | `PENDING_MAXDUR` | 缓存剩余部分 |
| `OPEN` | Timeout finalize（短音频缓存） | `PENDING_TIMEOUT` | 缓存短音频 |
| `OPEN` | 手动/timeout finalize（无 pending） | `FINALIZING` → `CLOSED` | 处理并删除 |
| `PENDING_MAXDUR` | 连续 MaxDuration finalize | `PENDING_MAXDUR` | 继续缓存 |
| `PENDING_MAXDUR` | 手动/timeout finalize | `FINALIZING` → `CLOSED` | 合并并处理 |
| `PENDING_TIMEOUT` | 连续 Timeout finalize | `PENDING_TIMEOUT` | 继续缓存 |
| `PENDING_TIMEOUT` | 手动/timeout finalize | `FINALIZING` → `CLOSED` | 合并并处理 |
| `FINALIZING` | 新音频块到达 | `OPEN` (新 epoch) | 避免写入旧 buffer |
| `CLOSED` | 新音频块到达 | `OPEN` (新 epoch) | 避免写入旧 buffer |

### 6.4 Epoch 机制

**目的**: 避免旧 buffer 被 finalize 后又被写入

**规则**:
- 如果 buffer 处于 `FINALIZING` 或 `CLOSED` 状态，创建新 epoch 的 buffer
- `epoch` 递增，确保新音频块写入新 buffer，不会影响正在 finalize 的旧 buffer

---

## 七、代码逻辑重复和矛盾检查

### 7.1 重复逻辑检查

#### ✅ 已统一的逻辑

1. **流式切分逻辑**（已统一）
   - ✅ 统一使用 `audio-aggregator.ts:createStreamingBatchesWithPending()` (line 782)
   - ✅ 已删除 `audio-aggregator-maxduration-handler.ts:144` 的重复实现

2. **音频格式验证**（已统一）
   - ✅ 统一使用 `audio-aggregator-decoder.ts:decodeAudioChunk()` (line 28-76)
   - ✅ 已删除 `pipeline-orchestrator-audio-processor.ts:95-128` 的重复实现

3. **Batch → originalJobId 分配策略**（已统一）
   - ✅ 统一使用头部对齐策略：`batchJobInfo.map(info => info.jobId)` (line 541, 167)
   - ✅ MaxDuration/Manual/Timeout 行为一致

#### ⚠️ 潜在的重复逻辑

1. **utteranceIndex 检查逻辑**（在多个地方重复）
   - `mergePendingTimeoutAudio()` (line 277-379)
   - `mergePendingMaxDurationAudio()` (line 164-272)
   - `mergePendingSmallSegments()` (line 385-476)
   - `checkTimeoutTTL()` (line 45-178)
   
   **建议**: 可以提取为公共方法，但当前实现清晰，重复可接受（便于独立维护和测试）

2. **音频合并逻辑**（在多个地方重复）
   - `mergePendingTimeoutAudio()`: `Buffer.concat([pendingAudio, currentAggregated])`
   - `mergePendingMaxDurationAudio()`: `Buffer.concat([pendingAudio, currentAggregated])`
   - `handleMaxDurationFinalize()`: `Buffer.concat([existingPendingAudio, currentAggregated])`
   
   **建议**: 已通过 `aggregateAudioChunks()` 统一，但某些地方直接使用 `Buffer.concat()`（可接受，因为逻辑简单）

### 7.2 矛盾逻辑检查

#### ✅ 无矛盾逻辑

1. **MaxDuration finalize 处理优先级**
   - ✅ MaxDuration finalize 在 `shouldProcessNow` 判断之前处理（line 303）
   - ✅ 确保 MaxDuration finalize 不会被误判为手动/timeout finalize

2. **状态机转换**
   - ✅ 状态转换逻辑清晰，无冲突
   - ✅ Epoch 机制确保不会写入旧 buffer

3. **originalJobIds 分配策略**
   - ✅ 统一使用头部对齐策略，MaxDuration/Manual/Timeout 行为一致

4. **pending 音频合并条件**
   - ✅ 所有 pending 音频合并都检查 `utteranceIndex` 差值（允许差值 ≤ 2）
   - ✅ 逻辑一致，无矛盾

#### ⚠️ 需要注意的逻辑

1. **Buffer 清理时机**
   - ✅ 如果有 `pendingTimeoutAudio` 或 `pendingMaxDurationAudio`，保留 buffer
   - ✅ 如果没有 pending 音频，删除 buffer
   - ✅ 逻辑清晰，无矛盾

2. **TTL 机制**
   - ✅ `pendingTimeoutAudio` 有 10 秒 TTL
   - ✅ `pendingMaxDurationAudio` 没有 TTL（因为最终都会有手动/timeout finalize 收尾）
   - ✅ 逻辑合理，无矛盾

---

## 八、关键设计决策

### 8.1 头部对齐策略

**决策**: 所有 finalize 类型（MaxDuration/Manual/Timeout）都使用头部对齐策略

**实现**: 每个 batch 使用其第一个音频片段所属的 job 容器

**优势**:
- ✅ 确保切片数量不会超过 job 容器数量
- ✅ 不会产生文本丢失的情况
- ✅ 行为一致，易于理解和维护

### 8.2 统一流式切分逻辑

**决策**: 统一使用 `createStreamingBatchesWithPending()` 方法

**实现**: MaxDuration/Manual/Timeout 都调用同一个方法

**优势**:
- ✅ 代码简洁，避免重复
- ✅ 行为一致，易于测试和维护

### 8.3 统一音频格式验证

**决策**: 统一在 `decodeAudioChunk()` 中验证音频格式

**实现**: 所有音频解码都通过 `decodeAudioChunk()` 进行

**优势**:
- ✅ 早期验证，避免后续处理错误
- ✅ 代码集中，易于维护

### 8.4 utteranceIndex 检查策略

**决策**: 允许 utteranceIndex 差值 ≤ 2 时合并 pending 音频

**实现**: 所有 pending 音频合并都检查 utteranceIndex 差值

**优势**:
- ✅ 允许正常的连续 finalize（MaxDuration 序列）
- ✅ 防止中间有其他独立 utterance 时的错误合并

### 8.5 MaxDuration 剩余部分容器分配

**决策**: 剩余部分使用第一个切片的 job 容器（不是 remainingSmallSegmentsJobInfo）

**实现**: `handleMaxDurationFinalize()` 中明确使用 `jobInfoToProcess[0]`

**优势**:
- ✅ 确保剩余部分使用当前 job 的容器
- ✅ 避免使用下一个 job 的容器（可能导致容器混乱）

---

## 九、总结

### 9.1 流程完整性

✅ **完整**: 所有 finalize 类型都有明确的处理流程  
✅ **清晰**: 调用链清晰，每个方法职责明确  
✅ **一致**: 相同逻辑统一实现，避免重复和矛盾

### 9.2 代码质量

✅ **统一**: 流式切分、音频格式验证、batch 分配策略都已统一  
✅ **模块化**: 各个处理器职责清晰，便于测试和维护  
✅ **可扩展**: 新增 finalize 类型或修改逻辑都很容易

### 9.3 潜在改进点

1. **utteranceIndex 检查逻辑**: 可以提取为公共方法，但当前实现清晰，重复可接受
2. **音频合并逻辑**: 某些地方直接使用 `Buffer.concat()`，可以统一使用 `aggregateAudioChunks()`，但逻辑简单，可接受

### 9.4 建议

✅ **当前实现已经非常清晰和统一，没有发现严重的重复或矛盾逻辑**  
✅ **建议保持当前架构，继续使用统一的流式切分和头部对齐策略**  
✅ **如果需要新增功能，建议遵循现有的模块化设计模式**

---

## 十、附录：关键常量

| 常量 | 值 | 说明 |
|------|-----|------|
| `MAX_BUFFER_DURATION_MS` | 20000 | 最大缓冲时长：20秒 |
| `MIN_AUTO_PROCESS_DURATION_MS` | 10000 | 最短自动处理时长：10秒 |
| `MIN_ACCUMULATED_DURATION_FOR_ASR_MS` | 5000 | 最小累积时长：5秒（用于ASR流式批次） |
| `PENDING_TIMEOUT_AUDIO_TTL_MS` | 10000 | pendingTimeoutAudio TTL：10秒 |
| `SHORT_AUDIO_THRESHOLD_MS` | 1000 | 短音频阈值：1秒 |
| `SPLIT_HANGOVER_MS` | 600 | 分割点Hangover：600ms |
| `SAMPLE_RATE` | 16000 | 采样率：16kHz |
| `BYTES_PER_SAMPLE` | 2 | PCM16：2 bytes per sample |

---

**文档结束**
