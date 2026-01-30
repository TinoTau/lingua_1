# 节点端任务处理流程

**日期**: 2026-01-24  
**目的**: 详细说明节点端收到任务后的完整处理流程，包括 AudioAggregator、ASR 处理和 UtteranceAggregator 三个关键环节

---

## 一、整体流程概览

### 1.1 完整调用链

```
调度服务器发送 JobAssignMessage
  ↓
节点端接收任务 (node-agent-simple.ts)
  ↓
JobProcessor.processJob()
  ↓
runJobPipeline() (job-pipeline.ts)
  ↓
executeStep('ASR', ...) (pipeline-step-registry.ts)
  ↓
runAsrStep() (asr-step.ts)
  ├─→ PipelineOrchestratorAudioProcessor.processAudio()
  │     └─→ AudioAggregator.processAudioChunk() 【阶段1】
  │           ├─→ MaxDuration Handler (如果是 MaxDuration finalize)
  │           ├─→ Finalize Handler (如果是手动/timeout finalize)
  │           └─→ 容器分配算法 (assignOriginalJobIdsForBatches)
  │
  ├─→ ASR 服务调用 (taskRouter.routeASRTask) 【阶段2】
  │     └─→ OriginalJobResultDispatcher.addASRSegment()
  │           └─→ 触发回调: runJobPipeline() (跳过 ASR 步骤)
  │                 └─→ executeStep('AGGREGATION', ...)
  │                       └─→ runAggregationStep() 【阶段3】
  │                             └─→ AggregationStage.process()
  │
  └─→ 返回结果给调度服务器
```

### 1.2 三种 Finalize 类型的处理路径

| Finalize 类型 | AudioAggregator 处理 | ASR 处理 | UtteranceAggregator 处理 |
|--------------|---------------------|---------|------------------------|
| **MaxDuration** | 按能量切片，处理前5秒（及以上），剩余部分缓存 | 立即处理前5秒（及以上）音频 | 每个原始 job 独立处理 |
| **手动** | 立即处理，合并 pending 音频 | 立即处理所有音频 | 每个原始 job 独立处理 |
| **Timeout** | 立即处理，合并 pending 音频，短音频缓存 | 立即处理所有音频 | 每个原始 job 独立处理 |

---

## 二、阶段1：AudioAggregator 处理

### 2.1 入口

**文件**: `pipeline-orchestrator/audio-aggregator.ts`

**方法**: `processAudioChunk(job: JobAssignMessage): Promise<AudioChunkResult>`

### 2.2 处理流程

#### 2.2.1 初始化和解码

**步骤**:
1. **提取标识**:
   - `isManualCut`: 手动截断标识
   - `isTimeoutTriggered`: 超时 finalize 标识
   - `isMaxDurationTriggered`: MaxDuration finalize 标识

2. **解码音频**:
   - 调用 `decodeAudioChunk()` 解码 Opus 音频为 PCM16
   - 获取 `currentAudio` 和 `currentDurationMs`

3. **获取或创建缓冲区**:
   - 使用 `buildBufferKey()` 生成 `bufferKey`
   - 使用 `bufferKey` 获取或创建 `AudioBuffer`

#### 2.2.2 TTL 检查（Timeout 专用）

**方法**: `timeoutHandler.checkTimeoutTTL()`

**逻辑**:
- 检查 `pendingTimeoutAudio` 是否超过 10 秒 TTL
- 如果超过且没有后续手动/静音切断，强制执行 finalize+ASR
- **注意**: `pendingMaxDurationAudio` 不需要 TTL 检查

#### 2.2.3 更新缓冲区

**步骤**:
1. 将 `currentAudio` 添加到 `buffer.audioChunks`
2. 更新 `buffer.totalDurationMs`
3. 记录当前 job 在聚合音频中的字节偏移范围（用于 `originalJobIds` 分配）

#### 2.2.4 Finalize 类型判断和处理

**三种 finalize 类型的处理路径**:

##### A. MaxDuration Finalize

**代码位置**: `audio-aggregator.ts:303-380`

**处理逻辑**:
```typescript
if (isMaxDurationTriggered && buffer) {
  const maxDurationResult = this.maxDurationHandler.handleMaxDurationFinalize(...);
  
  // 1. 合并之前的 pendingMaxDurationAudio（如果有）
  // 2. 按能量切片
  // 3. 流式切分：组合成~5秒批次
  // 4. 处理前5秒（及以上）音频，返回 audioSegments
  // 5. 缓存剩余部分（<5秒）到 pendingMaxDurationAudio
  
  if (maxDurationResult.shouldProcess && maxDurationResult.audioSegments) {
    return {
      audioSegments: maxDurationResult.audioSegments,
      originalJobIds: maxDurationResult.originalJobIds,
      shouldReturnEmpty: false,
    };
  } else {
    // 没有≥5秒的音频，全部缓存
    return {
      audioSegments: [],
      shouldReturnEmpty: true,
      isTimeoutPending: true,
    };
  }
}
```

**关键点**:
- ✅ 按能量切片，处理前5秒（及以上）音频
- ✅ 剩余部分缓存，等待下一个 job 合并
- ✅ 连续 MaxDuration finalize 会合并后继续处理前5秒（及以上）

##### B. 手动/Timeout Finalize

**代码位置**: `audio-aggregator.ts:382-474`

**处理逻辑**:
```typescript
const shouldProcessNow =
  isManualCut ||  // 手动截断：立即处理
  isTimeoutTriggered ||  // 超时finalize：立即处理
  buffer.totalDurationMs >= this.MAX_BUFFER_DURATION_MS ||  // 超过20秒：立即处理
  (buffer.totalDurationMs >= this.MIN_AUTO_PROCESS_DURATION_MS && !isTimeoutTriggered && !isMaxDurationTriggered);  // 达到10秒且不是超时/MaxDuration触发：立即处理

if (shouldProcessNow) {
  // 1. 聚合当前音频
  const currentAggregated = this.aggregateAudioChunks(buffer.audioChunks);
  
  // 2. 使用 finalizeHandler 处理合并逻辑
  const finalizeResult = this.finalizeHandler.handleFinalize(...);
  
  // 3. 合并 pendingTimeoutAudio（如果有）
  // 4. 合并 pendingMaxDurationAudio（如果有）
  // 5. 合并 pendingSmallSegments（如果有）
  
  // 6. 按能量切分
  const audioSegments = this.audioUtils.splitAudioByEnergy(...);
  
  // 7. 流式切分：组合成~5秒批次
  const { batches, remainingSmallSegments } = 
    this.createStreamingBatchesWithPending(audioSegments, jobInfoToProcess, shouldCacheRemaining);
  
  // 8. 分配 originalJobIds（使用容器分配算法）
  const originalJobIds = batchJobInfo.map(info => info.jobId);
  
  // 9. 返回处理后的音频段
  return {
    audioSegments: audioSegmentsBase64,
    originalJobIds,
    originalJobInfo: jobInfoToProcess,
    shouldReturnEmpty: false,
  };
}
```

**关键点**:
- ✅ 立即处理，不缓存等待
- ✅ 会合并 `pendingTimeoutAudio` 和 `pendingMaxDurationAudio`
- ✅ 按能量切分，流式切分，分配 `originalJobIds`

#### 2.2.5 容器分配算法

**文件**: `audio-aggregator-job-container.ts`

**算法逻辑**:
1. 从左到右扫描 batch（B0..Bn）
2. 按顺序依次填满 job0、job1、job2...
3. 容器装满后切换到下一个容器
4. 最后一个容器允许超长或为空

**目的**:
- 确保切片数量不会超过 job 容器数量
- 实现"头部对齐"策略：第一个 batch 属于哪个 job，整个批次就属于该 job

**统一分配策略**:
```typescript
// 所有 finalize 类型都使用相同的逻辑
const originalJobIds = batchJobInfo.map(info => info.jobId);
```

---

## 三、阶段2：ASR 处理

### 3.1 入口

**文件**: `pipeline/steps/asr-step.ts`

**方法**: `runAsrStep(job, ctx, services, options)`

### 3.2 处理流程

#### 3.2.1 音频处理

**步骤**:
1. **获取 AudioAggregator 结果**:
   ```typescript
   const audioProcessResult = await audioProcessor.processAudio(job);
   ```

2. **检查是否应该返回空**:
   - 如果 `shouldReturnEmpty = true`，设置 `ctx.shouldSkipPipeline = true`，直接返回

3. **提取音频段和 originalJobIds**:
   ```typescript
   const audioSegments = audioProcessResult.audioSegments || [audioProcessResult.audioForASR];
   const originalJobIds = audioProcessResult.originalJobIds || [];
   const originalJobInfo = audioProcessResult.originalJobInfo || [];
   ```

#### 3.2.2 OriginalJob 注册和分发

**文件**: `original-job-result-dispatcher.ts`

**逻辑**:
1. **注册原始 job**:
   ```typescript
   if (originalJobIds.length > 0) {
     const uniqueOriginalJobIds = Array.from(new Set(originalJobIds));
     
     for (const originalJobId of uniqueOriginalJobIds) {
       // 计算期望片段数量
       const batchCountForThisJob = originalJobIds.filter(id => id === originalJobId).length;
       const expectedSegmentCount = isFinalize 
         ? batchCountForThisJob  // 等待所有 batch 添加完成
         : undefined;  // 非 finalize 时累积等待
       
       // 注册原始 job
       dispatcher.registerOriginalJob(
         sessionId,
         originalJobId,
         expectedSegmentCount,
         originalJob,
         async (asrData, originalJobMsg) => {
           // 处理回调：为原始 job 执行后续处理
           const result = await runJobPipeline({
             job: originalJobMsg,
             services,
             ctx: originalCtx,  // 提供预初始化的 JobContext，跳过 ASR 步骤
           });
           
           // 发送原始 job 的结果到调度服务器
           services.resultSender.sendJobResult(originalJobMsg, result, ...);
         }
       );
     }
   }
   ```

2. **关键点**:
   - ✅ 按 `originalJobId` 分组注册
   - ✅ 使用原始 job 的 `utteranceIndex`（符合头部对齐策略）
   - ✅ 对于 finalize，等待所有 batch 添加完成后再处理
   - ✅ 对于非 finalize，累积等待直到 finalize
   - ✅ 注册时设置 10 秒 TTL，防止 job 一直等待

#### 3.2.3 ASR 服务调用

**步骤**:
1. **遍历音频段**:
   ```typescript
   for (let i = 0; i < audioSegments.length; i++) {
     const audioSegment = audioSegments[i];
     
     // 构建 ASR 任务
     const asrTask: ASRTask = {
       audio: audioSegment,
       audio_format: 'pcm16',
       sample_rate: job.sample_rate || 16000,
       src_lang: job.src_lang,
       enable_streaming: job.enable_streaming_asr || false,
       context_text: contextText,
       job_id: job.job_id,
       utterance_index: job.utterance_index,
     };
     
     // 调用 ASR 服务（带错误处理）
     try {
       const asrResult = await withGpuLease('ASR', async () => {
         return await services.taskRouter.routeASRTask(asrTask);
       });
       
       // 分发 ASR 结果
       if (originalJobIds.length > 0 && i < originalJobIds.length) {
         const originalJobId = originalJobIds[i];
         await dispatcher.addASRSegment(job.session_id, originalJobId, asrData);
       }
     } catch (error) {
       // ASR 失败：创建 missing: true 的 ASR 段
       const missingAsrData: OriginalJobASRData = {
         originalJobId: originalJobIds[i],
         asrText: '',
         asrSegments: [],
         missing: true,  // 标记为缺失
         batchIndex: i,
       };
       await dispatcher.addASRSegment(job.session_id, originalJobIds[i], missingAsrData);
     }
   }
   ```

2. **关键点**:
   - ✅ 为每个音频段调用 ASR 服务
   - ✅ 分发 ASR 结果到对应的 `originalJobId`
   - ✅ ASR 失败时创建 `missing: true` 的 ASR 段，确保 job 完成

#### 3.2.4 ASR 结果累积和触发

**文件**: `original-job-result-dispatcher.ts`

**方法**: `addASRSegment()`

**逻辑**:
```typescript
async addASRSegment(sessionId, originalJobId, asrData): Promise<boolean> {
  // 1. 累积 ASR 结果
  registration.accumulatedSegments.push(asrData);
  registration.accumulatedSegmentsList.push(...asrData.asrSegments);
  
  // 2. 更新计数
  registration.receivedCount++;
  if (asrData.missing) {
    registration.missingCount++;
  }
  
  // 3. 检查是否应该立即处理
  const shouldProcess =
    registration.expectedSegmentCount != null &&
    registration.accumulatedSegments.length >= registration.expectedSegmentCount;
  
  if (shouldProcess) {
    // 4. 清除 TTL 定时器
    if (registration.ttlTimerHandle) {
      clearTimeout(registration.ttlTimerHandle);
      registration.ttlTimerHandle = undefined;
    }
    
    // 5. 按 batchIndex 排序，保证顺序
    const sortedSegments = [...registration.accumulatedSegments]
      .filter(s => !s.missing)  // 过滤缺失的段
      .sort((a, b) => {
        const aIndex = a.batchIndex ?? 0;
        const bIndex = b.batchIndex ?? 0;
        return aIndex - bIndex;
      });
    
    // 6. 按排序后的顺序合并文本
    const fullText = sortedSegments.map(s => s.asrText).join(' ');
    
    // 7. 触发处理回调（执行后续 pipeline）
    await registration.callback(finalAsrData, registration.originalJob);
  }
  
  return shouldProcess;
}
```

**关键点**:
- ✅ 按 `originalJobId` 分组累积
- ✅ 按 `batchIndex` 排序，保证顺序
- ✅ 合并多个 ASR 批次成同一个 job 的结果
- ✅ 过滤缺失的段（`missing: true`），只使用有效的 ASR 结果
- ✅ 实现"头部对齐"逻辑：同一个 `originalJobId` 的所有 ASR 批次会合并成一个结果

#### 3.2.5 TTL 机制

**代码位置**: `original-job-result-dispatcher.ts`

**逻辑**:
```typescript
// 注册时设置 TTL
registerOriginalJob(sessionId, originalJobId, expectedSegmentCount, originalJob, callback) {
  // 设置 10 秒 TTL
  const ttlTimerHandle = setTimeout(async () => {
    await this.forceFinalizePartial(sessionId, originalJobId);
  }, this.REGISTRATION_TTL_MS);
  
  registration.ttlTimerHandle = ttlTimerHandle;
}

// TTL 到期时强制处理部分结果
async forceFinalizePartial(sessionId, originalJobId) {
  // 使用当前累积的结果，即使未达到 expectedSegmentCount
  // 触发回调，处理部分结果
}
```

**目的**:
- ✅ 防止 job 一直等待（如果某些 ASR 段失败或丢失）
- ✅ 确保部分结果能够及时处理

---

## 四、阶段3：UtteranceAggregator 处理

### 4.1 入口

**文件**: `agent/postprocess/aggregation-stage.ts`

**方法**: `process(job, result)`

### 4.2 处理流程

#### 4.2.1 前置检查

**步骤**:
1. **检查 ASR 文本是否为空**
2. **检查 AggregatorManager 是否启用**

#### 4.2.2 AggregationStage 处理

**步骤**:
1. **调用 AggregatorManager**:
   ```typescript
   const aggregatorResult = this.aggregatorManager.processUtterance(
     job.session_id,
     asrTextTrimmed,
     segments,
     langProbs,
     result.quality_score,
     true,  // isFinal: P0 只处理 final 结果
     isManualCut,
     mode,  // 'two_way'
     isTimeoutTriggered
   );
   ```

2. **处理聚合结果**:
   - `MERGE`: 合并组中的最后一个 utterance，返回聚合后的文本
   - `NEW_STREAM`: 返回原始 ASR 文本

#### 4.2.3 去重处理

**步骤**:
1. **DeduplicationHandler 去重**: 去除完全重复或重叠的文本
2. **TextForwardMergeManager 向前合并**: 处理短文本（< 6字符丢弃，6-20字符等待合并，> 10字符发送给语义修复）

---

## 五、关键设计决策

### 5.1 头部对齐策略

**策略**:
- 每个 ASR 批次应该使用**第一个切片的 job 容器**进行聚合
- 只有最后一个 job（手动/timeout finalize）使用**它自己的容器**

**目的**:
- 确保切片数量不会超过 job 容器数量
- 不会产生文本丢失的情况
- 使最终返回结果更完整，用户体验更好

### 5.2 统一分配策略

**实现**:
```typescript
// 所有 finalize 类型都使用相同的逻辑
const originalJobIds = batchJobInfo.map(info => info.jobId);
```

**优势**:
- ✅ 代码简洁，易于理解
- ✅ 统一的处理逻辑，减少错误
- ✅ 符合头部对齐策略

### 5.3 ASR 失败处理

**策略**:
- 如果 ASR 调用失败，创建 `missing: true` 的 ASR 段
- 在最终文本中过滤缺失的段
- 确保 job 能够完成，不会一直等待

---

## 六、相关文档

- [任务处理流程](./job_processing_flow.md)
- [Finalize 处理机制](../finalize/README.md)
- [音频处理](../audio/README.md)
- [节点端音频处理和 ASR 结果聚合](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/architecture_and_flow.md)

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24
