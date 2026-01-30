# SequentialExecutor 修复方案分析

**日期**: 2026-01-27  
**问题**: Job3 的 batch0 的 NMT 请求被 SequentialExecutor 拒绝（utteranceIndex=3 < currentIndex=4）

---

## 一、问题确认

### 1.1 这是否是一个 bug？

**结论**: **是的，这是一个 bug**

**原因**:
- SequentialExecutor 的设计假设：任务按 `utterance_index` 顺序到达
- 如果任务索引小于当前索引，SequentialExecutor 认为任务"过期"了，拒绝处理
- 但 Job3 的 batch0 不是"过期"的任务，而是"延迟到达"的后续 batch（因为 pendingMaxDurationAudio 机制）

**时间线**:
```
20:03:20 - Job3 的第一次 NMT（utteranceIndex=3）完成 → currentIndex=3
20:03:26 - Job4 的 NMT（utteranceIndex=4）完成 → currentIndex=4
20:03:33 - Job3 的 batch0 的 NMT（utteranceIndex=3）到达 → 被拒绝（currentIndex=4）
```

**问题本质**:
- Job3 的 pendingMaxDurationAudio 在 Job5 时被合并
- batch0 归属 Job3，但它的 NMT 请求在 Job3 的第一次 NMT 和 Job4 的 NMT 都完成后才到达
- SequentialExecutor 认为这是一个"过期"的任务，所以拒绝

---

## 二、修复方案分析

### 2.1 方案 1：调整 SequentialExecutor 的检查逻辑（推荐）

**修复思路**:
- 当 `currentIndex >= utteranceIndex` 时，不直接拒绝
- 检查这个 utterance 是否已经完成（通过 originalJobId 追踪）
- 如果已经完成，说明这是"延迟到达"的后续 batch，应该允许处理
- 如果未完成，说明是重复任务，应该拒绝

**优点**:
- 保持 SequentialExecutor 的核心设计（基于 utterance_index）
- 修复逻辑清晰：允许已完成的 utterance 的后续 batch

**缺点**:
- 需要 SequentialExecutor 知道"这个 utterance 是否已经完成"
- 需要额外的状态追踪（originalJobId → 是否完成）

**代码复杂度**: ⭐⭐⭐ (中等)

---

### 2.2 方案 2：使用 originalJobId 而不是 utteranceIndex 来检查顺序

**修复思路**:
- SequentialExecutor 使用 `originalJobId` 而不是 `utteranceIndex` 来检查顺序
- 每个 `originalJobId` 维护独立的顺序队列

**优点**:
- 逻辑简单：每个 originalJobId 独立管理
- 不需要额外的状态追踪

**缺点**:
- **破坏 SequentialExecutor 的核心设计**（它基于 utterance_index）
- 需要修改所有使用 SequentialExecutor 的地方
- 可能影响其他功能（如 context_text 的顺序保证）

**代码复杂度**: ⭐⭐⭐⭐ (较高，需要大量修改)

---

### 2.3 方案 3：调整 AudioAggregator 的 batch 分配策略

**修复思路**:
- 当 `mergePendingMaxDurationAudio` 时，统一使用当前 job 作为所有 batch 的 `originalJobId`
- 这样 batch0 也会归属 Job5，不会出现 utteranceIndex=3 的情况

**优点**:
- 修复简单，不需要修改 SequentialExecutor

**缺点**:
- **破坏头部对齐策略的设计意图**
- 可能导致音频归属错误（Job3 的音频被归属到 Job5）
- 可能影响其他功能

**代码复杂度**: ⭐⭐ (较低，但破坏设计)

---

## 三、推荐方案：方案 1（调整 SequentialExecutor 的检查逻辑）

### 3.1 修复思路

**核心逻辑**:
- SequentialExecutor 维护一个 `completedOriginalJobs` 集合，记录已完成的 `originalJobId`
- 当 `currentIndex >= utteranceIndex` 时：
  - 如果 `originalJobId` 在 `completedOriginalJobs` 中，说明这是"延迟到达"的后续 batch，允许处理
  - 否则，说明是重复任务，拒绝处理

**实现细节**:
1. SequentialExecutor 的 `execute` 方法需要接收 `originalJobId` 参数
2. 维护 `completedOriginalJobs: Map<sessionId, Set<originalJobId>>`
3. 当任务完成时，将 `originalJobId` 加入 `completedOriginalJobs`
4. 检查逻辑：`if (currentIndex >= utteranceIndex && !completedOriginalJobs.has(originalJobId)) { reject }`

### 3.2 代码修改

**修改位置**: `sequential-executor.ts:138-153`

**修改前**:
```typescript
} else if (currentIndex >= utteranceIndex) {
  // 如果当前索引已经大于等于utteranceIndex，说明这个任务已经"过期"了
  task.reject(new Error(`SequentialExecutor: Task index ${task.utteranceIndex} is less than or equal to current index ${currentIndex}, task may have arrived too late`));
}
```

**修改后**:
```typescript
} else if (currentIndex >= utteranceIndex) {
  // 检查是否是已完成的 utterance 的后续 batch
  const completedOriginalJobs = this.state.completedOriginalJobs.get(sessionId);
  const isDelayedBatch = originalJobId && completedOriginalJobs?.has(originalJobId);
  
  if (isDelayedBatch) {
    // 这是"延迟到达"的后续 batch，允许处理
    logger.info(
      {
        sessionId: task.sessionId,
        utteranceIndex: task.utteranceIndex,
        currentIndex,
        originalJobId,
        reason: 'Delayed batch from completed originalJob, allowing processing',
      },
      'SequentialExecutor: Allowing delayed batch from completed originalJob'
    );
    this.processTask(task);
  } else {
    // 这是重复任务或过期任务，拒绝
    logger.warn(
      {
        sessionId: task.sessionId,
        utteranceIndex: task.utteranceIndex,
        currentIndex,
        jobId: task.jobId,
        taskType: task.taskType,
        hasCurrentProcessing: !!currentProcessing,
      },
      'SequentialExecutor: Task index is less than or equal to current index, task may have arrived too late'
    );
    task.reject(new Error(`SequentialExecutor: Task index ${task.utteranceIndex} is less than or equal to current index ${currentIndex}, task may have arrived too late`));
  }
}
```

### 3.3 业务逻辑简洁性

**评估**: ✅ **可以保持简洁**

**原因**:
- 修复逻辑清晰：允许已完成的 utterance 的后续 batch
- 不需要破坏现有设计
- 只需要添加一个 `completedOriginalJobs` 集合来追踪状态
- 检查逻辑简单：`if (isDelayedBatch) { allow } else { reject }`

**复杂度增加**: 最小化（只添加一个集合和简单的检查逻辑）

---

## 四、关于业务逻辑简洁性的说明

### 4.1 这是否是必要的修复？

**结论**: **是的，这是必要的修复**

**原因**:
- 这是一个**真实的 bug**，导致内容丢失
- 修复方案**不会破坏现有设计**，只是扩展了检查逻辑
- 修复逻辑**清晰简单**，不会让业务逻辑变复杂

### 4.2 修复后的业务逻辑

**修复前**:
- SequentialExecutor 严格按 `utterance_index` 顺序执行
- 如果任务索引小于当前索引，直接拒绝

**修复后**:
- SequentialExecutor 严格按 `utterance_index` 顺序执行
- 如果任务索引小于当前索引：
  - 如果是已完成的 utterance 的后续 batch，允许处理
  - 否则，拒绝处理

**业务逻辑变化**: 最小化（只增加了一个例外情况）

---

## 五、总结

### 5.1 这是否是 bug？

**结论**: **是的，这是一个 bug**

- SequentialExecutor 的严格检查与 AudioAggregator 的 pendingMaxDurationAudio 机制冲突
- 导致"延迟到达"的后续 batch 被错误地拒绝

### 5.2 修复方案是否简洁？

**结论**: **是的，修复方案可以保持简洁**

- 推荐方案 1：调整 SequentialExecutor 的检查逻辑
- 只需要添加一个 `completedOriginalJobs` 集合来追踪状态
- 检查逻辑简单清晰，不会让业务逻辑变复杂

### 5.3 是否需要修复？

**结论**: **是的，需要修复**

- 这是一个真实的 bug，导致内容丢失
- 修复方案不会破坏现有设计
- 修复逻辑清晰简单

---

*本报告基于代码分析和日志分析。*
