# UtteranceIndex修复实现记录

## 问题描述

根据 `LONG_UTTERANCE_JOB_CONTAINER_POLICY.md` 的要求：**输出的 utterance_index 必须使用原始 job 的 index**

### 发现的问题

1. **utteranceIndex传递错误**：
   - Job 623 的原始 `utteranceIndex` 是 **0**，但发送结果时使用了 **2**
   - Job 624 的原始 `utteranceIndex` 是 **1**，但发送结果时使用了 **2**
   - 导致web端显示两个结果都是 `[2]`，无法区分原始顺序

2. **SequentialExecutor顺序执行失败**：
   - Job 624 的语义修复和翻译步骤失败
   - 错误：`Task index 2 is less than or equal to current index 2, task may have arrived too late`
   - 根本原因：`SequentialExecutor` 使用了当前job（Job 625）的 `utteranceIndex: 2`，而不是原始job的 `utteranceIndex`

---

## 修复方案

### 核心原则

**按照 `LONG_UTTERANCE_JOB_CONTAINER_POLICY.md` 第148行要求**：
> 输出的 utterance_index 必须使用原始 job 的 index

### 修复步骤

#### 1. 修改 `AudioChunkResult` 包含 `originalJobInfo`

**文件**：`electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator-types.ts`

**修改**：
```typescript
export interface AudioChunkResult {
  audioSegments: string[];
  originalJobIds?: string[];
  originalJobInfo?: OriginalJobInfo[];  // 新增：包含原始job的utteranceIndex
  shouldReturnEmpty: boolean;
  isTimeoutPending?: boolean;
}
```

**原因**：需要将原始job的 `utteranceIndex` 传递到 `asr-step.ts`

---

#### 2. 修改 `audio-aggregator.ts` 返回 `originalJobInfo`

**文件**：`electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts`

**修改**：
```typescript
return {
  audioSegments: audioSegmentsBase64,
  originalJobIds,
  originalJobInfo: jobInfoToProcess, // 传递原始job信息（包含utteranceIndex）
  shouldReturnEmpty: false,
};
```

**原因**：`jobInfoToProcess` 包含所有原始job的信息，包括 `utteranceIndex`

---

#### 3. 修改 `pipeline-orchestrator-audio-processor.ts` 传递 `originalJobInfo`

**文件**：`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator-audio-processor.ts`

**修改**：
1. 添加 `OriginalJobInfo` 导入
2. 在 `AudioProcessorResult` 接口中添加 `originalJobInfo?: OriginalJobInfo[]`
3. 在所有返回语句中包含 `originalJobInfo: chunkResult.originalJobInfo`

**原因**：将 `originalJobInfo` 从 `AudioAggregator` 传递到 `asr-step.ts`

---

#### 4. 修改 `asr-step.ts` 使用原始job的 `utteranceIndex`

**文件**：`electron_node/electron-node/main/src/pipeline/steps/asr-step.ts`

**修改**：
```typescript
// 从originalJobInfo中查找原始job的utteranceIndex
const jobInfo = originalJobInfo.find(info => info.jobId === originalJobId);
const originalUtteranceIndex = jobInfo?.utteranceIndex ?? job.utterance_index;

// 创建原始job的副本，使用原始job的utteranceIndex
const originalJob: JobAssignMessage = {
  ...job,
  job_id: originalJobId,
  utterance_index: originalUtteranceIndex,  // 使用原始job的utteranceIndex
};
```

**关键点**：
- 从 `originalJobInfo` 中查找对应 `originalJobId` 的 `utteranceIndex`
- 如果找不到，使用当前job的 `utteranceIndex` 作为后备（向后兼容）
- 创建 `originalJob` 时，明确设置 `utterance_index: originalUtteranceIndex`

**影响**：
- `runJobPipeline(originalJob)` 会使用正确的 `utteranceIndex`
- `SequentialExecutor.execute(sessionId, job.utterance_index, ...)` 会使用原始job的 `utteranceIndex`
- `ResultSender.sendJobResult(job, ...)` 会使用原始job的 `utteranceIndex`

---

## 修复效果

### 修复前

```
Job 623 (原始utteranceIndex: 0):
  ├─ 处理时使用 utteranceIndex: 2 ❌（当前job的）
  ├─ SequentialExecutor: currentIndex = 2
  └─ 发送结果: utterance_index = 2 ❌

Job 624 (原始utteranceIndex: 1):
  ├─ 处理时使用 utteranceIndex: 2 ❌（当前job的）
  ├─ SequentialExecutor: currentIndex (2) >= utteranceIndex (2) → 拒绝执行 ❌
  └─ 发送结果: utterance_index = 2 ❌（但处理失败）
```

### 修复后

```
Job 623 (原始utteranceIndex: 0):
  ├─ 从originalJobInfo获取 utteranceIndex: 0 ✅
  ├─ 处理时使用 utteranceIndex: 0 ✅（原始job的）
  ├─ SequentialExecutor: currentIndex = 0 → 1 → 2 ✅
  └─ 发送结果: utterance_index = 0 ✅

Job 624 (原始utteranceIndex: 1):
  ├─ 从originalJobInfo获取 utteranceIndex: 1 ✅
  ├─ 处理时使用 utteranceIndex: 1 ✅（原始job的）
  ├─ SequentialExecutor: currentIndex (0) < utteranceIndex (1) → 允许执行 ✅
  └─ 发送结果: utterance_index = 1 ✅
```

---

## 代码变更总结

### 修改的文件

1. **`audio-aggregator-types.ts`**：
   - 添加 `originalJobInfo?: OriginalJobInfo[]` 到 `AudioChunkResult`

2. **`audio-aggregator.ts`**：
   - 返回 `originalJobInfo: jobInfoToProcess`

3. **`pipeline-orchestrator-audio-processor.ts`**：
   - 导入 `OriginalJobInfo`
   - 添加 `originalJobInfo?: OriginalJobInfo[]` 到 `AudioProcessorResult`
   - 在所有返回语句中包含 `originalJobInfo`

4. **`asr-step.ts`**：
   - 导入 `OriginalJobInfo`
   - 从 `audioProcessResult` 获取 `originalJobInfo`
   - 在创建 `originalJob` 时，从 `originalJobInfo` 查找并设置正确的 `utterance_index`

---

## 验证要点

### 1. utteranceIndex传递验证

**测试场景**：
- 创建多个job（Job 623 `utteranceIndex:0`, Job 624 `utteranceIndex:1`, Job 625 `utteranceIndex:2`）
- Job 623和624的音频被缓存
- Job 625合并音频，分配给原始job

**预期结果**：
- Job 623 的结果使用 `utterance_index: 0`
- Job 624 的结果使用 `utterance_index: 1`
- Job 625 发送核销空结果，使用 `utterance_index: 2`

### 2. SequentialExecutor顺序执行验证

**测试场景**：
- 多个原始job同时处理（Job 623和624）
- 验证 `SequentialExecutor` 能按正确的 `utteranceIndex` 顺序执行

**预期结果**：
- Job 623 (`utteranceIndex: 0`) 先执行
- Job 624 (`utteranceIndex: 1`) 后执行
- 不会因为 `currentIndex` 更新错误而导致任务被拒绝

### 3. Web端显示验证

**测试场景**：
- 多个原始job的结果发送给调度服务器
- Web端显示结果

**预期结果**：
- 显示 `[0]` 和 `[1]`，而不是都是 `[2]`
- 可以正确区分原始顺序

---

## 相关文档

- `LONG_UTTERANCE_JOB_CONTAINER_POLICY.md` - 策略文档，要求使用原始job的utteranceIndex
- `INTEGRATION_TEST_ISSUE_ANALYSIS.md` - 问题分析文档

---

## 总结

**修复状态**：✅ 已完成

**核心改进**：
1. ✅ 确保 `originalJob` 使用原始job的 `utteranceIndex`
2. ✅ `SequentialExecutor` 使用原始job的 `utteranceIndex` 管理顺序
3. ✅ `ResultSender` 发送原始job的 `utteranceIndex` 给调度服务器
4. ✅ 符合 `LONG_UTTERANCE_JOB_CONTAINER_POLICY.md` 的要求

**预期效果**：
- ✅ 解决utteranceIndex传递错误问题
- ✅ 解决SequentialExecutor顺序执行失败问题
- ✅ Web端可以正确显示原始顺序
