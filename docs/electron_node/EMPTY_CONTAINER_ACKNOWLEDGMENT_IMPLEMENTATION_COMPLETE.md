# 空容器核销实现完成

## 实现日期
2026-01-16

## 实现内容

根据 `LONG_UTTERANCE_CURRENT_VS_DESIGN_GAP.md` 的要求，实现了**空容器Job的空结果核销**功能。

---

## 修复内容

### 1. 在ASR Step中检测空容器

**文件**：`electron_node/electron-node/main/src/pipeline/steps/asr-step.ts`

**位置**：第247-295行（在注册OriginalJob之后）

**实现逻辑**：
```typescript
// 检测空容器：找出jobInfoToProcess中没有被分配到batch的job
if (originalJobIds.length > 0 && originalJobInfo.length > 0) {
  const assignedJobIds = Array.from(new Set(originalJobIds));
  const allJobIds = originalJobInfo.map(info => info.jobId);
  const emptyJobIds = allJobIds.filter(jobId => !assignedJobIds.includes(jobId));
  
  // 为每个空容器发送空结果
  if (emptyJobIds.length > 0 && services.resultSender) {
    for (const emptyJobId of emptyJobIds) {
      const emptyJobInfo = originalJobInfo.find(info => info.jobId === emptyJobId);
      if (emptyJobInfo) {
        // 创建空job消息，使用原始job的utteranceIndex
        const emptyJob: JobAssignMessage = {
          ...job,
          job_id: emptyJobInfo.jobId,
          utterance_index: emptyJobInfo.utteranceIndex,
        };
        
        // 创建空结果
        const emptyResult: JobResult = {
          text_asr: '',
          text_translated: '',
          tts_audio: '',
          should_send: true,
          extra: {
            reason: 'NO_TEXT_ASSIGNED',
          },
        };
        
        // 发送空结果核销
        services.resultSender.sendJobResult(
          emptyJob,
          emptyResult,
          Date.now(),
          true,
          'NO_TEXT_ASSIGNED'
        );
      }
    }
  }
}
```

**关键点**：
- ✅ 使用原始job的 `utteranceIndex`（从 `emptyJobInfo.utteranceIndex` 获取）
- ✅ `reason = "NO_TEXT_ASSIGNED"`（放在 `extra.reason` 中）
- ✅ 立即发送，不等待Dispatcher

---

### 2. ResultSender支持空容器核销

**文件**：`electron_node/electron-node/main/src/agent/node-agent-result-sender.ts`

**修改位置**：第75-82行，第145-150行

**修改内容**：

1. **检测NO_TEXT_ASSIGNED**（第75-77行）
   ```typescript
   // 检查是否是"空容器核销"情况：NO_TEXT_ASSIGNED
   const extraReason = (finalResult.extra as any)?.reason;
   const isNoTextAssigned = extraReason === 'NO_TEXT_ASSIGNED';
   ```

2. **允许发送空结果**（第82行）
   ```typescript
   // 例外2：如果是"空容器核销"情况（NO_TEXT_ASSIGNED），发送空结果核销当前job
   if (isEmpty && !isConsolidated && !isNoTextAssigned) {
     // 不发送
     return;
   }
   ```

3. **确保extra包含reason**（第145-150行）
   ```typescript
   // 关键修复：如果extraReason是NO_TEXT_ASSIGNED，确保extra中包含reason字段
   const extra = finalResult.extra || {};
   if (isNoTextAssigned && !extra.reason) {
     extra.reason = 'NO_TEXT_ASSIGNED';
   }
   ```

**关键点**：
- ✅ 当 `extra.reason = "NO_TEXT_ASSIGNED"` 时，允许发送空结果
- ✅ 确保 `extra.reason` 字段被正确传递到 `JobResultMessage`

---

## 实现效果

### 修复前

**场景**：35秒长语音，4个job，最后一个job为空
- job0, job1, job2: 有batch，正常处理 ✅
- job3: 没有batch，Dispatcher不注册，调度一直等待 ❌

### 修复后

**场景**：35秒长语音，4个job，最后一个job为空
- job0, job1, job2: 有batch，正常处理 ✅
- job3: 没有batch，**立即发送空结果核销** ✅
  ```json
  {
    "job_id": "job3",
    "utterance_index": 3,
    "text_asr": "",
    "text_translated": "",
    "tts_audio": "",
    "extra": {
      "reason": "NO_TEXT_ASSIGNED"
    }
  }
  ```

---

## 测试验证

### 测试场景

1. **35秒长语音，4个job，最后一个job为空**
   - 输入：job0, job1, job2, job3（job3很短，没有分配到batch）
   - 期望：job0, job1, job2有结果，job3收到空结果核销

2. **多个空容器**
   - 输入：job0, job1, job2, job3, job4（job2和job4为空）
   - 期望：job2和job4都收到空结果核销

---

## 代码变更总结

### 修改的文件

1. **`electron_node/electron-node/main/src/pipeline/steps/asr-step.ts`**
   - 添加空容器检测逻辑（第247-295行）
   - 添加 `JobResult` import

2. **`electron_node/electron-node/main/src/agent/node-agent-result-sender.ts`**
   - 添加 `isNoTextAssigned` 检测（第75-77行）
   - 修改空结果发送逻辑（第82行）
   - 确保 `extra.reason` 传递（第145-150行）

---

## 相关文档

- `LONG_UTTERANCE_CURRENT_VS_DESIGN_GAP.md` - 设计差异分析
- `EMPTY_CONTAINER_ACKNOWLEDGMENT_IMPLEMENTATION_PLAN.md` - 实现计划
- `REMAINING_IMPLEMENTATION_TASKS.md` - 剩余任务清单

---

## 下一步

### 剩余任务（优先级2和3）

1. **调度端expectedDurationMs计算和传递** ⚠️
   - 在Job创建时计算 `expectedDurationMs`
   - 在 `JobAssignMessage` 中添加字段
   - 在创建消息时传递

2. **调度端空核销结果的支持** ⚠️
   - 在 `JobResultMessage` 中添加 `reason` 字段（或从 `extra.reason` 读取）
   - 处理 `NO_TEXT_ASSIGNED` 结果
   - 将空核销视为正常完成

---

## 总结

✅ **空容器核销功能已实现**

**核心改进**：
- 在容器分配后检测空容器
- 为每个空容器立即发送空结果核销
- 确保 `utterance_index` 使用原始job的index
- 确保 `reason = "NO_TEXT_ASSIGNED"` 被正确传递

**预期效果**：
- ✅ 空容器job不再导致调度超时
- ✅ 调度能正确识别空核销结果
- ✅ 长语音处理链路完全闭环
