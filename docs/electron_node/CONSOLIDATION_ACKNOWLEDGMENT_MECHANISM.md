# 核销空结果机制

## 概述

当 Job 619 的所有音频都被合并到 Job 618（即所有ASR结果都分配给 `originalJobId: 618`）时，Job 619 需要发送一个空结果来核销，告诉调度服务器"Job 619 已处理，但没有结果"（因为所有结果都归并到 Job 618 了）。

---

## 设计原则

### 两种空结果场景的区分

1. **保活空结果**（已移除）：
   - 场景：音频被缓存到 `pendingTimeoutAudio`，等待下一个job合并
   - 行为：**不发送任何结果**，让调度服务器等待
   - 原因：避免与去重逻辑冲突

2. **核销空结果**（新增）：
   - 场景：所有ASR结果都归并到其他job（`originalJobIds` 中不包含当前 `job.job_id`）
   - 行为：**发送空结果核销当前job**
   - 原因：调度服务器创建了job，期望收到结果，需要核销

---

## 实现机制

### 1. 检测核销情况

**位置**：`electron_node/electron-node/main/src/pipeline/steps/asr-step.ts` (第377-395行)

```typescript
// 如果所有ASR结果都属于其他原始job
if (originalJobIds.length > 0 && !originalJobIds.includes(job.job_id)) {
  // 清空当前job的ASR结果
  ctx.asrText = '';
  ctx.asrResult = undefined;
  ctx.asrSegments = [];
  
  // 标记为"核销"情况
  (ctx as any).isConsolidated = true;
  (ctx as any).consolidatedToJobIds = Array.from(new Set(originalJobIds));
  
  // 继续执行后续pipeline步骤，最终会返回空结果用于核销
}
```

**关键点**：
- 不直接return，而是继续执行后续pipeline步骤
- 设置 `isConsolidated = true` 标记
- 记录 `consolidatedToJobIds`（所有结果归并到的job_id列表）

### 2. 传递核销标记

**位置**：`electron_node/electron-node/main/src/pipeline/result-builder.ts` (第22-25行)

```typescript
extra: {
  language_probability: ...,
  language_probabilities: ...,
  // 核销标记
  is_consolidated: (ctx as any).isConsolidated || false,
  consolidated_to_job_ids: (ctx as any).consolidatedToJobIds || undefined,
}
```

### 3. 发送核销空结果

**位置**：`electron_node/electron-node/main/src/agent/node-agent-result-sender.ts` (第67-100行)

```typescript
// 检查是否是"核销"情况
const isConsolidated = (finalResult.extra as any)?.is_consolidated === true;

// 如果是"保活"情况（音频被缓存），不发送任何结果
if (isEmpty && !isConsolidated) {
  return;  // 不发送任何结果
}

// 如果是"核销"情况，继续执行，发送空结果核销
if (isEmpty && isConsolidated) {
  logger.info(..., 'Sending empty job_result to acknowledge job');
  // 继续执行，发送空结果
}
```

**关键点**：
- 核销空结果会正常发送给调度服务器
- 不记录到去重逻辑（因为这是正常的核销，不是重复）

---

## 实际场景示例

### 场景：所有批次分配给 Job 618

```
Job 618 (utteranceIndex:5):
  - 音频被缓存到 pendingTimeoutAudio
  - 不发送任何结果

Job 619 (utteranceIndex:6):
  - 合并 pendingTimeoutAudio + 当前音频
  - 所有批次分配给 originalJobId: 618
  - 检测到：originalJobIds = [618]，不包含 job.job_id (619)
  - 设置 isConsolidated = true
  - 继续执行pipeline，返回空结果
  - ✅ 发送空结果核销 Job 619（job_id: 619, text_asr: ""）
  - ✅ 发送实际结果给 Job 618（job_id: 618, text_asr: "实际文本"）
```

**调度服务器收到的结果**：
- `job_id: 618` → 实际ASR结果（包含合并后的所有文本）
- `job_id: 619` → 空结果（`text_asr: ""`，标记为核销）

---

## 与去重逻辑的关系

**关键点**：
- **实际结果**：记录到去重逻辑（`markJobIdAsSent`）
- **核销空结果**：不记录到去重逻辑（因为这是正常的核销，不是重复）

**代码实现**（`node-agent-result-sender.ts`）：
```typescript
// 只有实际结果才记录job_id
if (!isEmpty && this.dedupStage && typeof this.dedupStage.markJobIdAsSent === 'function') {
  this.dedupStage.markJobIdAsSent(job.session_id, job.job_id);
}

// 核销空结果不记录job_id
else if (isEmpty && isConsolidated) {
  logger.debug(..., 'Empty result sent for consolidation, job_id not marked');
}
```

---

## 总结

**核销空结果机制**：
- 当所有ASR结果都归并到其他job时，发送空结果核销当前job
- 与"保活空结果"不同：这是正常的核销，不是"正在处理中"
- 不记录到去重逻辑：因为这是正常的核销，不是重复

**设计优势**：
- ✅ 调度服务器可以正确跟踪每个job的状态
- ✅ 不会因为job没有结果而超时
- ✅ 不影响去重逻辑（核销空结果不记录）
