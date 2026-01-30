# Job3 Batch分配问题分析

**日期**: 2026-01-28  
**问题**: Job3的batch被错误地分配到了job1，导致文本丢失

---

## 一、问题现象

**从日志看到**：
```
jobId: job-168a54c4-0b31-404f-8e60-e50df06c9ff8 (job3)
originalJobIds: ["job-355e0727-1b60-418f-b4ad-929da7be042b", "job-355e0727-1b60-418f-b4ad-929da7be042b"]
ownerJobId: job-355e0727-1b60-418f-b4ad-929da7be042b (job1)
```

**问题**：
- job3的两个batch都被分配给了job-355e0727（job1的originalJobId）
- 这导致job3的文本被合并到了job1中，job3本身没有文本

---

## 二、根本原因分析

### 2.1 头部对齐策略

**当前逻辑**（`audio-aggregator-stream-batcher.ts`）：
```typescript
// 每个 batch 使用其第一个音频片段所属的 job 容器（头部对齐策略）
const firstSegmentJobInfo = this.findJobInfoByOffset(
  currentBatchFirstSegmentOffset,
  jobInfo
);
batchJobInfo.push(firstSegmentJobInfo);
```

**问题**：
- 当job3合并了pendingMaxDurationAudio（来自job1）时
- 合并后的音频中，第一个片段来自job1的pendingMaxDurationAudio
- 头部对齐策略导致所有batch都被分配给了job1

### 2.2 合并时的jobInfo处理

**当前逻辑**（`audio-aggregator-finalize-handler.ts` 第419行）：
```typescript
const mergedJobInfo = [...pendingJobInfo, ...currentJobInfo];
```

**问题**：
- `pendingJobInfo`来自job1（pendingMaxDurationJobInfo）
- `currentJobInfo`来自job3（buffer.originalJobInfo）
- 合并后，jobInfo数组的前半部分是job1的，后半部分是job3的
- 但头部对齐策略只看第一个片段，所以所有batch都被分配给了job1

---

## 三、架构设计问题

### 3.1 当前设计的问题

**问题**：
- 头部对齐策略在合并场景下不适用
- 当合并pendingMaxDurationAudio时，应该使用当前job的jobId，而不是pending的jobId

### 3.2 正确的设计应该是

**方案1: 使用当前job的jobId（推荐）**
- 当手动/timeout finalize合并pendingMaxDurationAudio时
- 所有batch应该使用当前job的jobId
- 因为这是当前job触发的finalize，结果应该属于当前job

**方案2: 按比例分配**
- 根据pending和current的时长比例
- 分配batch到对应的jobId
- 但这太复杂，不符合"简单易懂"的原则

---

## 四、修复方案

### 方案1: 合并时使用当前job的jobId（推荐）

**思路**：
- 当合并pendingMaxDurationAudio时，所有batch使用当前job的jobId
- 简单直接，符合业务逻辑

**实现**：
```typescript
// 在audio-aggregator.ts中，合并pendingMaxDurationAudio后
// 如果hasMergedPendingAudio，所有batch使用当前job的jobId
if (hasMergedPendingAudio) {
  // 使用当前job的jobId，而不是头部对齐策略
  const currentJobInfo: OriginalJobInfo = {
    jobId: job.job_id,
    utteranceIndex: job.utterance_index,
    startOffset: 0,
    endOffset: audioToProcess.length,
  };
  jobInfoToProcess = [currentJobInfo];
}
```

**优点**：
- 简单直接
- 符合业务逻辑：当前job触发的finalize，结果应该属于当前job
- 不需要修改头部对齐策略

---

## 五、总结

### 5.1 batchIndex混乱的影响

- ✅ **能解释语序混乱**：batchIndex重复导致排序不确定
- ❌ **不能解释文本丢失**：batchIndex混乱不会导致文本丢失

### 5.2 文本丢失的真正原因

- **batch被错误分配**：job3的batch被分配给了job1
- **根本原因**：头部对齐策略在合并场景下不适用
- **解决方案**：合并pendingMaxDurationAudio时，使用当前job的jobId

---

*本分析基于日志数据和代码逻辑，需要进一步验证修复效果。*
