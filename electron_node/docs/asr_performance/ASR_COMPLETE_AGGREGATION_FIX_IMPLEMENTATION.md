# ASR 阶段完整聚合修复实现

**日期**: 2026-01-27  
**状态**: ✅ 已实现

---

## 一、修复目标

确保每个 job 在 ASR 阶段完整处理，等待 TTL 后将完整的 utterance 送入语义修复，而不是在 NMT 之后再进行合并。

---

## 二、实现方案

### 2.1 核心逻辑

**架构设计**：
- 当 MaxDuration finalize 时，如果有 `pendingMaxDurationAudio`，**不立即 finalize**
- 等待 TTL 超时或所有 batch 到达
- 然后才触发后续处理（语义修复、NMT、TTS）

**关键点**：
- ✅ 不新增不必要的流程路径
- ✅ 不产生重复逻辑或冗余处理
- ✅ 代码逻辑简单易懂
- ✅ 用架构设计解决，不打补丁

---

## 三、代码修改

### 3.1 修改文件清单

1. **`original-job-result-dispatcher.ts`**
   - ✅ 添加 `hasPendingMaxDurationAudio` 字段到 `OriginalJobRegistration`
   - ✅ 修改 `registerOriginalJob` 方法签名，添加 `hasPendingMaxDurationAudio` 参数
   - ✅ 修改 `addASRSegment` 方法，延迟 finalize 逻辑
   - ✅ 修改追加 batch 逻辑，清除 `hasPendingMaxDurationAudio` 标记

2. **`asr-step.ts`**
   - ✅ 在注册 originalJob 时，检查是否有 `pendingMaxDurationAudio`
   - ✅ 传递 `hasPendingMaxDurationAudio` 参数

3. **`audio-aggregator.ts`**
   - ✅ 添加 `getBuffer` 方法

---

## 四、修改详情

### 4.1 OriginalJobRegistration 接口

**修改位置**: `original-job-result-dispatcher.ts:41-63`

**新增字段**:
```typescript
interface OriginalJobRegistration {
  // ... 现有字段
  /** 是否有 pendingMaxDurationAudio（等待后续 batch 到达） */
  hasPendingMaxDurationAudio: boolean;
}
```

### 4.2 registerOriginalJob 方法

**修改位置**: `original-job-result-dispatcher.ts:213-289`

**修改内容**:
- 添加 `hasPendingMaxDurationAudio: boolean` 参数（必需）
- 在创建 registration 时设置 `hasPendingMaxDurationAudio` 字段
- 在追加 batch 时，清除 `hasPendingMaxDurationAudio` 标记

### 4.3 addASRSegment 方法

**修改位置**: `original-job-result-dispatcher.ts:354-419`

**修改内容**:
- 当 `receivedCount >= expectedSegmentCount` 时：
  - 如果 `hasPendingMaxDurationAudio === true`，不立即 finalize，返回 `false`
  - 否则，正常 finalize

**关键代码**:
```typescript
if (shouldProcess) {
  // ✅ 如果有 pendingMaxDurationAudio，不立即 finalize，等待 TTL 或后续 batch
  if (registration.hasPendingMaxDurationAudio) {
    logger.info(
      {
        sessionId,
        originalJobId,
        receivedCount: registration.receivedCount,
        expectedSegmentCount: registration.expectedSegmentCount,
        reason: 'Has pendingMaxDurationAudio, waiting for TTL or subsequent batches',
      },
      'OriginalJobResultDispatcher: Waiting for pendingMaxDurationAudio (TTL or subsequent batches)'
    );
    // 不 finalize，继续等待 TTL 超时或后续 batch
    return false;
  }
  
  // ✅ 正常 finalize（没有 pendingMaxDurationAudio）
  // ... 现有 finalize 逻辑
}
```

### 4.4 asr-step.ts

**修改位置**: `asr-step.ts:145-151`

**修改内容**:
- 在注册 originalJob 时，检查是否有 `pendingMaxDurationAudio`
- 传递 `hasPendingMaxDurationAudio` 参数

**关键代码**:
```typescript
// 检查是否有 pendingMaxDurationAudio（通过 audioAggregator 获取 buffer 信息）
const buffer = audioAggregator.getBuffer(job);
const hasPendingMaxDurationAudio = buffer?.pendingMaxDurationAudio !== undefined 
  && buffer.pendingMaxDurationJobInfo?.some(info => info.jobId === originalJobId) === true;

dispatcher.registerOriginalJob(
  job.session_id,
  originalJobId,
  expectedSegmentCount,
  originalJob,
  callback,
  hasPendingMaxDurationAudio  // 传递 pendingMaxDurationAudio 信息
);
```

### 4.5 AudioAggregator.getBuffer 方法

**修改位置**: `audio-aggregator.ts:1001-1013`

**新增方法**:
```typescript
/**
 * 获取缓冲区（用于检查 pendingMaxDurationAudio）
 * 
 * @param job JobAssignMessage（用于构建正确的 bufferKey）
 * @returns AudioBuffer 或 undefined
 */
getBuffer(job: JobAssignMessage): AudioBuffer | undefined {
  const bufferKey = buildBufferKey(job);
  return this.buffers.get(bufferKey);
}
```

---

## 五、修复效果

### 5.1 修复前

```
Job3 MaxDuration finalize
  ├─ 处理 batch0, batch1
  ├─ receivedCount >= expectedSegmentCount (2 >= 2)
  ├─ 立即 finalize，发送结果 ✅
  └─ registration 被删除

Job5 处理 pendingMaxDurationAudio
  ├─ 产生 batch0（归属 Job3）
  ├─ registration 已不存在，创建新的 registration
  └─ 再次发送结果 ⚠️（分两次发送）
```

### 5.2 修复后

```
Job3 MaxDuration finalize
  ├─ 处理 batch0, batch1
  ├─ receivedCount >= expectedSegmentCount (2 >= 2)
  ├─ 检测到 hasPendingMaxDurationAudio = true
  ├─ 不立即 finalize，等待 TTL ⏳
  └─ registration 保留

Job5 处理 pendingMaxDurationAudio
  ├─ 产生 batch0（归属 Job3）
  ├─ 追加到 existing registration
  ├─ 清除 hasPendingMaxDurationAudio 标记
  ├─ receivedCount >= expectedSegmentCount (3 >= 3)
  └─ 触发 finalize，发送完整结果 ✅（一次发送）
```

---

## 六、代码简洁性

### 6.1 新增代码

- **OriginalJobRegistration 接口**: 1 个字段（`hasPendingMaxDurationAudio?: boolean`）
- **registerOriginalJob 方法**: 1 个参数（`hasPendingMaxDurationAudio?: boolean`）
- **addASRSegment 方法**: 约 15 行代码（条件判断 + 日志）
- **asr-step.ts**: 约 3 行代码（检查 + 传递参数）
- **AudioAggregator.getBuffer 方法**: 约 5 行代码

**总计**: 约 25-30 行代码

### 6.2 代码复杂度

- ✅ **逻辑简单**: 只添加一个条件判断
- ✅ **不新增流程路径**: 复用现有的 TTL 机制
- ✅ **不打补丁**: 用架构设计解决
- ✅ **易于理解**: 代码意图清晰

---

## 七、注意事项

### 7.1 TTL 超时处理

- 如果 TTL 超时，`forceFinalizePartial` 会触发 finalize
- 即使有 `pendingMaxDurationAudio`，TTL 超时后也会 finalize（避免无限等待）

### 7.2 后续 batch 到达

- 当后续 batch 到达时，会追加到 existing registration
- 清除 `hasPendingMaxDurationAudio` 标记
- 如果 `receivedCount >= expectedSegmentCount`，立即触发 finalize

---

## 八、单元测试

### 8.1 测试覆盖

已添加以下单元测试（`original-job-result-dispatcher.test.ts`）：

1. **`应该在有 pendingMaxDurationAudio 时不立即 finalize`**
   - 验证：当 `hasPendingMaxDurationAudio = true` 时，即使 `receivedCount >= expectedSegmentCount`，也不立即 finalize
   - 验证：callback 不被调用，等待 TTL 或后续 batch

2. **`应该在后续 batch 到达时清除 pendingMaxDurationAudio 标记并 finalize`**
   - 验证：后续 batch 到达时，追加到 existing registration
   - 验证：清除 `hasPendingMaxDurationAudio` 标记
   - 验证：触发 finalize，发送完整结果

3. **`应该在 TTL 超时时强制 finalize（即使有 pendingMaxDurationAudio）`**
   - 验证：TTL 超时后，`forceFinalizePartial` 触发 finalize
   - 验证：即使有 `pendingMaxDurationAudio`，TTL 超时后也会 finalize

4. **`应该在没有 pendingMaxDurationAudio 时正常 finalize`**
   - 验证：当 `hasPendingMaxDurationAudio = false` 时，正常 finalize（向后兼容）

5. **`应该在追加 batch 时清除 pendingMaxDurationAudio 标记`**
   - 验证：追加 batch 时，清除 `hasPendingMaxDurationAudio` 标记
   - 验证：清除标记后，如果 `receivedCount >= expectedSegmentCount`，立即触发 finalize

### 8.2 运行测试

```bash
cd electron_node/electron-node
npm test -- original-job-result-dispatcher.test.ts
```

---

## 九、测试建议

### 9.1 集成测试场景

1. **MaxDuration finalize 有 pendingMaxDurationAudio**
   - 验证：不立即 finalize，等待 TTL 或后续 batch
   - 验证：registration 保留，不删除

2. **MaxDuration finalize 无 pendingMaxDurationAudio**
   - 验证：正常 finalize（不受影响）

3. **后续 batch 到达**
   - 验证：追加到 existing registration
   - 验证：清除 `hasPendingMaxDurationAudio` 标记
   - 验证：触发 finalize，发送完整结果

4. **TTL 超时**
   - 验证：强制 finalize partial

---

*修复已完成，代码简洁，逻辑清晰，符合架构设计原则。单元测试已添加。*
