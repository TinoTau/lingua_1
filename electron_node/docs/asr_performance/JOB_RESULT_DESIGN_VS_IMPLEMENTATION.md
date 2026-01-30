# JobResult 设计 vs 实现：架构偏离分析

**日期**：2026-01-28  
**问题**：当前实现是否违反"唯一路径、唯一返回值"的原始设计？

---

## 一、原始设计意图

### 1.1 设计原则

**JobResult 应该是唯一路径上的唯一返回值**：

```
调度服务器下发 job_assign
    ↓
节点端接收 job
    ↓
JobPipeline（唯一编排器）
    ├─→ ASR 服务处理 → 结果写入 ctx
    ├─→ 聚合服务处理 → 结果写入 ctx
    ├─→ 语义修复服务处理 → 结果写入 ctx
    ├─→ 去重服务处理 → 结果写入 ctx
    ├─→ 翻译服务处理 → 结果写入 ctx
    └─→ TTS 服务处理 → 结果写入 ctx
    ↓
buildJobResult(job, ctx) → 返回 JobResult
    ↓
node-agent-simple 统一发送给调度服务器
```

**关键点**：
- **唯一路径**：所有服务串联在同一个 `runJobPipeline` 调用中
- **唯一返回值**：pipeline 完成后返回一个 `JobResult`，由 node-agent 统一发送
- **各服务职责**：处理任务，把结果放到 `ctx` 里交给下一个服务，**不直接发送给调度服务器**

### 1.2 代码体现（符合设计的部分）

**`job-pipeline.ts`**：
```ts
export async function runJobPipeline(options: JobPipelineOptions): Promise<JobResult> {
  // 按步骤序列执行：ASR → AGGREGATION → SEMANTIC_REPAIR → DEDUP → TRANSLATION → TTS
  for (const step of mode.steps) {
    await executeStep(step, job, ctx, services, stepOptions);
  }
  // 唯一返回值
  return buildJobResult(job, ctx);
}
```

**`node-agent-simple.ts`**：
```ts
const processResult = await this.jobProcessor.processJob(job, startTime);
// processJob 内部调用 inferenceService.processJob → runJobPipeline
// 返回 finalResult，由 node-agent 统一发送
this.resultSender.sendJobResult(job, processResult.finalResult, startTime, true);
```

---

## 二、当前实现（违反设计）

### 2.1 问题：asr-step 内直接发送

**`asr-step.ts`**（第 196-212 行）：
```ts
// 在 dispatcher 的 callback 内，对每个 original job 执行 pipeline
const result = await runJobPipeline({
  job: originalJobMsg,
  services,
  ctx: originalCtx,
});

// ❌ 违反设计：在 pipeline 中间步骤（ASR 步骤）内直接发送结果
if (services.resultSender) {
  services.resultSender.sendJobResult(
    originalJobMsg,
    result,
    startTime,
    result.should_send ?? true,
    result.dedup_reason
  );
  logger.info(/* ... */ 'runAsrStep: Original job result sent to scheduler');
}
```

**问题**：
- **违反了"唯一路径"**：original job 的 pipeline 完成后，在 **ASR 步骤的 callback 内**就发送了，而不是等到 container 的 pipeline 完成
- **违反了"唯一返回值"**：每个 original job 的 pipeline 都返回一个 `JobResult` 并立即发送，而不是统一由 container 的 pipeline 返回一个 `JobResult`
- **变成了"每个服务处理完都直接返回"**：至少对于 original job，确实变成了"pipeline 完成 → 立即发送"

### 2.2 发送点统计

| 发送点 | 位置 | 触发条件 | 是否符合设计 |
|--------|------|----------|--------------|
| **发送点 1** | `asr-step.ts` callback 内 | original job 的 `runJobPipeline` 完成后 | ❌ 违反：在 pipeline 中间步骤内发送 |
| **发送点 2** | `node-agent-simple.ts` | container 的 `processJob` 返回后 | ✅ 符合：统一发送点 |
| **发送点 3** | `asr-step.ts` 空容器检测 | 检测到 emptyJobIds 时 | ❌ 违反：在 pipeline 中间步骤内发送 |

**结论**：当前实现**确实违反了"唯一路径、唯一返回值"的设计**，变成了"每个 original job 的 pipeline 完成后都直接发送一个 jobResult 给调度服务器"。

---

## 三、设计偏离的原因

### 3.1 467aee4 的改动

- **要解决的问题**：当 original job 有 `pendingMaxDurationAudio` 时，container 的 `ctx.asrText` 为空，导致发送空结果（Job1 文本丢失）。
- **采用的方案**：在 asr-step 内，当 original job 的 pipeline 完成时**立即发送**，不再依赖 container 的 pipeline 填充 `ctx`。
- **副作用**：引入了"在 pipeline 中间步骤内发送"的路径，违反了原始设计。

### 3.2 设计权衡

| 方案 | 是否符合原始设计 | 是否解决 pendingMaxDurationAudio 问题 |
|------|------------------|----------------------------------------|
| **原始设计**（container 统一发送） | ✅ 符合 | ❌ 未解决：container 的 ctx 为空 |
| **当前实现**（asr-step 内发送） | ❌ 违反 | ✅ 解决：original job 立即发送 |

---

## 四、符合原始设计的正确实现应该是

### 4.1 设计原则

1. **唯一路径**：所有服务串联在同一个 pipeline 调用中（container 的 pipeline）
2. **唯一返回值**：pipeline 完成后返回一个 `JobResult`，由 node-agent 统一发送
3. **original job 的处理**：original job 的 pipeline **只负责产出 result，不发送**；将 result **回填到 container 的 ctx 或 finalResult**，最后由 container 的 pipeline 统一返回

### 4.2 正确流程（概念）

```
调度服务器下发 job_assign (container job)
    ↓
node-agent-simple.processJob(containerJob)
    ↓
runJobPipeline(containerJob)
    ├─→ ASR 步骤
    │   ├─→ 音频分片 → originalJobIds
    │   ├─→ 对每个 original job：
    │   │   ├─→ runJobPipeline(originalJob) → 产出 result
    │   │   └─→ 将 result 回填到 container 的 ctx（或合并到 finalResult）
    │   └─→ container 的 ctx.asrText = 合并后的文本
    ├─→ AGGREGATION 步骤（处理 container 的 ctx）
    ├─→ SEMANTIC_REPAIR 步骤（处理 container 的 ctx）
    ├─→ DEDUP 步骤（处理 container 的 ctx）
    ├─→ TRANSLATION 步骤（处理 container 的 ctx）
    └─→ TTS 步骤（处理 container 的 ctx）
    ↓
buildJobResult(containerJob, containerCtx) → 返回 JobResult
    ↓
node-agent-simple 统一发送给调度服务器（唯一发送点）
```

### 4.3 需要修改的地方

1. **asr-step.ts**：
   - ❌ 移除：`services.resultSender.sendJobResult(originalJobMsg, result, ...)`
   - ✅ 新增：将 original job 的 `result` 回填到 container 的 `ctx`（例如：合并 `result.text_asr` 到 `ctx.asrText`，或标记"已由 original job 处理"）

2. **result-builder.ts**：
   - 可能需要支持从 container 的 ctx 中提取"来自 original job 的结果"并写入 finalResult

3. **node-agent-simple.ts**：
   - ✅ 保持：统一发送点（移除 `originalJobResultsAlreadySent` 判断，因为不再需要）

4. **pendingMaxDurationAudio 问题**：
   - 需要单独解决：确保在 dispatcher 触发 callback 时，即使有 pendingMaxDurationAudio，也能将结果回填到 container 的 ctx，而不是让 container 的 ctx 为空

---

## 五、结论

### 5.1 当前实现状态

- ❌ **不符合原始设计**：在 pipeline 中间步骤（ASR 步骤）内直接发送 jobResult
- ❌ **变成了"每个服务处理完都直接返回"**：至少对于 original job，确实如此
- ✅ **解决了 pendingMaxDurationAudio 导致的文本丢失问题**：但代价是违反设计

### 5.2 建议

- **短期**：保持当前实现（已用 `originalJobResultsAlreadySent` 标记避免重复发送），但明确这是**临时方案**，不符合原始设计
- **长期**：重构为符合原始设计的实现：
  1. asr-step 内不再发送，只回填 result 到 container 的 ctx
  2. container 的 pipeline 统一返回 finalResult
  3. node-agent 统一发送（唯一发送点）
  4. 单独解决 pendingMaxDurationAudio 问题（确保回填逻辑正确）

---

*以上为设计 vs 实现的分析，供架构调整决策参考。*
