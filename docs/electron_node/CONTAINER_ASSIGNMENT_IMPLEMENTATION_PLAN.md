# 容器分配算法实现计划

## 目标

按照 `LONG_UTTERANCE_35S_EXAMPLE_IMPLEMENTATION_GUIDE_FULL.md` 的要求，实现完整的容器分配算法，确保：
1. 最终输出文本段数 ≤ Job数量
2. 根据expectedDurationMs判断容器是否装满
3. 容器装满后自动切换到下一个容器
4. 空容器发送空核销结果

---

## 当前状态

### 已实现
- ✅ utteranceIndex使用原始job的index（已修复）
- ✅ OriginalJobResultDispatcher按原始job_id分发ASR结果
- ✅ 头部对齐策略（assignOriginalJobIdsForBatches）

### 待实现
- ❌ expectedDurationMs字段（调度端计算，节点端接收）
- ❌ 容器分配算法（根据expectedDurationMs判断容器是否装满）
- ❌ 容器装满判定逻辑

---

## 实现步骤

### 步骤1: 添加expectedDurationMs字段

#### 1.1 调度端（Rust）

**文件**: `central_server/shared/protocols/messages.ts`

**修改**:
```typescript
export interface JobAssignMessage {
  // ... 现有字段 ...
  /** 预期时长（毫秒），用于容器分配算法判断容器是否装满 */
  expected_duration_ms?: number;
}
```

**文件**: `central_server/scheduler/src/websocket/job_creator.rs`

**修改**: 在创建job时计算expectedDurationMs
```rust
// 计算expectedDurationMs
let expected_duration_ms = if let Some(duration) = job_duration_ms {
    // 使用实际音频时长
    duration
} else {
    // 使用MaxDuration作为默认值
    max_duration_ms
};

// 在创建JobAssignMessage时添加
expected_duration_ms: Some(expected_duration_ms),
```

#### 1.2 节点端（TypeScript）

**文件**: `electron_node/shared/protocols/messages.ts`

**修改**: 添加expectedDurationMs字段（与调度端同步）

**文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator-types.ts`

**修改**: 在OriginalJobInfo中添加expectedDurationMs
```typescript
export interface OriginalJobInfo {
  jobId: string;
  startOffset: number;
  endOffset: number;
  utteranceIndex: number;
  expectedDurationMs?: number;  // 新增
}
```

---

### 步骤2: 实现容器分配算法

#### 2.1 数据结构

**文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator-types.ts`

**新增**:
```typescript
/**
 * Job容器（用户可见文本单位）
 */
export interface JobContainer {
  jobId: string;
  expectedDurationMs: number;
  batches: Buffer[];
  currentDurationMs: number;
  utteranceIndex: number;
}

/**
 * Batch元数据
 */
export interface AudioBatchMetadata {
  batch: Buffer;
  durationMs: number;
  startJobId: string;  // 首帧所属原始job
  endJobId?: string;   // 尾帧所属原始job（可选）
}
```

#### 2.2 容器分配算法

**文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts`

**新增方法**:
```typescript
/**
 * 构建Job容器
 */
private buildContainers(
  jobInfo: OriginalJobInfo[]
): JobContainer[] {
  const containers: JobContainer[] = [];
  for (const info of jobInfo) {
    containers.push({
      jobId: info.jobId,
      expectedDurationMs: info.expectedDurationMs || 10000, // 默认10秒
      batches: [],
      currentDurationMs: 0,
      utteranceIndex: info.utteranceIndex,
    });
  }
  return containers;
}

/**
 * 容器分配算法：将batch分配给job容器
 * 
 * 算法逻辑：
 * 1. 从左到右扫描batch
 * 2. 按顺序依次填满job0、job1、job2...
 * 3. 容器装满后切换到下一个容器
 * 4. 最后一个容器允许超长或为空
 */
private assignBatchesToContainers(
  batches: Buffer[],
  containers: JobContainer[],
  sampleRate: number,
  bytesPerSample: number
): JobContainer[] {
  let containerIndex = 0;
  const maxContainerIndex = containers.length - 1;

  for (const batch of batches) {
    // 安全防御：所有多出的batch都塞进最后一个容器
    if (containerIndex > maxContainerIndex) {
      const last = containers[maxContainerIndex];
      last.batches.push(batch);
      const batchDurationMs = (batch.length / bytesPerSample / sampleRate) * 1000;
      last.currentDurationMs += batchDurationMs;
      continue;
    }

    let container = containers[containerIndex];

    // 计算batch时长
    const batchDurationMs = (batch.length / bytesPerSample / sampleRate) * 1000;

    // 当前容器还没装满：继续累积
    if (container.currentDurationMs < container.expectedDurationMs) {
      container.batches.push(batch);
      container.currentDurationMs += batchDurationMs;

      // 容器达到或超过预期：后续切到下一个容器
      if (container.currentDurationMs >= container.expectedDurationMs &&
          containerIndex < maxContainerIndex) {
        containerIndex += 1;
      }

      continue;
    }

    // 当前容器已经装满：切换到下一个容器
    if (containerIndex < maxContainerIndex) {
      containerIndex += 1;
      container = containers[containerIndex];
      container.batches.push(batch);
      container.currentDurationMs += batchDurationMs;
    } else {
      // 已是最后一个容器：全部放进来
      container.batches.push(batch);
      container.currentDurationMs += batchDurationMs;
    }
  }

  return containers;
}
```

#### 2.3 修改assignOriginalJobIdsForBatches

**替换当前实现**:
```typescript
/**
 * 为音频批次分配originalJobIds（使用容器分配算法）
 */
private assignOriginalJobIdsForBatches(
  batches: Buffer[],
  jobInfo: OriginalJobInfo[]
): string[] {
  if (jobInfo.length === 0) {
    return [];
  }

  // 构建容器
  const containers = this.buildContainers(jobInfo);
  
  // 分配batch到容器
  const assignedContainers = this.assignBatchesToContainers(
    batches,
    containers,
    this.SAMPLE_RATE,
    this.BYTES_PER_SAMPLE
  );

  // 为每个batch分配对应的originalJobId
  const originalJobIds: string[] = [];
  let batchIndex = 0;

  for (const container of assignedContainers) {
    for (const batch of container.batches) {
      originalJobIds.push(container.jobId);
      batchIndex++;
    }
  }

  // 确保返回的数组长度与batches长度一致
  while (originalJobIds.length < batches.length) {
    // 如果还有未分配的batch，分配给最后一个容器
    originalJobIds.push(assignedContainers[assignedContainers.length - 1].jobId);
  }

  return originalJobIds;
}
```

---

### 步骤3: 在AudioAggregator中记录expectedDurationMs

**文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts`

**修改**: 在processAudioChunk中记录expectedDurationMs
```typescript
// 记录当前job在聚合音频中的字节偏移范围
const aggregatedAudioLength = this.aggregateAudioChunks(buffer.audioChunks).length;
const currentJobStartOffset = aggregatedAudioLength - currentAudio.length;
const currentJobEndOffset = aggregatedAudioLength;

// 获取expectedDurationMs（从job消息中）
const expectedDurationMs = (job as any).expected_duration_ms || 
  (currentDurationMs * 1.2); // 如果没有，使用当前时长的1.2倍作为估算

buffer.originalJobInfo.push({
  jobId: job.job_id,
  startOffset: currentJobStartOffset,
  endOffset: currentJobEndOffset,
  utteranceIndex: job.utterance_index,
  expectedDurationMs: expectedDurationMs,  // 新增
});
```

---

### 步骤4: 确保空容器发送空核销

**文件**: `electron_node/electron-node/main/src/pipeline/steps/asr-step.ts`

**修改**: 在OriginalJobResultDispatcher回调中检查容器是否为空
```typescript
// 在asr-step.ts中，当originalJobIds为空时，检查是否需要发送空核销
if (originalJobIds.length === 0) {
  // 检查当前job是否应该发送空核销
  // 这应该在容器分配算法中处理，但这里作为防御性检查
  logger.info(
    {
      jobId: job.job_id,
      sessionId: job.session_id,
      note: 'No originalJobIds assigned, may need empty result acknowledgment',
    },
    'runAsrStep: No originalJobIds assigned'
  );
}
```

---

## 测试验证

### 测试场景1: 35秒长语音，4个job，5个batch

**输入**:
- job0: 0-10s (expectedDurationMs: 10000)
- job1: 10-20s (expectedDurationMs: 10000)
- job2: 20-30s (expectedDurationMs: 10000)
- job3: 30-35s (expectedDurationMs: 5000)
- 5个batch: B0(6s), B1(7s), B2(7s), B3(6s), B4(9s)

**预期结果**:
- Container(job0) ← B0 (6s < 10s, 未装满)
- Container(job0) ← B1 (6s + 7s = 13s >= 10s, 装满，切换到job1)
- Container(job1) ← B2 (7s < 10s, 未装满)
- Container(job1) ← B3 (7s + 6s = 13s >= 10s, 装满，切换到job2)
- Container(job2) ← B4 (9s < 10s, 未装满，但已是最后一个batch)
- Container(job3) ← (empty) → 发送空核销

**最终输出**: 3段文本（job0, job1, job2），job3空核销

---

## 实施优先级

1. **高优先级**: 步骤1（添加expectedDurationMs字段）
2. **高优先级**: 步骤2（实现容器分配算法）
3. **中优先级**: 步骤3（在AudioAggregator中记录expectedDurationMs）
4. **低优先级**: 步骤4（空容器空核销，已有部分实现）

---

## 注意事项

1. **向后兼容**: expectedDurationMs应该是可选字段，如果没有提供，使用默认值或估算值
2. **性能**: 容器分配算法应该高效，避免不必要的计算
3. **日志**: 添加详细日志，便于调试和验证
4. **测试**: 确保现有测试通过，添加新的集成测试
