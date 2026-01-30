# ASR 阶段完整聚合修复方案

**日期**: 2026-01-27  
**目标**: 确保每个 job 在 ASR 阶段完整处理，等待 TTL 后将完整的 utterance 送入语义修复

---

## 一、问题分析

### 1.1 当前问题

1. **Job3 的第一次处理完成后立即返回结果**
   - 当 `receivedCount >= expectedSegmentCount` 时，立即触发 finalize
   - registration 被删除
   - 后续 batch（来自 pendingMaxDurationAudio）到达时，registration 已不存在

2. **结果被分两次发送**
   - 第一次：Job3 的 batch0, batch1 处理完成后发送
   - 第二次：Job3 的后续 batch（来自 pendingMaxDurationAudio）到达时，创建新的 registration，再次发送

3. **不符合设计意图**
   - `pendingMaxDurationAudio` 是 Job3 的一部分，应该等待它处理完再返回结果
   - 应该在 ASR 阶段完整聚合，等待 TTL 超时后再送入语义修复

---

## 二、修复方案

### 2.1 核心思路

**架构设计**：
- 当 MaxDuration finalize 时，如果有 `pendingMaxDurationAudio`，**不立即 finalize**
- 等待 TTL 超时或所有 batch 到达
- 然后才触发后续处理（语义修复、NMT、TTS）

**关键点**：
- 不新增不必要的流程路径
- 不产生重复逻辑或冗余处理
- 代码逻辑简单易懂
- 用架构设计解决，不打补丁

### 2.2 实现方案

#### 方案 1：延迟 finalize（推荐）

**核心逻辑**：
- 在 `addASRSegment` 中，当 `receivedCount >= expectedSegmentCount` 时：
  - 如果 registration 标记为 `hasPendingMaxDurationAudio`，**不立即 finalize**
  - 继续等待 TTL 超时或后续 batch 到达
  - TTL 超时时，才 finalize

**优点**：
- 逻辑简单：只修改 finalize 条件
- 不需要新增流程路径
- 符合设计意图

**实现步骤**：

1. **修改 `OriginalJobRegistration` 接口**：
   ```typescript
   interface OriginalJobRegistration {
     // ... 现有字段
     hasPendingMaxDurationAudio: boolean;  // 新增：是否有 pendingMaxDurationAudio（必需）
   }
   ```

2. **修改 `registerOriginalJob` 方法**：
   ```typescript
   registerOriginalJob(
     sessionId: string,
     originalJobId: string,
     expectedSegmentCount: number,
     originalJob: JobAssignMessage,
     callback: OriginalJobCallback,
     hasPendingMaxDurationAudio: boolean  // 新增参数（必需）
   ): void {
     // ...
     const registration: OriginalJobRegistration = {
       // ...
       hasPendingMaxDurationAudio,
     };
   }
   ```

3. **修改 `addASRSegment` 方法**：
   ```typescript
   // ✅ 检查是否应该立即处理：当 receivedCount >= expectedSegmentCount 时触发
   const shouldProcess = registration.receivedCount >= registration.expectedSegmentCount;

   if (shouldProcess) {
     // ✅ 如果有 pendingMaxDurationAudio，不立即 finalize，等待 TTL
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

4. **修改 `asr-step.ts`**：
   ```typescript
   // 检查是否有 pendingMaxDurationAudio（通过 audioAggregator 获取 buffer 信息）
   const buffer = audioAggregator.getBuffer(job.session_id);
   const hasPendingMaxDurationAudio = buffer?.pendingMaxDurationAudio !== undefined 
     && buffer.pendingMaxDurationJobInfo?.some(info => info.jobId === originalJobId);

   dispatcher.registerOriginalJob(
     job.session_id,
     originalJobId,
     expectedSegmentCount,
     originalJob,
     callback,
     hasPendingMaxDurationAudio  // 传递 pendingMaxDurationAudio 信息
   );
   ```

5. **需要 `AudioAggregator` 提供 `getBuffer` 方法**：
   ```typescript
   // 在 AudioAggregator 中添加
   getBuffer(sessionId: string): AudioBuffer | undefined {
     const bufferKey = buildBufferKey({ session_id: sessionId } as JobAssignMessage);
     return this.buffers.get(bufferKey);
   }
   ```

---

## 三、代码修改清单

### 3.1 修改文件

1. **`original-job-result-dispatcher.ts`**
   - 添加 `hasPendingMaxDurationAudio` 字段到 `OriginalJobRegistration`
   - 修改 `registerOriginalJob` 方法签名，添加 `hasPendingMaxDurationAudio` 参数
   - 修改 `addASRSegment` 方法，延迟 finalize 逻辑

2. **`asr-step.ts`**
   - 在注册 originalJob 时，检查是否有 `pendingMaxDurationAudio`
   - 传递 `hasPendingMaxDurationAudio` 参数

3. **`audio-aggregator.ts`**
   - 添加 `getBuffer` 方法（如果不存在）

### 3.2 代码行数

- 预计新增代码：约 30-40 行
- 修改现有代码：约 10-15 行

---

## 四、修复效果

### 4.1 修复前

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

### 4.2 修复后

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
  ├─ receivedCount >= expectedSegmentCount (3 >= 3)
  └─ 触发 finalize，发送完整结果 ✅（一次发送）
```

---

## 五、注意事项

### 5.1 TTL 超时处理

- 如果 TTL 超时，`forceFinalizePartial` 会触发 finalize
- 即使有 `pendingMaxDurationAudio`，TTL 超时后也会 finalize（避免无限等待）

### 5.2 代码简洁性

- 只添加一个字段和一个条件判断
- 不新增流程路径
- 逻辑清晰易懂

---

## 六、测试建议

### 6.1 测试场景

1. **MaxDuration finalize 有 pendingMaxDurationAudio**
   - 验证：不立即 finalize，等待 TTL 或后续 batch

2. **MaxDuration finalize 无 pendingMaxDurationAudio**
   - 验证：正常 finalize（不受影响）

3. **后续 batch 到达**
   - 验证：追加到 existing registration，触发 finalize

4. **TTL 超时**
   - 验证：强制 finalize partial

---

*本方案基于架构设计，不打补丁，保持代码简洁。*
