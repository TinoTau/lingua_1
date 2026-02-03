# 节点端音频处理和ASR结果聚合架构与流程

**日期**: 2026-01-24（架构说明）；2026-02 更新  
**目的**: 详细描述业务需求，并整理实际代码的架构和流程（具体到每个方法的调用）  
**更新**: 已根据决策部门反馈完成 P0 优化（见 [implementation_summary.md](implementation_summary.md)）

**架构变更（2026-02）**：**OriginalJobResultDispatcher** 已移除。当前节点端结果发送统一经 **ResultSender** + **buildResultsToSend**（含 `pendingEmptyJobs`）单路径完成。本文中涉及 Dispatcher 的流程图与调用关系为**历史架构**，仅作参考。

---

## 一、业务需求详细描述

### 1.1 核心业务场景

系统需要处理三种类型的语音 finalize 场景：

1. **手动 Finalize**：用户主动点击停止按钮，立即处理当前音频
2. **Timeout Finalize**：用户停止说话超过3秒，调度服务器检测到静音，触发超时 finalize
3. **MaxDuration Finalize**：用户持续说话超过最大时长（如10秒），调度服务器自动截断，生成多个连续的 job

### 1.2 MaxDuration Finalize 的特殊需求

**业务背景**：
- 超长语音（如35秒）会被调度服务器拆分成多个连续的 MaxDuration finalize job
- 节点端需要流式处理，不能等待所有 job 到达后再处理（延迟太大）
- 需要确保 ASR 文本结果与原始 job 容器对齐，避免文本丢失

**具体需求**：

1. **部分处理策略**：
   - MaxDuration finalize 不应该立即处理全部音频
   - 应该按能量切片后，处理前5秒（及以上）的音频内容，发送给 ASR
   - 剩余部分（<5秒）缓存到 `pendingMaxDurationAudio`，等待下一个 job 合并

2. **连续 MaxDuration 处理**：
   - 如果下一个 job 也是 MaxDuration finalize：
     - 合并缓存的剩余部分和当前 job 的音频
     - 按能量切片后，处理前5秒（及以上）的音频内容
     - 新的剩余部分继续缓存
   - 如果下一个任务是手动/timeout finalize：
     - 将缓存的剩余部分和当前 job 的音频合并
     - 使用当前 job（最后一个 job）的容器返回结果

3. **容器分配策略（头部对齐）**：
   - **关键需求**：每个 ASR 批次使用其**第一个音频片段所属的 job 容器**（头部对齐策略）
   - **目的**：确保每个 batch 的 ASR 文本结果与原始 job 容器对齐，避免文本丢失的情况
   - **示例**：
     ```
     35秒长语音被拆成4个job：
     - job0: 10秒 → 切分成 job0_1(3秒) + job0_2(3秒) + job0_3(4秒)
     - job1: 10秒 → 切分成 job1_1(3秒) + job1_2(3秒) + job1_3(4秒)
     - job2: 10秒 → 切分成 job2_1(3秒) + job2_2(3秒) + job2_3(3秒) + job2_4(1秒)
     - job3: 5秒 → 切分成 job3_1(5秒) [手动/timeout finalize]
     
     流式批次组合：
     - batch0: job0_1 + job0_2 = 6秒 → 使用 job0 的容器
     - batch1: job0_3 + job1_1 = 7秒 → 使用 job0 的容器（头部对齐）
     - batch2: job1_2 + job1_3 = 7秒 → 使用 job1 的容器（头部对齐）
     - batch3: job2_1 + job2_2 = 6秒 → 使用 job2 的容器（头部对齐）
     - batch4: job2_3 + job2_4 + job3_1 = 9秒 → 使用 job3 的容器（头部对齐）
     
     最终结果：
     - job0 的容器包含 batch0 和 batch1 的 ASR 文本（合并后发送给语义修复）
     - job1 的容器包含 batch2 的 ASR 文本
     - job2 的容器包含 batch3 的 ASR 文本
     - job3 的容器包含 batch4 的 ASR 文本
     ```

4. **剩余部分缓存**：
   - 剩余部分应该使用**当前 job 的容器**（第一个切片的 job 容器），而不是下一个 job 的容器
   - `pendingMaxDurationAudio` **不需要 TTL 机制**，因为 MaxDuration finalize 最终都会有且必须要有一个手动/Timeout finalize 的 job 进行收尾

### 1.3 代码统一需求

1. **流式切分逻辑统一**：
   - 所有流式切分逻辑统一使用 `AudioAggregator.createStreamingBatchesWithPending()` 方法
   - MaxDuration handler 通过参数传入该方法，不再直接使用 `AudioAggregatorStreamBatcher` 实例

2. **音频格式验证统一**：
   - 所有音频格式验证统一到 `decodeAudioChunk()` 方法
   - 删除 `pipeline-orchestrator-audio-processor.ts` 中的重复验证代码

3. **标签分离**：
   - MaxDuration 使用独立的标签 `is_max_duration_triggered`，不与 `is_timeout_triggered` 混用
   - 调度服务器端和节点端都使用独立的标签

---

## 二、代码架构和流程

### 2.1 整体架构图

```
调度服务器 (Scheduler)
  ↓ [发送 JobAssignMessage]
节点端接收 (node-agent-simple.ts)
  ↓
JobProcessor.processJob()
  ↓
runJobPipeline() (job-pipeline.ts)
  ↓
executeStep('ASR', ...) (pipeline-step-registry.ts)
  ↓
runAsrStep() (asr-step.ts)
  ├─→ PipelineOrchestratorAudioProcessor.processAudio() 【阶段1：音频聚合】
  │     └─→ AudioAggregator.processAudioChunk()
  │           ├─→ MaxDuration Handler (如果是 MaxDuration finalize)
  │           ├─→ Finalize Handler (如果是手动/timeout finalize)
  │           └─→ 头部对齐策略分配 originalJobIds
  │
  ├─→ ASR 服务调用 (taskRouter.routeASRTask) 【阶段2：ASR识别】
  │     └─→ OriginalJobResultDispatcher.addASRSegment()
  │           └─→ 触发回调: runJobPipeline() (跳过 ASR 步骤)
  │                 └─→ executeStep('AGGREGATION', ...)
  │                       └─→ runAggregationStep() 【阶段3：文本聚合】
  │                             └─→ AggregationStage.process()
  │                                   └─→ AggregatorManager.processUtterance()
  │
  └─→ 返回结果给调度服务器
```

### 2.2 阶段1：音频聚合（AudioAggregator）

详细流程请参考 [audio_aggregator_flow_analysis.md](audio_aggregator_flow_analysis.md)

**关键方法调用**:
- `AudioAggregator.processAudioChunk()` → 主入口
- `buildBufferKey()` → 构建 bufferKey
- `decodeAudioChunk()` → 解码音频（统一格式验证）
- `maxDurationHandler.handleMaxDurationFinalize()` → MaxDuration finalize 处理
- `finalizeHandler.handleFinalize()` → 手动/timeout finalize 处理
- `createStreamingBatchesWithPending()` → 流式批次组合

### 2.3 阶段2：ASR 识别

**文件**: `electron_node/electron-node/main/src/pipeline/steps/asr-step.ts`

**方法**: `runAsrStep(job: JobAssignMessage, ctx: JobContext)`

**处理流程**:
```typescript
// 1. 音频聚合
const audioProcessorResult = await audioProcessor.processAudio(job);
// 返回: { audioSegments, originalJobIds, originalJobInfo, ... }

// 2. 如果应该返回空，直接返回
if (audioProcessorResult.shouldReturnEmpty) {
  return;
}

// 3. 注册原始 job（用于结果分发）
// 关键：expectedSegmentCount = batchCountForThisJob（强制一致）
for (const originalJobId of uniqueOriginalJobIds) {
  const batchCountForThisJob = originalJobIds.filter(id => id === originalJobId).length;
  const expectedSegmentCount = batchCountForThisJob;  // 强制一致
  
  dispatcher.registerOriginalJob(
    job.session_id,
    originalJobId,
    expectedSegmentCount,  // 明确的期望数量
    originalJob,
    callback
  );
}

// 4. 遍历 audioSegments，调用 ASR 服务
for (let i = 0; i < audioSegments.length; i++) {
  const audioSegment = audioSegments[i];
  const originalJobId = originalJobIds[i];
  
  try {
    // 调用 ASR 服务
    const asrResult = await taskRouter.routeASRTask(...);
    
    // 添加 ASR 片段到分发器
    await dispatcher.addASRSegment(job.session_id, originalJobId, {
      originalJobId,
      asrText: asrResult.text,
      asrSegments: asrResult.segments,
      batchIndex: i,
    });
  } catch (error) {
    // ASR 失败时，创建 missing segment
    await dispatcher.addASRSegment(job.session_id, originalJobId, {
      originalJobId,
      asrText: '',
      asrSegments: [],
      batchIndex: i,
      missing: true,  // 标记为缺失
    });
  }
}
```

**OriginalJobResultDispatcher 内部流程**:
```typescript
// 调用: addASRSegment(sessionId, originalJobId, asrData)
// 文件: original-job-result-dispatcher.ts:213

// 1. 获取注册信息
const registration = sessionRegistrations.get(originalJobId);

// 2. 累积 ASR 结果
registration.accumulatedSegments.push(asrData);
registration.receivedCount++;

// 3. 如果 missing，更新 missingCount
if (asrData.missing) {
  registration.missingCount++;
}

// 4. 检查是否达到期望数量
if (registration.receivedCount >= registration.expectedSegmentCount) {
  // 按 batchIndex 排序
  const sortedSegments = [...registration.accumulatedSegments].sort((a, b) => {
    return (a.batchIndex ?? 0) - (b.batchIndex ?? 0);
  });
  
  // 合并文本（跳过 missing segment）
  const fullText = sortedSegments
    .filter(s => !s.missing)
    .map(s => s.asrText)
    .join(' ');
  
  // 清除 TTL 定时器
  if (registration.ttlTimerHandle) {
    clearTimeout(registration.ttlTimerHandle);
  }
  
  // 触发回调（继续后续处理）
  await registration.callback(finalAsrData, registration.originalJob);
}
```

**TTL 机制**:
```typescript
// 注册时启动 TTL 定时器
registration.ttlTimerHandle = setTimeout(() => {
  this.forceFinalizePartial(sessionId, originalJobId, 'registration_ttl');
}, this.REGISTRATION_TTL_MS);  // 10秒

// 超时强制 finalize
private async forceFinalizePartial(sessionId, originalJobId, reason) {
  // 输出已有 segments，标注 partial=true
  // 清理 registration
}
```

### 2.4 阶段3：文本聚合（UtteranceAggregator）

**文件**: `electron_node/electron-node/main/src/pipeline/steps/aggregation-step.ts`

**方法**: `runAggregationStep(job: JobAssignMessage, ctx: JobContext)`

**处理流程**:
```typescript
// 1. 执行文本聚合
const result = await aggregationStage.process(job, asrResult);

// 2. 处理 utterance
// 调用: aggregatorManager.processUtterance(
//   sessionId,
//   asrTextTrimmed,
//   segments,
//   langProbs,
//   qualityScore,
//   isFinal: true,
//   isManualCut,
//   mode: 'two_way',
//   isTimeoutTriggered
// )

// 3. 返回聚合结果
```

---

## 三、关键设计决策

### 3.1 流式切分逻辑统一

**决策**：所有流式切分逻辑统一使用 `AudioAggregator.createStreamingBatchesWithPending()` 方法

**实现**：
- MaxDuration handler 通过参数传入该方法，不再直接使用 `AudioAggregatorStreamBatcher` 实例
- 手动/timeout finalize 也使用相同的方法

**好处**：
- 代码复用，减少重复
- 逻辑一致，易于维护
- 便于测试

### 3.2 音频格式验证统一

**决策**：所有音频格式验证统一到 `decodeAudioChunk()` 方法

**实现**：
- `decodeAudioChunk()` 负责：
  - Opus 格式解码
  - PCM16 格式解码
  - PCM16 长度验证（必须是2的倍数）
  - 自动修复（截断最后一个字节）
- `pipeline-orchestrator-audio-processor.ts` 中删除所有重复验证代码

**好处**：
- 单一职责，验证逻辑集中
- 避免重复验证，提高性能
- 减少错误风险

### 3.3 容器分配策略（头部对齐）

**决策**：所有 finalize 类型（MaxDuration/Manual/Timeout）都使用头部对齐策略

**架构设计**：
- `createStreamingBatchesWithPending` 在创建 batch 时，记录每个 batch 的第一个片段对应的 jobInfo
- 返回 `batchJobInfo` 数组，与 `batches` 数组一一对应
- 所有 handler 直接使用 `batchJobInfo`，无需重新计算偏移量

**实现**：
```typescript
// createStreamingBatchesWithPending 中
// 创建 batch 时记录第一个片段的偏移量和对应的 jobInfo
const batchJobInfo: OriginalJobInfo[] = [];
for (let i = 0; i < audioSegments.length; i++) {
  if (currentBatch.length === 0) {
    currentBatchFirstSegmentOffset = segmentOffset;  // 记录第一个片段的偏移量
  }
  // ... 创建 batch 逻辑 ...
  if (batch完成) {
    const firstSegmentJobInfo = findJobInfoByOffset(currentBatchFirstSegmentOffset, jobInfo);
    batchJobInfo.push(firstSegmentJobInfo);
  }
}

// 所有 handler 中
const { batches, batchJobInfo } = createStreamingBatchesWithPending(...);
const originalJobIds = batchJobInfo.map(info => info.jobId);  // 直接使用，无需重新计算
```

**好处**：
- **架构清晰**：jobInfo 的查找逻辑集中在 `createStreamingBatchesWithPending` 中
- **代码简洁**：MaxDuration handler 从 50 行简化为 1 行
- **易于维护**：所有逻辑都在一个地方，便于调试和修改
- **避免重复**：不需要在多个地方重复计算偏移量
- **行为一致**：MaxDuration/Manual/Timeout 行为完全一致

### 3.4 剩余部分缓存策略

**决策**：
- 剩余部分使用当前 job 的容器（第一个切片的 job 容器）
- `pendingMaxDurationAudio` 不需要 TTL 机制

**实现**：
```typescript
// 剩余部分也使用当前 job 的容器
if (jobInfoToProcess.length > 0) {
  const firstJobInfo = jobInfoToProcess[0];
  remainingJobInfo = [{
    jobId: firstJobInfo.jobId,  // 使用第一个 job 的容器
    // ...
  }];
}
```

**好处**：
- 符合业务逻辑（MaxDuration 最终都会有手动/timeout finalize 收尾）
- 不需要 TTL 机制，避免掩盖问题

### 3.5 标签分离

**决策**：MaxDuration 使用独立的标签，不与 Timeout 混用

**实现**：
- 调度服务器端：`is_max_duration_triggered` 和 `is_timeout_triggered` 独立设置
- 节点端：使用独立的处理方法（`recordMaxDurationFinalize` 和 `recordTimeoutFinalize`）

**好处**：
- 逻辑清晰，易于维护
- 避免混用导致的错误

---

## 四、方法调用关系图

### 4.1 AudioAggregator 方法调用关系

```
AudioAggregator.processAudioChunk()
  ├─→ buildBufferKey() [audio-aggregator-buffer-key.ts:buildBufferKey]
  ├─→ decodeAudioChunk() [audio-aggregator-decoder.ts:decodeAudioChunk]
  │     ├─→ decodeOpusToPcm16() [如果 audio_format === 'opus']
  │     └─→ Buffer.from(job.audio, 'base64') [如果 audio_format === 'pcm16']
  │
  ├─→ timeoutHandler.checkTimeoutTTL() [如果是 timeout]
  │
  ├─→ maxDurationHandler.handleMaxDurationFinalize() [如果是 MaxDuration]
  │     ├─→ aggregateAudioChunks() [合并音频块]
  │     ├─→ audioUtils.splitAudioByEnergy() [按能量切分]
  │     ├─→ createStreamingBatchesWithPending() [流式切分]
  │     │     └─→ streamBatcher.createStreamingBatchesWithPending()
  │     └─→ sessionAffinityManager.recordMaxDurationFinalize()
  │
  └─→ finalizeHandler.handleFinalize() [如果是手动/timeout]
        ├─→ mergePendingTimeoutAudio() [合并 pendingTimeoutAudio]
        ├─→ mergePendingMaxDurationAudio() [合并 pendingMaxDurationAudio]
        ├─→ mergePendingSmallSegments() [合并 pendingSmallSegments]
        ├─→ audioUtils.splitAudioByEnergy() [按能量切分]
        ├─→ createStreamingBatchesWithPending() [流式切分]
        │     └─→ streamBatcher.createStreamingBatchesWithPending()
        └─→ 头部对齐策略分配 originalJobIds
```

### 4.2 OriginalJobResultDispatcher 方法调用关系

```
OriginalJobResultDispatcher.registerOriginalJob()
  └─→ 启动 TTL 定时器

OriginalJobResultDispatcher.addASRSegment()
  ├─→ 累积 ASR 结果
  ├─→ 更新 receivedCount 和 missingCount
  ├─→ 检查是否达到 expectedSegmentCount
  └─→ 如果达到，触发回调

OriginalJobResultDispatcher.forceFinalizePartial()
  └─→ TTL 超时强制 finalize
```

---

## 五、关键数据结构

### 5.1 AudioBuffer

```typescript
export interface AudioBuffer {
  state: BufferState;           // 状态机状态
  epoch: number;                // 代次
  bufferKey: string;            // 唯一标识
  lastWriteAt?: number;         // 最后写入时间
  lastFinalizeAt?: number;      // 最后 finalize 时间
  audioChunks: Buffer[];
  totalDurationMs: number;
  originalJobInfo: OriginalJobInfo[];
  pendingTimeoutAudio?: Buffer;
  pendingTimeoutAudioCreatedAt?: number;
  pendingTimeoutJobInfo?: OriginalJobInfo[];
  pendingMaxDurationAudio?: Buffer;
  pendingMaxDurationAudioCreatedAt?: number;
  pendingMaxDurationJobInfo?: OriginalJobInfo[];
  pendingSmallSegments: Buffer[];
  pendingSmallSegmentsJobInfo: OriginalJobInfo[];
}
```

### 5.2 OriginalJobInfo

```typescript
export interface OriginalJobInfo {
  jobId: string;
  startOffset: number;  // 在聚合音频中的起始字节偏移
  endOffset: number;    // 在聚合音频中的结束字节偏移
  utteranceIndex: number;
  expectedDurationMs?: number;  // 预期时长（毫秒）
}
```

### 5.3 OriginalJobRegistration

```typescript
interface OriginalJobRegistration {
  expectedSegmentCount: number;  // 不再允许 undefined
  receivedCount: number;         // 已接收片段数量
  missingCount: number;          // 缺失片段数量
  ttlTimerHandle?: NodeJS.Timeout;  // TTL 定时器
  accumulatedSegments: OriginalJobASRData[];
  originalJob: JobAssignMessage;
  callback: OriginalJobCallback;
}
```

---

## 六、关键常量

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

## 七、相关文档

- [设计评审与优化建议](streaming_asr_node_optimization_guide.md) - 决策部门反馈
- [实施总结](implementation_summary.md) - P0 优化完成情况
- [AudioAggregator 完整流程分析](audio_aggregator_flow_analysis.md) - 详细的流程和方法调用
- [单元测试说明](unit_testing.md) - 测试覆盖和验证点

---

**文档结束**
