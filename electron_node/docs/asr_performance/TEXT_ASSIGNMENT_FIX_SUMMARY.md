# 文本分配和合并问题修复总结

**日期**: 2026-01-28  
**问题**: 文本被发送后又被标记为空容器

---

## 一、问题确认

### 1.1 问题现象

从日志发现：
- Job3: 文本被成功发送到scheduler（76字符），但后来被标记为"Empty container (NO_TEXT_ASSIGNED)"
- Job5: 文本被成功发送到scheduler（45字符），但后来被标记为"ASR result is empty"
- Job11: 文本被成功发送到scheduler（31字符），但后来被标记为"ASR result is empty"

### 1.2 根本原因

**问题场景**：
1. Job3合并了pendingMaxDurationAudio（来自job1）
2. 合并后，batch被分配给了job3的originalJobId（因为我们之前的修复：合并时使用当前job的jobId）
3. 但`originalJobInfo`中还保留了job1的ID（因为job1参与了音频聚合）
4. 所以`originalJobIds`中只有job3的ID，但`originalJobInfo`中还有job1的ID
5. 导致job1被错误地标记为空容器

**关键问题**：
- `originalJobIds`是从batch分配得到的，表示哪些job被分配到了batch
- `originalJobInfo`是从音频聚合得到的，表示哪些job参与了音频聚合
- 当合并pendingMaxDurationAudio时，batch被分配给了当前job，但`originalJobInfo`中还保留了参与聚合的其他job

---

## 二、修复方案

### 2.1 修复合并时的jobInfo处理

**修复位置**：`audio-aggregator.ts` 第642-655行

**修复逻辑**：
```typescript
// 架构设计：如果合并了pendingMaxDurationAudio，所有batch使用当前job的jobId
let finalJobInfoToProcess = jobInfoToProcess;
if (hasMergedPendingAudio) {
  // 合并pendingMaxDurationAudio时，使用当前job的jobId
  const currentJobInfo: OriginalJobInfo = {
    jobId: job.job_id,
    utteranceIndex: job.utterance_index,
    startOffset: 0,
    endOffset: audioToProcess.length,
  };
  finalJobInfoToProcess = [currentJobInfo];
  // ✅ 修复：同时更新originalJobInfo，确保与originalJobIds一致
  // 原因：空容器检测逻辑依赖originalJobInfo和originalJobIds的一致性
  // 如果originalJobInfo中还保留参与聚合的其他job，会导致这些job被错误地标记为空容器
  jobInfoToProcess = [currentJobInfo];
}
```

**修复效果**：
- 合并pendingMaxDurationAudio时，`originalJobInfo`只包含当前job
- 确保`originalJobInfo`和`originalJobIds`一致
- 避免参与聚合但没有被分配到batch的job被错误地标记为空容器

---

## 三、修复验证

### 3.1 修复前

**问题**：
- `originalJobInfo`包含所有参与聚合的job（job1, job3）
- `originalJobIds`只包含被分配到batch的job（job3）
- 导致job1被错误地标记为空容器

### 3.2 修复后

**预期效果**：
- `originalJobInfo`只包含当前job（job3）
- `originalJobIds`也只包含当前job（job3）
- `originalJobInfo`和`originalJobIds`一致
- 不会错误地标记有文本的job为空容器

---

## 四、总结

### 4.1 问题确认

- ✅ **文本被成功发送**：ASR返回了完整的文本，并成功发送到scheduler
- ❌ **文本被错误地标记为空容器**：空容器检测逻辑有问题，错误地标记了有文本的job

### 4.2 根本原因

- **合并pendingMaxDurationAudio时，`originalJobInfo`和`originalJobIds`不一致**
- **空容器检测逻辑依赖它们的一致性**

### 4.3 修复方案

- **修复合并时的jobInfo处理**：确保`originalJobInfo`和`originalJobIds`一致

---

*修复已完成，需要重新测试验证效果。*
