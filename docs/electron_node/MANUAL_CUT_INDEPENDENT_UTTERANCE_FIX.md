# 独立Utterance修复（手动发送和Pause Finalize）

## 问题描述

用户报告：
- job0错误地把第二句话的句头合并到第一句话的尾部
- job5对应第二句话，但大部分内容丢失
- job8也丢失了前半句
- **用户每句话之间都使用了手动发送（is_manual_cut: true）**

**设计原则**：
- 手动发送（`is_manual_cut: true`）的句子应该视为完整的独立utterance
- **Pause finalize（`is_pause_triggered: true`）的句子也应该视为完整的独立utterance**
- 这两种情况都不应该与其他utterance合并

---

## 根本原因

### 容器分配算法的误用

**容器分配算法**设计用于：
- **同一个utterance被拆分成多个job**的场景
- 例如：35秒长语音，MaxDuration=10s，拆分成job0/job1/job2/job3
- 这些job属于**同一个utterance**，需要合并处理

**不适用于**：
- **多个独立的utterance**（每句话手动发送）
- 每个utterance应该独立处理，不应该合并

### 具体问题

1. **pendingSmallSegments合并**
   - job0的剩余片段被缓存到 `pendingSmallSegments`
   - job5处理时合并了 `pendingSmallSegments` 和当前音频
   - 导致不同utterance的batch被错误合并

2. **容器分配算法错误应用**
   - 当 `jobInfoToProcess` 包含多个job时，使用容器分配算法
   - 导致不同utterance的batch被错误分配

3. **剩余片段缓存**
   - 手动发送时，剩余片段被缓存到下一个job
   - 导致下一个utterance的开头被错误合并到当前utterance

---

## 修复方案

### 修复1: 独立utterance时不合并pendingSmallSegments

**位置**: `audio-aggregator.ts` 第567行

**修改**:
```typescript
// 关键修复：独立utterance（手动发送或pause finalize）时，不应该合并pendingSmallSegments
// 手动发送/pause finalize = 用户认为这句话完整，应该独立处理
// 只有在非独立utterance的场景下，才合并pendingSmallSegments（用于短句延迟合并）
const isIndependentUtterance = isManualCut || isPauseTriggered; // 手动发送或pause finalize都视为完整句子
const shouldMergePendingSmallSegments = 
  buffer.pendingSmallSegments.length > 0 && 
  !isIndependentUtterance; // 独立utterance时不合并，确保独立处理

// 合并pendingSmallSegments（如果有，且不是独立utterance）
if (shouldMergePendingSmallSegments) {
  // ... 合并逻辑
}
```

---

### 修复2: 独立utterance时不缓存剩余片段

**位置**: `audio-aggregator.ts` 第621-646行

**修改**:
```typescript
// 关键修复：独立utterance（手动发送或pause finalize）时，不应该缓存剩余片段，应该全部处理
const shouldCacheRemaining = !isIndependentUtterance; // 只有非独立utterance时才缓存剩余片段
const { batches: initialBatches, remainingSmallSegments, remainingSmallSegmentsJobInfo } =
  this.createStreamingBatchesWithPending(audioSegments, jobInfoToProcess, shouldCacheRemaining);

// 独立utterance时，将剩余片段也加入到batches中（确保完整处理）
let batches = initialBatches;
if (isIndependentUtterance && remainingSmallSegments.length > 0) {
  // 独立utterance（手动发送或pause finalize）：剩余片段也应该处理，不应该缓存
  const remainingBatch = Buffer.concat(remainingSmallSegments);
  batches = [...initialBatches, remainingBatch];
}
```

---

### 修复3: 独立utterance时使用直接分配，不使用容器分配算法

**位置**: `audio-aggregator.ts` 第680-720行

**修改**:
```typescript
// 分配originalJobIds
// 关键修复：独立utterance（手动发送或pause finalize）时，如果是只有一个job，不应该使用容器分配算法
// 容器分配算法只适用于同一个utterance被拆分成多个job的场景（如35秒长语音MaxDuration拆分）
let originalJobIds: string[];

if (isIndependentUtterance && jobInfoToProcess.length === 1) {
  // 独立utterance（手动发送或pause finalize）：所有batch都分配给当前job
  const currentJobId = job.job_id;
  originalJobIds = batches.map(() => currentJobId);
} else if (jobInfoToProcess.length > 1) {
  // 多个job：使用容器分配算法（同一个utterance被拆分成多个job）
  originalJobIds = this.assignOriginalJobIdsForBatches(batches, jobInfoToProcess);
} else {
  // 单个job：直接分配所有batch给当前job
  const currentJobId = job.job_id;
  originalJobIds = batches.map(() => currentJobId);
}
```

---

### 修复4: createStreamingBatchesWithPending支持shouldCacheRemaining参数

**位置**: `audio-aggregator.ts` 第954-1032行

**修改**:
```typescript
private createStreamingBatchesWithPending(
  audioSegments: Buffer[],
  jobInfo: OriginalJobInfo[],
  shouldCacheRemaining: boolean = true  // 新增参数
): {
  batches: Buffer[];
  remainingSmallSegments: Buffer[];
  remainingSmallSegmentsJobInfo: OriginalJobInfo[];
} {
  // ...
  
  if (currentBatch.length > 0) {
    if (currentBatchDurationMs < this.MIN_ACCUMULATED_DURATION_FOR_ASR_MS && shouldCacheRemaining) {
      // 最后一个批次<5秒，且允许缓存：缓存到pendingSmallSegments
      remainingSmallSegments = currentBatch;
      // ...
    } else {
      // 最后一个批次≥5秒，或者shouldCacheRemaining=false（手动发送），直接作为批次发送
      batches.push(Buffer.concat(currentBatch));
    }
  }
}
```

---

## 修复效果

### 修复前

**用户场景**（3个独立utterance，每句话手动发送）：
- job0: 第一句话
- job5: 第二句话
- job8: 第三句话

**错误行为**：
- job0的剩余片段被缓存到 `pendingSmallSegments`
- job5处理时合并了 `pendingSmallSegments`（包含job0的片段）
- 容器分配算法将batch错误分配给不同job
- 结果：job0包含第二句话的开头，job5丢失大部分内容

---

### 修复后

**正确行为**：
- job0: 只包含第一句话的音频，所有batch分配给job0
- job5: 只包含第二句话的音频，所有batch分配给job5
- job8: 只包含第三句话的音频，所有batch分配给job8
- 每个utterance独立处理，不合并

---

## 关键修复点总结

1. ✅ **独立utterance时不合并pendingSmallSegments**
   - 手动发送（`is_manual_cut: true`）或pause finalize（`is_pause_triggered: true`）都视为独立utterance
   - 确保独立utterance不合并

2. ✅ **独立utterance时不缓存剩余片段**
   - 剩余片段包含在当前处理中，不留尾巴

3. ✅ **独立utterance时使用直接分配**
   - 不使用容器分配算法，所有batch分配给当前job

4. ✅ **容器分配算法只用于多job场景**
   - 只有当 `jobInfoToProcess.length > 1` 时才使用

**独立utterance定义**：
- `isIndependentUtterance = isManualCut || isPauseTriggered`
- 手动发送和pause finalize都视为完整的独立句子

---

## 测试验证

✅ **所有测试通过** (27 passed, 27 total)

---

## 相关文档

- `CONTAINER_ASSIGNMENT_BUG_ANALYSIS.md` - Bug分析
- `LONG_UTTERANCE_35S_EXAMPLE_IMPLEMENTATION_GUIDE_FULL.md` - 容器分配算法文档
- `LONG_UTTERANCE_JOB_CONTAINER_POLICY.md` - 策略文档

---

## 总结

✅ **修复完成**

**核心改进**：
- 手动发送的独立utterance不再合并
- 容器分配算法只用于多job场景
- 剩余片段不再缓存到下一个job

**预期效果**：
- ✅ job0只包含第一句话
- ✅ job5只包含第二句话
- ✅ job8只包含第三句话
- ✅ 不再出现内容丢失或错误合并
