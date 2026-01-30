# 为什么已完成的 utterance 会有后续 batch？

**日期**: 2026-01-27  
**问题**: 为什么已完成的 utterance 会有后续 batch？

---

## 一、问题本质

### 1.1 问题的核心

用户问：**为什么已完成的 utterance 会有后续 batch？**

这是一个很好的问题，需要理解 AudioAggregator 的 `pendingMaxDurationAudio` 机制。

---

## 二、Job3 的处理流程

### 2.1 Job3 的第一次处理（MaxDuration finalize）

**时间**: 20:03:19 - 20:03:20

**流程**:
1. **Job3** 触发 MaxDuration finalize（音频总长度 9.1 秒）
2. AudioAggregator 处理前 5+ 秒的音频，切分为 2 个 batch：
   - `batch0`: 2.5 秒
   - `batch1`: 6.6 秒
3. 注册 originalJob: `expectedSegmentCount=2`
4. 处理这 2 个 batch，完成 ASR → NMT → TTS
5. **发送结果**（20:03:20）

**关键点**:
- Job3 的第一次处理**已经完成**，并发送了结果
- 但是 Job3 的 `pendingMaxDurationAudio`（剩余音频）**还没有处理**

### 2.2 Job3 的 pendingMaxDurationAudio

**状态**:
- Job3 的 `pendingMaxDurationAudio` 被缓存，等待后续处理
- 日志显示：`remainingAudioDurationMs=0`（但实际上有剩余音频片段）

**设计原因**:
- MaxDuration finalize 时，如果剩余音频 `<5秒`，不会立即处理
- 等待后续 job 的音频，合并后一起处理（避免产生太小的 batch）

### 2.3 Job5 处理时合并 pendingMaxDurationAudio

**时间**: 20:03:33

**流程**:
1. **Job5** manual/timeout finalize
2. 合并 Job3 的 `pendingMaxDurationAudio` + Job5 的当前音频
3. 合并后的音频被切分为 2 个 batch：
   - `batch0`（前 4.5s）：第一个片段来自 Job3 的 pending → **归属 Job3**
   - `batch1`（后 3.08s）：第一个片段来自 Job5 的当前音频 → **归属 Job5**

**关键点**:
- Job3 的 `batch0` 是**延迟到达**的，不是"新"的 batch
- 它属于 Job3 的 `pendingMaxDurationAudio`，只是被延迟处理了

---

## 三、为什么会有后续 batch？

### 3.1 设计原因

**AudioAggregator 的 pendingMaxDurationAudio 机制**:
- 当 MaxDuration finalize 时，如果剩余音频 `<5秒`，不会立即处理
- 等待后续 job 的音频，合并后一起处理
- 这样可以：
  - 避免产生太小的 batch（提高 ASR 质量）
  - 保持音频的连续性

### 3.2 头部对齐策略

**设计逻辑**:
- 当 `mergePendingMaxDurationAudio` 时，合并后的音频按**头部对齐策略**分配 batch
- 每个 batch 使用**第一个片段**所属的 `jobId` 作为 `originalJobId`
- 所以 Job3 的 `pendingMaxDurationAudio` 产生的 batch 仍然归属 Job3

### 3.3 OriginalJobResultDispatcher 的追加机制

**设计逻辑**:
- 当 Job3 的 `batch0`（来自 pendingMaxDurationAudio）到达时
- OriginalJobResultDispatcher 会**追加**到现有的 registration，而不是创建新的
- 日志显示：`"Appended batch to existing original job registration"`

**代码逻辑**:
```typescript
// 如果已存在且未 finalized，追加 batch 而不是覆盖
if (existingRegistration && !existingRegistration.isFinalized) {
  existingRegistration.expectedSegmentCount += expectedSegmentCount;
  // ...
}
```

---

## 四、问题的本质

### 4.1 "已完成"的定义

**问题**: Job3 已经"完成"了，为什么还有后续 batch？

**答案**: 
- Job3 的**第一次处理**已经完成（batch0 和 batch1）
- 但是 Job3 的 `pendingMaxDurationAudio` **还没有处理**
- 这个 `pendingMaxDurationAudio` 是 Job3 的一部分，只是被延迟处理了

### 4.2 时间线

```
20:03:19 - Job3 MaxDuration finalize
  ├─ 处理前 5+ 秒音频（batch0, batch1）
  ├─ 注册 originalJob (expectedSegmentCount=2)
  ├─ 完成 ASR → NMT → TTS
  └─ 发送结果（20:03:20）✅ "第一次处理完成"

20:03:19 - Job3 的 pendingMaxDurationAudio 被缓存
  └─ 等待后续处理...

20:03:33 - Job5 manual/timeout finalize
  ├─ 合并 Job3 的 pendingMaxDurationAudio + Job5 的当前音频
  ├─ 切分为 2 个 batch：
  │   ├─ batch0 → 归属 Job3（来自 pendingMaxDurationAudio）
  │   └─ batch1 → 归属 Job5
  └─ Job3 的 batch0 追加到 existing registration
      └─ 触发后续处理（ASR → NMT → TTS）⚠️ "延迟到达的后续 batch"
```

### 4.3 冲突点

**问题**:
- Job3 的第一次处理已经完成，SequentialExecutor 的 `currentIndex=4`（Job4 已完成）
- Job3 的 `batch0`（延迟到达）的 NMT 请求使用 `utteranceIndex=3`
- SequentialExecutor 拒绝处理：`"Task index 3 is less than or equal to current index 4"`

**原因**:
- SequentialExecutor 假设任务按 `utterance_index` 顺序到达
- 如果任务索引小于当前索引，认为任务"过期"了
- 但 Job3 的 `batch0` 不是"过期"的任务，而是"延迟到达"的后续 batch

---

## 五、总结

### 5.1 为什么已完成的 utterance 会有后续 batch？

**答案**:
- **"已完成"** 是指**第一次处理完成**，但 `pendingMaxDurationAudio` 还没有处理
- `pendingMaxDurationAudio` 是 utterance 的一部分，只是被延迟处理了
- 当它被处理时，它仍然归属原来的 utterance（因为头部对齐策略）

### 5.2 这是设计上的预期行为吗？

**答案**: **是的**

- AudioAggregator 的 `pendingMaxDurationAudio` 机制是设计上的预期行为
- 头部对齐策略确保延迟到达的 batch 仍然归属原来的 utterance
- OriginalJobResultDispatcher 的追加机制支持这种情况

### 5.3 问题在哪里？

**答案**: **SequentialExecutor 的严格检查**

- SequentialExecutor 的严格检查与 AudioAggregator 的 `pendingMaxDurationAudio` 机制冲突
- 导致"延迟到达"的后续 batch 被错误地拒绝

### 5.4 修复方案

**答案**: **调整 SequentialExecutor 的检查逻辑**

- 允许处理已完成的 utterance 的后续 batch（通过 `originalJobId` 追踪）
- 这样不会破坏现有设计，只是扩展了检查逻辑

---

*本报告基于代码分析和日志分析。*
