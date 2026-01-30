# 头部对齐设计 vs 实际实现分析报告

**日期**: 2026-01-27  
**分析目标**: 确认实际代码是否与"按job头部对齐"的设计一致  
**合并报告**：详见 [INTEGRATION_TEST_MERGED_REPORT.md](./INTEGRATION_TEST_MERGED_REPORT.md)。

---

## 一、设计意图

### 场景示例
假设35秒长语音被调度服务器拆成4个job（job0, job1, job2, job3），进入节点端后被AudioAggregator切分成多个片段：

| 片段 | 时长 | 所属Job |
|------|------|---------|
| job0_1 | 3秒 | job0 |
| job0_2 | 3秒 | job0 |
| job0_3 | 4秒 | job0 |
| job1_1 | 3秒 | job1 |
| job1_2 | 3秒 | job1 |
| job1_3 | 4秒 | job1 |
| job2_1 | 3秒 | job2 |
| job2_2 | 3秒 | job2 |
| job2_3 | 3秒 | job2 |
| job2_4 | 1秒 | job2 |
| job3_1 | 5秒 | job3 |

### 设计目标
1. **AudioAggregator阶段**：按能量切分，合并成~5秒批次
   - job0_1+job0_2 = 6秒 → batch0
   - job0_3+job1_1 = 7秒 → batch1
   - job1_2+job1_3 = 7秒 → batch2
   - job2_1+job2_2 = 6秒 → batch3
   - job2_3+job2_4+job3_1 = 9秒 → batch4

2. **头部对齐策略**：每个batch使用其第一个片段所属的job容器
   - batch0（job0_1开头）→ `originalJobId = job0`
   - batch1（job0_3开头）→ `originalJobId = job0`（**关键：虽然包含job1_1，但头部是job0_3，所以归属job0**）
   - batch2（job1_2开头）→ `originalJobId = job1`
   - batch3（job2_1开头）→ `originalJobId = job2`
   - batch4（job2_3开头）→ `originalJobId = job2`（**关键：虽然包含job3_1，但头部是job2_3，所以归属job2**）

3. **Utterance聚合阶段**：按原始job分组，合并多个batch的文本
   - job0：batch0 + batch1 → 合并后送NMT
   - job1：batch2 → 送NMT
   - job2：batch3 + batch4 → 合并后送NMT
   - job3：如果没有以job3开头的batch，视为合并入job2

4. **目标**：确保切片数量不超过job容器数量，避免文本丢失

---

## 二、实际代码实现

### 1. AudioAggregator阶段 ✅ 符合设计

**文件**: `audio-aggregator-stream-batcher.ts`

```typescript
// 每个 batch 的第一个片段对应的 jobInfo（用于头部对齐策略）
batchJobInfo: OriginalJobInfo[];

// 在 createStreamingBatchesWithPending 中：
if (currentBatch.length === 0) {
  // 这是当前 batch 的第一个片段
  currentBatchFirstSegmentOffset = segmentOffset;
}
// ...
// 记录当前 batch 的第一个片段对应的 jobInfo
if (currentBatchFirstSegmentOffset !== undefined) {
  const firstSegmentJobInfo = this.findJobInfoByOffset(
    currentBatchFirstSegmentOffset,
    jobInfo
  );
  batchJobInfo.push(firstSegmentJobInfo);
}
```

**文件**: `audio-aggregator.ts`

```typescript
// ✅ 统一 batch → originalJobId 归属策略：全局采用头部对齐
const originalJobIds = batchJobInfo.map(info => info.jobId);
```

**结论**: ✅ **实现正确**，每个batch使用第一个片段对应的jobId作为`originalJobId`。

---

### 2. ASR阶段 ✅ 符合设计

**文件**: `asr-step.ts`

```typescript
// 按原始job_id分组处理
if (originalJobIds.length > 0) {
  const uniqueOriginalJobIds = Array.from(new Set(originalJobIds));
  
  for (const originalJobId of uniqueOriginalJobIds) {
    // 计算该 originalJobId 对应的 batch 数量
    const batchCountForThisJob = originalJobIds.filter(id => id === originalJobId).length;
    const expectedSegmentCount = batchCountForThisJob;
    
    // 注册原始job，等待所有batch都添加完成后再处理
    dispatcher.registerOriginalJob(
      job.session_id,
      originalJobId,
      expectedSegmentCount,
      originalJob,
      async (asrData: OriginalJobASRData, originalJobMsg: JobAssignMessage) => {
        // 处理回调：为原始job执行后续处理（聚合、语义修复、翻译、TTS）
        // ...
      }
    );
  }
}

// 处理每个ASR批次
for (let i = 0; i < audioSegments.length; i++) {
  // ...
  const asrResult = await services.taskRouter.routeASRTask(asrTask);
  
  // 如果存在originalJobIds，通过dispatcher分发
  if (originalJobIds.length > 0 && i < originalJobIds.length) {
    const originalJobId = originalJobIds[i];
    
    const asrData: OriginalJobASRData = {
      originalJobId,
      asrText: asrResult.text || '',
      asrSegments: asrResult.segments || [],
      languageProbabilities: asrResult.language_probabilities,
      batchIndex: i,  // ✅ 记录批次索引（用于排序）
    };
    
    await dispatcher.addASRSegment(job.session_id, originalJobId, asrData);
  }
}
```

**结论**: ✅ **实现正确**，按`originalJobIds`分组注册原始job，每个ASR batch的结果通过`addASRSegment`添加到对应的原始job。

---

### 3. OriginalJobResultDispatcher ✅ 符合设计

**文件**: `original-job-result-dispatcher.ts`

```typescript
async addASRSegment(
  sessionId: string,
  originalJobId: string,
  asrData: OriginalJobASRData
): Promise<boolean> {
  // ✅ 累积ASR结果
  registration.accumulatedSegments.push(asrData);
  registration.receivedCount++;
  
  // ✅ 检查是否应该立即处理：当 receivedCount >= expectedSegmentCount 时触发
  const shouldProcess = registration.receivedCount >= registration.expectedSegmentCount;
  
  if (shouldProcess) {
    // ✅ 按batchIndex排序，保证顺序
    const sortedSegments = [...registration.accumulatedSegments].sort((a, b) => {
      const aIndex = a.batchIndex ?? 0;
      const bIndex = b.batchIndex ?? 0;
      return aIndex - bIndex;
    });
    
    // ✅ 按排序后的顺序合并文本
    const fullText = sortedSegments.map(s => s.asrText).join(' ');
    
    // 触发处理回调（聚合、语义修复、翻译、TTS）
    await registration.callback(finalAsrData, registration.originalJob);
  }
}
```

**结论**: ✅ **实现正确**，当所有batch都添加完成后，按`batchIndex`排序并合并文本，然后触发后续处理。

---

## 三、潜在问题分析

### 问题1：Job [25c9…] 多ASR单NMT

**现象**（来自日志分析报告）：
- Job [25c9…] 有2次ASR调用（ASR #1 和 ASR #2）
- 但只有第2段文本送了NMT，第1段整段丢失

**可能原因**：

1. **`originalJobIds` 数组不正确**
   - 如果 `originalJobIds` 中，ASR #1 和 ASR #2 被分配到了不同的 `originalJobId`，但只有其中一个被正确注册和处理
   - 需要检查日志中 `originalJobIds` 的实际值

2. **`expectedSegmentCount` 计算错误**
   - 如果 `expectedSegmentCount` 被错误计算（例如，只计算了1个batch，但实际有2个），可能导致只等待1个batch就触发处理
   - 需要检查日志中 `expectedSegmentCount` 和 `batchCountForThisJob` 的值

3. **`addASRSegment` 未被调用**
   - 如果条件判断 `if (originalJobIds.length > 0 && i < originalJobIds.length)` 失败，可能导致某些batch没有被添加到dispatcher
   - 需要检查日志中是否有 `addASRSegment` 的调用记录

4. **TTL超时导致部分batch丢失**
   - 如果ASR #1 返回较慢，在ASR #2 返回时，TTL（10秒）可能已过期，导致 `forceFinalizePartial` 被触发，但此时只累积了ASR #2
   - 需要检查日志中是否有 `forceFinalizePartial` 的调用记录

---

### 问题2：有聚合无ASR/NMT的Job

**现象**（来自日志分析报告）：
- Job [1]、Job [22be…] 在AudioAggregator有处理记录，但无ASR/NMT日志

**可能原因**：

1. **空音频或无效音频**
   - AudioAggregator处理了音频，但生成的segments为空或无效，导致没有调用ASR
   - 需要检查日志中是否有 `EMPTY_INPUT`、`shouldReturnEmpty` 等标识

2. **被合并到其他job**
   - 这些job的音频被合并到其他job的batch中，本job作为空容器处理
   - 需要检查日志中是否有 `NO_TEXT_ASSIGNED` 的空结果核销

3. **ASR调用失败但未记录**
   - ASR调用失败，但错误日志未正确记录
   - 需要检查ASR服务日志

---

## 四、代码与设计的一致性

### ✅ 一致的部分

1. **AudioAggregator头部对齐**：✅ 实现正确
   - 每个batch使用第一个片段对应的jobId作为`originalJobId`

2. **ASR结果分发**：✅ 实现正确
   - 按`originalJobIds`分组注册原始job
   - 每个ASR batch的结果通过`addASRSegment`添加到对应的原始job

3. **多batch聚合**：✅ 实现正确
   - `OriginalJobResultDispatcher` 累积多个batch的结果
   - 当 `receivedCount >= expectedSegmentCount` 时，按`batchIndex`排序并合并文本

### ⚠️ 需要验证的部分

1. **`originalJobIds` 数组的正确性**
   - 需要确认AudioAggregator生成的`originalJobIds`数组是否与设计一致
   - 特别是在跨job合并的场景（例如batch1包含job0_3和job1_1，但头部是job0_3）

2. **`expectedSegmentCount` 的计算**
   - 需要确认 `batchCountForThisJob = originalJobIds.filter(id => id === originalJobId).length` 是否正确
   - 特别是在多个batch属于同一个originalJobId的场景

3. **TTL超时处理**
   - 需要确认TTL（10秒）是否足够等待所有batch返回
   - 如果不够，可能导致部分batch丢失

---

## 五、建议的验证步骤

1. **检查日志中的`originalJobIds`**
   ```bash
   grep -i "originalJobIds" electron-node/logs/electron-main.log | grep "job-25c9d9ee"
   ```

2. **检查日志中的`expectedSegmentCount`**
   ```bash
   grep -i "expectedSegmentCount\|batchCountForThisJob" electron-node/logs/electron-main.log | grep "job-25c9d9ee"
   ```

3. **检查日志中的`addASRSegment`调用**
   ```bash
   grep -i "addASRSegment\|Accumulate.*Added ASR segment" electron-node/logs/electron-main.log | grep "job-25c9d9ee"
   ```

4. **检查日志中的`forceFinalizePartial`调用**
   ```bash
   grep -i "forceFinalizePartial\|Force finalize partial" electron-node/logs/electron-main.log | grep "job-25c9d9ee"
   ```

5. **检查日志中的文本合并**
   ```bash
   grep -i "TextMerge.*Merged ASR batches" electron-node/logs/electron-main.log | grep "job-25c9d9ee"
   ```

---

## 六、结论

**总体评估**：实际代码实现与设计意图**基本一致**，但在以下方面需要进一步验证：

1. ✅ **AudioAggregator头部对齐**：实现正确
2. ✅ **ASR结果分发**：实现正确
3. ✅ **多batch聚合**：实现正确
4. ⚠️ **`originalJobIds`数组正确性**：需要验证（特别是跨job合并场景）
5. ⚠️ **`expectedSegmentCount`计算**：需要验证（特别是多个batch属于同一个originalJobId的场景）
6. ⚠️ **TTL超时处理**：需要验证（是否足够等待所有batch返回）

**建议**：通过日志分析验证上述问题，特别是Job [25c9…] 的完整处理流程，确认是否存在实现与设计不一致的地方。
