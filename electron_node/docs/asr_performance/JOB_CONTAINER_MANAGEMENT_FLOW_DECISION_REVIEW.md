# Job 容器管理流程决策审议文档

**范围**：从收到 job 到构建、发送 JobResult 的完整“容器”管理路径  
**目的**：逐方法列出调用顺序，确认唯一容器、单发送点，识别重复或错误调用，供决策部门审议。

---

## 1. 设计原则（当前实现）

- **唯一容器**：每个收到的 job 对应一个 `JobContext`（ctx），整条 pipeline 共用该 ctx，无多容器并行。
- **单发送点**：仅 node-agent 的 `handleJob` 内根据 `resultsToSend` 循环调用 `sendJobResult`；asr-step 不发送。
- **结果列表**：主结果 + 空容器核销（若有）合并为 `resultsToSend`，一次循环发出，无“主结果分支 + 空容器分支”双路径。

---

## 2. 调用链（按执行顺序）

### 2.1 容器创建与填充

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 1 | runJobPipeline | `ctx = providedCtx \|\| initJobContext(job)` | job-pipeline.ts → context/job-context.ts |
| 2 | runJobPipeline | 对每个步骤：`executeStep(step, job, ctx, services, stepOptions)` | job-pipeline.ts |
| 3 | runAsrStep | 写 `ctx.audio`、`ctx.audioFormat`；若空容器：写 `(ctx as any).pendingEmptyJobs` | asr-step.ts |
| 4 | runAsrStep | 每 ASR segment：写 `ctx.asrText`、`ctx.asrSegments`、`ctx.languageProbabilities`、`ctx.qualityScore` 等 | asr-step.ts |
| 5 | runAggregationStep | 写 `ctx.aggregatedText`、`ctx.aggregationAction`、`ctx.aggregationChanged`、`ctx.shouldSendToSemanticRepair`、`ctx.lastCommittedText` 等 | aggregation-step.ts |
| 6 | runSemanticRepairStep | 写 `ctx.repairedText`、`ctx.semanticDecision`、`ctx.semanticRepairApplied`、`ctx.semanticRepairConfidence`；可选 `aggregatorManager.updateLastCommittedTextAfterRepair` | semantic-repair-step.ts |
| 7 | runDedupStep（若执行） | 写 `ctx.shouldSend`、`ctx.dedupReason` | dedup-step.ts |
| 8 | runTranslationStep | 写 `ctx.translatedText`、`ctx.detectedTargetLang` 等 | translation-step.ts |
| 9 | runTtsStep / runYourTtsStep | 写 `ctx.ttsAudio`、`ctx.ttsFormat` 等 | tts-step.ts / yourtts-step.ts |

### 2.2 从 ctx 构建 JobResult（唯一构建点）

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 10 | runJobPipeline | `return buildJobResult(job, ctx)` | job-pipeline.ts |
| 11 | buildJobResult | 从 ctx 读 `repairedText/aggregatedText/asrText`、`translatedText`、`ttsAudio/ttsFormat`、`extra.audioBuffered`、`extra.pendingEmptyJobs` 等，构造单个 `JobResult` | result-builder.ts |

**buildJobResult 不包含**：`is_consolidated`、`consolidated_to_job_ids`（已移除）；空容器信息仅通过 `extra.pendingEmptyJobs` 传递。

### 2.3 从 Pipeline 返回到 Node-Agent

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 12 | InferenceService.processJob | `const result = await runJobPipeline(...)`；return result | inference-service.ts |
| 13 | JobProcessor.processJob | `const result = await this.inferenceService.processJob(job, partialCallback)`；TTS 编码等后，return `{ finalResult, shouldSend, reason }` | node-agent-job-processor.ts |

### 2.4 唯一发送路径：resultsToSend + 单循环

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 14 | NodeAgent.handleJob | `processResult = await this.jobProcessor.processJob(job, startTime)` | node-agent-simple.ts |
| 15 | NodeAgent.handleJob | `pendingEmptyJobs = processResult.finalResult.extra?.pendingEmptyJobs` | node-agent-simple.ts |
| 16 | NodeAgent.handleJob | 构建 `resultsToSend = [{ job, result: processResult.finalResult, shouldSend, reason }]`；若 `processResult.shouldSend && pendingEmptyJobs?.length`，则 push 每个空容器 `{ job: { ...job, job_id, utterance_index }, result: emptyResult, shouldSend: true, reason: 'NO_TEXT_ASSIGNED' }` | node-agent-simple.ts |
| 17 | NodeAgent.handleJob | `for (const { job: j, result: r, shouldSend: s, reason } of resultsToSend) { this.resultSender.sendJobResult(j, r, startTime, s, reason ?? ...) }` | node-agent-simple.ts |

### 2.5 ResultSender.sendJobResult 内（每条结果一次）

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 18 | sendJobResult | 连接与 `audioBuffered` 检查；空结果时写 `reason: 'ASR_EMPTY'`（若非 NO_TEXT_ASSIGNED）；`shouldSend` 为 false 时 return | node-agent-result-sender.ts |
| 19 | sendJobResult | 构造 `JobResultMessage`，可选 `aggregatorMiddleware.getLastSentText`、去重与记录等，`this.ws.send(JSON.stringify(response))` | node-agent-result-sender.ts |
| 20 | sendJobResult | 成功发送后可选 `dedupStage.markJobIdAsSent`、`aggregatorMiddleware.recordSentText` 等 | node-agent-result-sender.ts |

---

## 3. 重复调用与潜在开销

| 问题 | 位置 | 说明 | 建议 |
|------|------|------|------|
| **buildJobResult 仅调用一次** | runJobPipeline 结尾 | 每个 job 只 return 一次 buildJobResult(job, ctx)，无多处构建 | 无重复 |
| **sendJobResult 仅来自 handleJob 的循环** | NodeAgent.handleJob | 所有发送（主结果 + 空容器核销）均来自同一 `resultsToSend` 循环，无 asr-step 或其他路径发送 | 单发送点，无重复发送 |
| **pendingEmptyJobs 来源单一** | asr-step 写 `ctx.pendingEmptyJobs` → buildJobResult 放入 `extra.pendingEmptyJobs` → handleJob 读取 | 空容器信息只在此链上传递，node-agent 仅根据 extra 追加到 resultsToSend，无重复构造 | 无重复 |
| **同一 job 的 ctx 唯一** | runJobPipeline 内 | 一个 job 对应一个 ctx，各步骤只写该 ctx，无多容器合并或分支写不同容器 | 符合唯一容器设计 |
| **lastSentText / 去重** | ResultSender.sendJobResult 内 | 与“容器管理”正交，属发送前业务规则；若需优化去重逻辑可单独审议 | 当前不视为容器管理重复 |

---

## 4. 结论与审议要点

1. **唯一容器**：从 `initJobContext(job)` 到各步骤只写同一个 `ctx`，到 `buildJobResult(job, ctx)` 产出唯一一个主结果对象，链路单一。
2. **单发送点**：仅 `NodeAgent.handleJob` 内根据 `resultsToSend` 循环调用 `sendJobResult`；asr-step、pipeline 其他步骤均不调用 sendJobResult。
3. **结果列表与空容器**：主结果 + 空容器核销统一为 `resultsToSend`，一次循环发出，无“先发主结果再单独分支发空容器”的双路径，避免重复或漏发。
4. **无重复构建、无重复发送**：buildJobResult 每 job 一次；同一结果不会在 resultsToSend 中重复出现；sendJobResult 调用次数 = 1（主结果）+ pendingEmptyJobs.length。

**提请决策**：是否确认当前 Job 容器管理流程（唯一 ctx、单 buildJobResult、单发送点 + resultsToSend 循环）为正式设计，不做结构性变更？
