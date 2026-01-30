# 内容丢失修复方案（架构层面）

**日期**: 2026-01-27  
**原则**: 架构层面修复，避免打补丁，保持代码简单易懂

---

## 一、问题分析

### 1.1 问题 1：OriginalJob 重复注册导致覆盖

**代码位置**: `original-job-result-dispatcher.ts:245`
```typescript
sessionRegistrations.set(originalJobId, registration);
```

**问题**: 如果同一个 `originalJobId` 被多次注册，会直接覆盖，导致之前的 `accumulatedSegments` 丢失。

**根因**: `registerOriginalJob()` 没有检查 registration 是否已存在。

---

### 1.2 问题 2：头部对齐导致跨 job 分割

**代码位置**: 
- `audio-aggregator-finalize-handler.ts:419` - 构建 `mergedJobInfo`
- `audio-aggregator-stream-batcher.ts:56-60` - 分配 `batchJobInfo`

**问题**: 当 `mergePendingMaxDurationAudio` 时，`mergedJobInfo` 包含 pending 音频的 jobInfo（前一个 job）和当前音频的 jobInfo（当前 job）。每个 batch 使用第一个片段对应的 jobInfo，导致 batch 被分配到前一个 job。

**根因**: 头部对齐策略在 mergePendingMaxDurationAudio 场景下，pending 音频的第一个片段属于前一个 job，导致 batch 被分配到前一个 job。

---

## 二、修复方案（架构层面）

**注意**：修复 2 不必要，保持原有设计（pending 音频归属前一个 job 是有意的设计，避免原始文本缺头少尾）。

### 2.1 修复 1：OriginalJob 重复注册 - 追加而非覆盖（**唯一需要修复的问题**）

**修改文件**: `original-job-result-dispatcher.ts`

**修改位置**: `registerOriginalJob()` 方法（第 213-257 行）

**修改方案**:
```typescript
registerOriginalJob(
  sessionId: string,
  originalJobId: string,
  expectedSegmentCount: number,
  originalJob: JobAssignMessage,
  callback: OriginalJobCallback
): void {
  let sessionRegistrations = this.registrations.get(sessionId);
  if (!sessionRegistrations) {
    sessionRegistrations = new Map();
    this.registrations.set(sessionId, sessionRegistrations);
  }

  const existingRegistration = sessionRegistrations.get(originalJobId);
  
  // ✅ 架构修复：如果已存在且未 finalized，追加 batch 而不是覆盖
  if (existingRegistration && !existingRegistration.isFinalized) {
    // 追加 batch：增加 expectedSegmentCount，保留 accumulatedSegments
    existingRegistration.expectedSegmentCount += expectedSegmentCount;
    existingRegistration.lastActivityAt = Date.now();
    
    // 重置 TTL 定时器（延长等待时间）
    if (existingRegistration.ttlTimerHandle) {
      clearTimeout(existingRegistration.ttlTimerHandle);
    }
    existingRegistration.ttlTimerHandle = setTimeout(() => {
      this.forceFinalizePartial(sessionId, originalJobId, 'registration_ttl');
    }, this.REGISTRATION_TTL_MS);
    
    logger.info(
      {
        sessionId,
        originalJobId,
        previousExpectedSegmentCount: existingRegistration.expectedSegmentCount - expectedSegmentCount,
        newExpectedSegmentCount: existingRegistration.expectedSegmentCount,
        addedBatchCount: expectedSegmentCount,
        accumulatedSegmentsCount: existingRegistration.accumulatedSegments.length,
        note: 'Appended batch to existing registration (not overwritten)',
      },
      'OriginalJobResultDispatcher: Appended batch to existing original job registration'
    );
    return;
  }

  // 新注册：创建新的 registration
  const now = Date.now();
  const registration: OriginalJobRegistration = {
    originalJob,
    callback,
    expectedSegmentCount,
    receivedCount: 0,
    missingCount: 0,
    accumulatedSegments: [],
    accumulatedSegmentsList: [],
    startedAt: now,
    lastActivityAt: now,
    isFinalized: false,
  };
  
  registration.ttlTimerHandle = setTimeout(() => {
    this.forceFinalizePartial(sessionId, originalJobId, 'registration_ttl');
  }, this.REGISTRATION_TTL_MS);
  
  sessionRegistrations.set(originalJobId, registration);

  logger.info(
    {
      sessionId,
      originalJobId,
      expectedSegmentCount,
      registrationTtlMs: this.REGISTRATION_TTL_MS,
      note: 'Registration TTL timer started',
    },
    'OriginalJobResultDispatcher: Registered original job with TTL timer'
  );
}
```

**说明**:
- **简单直接**：检查已存在且未 finalized 的 registration，追加 batch 而不是覆盖
- **保留状态**：保留 `accumulatedSegments`，只增加 `expectedSegmentCount`
- **重置 TTL**：延长等待时间，确保有足够时间接收所有 batch

---

### 2.2 修复 2：不必要（已确认）

**说明**：
- 修复 2 不必要，保持原有设计
- pending 音频归属前一个 job 是有意的设计，避免原始文本缺头少尾
- 当 MaxDuration finalize 切割长语音为多个 job 时，这些 job 属于同一句话，pending 归并到前一个 job 是正确的设计

---

## 三、修复效果

### 3.1 修复前

- Utterance 15: `job-ee8e1cef` 注册 → 收到 batch0（41字），`expectedSegmentCount=1`，`receivedCount=1` → **立即触发** → completed
- Utterance 16: `job-ee8e1cef` **重新注册**（覆盖）→ 收到 batch0（32字），`expectedSegmentCount=1`，`receivedCount=1` → **立即触发** → completed（**丢失了之前的 41 字**）
- Utterance 17: `job-ee8e1cef` **再次重新注册**（覆盖）→ 收到 batch0（25字），`expectedSegmentCount=1`，`receivedCount=1` → **立即触发** → completed（**丢失了之前的 32 字**）

### 3.2 修复后

- Utterance 15: `job-ee8e1cef` 注册 → 收到 batch0（41字），`expectedSegmentCount=1`，`receivedCount=1` → **等待**（如果后续还有 batch）
- Utterance 16: `job-ee8e1cef` **追加 batch**（不覆盖）→ `expectedSegmentCount=2`，收到 batch1（32字），`receivedCount=2` → **触发合并**（41字 + 32字）
- Utterance 17: `job-ee8e1cef` **追加 batch**（不覆盖）→ `expectedSegmentCount=3`，收到 batch2（25字），`receivedCount=3` → **触发合并**（41字 + 32字 + 25字）

**说明**：修复后，所有 batch 都能正确合并，不会丢失内容。

---

## 四、注意事项

1. **修复 1（追加而非覆盖）**：
   - 需要确保 `callback` 一致（如果不同，可能需要合并 callback 逻辑）
   - 当前实现中，同一个 `originalJobId` 的 callback 应该是一致的，所以不需要额外处理
   - 如果已存在的 registration 已 finalized，则创建新 registration（正常情况）

2. **测试建议**：
   - 测试 Utterance 15/16/17 的场景，确保所有 batch 都能正确合并
   - 测试 MaxDuration finalize 场景，确保 pending 音频归属前一个 job 的逻辑正常工作

---

*本修复方案基于架构层面，避免打补丁，保持代码简单易懂。*
