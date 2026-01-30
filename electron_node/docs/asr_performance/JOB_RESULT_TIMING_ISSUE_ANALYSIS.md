# Job3 结果返回时机问题分析

**日期**: 2026-01-27  
**问题**: 能否保证 Job3 在后续内容未被处理完之前，不返回 jobResult 给调度服务器？

---

## 一、问题本质

### 1.1 用户的问题

用户问：**但这样能保证 job3 在后续内容未被处理完之前，不返回 jobResult 给调度服务器吗？**

这是一个很好的问题，涉及到 OriginalJobResultDispatcher 的 finalize 时机。

---

## 二、当前实现的问题

### 2.1 Job3 的第一次处理流程

**时间**: 20:03:19 - 20:03:20

**流程**:
1. Job3 MaxDuration finalize，处理前 5+ 秒音频
2. 注册 originalJob: `expectedSegmentCount=2`
3. 收到 2 个 batch 后，`receivedCount >= expectedSegmentCount`
4. **触发 finalize，发送结果**（20:03:20）
5. **删除 registration**（`sessionRegistrations.delete(originalJobId)`）

**关键代码** (`original-job-result-dispatcher.ts:354-416`):
```typescript
// ✅ 检查是否应该立即处理：当 receivedCount >= expectedSegmentCount 时触发
const shouldProcess = registration.receivedCount >= registration.expectedSegmentCount;

if (shouldProcess) {
  // ✅ 标记为已finalize
  registration.isFinalized = true;
  
  // 触发处理回调
  await registration.callback(finalAsrData, registration.originalJob);
  
  // 清除注册信息
  sessionRegistrations.delete(originalJobId);  // ⚠️ 问题：registration 被删除
}
```

### 2.2 Job3 的 pendingMaxDurationAudio 处理

**时间**: 20:03:33

**流程**:
1. Job5 处理时，合并 Job3 的 `pendingMaxDurationAudio`
2. 产生新的 batch0，归属 Job3
3. 尝试追加到 existing registration
4. **但是 registration 已经被删除了**，所以会创建新的 registration

**关键代码** (`original-job-result-dispatcher.ts:228-254`):
```typescript
const existingRegistration = sessionRegistrations.get(originalJobId);

// ✅ 架构修复：如果已存在且未 finalized，追加 batch 而不是覆盖
if (existingRegistration && !existingRegistration.isFinalized) {
  // 追加 batch：增加 expectedSegmentCount，保留 accumulatedSegments
  existingRegistration.expectedSegmentCount += expectedSegmentCount;
  // ...
  return;
}

// 新注册：创建新的 registration
// ⚠️ 问题：如果 registration 已被删除，会创建新的 registration
```

---

## 三、问题分析

### 3.1 当前实现的问题

**问题**:
- Job3 的第一次处理完成后，registration 被删除
- Job3 的 `pendingMaxDurationAudio` 产生的 batch 到达时，registration 已经不存在
- 会创建新的 registration，导致 Job3 的结果被**分两次发送**

### 3.2 日志证据

从日志可以看到：
1. **第一次处理**（20:03:20）:
   - `expectedSegmentCount=2`
   - 收到 2 个 batch 后，发送结果
   - registration 被删除

2. **后续 batch**（20:03:33）:
   - `expectedSegmentCount=1`（新的 registration）
   - 收到 1 个 batch 后，会再次发送结果

### 3.3 设计上的冲突

**设计意图**:
- `pendingMaxDurationAudio` 是 Job3 的一部分，应该等待它处理完再返回结果
- 但是当前实现中，第一次处理完成后就返回了结果

**问题根源**:
- `expectedSegmentCount` 只考虑了当前 finalize 的 batch 数量
- 没有考虑 `pendingMaxDurationAudio` 可能产生的后续 batch

---

## 四、修复方案

### 4.1 方案 1：延迟 finalize（推荐）

**修复思路**:
- 当 MaxDuration finalize 时，如果有 `pendingMaxDurationAudio`，**不立即 finalize**
- 等待 `pendingMaxDurationAudio` 被处理完后再 finalize

**实现细节**:
1. 注册 originalJob 时，检查是否有 `pendingMaxDurationAudio`
2. 如果有，设置 `expectedSegmentCount` 为 `undefined`（累积等待）
3. 当 `pendingMaxDurationAudio` 被处理时，追加 batch
4. 当所有 batch 都收到后，再 finalize

**优点**:
- 保证所有 batch 处理完后再返回结果
- 符合设计意图

**缺点**:
- 需要修改 AudioAggregator 和 OriginalJobResultDispatcher 的交互逻辑
- 可能影响其他场景（如 TTL 超时）

### 4.2 方案 2：保留 registration，标记为 pending

**修复思路**:
- 当第一次处理完成时，如果有 `pendingMaxDurationAudio`，**不删除 registration**
- 标记为 `hasPendingMaxDurationAudio=true`
- 等待后续 batch 到达后，追加并 finalize

**实现细节**:
1. 注册 originalJob 时，记录是否有 `pendingMaxDurationAudio`
2. 当 `receivedCount >= expectedSegmentCount` 时：
   - 如果有 `pendingMaxDurationAudio`，不删除 registration，标记为 `hasPendingMaxDurationAudio=true`
   - 如果没有，正常 finalize 并删除 registration
3. 当后续 batch 到达时，追加到 existing registration
4. 当所有 batch 都收到后，再 finalize 并删除 registration

**优点**:
- 保证所有 batch 处理完后再返回结果
- 不需要大幅修改现有逻辑

**缺点**:
- 需要修改 OriginalJobResultDispatcher 的状态管理

### 4.3 方案 3：使用 TTL 机制（当前部分实现）

**修复思路**:
- 使用 TTL 机制，等待 `pendingMaxDurationAudio` 被处理
- 如果 TTL 超时，强制 finalize partial

**当前实现**:
- `REGISTRATION_TTL_MS = 10_000`（10秒）
- 如果 10 秒内没有收到后续 batch，强制 finalize

**问题**:
- TTL 可能不够准确（可能提前或延后）
- 不能保证所有 batch 都处理完

---

## 五、推荐方案：方案 2（保留 registration，标记为 pending）

### 5.1 修复思路

**核心逻辑**:
- 当 MaxDuration finalize 时，如果有 `pendingMaxDurationAudio`，不立即删除 registration
- 标记为 `hasPendingMaxDurationAudio=true`
- 等待后续 batch 到达后，追加并 finalize

### 5.2 代码修改

**修改位置**: `original-job-result-dispatcher.ts`

**修改 1**: 添加状态标记
```typescript
interface OriginalJobRegistration {
  // ... 现有字段
  hasPendingMaxDurationAudio?: boolean;  // 新增：是否有 pendingMaxDurationAudio
}
```

**修改 2**: 修改 finalize 逻辑
```typescript
// ✅ 检查是否应该立即处理：当 receivedCount >= expectedSegmentCount 时触发
const shouldProcess = registration.receivedCount >= registration.expectedSegmentCount;

if (shouldProcess) {
  // ✅ 如果有 pendingMaxDurationAudio，不立即 finalize
  if (registration.hasPendingMaxDurationAudio) {
    logger.info(
      {
        sessionId,
        originalJobId,
        receivedCount: registration.receivedCount,
        expectedSegmentCount: registration.expectedSegmentCount,
        reason: 'Has pendingMaxDurationAudio, waiting for subsequent batches',
      },
      'OriginalJobResultDispatcher: Waiting for pendingMaxDurationAudio batches'
    );
    // 不 finalize，等待后续 batch
    return false;
  }
  
  // ✅ 正常 finalize
  registration.isFinalized = true;
  await registration.callback(finalAsrData, registration.originalJob);
  sessionRegistrations.delete(originalJobId);
}
```

**修改 3**: 注册时传递 pendingMaxDurationAudio 信息
```typescript
registerOriginalJob(
  sessionId: string,
  originalJobId: string,
  expectedSegmentCount: number,
  originalJob: JobAssignMessage,
  callback: OriginalJobCallback,
  hasPendingMaxDurationAudio?: boolean  // 新增参数
): void {
  // ...
  const registration: OriginalJobRegistration = {
    // ...
    hasPendingMaxDurationAudio: hasPendingMaxDurationAudio || false,
  };
}
```

### 5.3 调用方修改

**修改位置**: `asr-step.ts`

```typescript
// 检查是否有 pendingMaxDurationAudio
const hasPendingMaxDurationAudio = buffer.pendingMaxDurationAudio !== undefined;

dispatcher.registerOriginalJob(
  job.session_id,
  originalJobId,
  expectedSegmentCount,
  originalJob,
  callback,
  hasPendingMaxDurationAudio  // 传递 pendingMaxDurationAudio 信息
);
```

---

## 六、总结

### 6.1 当前问题

**问题**: Job3 的第一次处理完成后，立即返回结果，registration 被删除。后续 batch 到达时，会创建新的 registration，导致结果被分两次发送。

### 6.2 修复方案

**推荐方案**: 方案 2（保留 registration，标记为 pending）

- 当 MaxDuration finalize 时，如果有 `pendingMaxDurationAudio`，不立即删除 registration
- 标记为 `hasPendingMaxDurationAudio=true`
- 等待后续 batch 到达后，追加并 finalize

### 6.3 修复效果

**修复后**:
- Job3 的所有 batch 处理完后，才返回结果
- 保证结果的完整性
- 不会出现结果被分两次发送的情况

---

*本报告基于代码分析和日志分析。*
