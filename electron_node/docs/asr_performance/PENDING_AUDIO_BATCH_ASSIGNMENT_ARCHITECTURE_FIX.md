# Pending音频Batch分配架构修复方案

**日期**: 2026-01-28  
**问题**: Job4合并了Job3的pendingMaxDurationAudio，但batch被分配到了Job3，导致Job4被标记为空容器

---

## 一、问题分析

### 1.1 当前流程（Job4 MaxDuration finalize）

**Job4处理流程**:
1. Job4是MaxDuration finalize，合并了Job3的pendingMaxDurationAudio（12680ms = 2880ms + 9800ms）
2. `AudioAggregatorMaxDurationHandler.handleMaxDurationFinalize`中：
   - `jobInfoToProcess = [...existingPendingJobInfo, ...currentJobInfo]`（包含Job3和Job4的jobInfo）
   - 调用`createStreamingBatchesWithPending`，传入`jobInfoToProcess`（包含Job3和Job4的jobInfo）
   - `createStreamingBatchesWithPending`使用头部对齐策略，根据batch的第一个片段来查找jobInfo
   - 由于合并后的音频的第一个片段来自pending音频（属于Job3），所以batch被分配到了Job3
3. 返回的`originalJobIds`包含Job3，但`originalJobInfo`包含Job3和Job4
4. 在`asr-step.ts`中，空容器检测逻辑发现Job4在`originalJobInfo`中但不在`originalJobIds`中，所以被标记为空容器

**问题根源**:
- `AudioAggregatorMaxDurationHandler`合并pendingMaxDurationAudio时，`jobInfoToProcess`包含pending和当前job的jobInfo（这是正确的，因为合并后的音频包含两部分）
- 但batch分配时，使用头部对齐策略，batch的第一个片段来自pending音频（属于Job3），所以batch被分配到了Job3
- 这与设计意图不符：合并pending音频时，batch应该属于当前job（Job4）

---

## 二、架构设计问题

### 2.1 设计意图

**设计意图**:
- 合并pendingMaxDurationAudio时，batch应该属于当前job（合并pending的job），而不是原始job（产生pending的job）

**当前实现**:
- `AudioAggregatorMaxDurationHandler`合并pendingMaxDurationAudio时，`jobInfoToProcess`包含pending和当前job的jobInfo
- `createStreamingBatchesWithPending`使用头部对齐策略，根据batch的第一个片段来分配batch
- 由于batch的第一个片段来自pending音频（属于Job3），所以batch被分配到了Job3

**设计矛盾**:
- 头部对齐策略：batch属于第一个片段所属的job
- 合并pending音频的设计意图：batch应该属于当前job（合并pending的job）

---

## 三、架构修复方案

### 3.1 方案：在MaxDurationHandler中强制batch分配

**设计**:
- 在`AudioAggregatorMaxDurationHandler`中，如果合并了pendingMaxDurationAudio，强制所有batch使用当前job的jobId
- 不修改`createStreamingBatchesWithPending`的逻辑，保持头部对齐策略的通用性
- 只在MaxDurationHandler中特殊处理合并pending音频的情况

**实现**:
- 在`createStreamingBatchesWithPending`后，如果合并了pendingMaxDurationAudio，强制所有batch使用当前job的jobId

**优点**:
- ✅ **简单直接**：只需要在batch分配后强制覆盖jobId
- ✅ **不新增流程路径**：只修改batch分配逻辑，不新增处理流程
- ✅ **符合设计意图**：合并pending音频时，batch属于当前job
- ✅ **保持代码简洁**：不需要修改`createStreamingBatchesWithPending`的逻辑

**缺点**:
- ⚠️ 需要在MaxDurationHandler中特殊处理，但这是必要的

---

## 四、实现细节

### 4.1 修改点

**文件**: `audio-aggregator-maxduration-handler.ts`

**修改位置**: 第189行（batch分配后）

**当前代码**:
```typescript
// 分配originalJobIds
// 业务需求：每个 batch 使用其第一个音频片段所属的 job 容器（头部对齐策略）
// 架构设计：createStreamingBatchesWithPending 已经返回了每个 batch 的第一个片段对应的 jobInfo
// 直接使用 batchJobInfo，无需重新计算偏移量
const originalJobIds = batchJobInfo.map(info => info.jobId);
```

**修改后**:
```typescript
// 分配originalJobIds
// ✅ 架构设计：如果合并了pendingMaxDurationAudio，强制所有batch使用当前job的jobId
// 原因：合并pending音频时，batch应该属于当前job（合并pending的job），而不是原始job（产生pending的job）
// 设计：不修改createStreamingBatchesWithPending的逻辑，保持头部对齐策略的通用性
// 只在MaxDurationHandler中特殊处理合并pending音频的情况
const hasMergedPendingAudio = !!buffer.pendingMaxDurationAudio;
let originalJobIds: string[];

if (hasMergedPendingAudio) {
  // 合并pendingMaxDurationAudio时，强制所有batch使用当前job的jobId
  originalJobIds = batches.map(() => job.job_id);
} else {
  // 没有合并pending音频时，使用头部对齐策略
  originalJobIds = batchJobInfo.map(info => info.jobId);
}
```

---

## 五、风险评估

### 5.1 风险

**风险**:
- ⚠️ 修改batch分配逻辑，可能影响其他场景

**缓解措施**:
- ✅ 只在`hasMergedPendingAudio`时修改，不影响其他场景
- ✅ 修改逻辑简单直接，不会引入新的问题
- ✅ 不修改`createStreamingBatchesWithPending`的逻辑，保持头部对齐策略的通用性

### 5.2 测试

**需要测试**:
- ✅ 合并pendingMaxDurationAudio时，batch被正确分配到当前job
- ✅ 不合并pending音频时，batch分配逻辑不受影响（使用头部对齐策略）
- ✅ 空容器检测逻辑正确

---

## 六、结论

**推荐方案**:
- ✅ 在MaxDurationHandler中强制batch分配
- ✅ 简单直接，不新增流程路径
- ✅ 符合设计意图，保持代码简洁

**实现**:
- 在`createStreamingBatchesWithPending`后，如果合并了pendingMaxDurationAudio，强制所有batch使用当前job的jobId
- 不修改`createStreamingBatchesWithPending`的逻辑，保持头部对齐策略的通用性

---

*本方案通过架构设计解决pending音频归属问题，不新增不必要的流程路径，保持代码简洁。*
