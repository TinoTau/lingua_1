# 文本分配和合并问题分析

**日期**: 2026-01-28  
**问题**: 文本被发送后又被标记为空容器

---

## 一、问题现象

**从日志发现**：
- Job3: 文本被成功发送到scheduler（76字符），但后来被标记为"Empty container (NO_TEXT_ASSIGNED)"
- Job5: 文本被成功发送到scheduler（45字符），但后来被标记为"ASR result is empty"
- Job11: 文本被成功发送到scheduler（31字符），但后来被标记为"ASR result is empty"

---

## 二、代码逻辑分析

### 2.1 空容器检测逻辑（asr-step.ts 第257-318行）

```typescript
// 检测空容器并发送空结果核销
if (originalJobIds.length > 0 && originalJobInfo.length > 0) {
  const assignedJobIds = Array.from(new Set(originalJobIds));
  const allJobIds = originalJobInfo.map(info => info.jobId);
  const emptyJobIds = allJobIds.filter(jobId => !assignedJobIds.includes(jobId));
  
  if (emptyJobIds.length > 0 && services.resultSender) {
    // 发送空结果核销
  }
}
```

**逻辑说明**：
- `assignedJobIds`: 从`originalJobIds`（batch分配得到的）去重
- `allJobIds`: 从`originalJobInfo`（音频聚合得到的）提取所有jobId
- `emptyJobIds`: `allJobIds`中不在`assignedJobIds`中的jobId

### 2.2 问题根源

**问题场景**：
1. Job3合并了pendingMaxDurationAudio（来自job1）
2. 合并后，batch被分配给了job1的originalJobId（因为我们之前的修复：合并时使用当前job的jobId）
3. 但`originalJobInfo`中还有job3的ID（因为job3参与了音频聚合）
4. 所以`originalJobIds`中只有job1的ID，没有job3的ID
5. 导致Job3被标记为空容器

**关键问题**：
- `originalJobIds`是从batch分配得到的，表示哪些job被分配到了batch
- `originalJobInfo`是从音频聚合得到的，表示哪些job参与了音频聚合
- 当合并pendingMaxDurationAudio时，batch被分配给了当前job，但`originalJobInfo`中还保留了所有参与聚合的job

---

## 三、根本原因

### 3.1 合并pendingMaxDurationAudio时的jobInfo处理

**当前逻辑**（audio-aggregator.ts 第642行）：
```typescript
// 架构设计：如果合并了pendingMaxDurationAudio，所有batch使用当前job的jobId
if (hasMergedPendingAudio) {
  const currentJobInfo: OriginalJobInfo = {
    jobId: job.job_id,
    utteranceIndex: job.utterance_index,
    startOffset: 0,
    endOffset: audioToProcess.length,
  };
  finalJobInfoToProcess = [currentJobInfo];
}
```

**问题**：
- 合并时，`finalJobInfoToProcess`被设置为只有当前job
- 但`originalJobInfo`（传入`createStreamingBatchesWithPending`的参数）还保留了所有参与聚合的job
- 导致`originalJobInfo`和`originalJobIds`不一致

### 3.2 空容器检测逻辑的问题

**问题**：
- 空容器检测逻辑假设`originalJobInfo`和`originalJobIds`应该一致
- 但当合并pendingMaxDurationAudio时，它们不一致
- 导致参与聚合但没有被分配到batch的job被错误地标记为空容器

---

## 四、修复方案

### 方案1: 修复空容器检测逻辑（推荐）

**思路**：
- 空容器检测应该只检查`originalJobInfo`中是否有job没有被分配到batch
- 但如果某个job的文本已经被发送（通过dispatcher），就不应该被标记为空容器

**实现**：
```typescript
// 修复：检查dispatcher中是否有该job的文本
if (originalJobIds.length > 0 && originalJobInfo.length > 0) {
  const assignedJobIds = Array.from(new Set(originalJobIds));
  const allJobIds = originalJobInfo.map(info => info.jobId);
  
  // 检查dispatcher中是否有文本
  const dispatcher = getOriginalJobResultDispatcher();
  const emptyJobIds = allJobIds.filter(jobId => {
    if (assignedJobIds.includes(jobId)) {
      return false; // 已被分配到batch
    }
    // 检查dispatcher中是否有该job的文本
    const registration = dispatcher.getRegistration(job.session_id, jobId);
    if (registration && registration.accumulatedSegments.length > 0) {
      return false; // dispatcher中有文本，不应该标记为空容器
    }
    return true; // 真正的空容器
  });
  
  // 只对真正的空容器发送空结果
  if (emptyJobIds.length > 0 && services.resultSender) {
    // 发送空结果核销
  }
}
```

### 方案2: 修复合并时的jobInfo处理

**思路**：
- 合并pendingMaxDurationAudio时，`originalJobInfo`也应该只包含当前job
- 这样`originalJobInfo`和`originalJobIds`就一致了

**实现**：
```typescript
// 修复：合并时，originalJobInfo也应该只包含当前job
if (hasMergedPendingAudio) {
  const currentJobInfo: OriginalJobInfo = {
    jobId: job.job_id,
    utteranceIndex: job.utterance_index,
    startOffset: 0,
    endOffset: audioToProcess.length,
  };
  finalJobInfoToProcess = [currentJobInfo];
  // 同时更新originalJobInfo，确保一致性
  originalJobInfo = [currentJobInfo];
}
```

---

## 五、推荐方案

**推荐方案1**：修复空容器检测逻辑
- **优点**：更安全，不会错误地标记有文本的job为空容器
- **缺点**：需要访问dispatcher，逻辑稍复杂

**方案2**：修复合并时的jobInfo处理
- **优点**：简单直接，保持一致性
- **缺点**：可能丢失一些信息（哪些job参与了聚合）

**建议**：使用方案1，因为它更安全，不会错误地标记有文本的job为空容器。

---

## 六、总结

### 6.1 问题确认

- ✅ **文本被成功发送**：ASR返回了完整的文本，并成功发送到scheduler
- ❌ **文本被错误地标记为空容器**：空容器检测逻辑有问题，错误地标记了有文本的job

### 6.2 根本原因

- **合并pendingMaxDurationAudio时，`originalJobInfo`和`originalJobIds`不一致**
- **空容器检测逻辑没有检查dispatcher中是否有文本**

### 6.3 修复方案

- **修复空容器检测逻辑**：检查dispatcher中是否有文本，避免错误地标记有文本的job为空容器

---

*本分析基于代码逻辑和日志数据，需要进一步验证修复效果。*
