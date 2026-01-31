# 节点端 Job 调度、AudioAggregator 与 Utterance 聚合 — 调用链与重复调用审议

**文档目的**：供决策部门审议节点端「Job 调度」「AudioAggregator（从收到 job、切片到分批送入 ASR 的每一个调用方法）」「Utterance 聚合（从 ASR 返回结果到发送给语义修复服务的每一个调用方法）」的完整调用链，并识别是否存在**重复调用或错误调用**导致的不必要开销。

**代码基准**：`electron_node/electron-node/main/src`（截至 2026-01，已移除 MaxDuration 仅追加逻辑，bufferKey = turn_id|tgt_lang）。

---

## 一、节点端 Job 调度（从收到 job 到执行 Pipeline）

### 1.1 调用链（按方法）

| 序号 | 文件 | 方法/调用 | 说明 |
|------|------|-----------|------|
| 1 | WebSocket 消息处理 | 收到 `job_assign` | 调度服务器派发 job 到节点 |
| 2 | `agent/node-agent-simple.ts` | `handleJobAssign()` → 去重与 slot 检查 | 同一 session+utterance_index 只接受一个 job |
| 3 | 同上 | `JobProcessor.processJob(job, startTime)` | 单 job 处理入口 |
| 4 | `agent/node-agent-job-processor.ts` | `processJob()` | 按 features 启动服务（如 speaker_embedding）、设置 partialCallback（流式 ASR 时） |
| 5 | 同上 | **`this.inferenceService.processJob(job, partialCallback)`** | 推理服务入口 |
| 6 | `inference/inference-service.ts` | `processJob()` | 首次 job 时 `waitForServicesReady()`；`taskRouter.refreshServiceEndpoints()` |
| 7 | 同上 | **`runJobPipeline({ job, partialCallback, asrCompletedCallback, services: this.servicesBundle, callbacks })`** | **唯一 Pipeline 编排入口** |
| 8 | `pipeline/job-pipeline.ts` | `runJobPipeline()` | `inferPipelineMode(job)` → 按 `mode.steps` 循环 |
| 9 | 同上 | `shouldExecuteStep(step, mode, job, ctx)` | 动态判断是否执行（如 SEMANTIC_REPAIR 仅当 `ctx.shouldSendToSemanticRepair === true`） |
| 10 | 同上 | `executeStep(step, job, ctx, services, stepOptions)` | `STEP_REGISTRY[step](job, ctx, services, options)` |
| 11 | 同上 | 步骤序列：**ASR → AGGREGATION → SEMANTIC_REPAIR → DEDUP → TRANSLATION → TTS/YOURTTS** | 依 `pipeline-mode-config` |
| 12 | 同上 | 全部步骤完成后 `buildJobResult(job, ctx)`；若 `is_manual_cut` 或 `is_timeout_triggered` 则 `services.audioAggregator.clearBufferByKey(buildBufferKey(job))` | 构建结果并清理 turn buffer |

**结论（Job 调度）**：单 job 单次 `runJobPipeline`，步骤顺序与条件执行清晰，无重复编排。

---

## 二、AudioAggregator 流程（从收到 job、切片到分批送入 ASR — 每一个调用方法）

### 2.1 入口

| 序号 | 文件 | 方法/调用 | 说明 |
|------|------|-----------|------|
| 1 | `pipeline/steps/asr-step.ts` | `runAsrStep(job, ctx, services, options)` | ASR 步骤入口 |
| 2 | 同上 | `new PipelineOrchestratorAudioProcessor(services.audioAggregator)` | **每 job 新建**（轻量，仅持有 audioAggregator 引用） |
| 3 | 同上 | `audioProcessor.processAudio(job)` | 音频处理入口 |
| 4 | `pipeline-orchestrator/pipeline-orchestrator-audio-processor.ts` | `processAudio(job)` | **唯一进入 AudioAggregator 的调用**：`this.audioAggregator.processAudioChunk(job)` |

### 2.2 `audio-aggregator.ts` — `processAudioChunk(job)` 内每一个调用（按执行顺序）

| 序号 | 文件 | 方法/调用 | 说明 |
|------|------|-----------|------|
| 1 | `audio-aggregator-buffer-key.ts` | **`buildBufferKey(job)`** | 得到 `bufferKey = turn_id|tgt_lang`（无 turn_id 退化为 job_id） |
| 2 | `audio-aggregator-decoder.ts` | **`decodeAudioChunk(job, SAMPLE_RATE, BYTES_PER_SAMPLE)`** | 解码当前音频块（opus/pcm16 → PCM16），得到 `currentAudio`、`currentDurationMs` |
| 3 | `audio-aggregator.ts` | **`this.buffers.get(bufferKey)`** | 获取或准备 buffer |
| 4 | 同上 | 若不存在则**内联创建**新 buffer（无单独 `createEmptyBuffer` 调用，字段手写）；若存在且 `state === 'FINALIZING' \|\| 'CLOSED'` 则**内联创建新 epoch** buffer；否则更新 `buffer.lastWriteAt` | 获取或创建/切换 epoch |
| 5 | `audio-aggregator-buffer-lifecycle.ts` | **`shouldReturnEmptyInput(currentBuffer, currentAudio, currentDurationMs)`** | **① 空输入判定**：当前无新音频且无 pending/buffer 内容则 return EMPTY_INPUT |
| 6 | `audio-aggregator-timeout-handler.ts` | **`this.timeoutHandler.checkTimeoutTTL(currentBuffer, job, currentAudio, nowMs)`** | 检查 pendingTimeoutAudio 是否超过 TTL（10s）；超则合并并按能量切分，直接返回待送 ASR 的 `audioSegments`（不再走下方 finalize） |
| 7 | `audio-aggregator.ts` | 更新 buffer：`currentBuffer.audioChunks.push(currentAudio)`、`totalDurationMs`、`lastChunkTimeMs`、`isManualCut`、`isTimeoutTriggered`、`originalJobInfo.push(...)` | 当前 chunk 写入 buffer |
| 8 | `audio-aggregator-buffer-lifecycle.ts` | **`shouldReturnEmptyInput(currentBuffer, currentAudio, currentDurationMs)`** | **② 再次空输入判定**（在更新 buffer 之后） |
| 9 | `audio-aggregator.ts` | `shouldProcessNow = isManualCut \|\| isTimeoutTriggered \|\| totalDurationMs >= MAX \|\| (totalDurationMs >= 10s && !isTimeoutTriggered)` | 是否立即 finalize |
| 10 | 同上 | 若 `shouldProcessNow`：`currentBuffer.state = 'FINALIZING'`；**`this.aggregateAudioChunks(currentBuffer.audioChunks)`** | 聚合当前 buffer 内所有 chunk 为一段 |
| 11 | `audio-aggregator-merger.ts` | **`this.audioMerger.aggregateAudioChunks(chunks)`** | 合并多段 PCM 为一段 Buffer |
| 12 | `audio-aggregator-finalize-handler.ts` | **`this.finalizeHandler.handleFinalize(buffer, job, currentAggregated, nowMs, isManualCut, isTimeoutTriggered)`** | 合并 pendingTimeoutAudio、pendingSmallSegments，得到 `audioToProcess`、`jobInfoToProcess` |
| 13 | `audio-aggregator-finalize-merge.ts` | **`mergePendingTimeoutAudio(buffer, job, currentAggregated, nowMs)`**（若 buffer 有 pendingTimeoutAudio） | 与当前聚合音频合并 |
| 14 | 同上 | **`mergePendingSmallSegments(buffer, job, currentAggregated, nowMs)`**（若有 pendingSmallSegments） | 与当前聚合音频合并 |
| 15 | `audio-aggregator-utils.ts` | **`this.audioUtils.splitAudioByEnergy(audioToProcess, 5000, 2000, SPLIT_HANGOVER_MS)`** | 按能量切分（max 5s、min 2s、hangover 600ms） |
| 16 | `audio-aggregator-stream-batcher.ts` | **`this.streamBatcher.createStreamingBatchesWithPending(audioSegments, jobInfoToProcess, shouldCacheRemaining)`**（通过 **`createStreamingBatchesWithPending`**） | 组合成 ~5s 批次 + 剩余小片段（manual 时不缓存剩余） |
| 17 | `audio-aggregator.ts` | 计算 `originalJobIds`（合并 pending 时归属当前 job，否则头部对齐）；`batches.map(b => b.toString('base64'))` | 得到送 ASR 的 `audioSegmentsBase64`、`originalJobIds`、`originalJobInfo` |
| 18 | 同上 | 若有 pendingTimeoutAudio 则清空 buffer 内 audioChunks 并置 `state = 'PENDING_TIMEOUT'`；否则 **`deleteBufferFromMap`**（通过 **`this.deleteBuffer(bufferKey, currentBuffer, reason, nowMs)`**） | buffer 生命周期 |
| 19 | `audio-aggregator-buffer-lifecycle.ts` | **`deleteBufferFromMap(this.buffers, bufferKey, buffer, reason, nowMs)`** | 从 Map 删除并打日志 |

### 2.3 从 AudioProcessor 返回到 ASR 步骤

| 序号 | 文件 | 方法/调用 | 说明 |
| 20 | `pipeline-orchestrator-audio-processor.ts` | 若 `chunkResult.shouldReturnEmpty` 则 return 空结果；否则 return `audioSegments`、`originalJobIds`、`originalJobInfo` | 供 asr-step 使用 |
| 21 | `pipeline/steps/asr-step.ts` | `audioSegments = audioProcessResult.audioSegments`；`originalJobIds`、`originalJobInfo`；空容器记入 `ctx.pendingEmptyJobs` | 准备多段 ASR |
| 22 | 同上 | **for 循环** `audioSegments`：每段构建 `ASRTask`，**`services.taskRouter.routeASRTask(asrTask)`**（非流式）或 **`asrHandler.processASRStreaming(asrTask, partialCallback)`**（流式） | **分批送入 ASR**（每段 1 次调用） |
| 23 | `task-router/task-router.ts` | **`routeASRTask(task)`** → `this.asrHandler.routeASRTask(task)` | 实际路由到 ASR 服务 |

### 2.4 AudioAggregator 小结与审议点

- **单 job 单次**进入 `processAudioChunk`；解码 → 缓冲 → TTL 检查 → 更新 buffer → finalize（合并 pending → 能量切分 → 流式批次）→ 返回多段 base64 → asr-step 按段循环调用 **`routeASRTask`**，**无同一 job 下重复进入 processAudioChunk 或重复送 ASR 的逻辑**。
- **bufferKey**：`buildBufferKey(job)` = **turn_id|tgt_lang**（与旧文档中“sessionId”不同，以当前代码为准）。
- **潜在重复/冗余**：
  - **`shouldReturnEmptyInput` 被调用 2 次**（① 更新 buffer 前，② 更新 buffer 后）。第二次在“已 push 当前 chunk”之后，多数情况下若第一次未 return 则第二次仅当“新 chunk 为空且 buffer 仅含该空 chunk”等边界才有意义，**可审议是否保留第二次**以简化分支。
  - **每 job 新建 `PipelineOrchestratorAudioProcessor`、`PipelineOrchestratorASRResultProcessor`、`PipelineOrchestratorASRHandler`**：均为轻量/无状态，当前开销可接受；若未来做“按 session 复用”可单独评估。

---

## 三、Utterance 聚合流程（从 ASR 返回结果到发送给语义修复服务 — 每一个调用方法）

### 3.1 调用链（按方法，到具体调用）

| 序号 | 文件 | 方法/调用 | 说明 |
|------|------|-----------|------|
| 1 | `pipeline/job-pipeline.ts` | 步骤 `AGGREGATION` → **`executeStep('AGGREGATION', job, ctx, services)`** | 聚合步骤入口 |
| 2 | `pipeline/pipeline-step-registry.ts` | **`runAggregationStep(job, ctx, services)`** | 注册表分发 |
| 3 | `pipeline/steps/aggregation-step.ts` | `runAggregationStep()` | 若 `!ctx.asrText` 或 trim 为空 → 设 `segmentForJobResult`、`repairedText` 为空并 return |
| 4 | 同上 | 若 `!services.aggregatorManager` → `ctx.segmentForJobResult = ctx.asrText`，`ctx.shouldSendToSemanticRepair = true`，return | 无聚合器时本段直送语义修复 |
| 5 | 同上 | 构造 **`tempResult: JobResult`**（text_asr、segments、extra、quality_score） | 供 AggregationStage 使用 |
| 6 | 同上 | **`services.aggregatorManager.getLastCommittedText(job.session_id, job.utterance_index)`** | **① 获取上一句已提交文本（只调用 1 次）** |
| 7 | 同上 | `ctx.lastCommittedText = lastCommittedText ?? null` | 写入 ctx，供语义修复步骤只读 |
| 8 | 同上 | **`new AggregationStage(services.aggregatorManager, services.deduplicationHandler)`** | **每 job 新建 AggregationStage**（内建 `new TextForwardMergeManager()`） |
| 9 | 同上 | **`aggregationStage.process(jobWithDetectedLang, tempResult, lastCommittedText)`** | 执行聚合与向前合并 |
| 10 | `agent/postprocess/aggregation-stage.ts` | **`AggregationStage.process(job, result, lastCommittedText)`** | 入口 |
| 11 | 同上 | 若 `!result.text_asr` 或 trim 为空 → return 空结果 | 空 ASR 不往下走 |
| 12 | 同上 | **`this.aggregatorManager.processUtterance(session_id, asrTextTrimmed, segments, langProbs, quality_score, true, isManualCut, mode, isTimeoutTriggered)`** | **Utterance 级聚合（MERGE/NEW_STREAM/COMMIT）** |
| 13 | 同上 | 根据 `aggregatorResult.action`（MERGE/NEW_STREAM）设置 `aggregatedText`、`isLastInMergedGroup` | 仅合并组最后一条带聚合文本 |
| 14 | 同上 | 若 `this.deduplicationHandler` 存在 → **`this.deduplicationHandler.isDuplicate(session_id, aggregatedText, job_id, utterance_index)`** | 去重判定 |
| 15 | 同上 | 若 duplicate → return 空结果、`shouldSendToSemanticRepair: false` | DROP |
| 16 | 同上 | **`this.forwardMergeManager.processText(sessionId, textAfterDeduplication, previousText, job_id, utterance_index, isManualCut, lastSentText)`**（`previousText = lastCommittedText`） | **向前合并 + Gate（SEND/HOLD/DROP）** |
| 17 | `agent/postprocess/text-forward-merge-manager.ts` | **`processText()`** | 内部：mergeByTrim（dedupMergePrecise）、decideGateAction、pendingTexts 等 |
| 18 | `agent/postprocess/aggregation-stage.ts` | 从 `forwardMergeResult` 取 `segmentForJobResult`、`shouldSendToSemanticRepair`、metrics 等，return | 写回 aggregation-step |
| 19 | `pipeline/steps/aggregation-step.ts` | `ctx.segmentForJobResult`、`ctx.aggregationAction`、`ctx.shouldSendToSemanticRepair`、`ctx.aggregationMetrics` 等 | 写回 ctx |
| 20 | `pipeline/job-pipeline.ts` | 若 **`shouldExecuteStep('SEMANTIC_REPAIR', ...)`** 为 true（即 `ctx.shouldSendToSemanticRepair === true`）→ **`executeStep('SEMANTIC_REPAIR', ...)`** | 执行语义修复步骤 |
| 21 | `pipeline/steps/semantic-repair-step.ts` | **`runSemanticRepairStep(job, ctx, services)`** | 语义修复步骤入口 |
| 22 | 同上 | `textToRepair = (ctx.segmentForJobResult ?? '').trim()` | 只读本段 |
| 23 | 同上 | 若 `!services.semanticRepairInitializer` 或 init 失败或 `!getSemanticRepairStage()` → `ctx.repairedText = ''`，`ctx.shouldSend = false`，return | 语义修复不可用时不透传 |
| 24 | 同上 | **`semanticRepairStage.process(jobWithDetectedLang, textToRepair, ctx.qualityScore, { segments, language_probability, micro_context })`** | **调用语义修复 Stage** |
| 25 | `agent/postprocess/semantic-repair-stage.ts` | **`SemanticRepairStage.process(job, text, qualityScore, meta)`** | 根据源语言路由到 zh/en |
| 26 | 同上 | 中文：**`this.zhStage.process(job, text, qualityScore, meta)`**；英文：**`this.enNormalizeStage.process(...)`** + **`this.enStage.process(...)`** | 实际修复逻辑 |
| 27 | `agent/postprocess/semantic-repair-stage-zh.ts` / `semantic-repair-stage-en.ts` | **`this.taskRouter.routeSemanticRepairTask(repairTask)`** | **发送给语义修复服务** |
| 28 | `task-router/task-router.ts` | **`routeSemanticRepairTask(task)`** → `this.semanticRepairHandler.routeSemanticRepairTask(task)` | 实际路由到语义修复服务 |
| 29 | `pipeline/steps/semantic-repair-step.ts` | `ctx.repairedText = repairResult.textOut`；若存在 **`services.aggregatorManager`** → **`services.aggregatorManager.updateLastCommittedTextAfterRepair(session_id, utterance_index, textToRepair, ctx.repairedText)`** | 写回修复结果并更新「上一句已提交」 |

### 3.2 Utterance 聚合小结与审议点

- **`getLastCommittedText`** 在聚合步骤中**只调用 1 次**，作为 `lastCommittedText` 传入 `AggregationStage.process`，用于 Trim 与 Gate，语义合理。
- **`processUtterance`**、**`isDuplicate`**、**`processText`** 在单次 `AggregationStage.process` 内各调用 **1 次**，无重复。
- **每 job 新建 `AggregationStage`（及内建 `TextForwardMergeManager`）**：二者为无状态调用，创建成本低；当前未发现错误或重复调用。若未来有「按 session 复用实例」需求可再审议。

---

## 四、三种 Job 场景在节点端的实际处理路径（按当前代码）

以下按**实际代码逻辑**说明：手动截断短句、timeout finalize 短句、以及「多个 MaxDuration + 一个 manual/timeout finalize」的长句，在 **AudioAggregator** 与 **Utterance 聚合** 中分别如何被处理。约定：**bufferKey = turn_id|tgt_lang**；调度端「MaxDuration」job 在节点端仅表示**未带 is_manual_cut / is_timeout_triggered 的普通 chunk**，节点不再做“仅追加不输出”的特殊分支。

---

### 4.1 场景一：手动截断的短句 job（单 job，is_manual_cut=true，短音频）

| 阶段 | 实际处理 |
|------|----------|
| **AudioAggregator** | 1）`buildBufferKey(job)` → 同一 turn 共用一个 bufferKey。<br>2）`decodeAudioChunk` 得到短音频，`buffers.get(bufferKey)` 无则新建 buffer。<br>3）`shouldReturnEmptyInput` 为 false（当前有音频），无 `pendingTimeoutAudio` 故 `checkTimeoutTTL` 不触发。<br>4）当前 chunk push 进 buffer，`shouldProcessNow = true`（isManualCut）。<br>5）`state = 'FINALIZING'`，`aggregateAudioChunks` 仅当前这一段，`handleFinalize`：无 pendingTimeoutAudio/pendingSmallSegments，非 timeout 短句故不设 `shouldCachePendingTimeout`，`audioToProcess` = 当前短段。<br>6）`splitAudioByEnergy`（短段多为 1 段）→ `createStreamingBatchesWithPending`，`isIndependentUtterance = isManualCut` 故 `shouldCacheRemaining = false`，剩余小片段也进 batches。<br>7）返回 1 个（或少量）segment(s)，无 pending 则 `deleteBuffer`。<br>**结果**：本 job 一次返回若干段音频送 ASR，通常 **1 次 ASR 调用**（一段短句）。 |
| **Utterance 聚合** | 1）本 job 的 Pipeline 只跑一次，ASR 得到一段 `asrText`。<br>2）`runAggregationStep` → `getLastCommittedText`（1 次）→ `AggregationStage.process`。<br>3）`processUtterance(..., isManualCut=true)`：**AggregatorDecision 硬规则** → **NEW_STREAM**（手动截断必开新流）。<br>4）`aggregatedText = asrText`，`segmentForJobResult` = 本段，经 `isDuplicate`、`processText`（Gate）→ `shouldSendToSemanticRepair` 多为 true（短句若长度满足则 SEND）。<br>5）`runSemanticRepairStep` 用 `segmentForJobResult` 调语义修复一次，再 `updateLastCommittedTextAfterRepair`。<br>**结果**：**单段文本 → NEW_STREAM → 送语义修复一次 → 更新上一句已提交**。 |

---

### 4.2 场景二：timeout finalize 的短句 job（单 job，is_timeout_triggered=true，短音频）

| 阶段 | 实际处理 |
|------|----------|
| **AudioAggregator** | **与手动 finalize 一致**：1）bufferKey、decode、get/create buffer。<br>2）push 当前短段，`shouldProcessNow = true`（isTimeoutTriggered）。<br>3）**不再**将短句缓存到 pendingTimeoutAudio；`handleFinalize` 直接以当前段为 `audioToProcess`。<br>4）`isIndependentUtterance = isManualCut \|\| isTimeoutTriggered`，故 timeout 也不缓存剩余小片段，全部输出。<br>5）按能量切分 → 批次 → 返回 segment(s) 送 ASR，无 pending 则 `deleteBuffer`。<br>**结果**：**短句直接输出并送 ASR 一次，不等待下一 job 合并**。 |
| **Utterance 聚合** | 1）有 turn_id 且本 job 为 finalize：取走该 turn 的累积（若有）与本段合并为 `segmentForJobResult`，`shouldSendToSemanticRepair = (fullTurnText.length > 0)`。<br>2）无 turn_id 时仍走原 `processUtterance` 逻辑（MERGE/NEW_STREAM 等）。<br>**结果**：**与手动短句一致，本段（或整段）送语义修复一次**。 |

---

### 4.3 场景三：多个 MaxDuration + 一个 manual/timeout finalize 的长句（同一 turn，多 job）

假设同一 turn：Job1…JobK 为普通 chunk（无 manual/timeout），JobK+1 带 is_manual_cut 或 is_timeout_triggered。

| 阶段 | 实际处理 |
|------|----------|
| **AudioAggregator** | **Job1…JobK（普通 chunk）**：<br>1）共用同一 bufferKey（turn_id\|tgt_lang），依次 decode、push。<br>2）累计 &lt; 10s 则 **return shouldReturnEmpty**，不送 ASR。<br>3）当某 job 使 totalDurationMs ≥ 10s 时，`shouldProcessNow` 为 true，finalize 当前 buffer 全部 → `splitAudioByEnergy`（~5s/2s/600ms）→ 多段批次 → 返回多 segment(s)，asr-step 对**每段**调 `routeASRTask`。<br>4）无 pending 则 `deleteBuffer`，下一 job 再建新 buffer。<br>**JobK+1（manual/timeout）**：<br>5）push 最后一截 → `shouldProcessNow = true` → finalize（可合并 pendingSmallSegments），按能量切分 → 返回多段送 ASR；`isIndependentUtterance = true`，剩余小片段也进 batches。<br>6）本 job 结束后 job-pipeline 执行 **`clearBufferByKey(buildBufferKey(job))`**，清理该 turn 的 buffer。<br>**结果**：同一 turn 内**多次**「累计到 10s → 输出多段 → 清 buffer」+ **最后一次 finalize 输出并清理 buffer**。 |
| **Utterance 聚合** | **有 turn_id 时**：<br>1）**非 finalize job**（Job1…JobK 中有 ASR 输出的）：`appendTurnSegment(sessionId, turnId, ctx.asrText)` 累积本段，**`shouldSendToSemanticRepair = false`**，不送语义修复。<br>2）**finalize job（JobK+1）**：`getAndClearTurnAccumulator(sessionId, turnId)` 取走累积，`segmentForJobResult = 累积 + 本段`（整段 turn 文本），**`shouldSendToSemanticRepair = (fullTurnText.length > 0)`**，**一次性**送入语义修复与后续处理。<br>3）无 turn_id 时仍走原 processUtterance 逻辑（MERGE/NEW_STREAM 等）。<br>**结果**：**同 turn 内仅 finalize job 将整段累积文本送入语义修复一次**；buffer 在 finalize 时由 job-pipeline 的 clearBufferByKey 清理。 |

---

### 4.4 小结（三种场景，简化后）

| 场景 | AudioAggregator 行为概要 | Utterance 聚合行为概要 |
|------|---------------------------|-------------------------|
| **手动截断短句** | 单 job、短段 → 1 次 finalize，1（或少量）segment 送 ASR，清 buffer | 有 turn_id 且 finalize：本段送语义修复一次；无 turn_id 仍 NEW_STREAM |
| **timeout 短句** | **与手动一致**：单 job、短段 → 直接输出送 ASR，不缓存、不等待下一 job 合并，清 buffer | 同手动短句 |
| **长句（多 MaxDuration + 一 finalize）** | 多 job 共 buffer；累计 10s 即按能量切分、分批送 ASR；最后一 job finalize 再输出并 **clearBufferByKey** | **有 turn_id**：非 finalize 仅累积不送语义修复；**仅 finalize job** 取走累积 + 本段，整段一次性送语义修复与后续；buffer 在 finalize 时清理 |

---

## 五、重复调用与潜在开销审议汇总

### 4.1 已确认无重复/错误的设计

| 项目 | 结论 |
|------|------|
| Job 调度 | 单 job 单次 `runJobPipeline`，步骤顺序与条件执行清晰。 |
| AudioAggregator 入口 | 每 job 单次 `processAudioChunk`，无同一 job 重复进入或重复送 ASR。 |
| Utterance 聚合 | `getLastCommittedText` 在聚合步骤只调 1 次；`processUtterance`、`isDuplicate`、`processText` 各 1 次；语义修复 `process` 只调 1 次。 |
| `getLastCommittedText` 与 NMT | 聚合阶段 1 次（Trim/Gate）；翻译阶段 1 次（NMT context_text）；第二次在 `updateLastCommittedTextAfterRepair` 之后，**用途不同、时机正确，非重复逻辑**。 |

### 5.2 可审议的潜在冗余/优化点

| 项目 | 说明 | 建议 |
|------|------|------|
| **`shouldReturnEmptyInput` 在 processAudioChunk 内调用 2 次** | 第一次在更新 buffer 前，第二次在更新 buffer 后。第二次多数场景不会改变结果。 | 决策部门可审议：是否保留第二次以覆盖“刚 push 空 chunk”等边界，或删除以简化分支。 |
| **每 job 新建 PipelineOrchestratorAudioProcessor / ASRResultProcessor / ASRHandler** | 轻量、无状态，当前开销可接受。 | 无需强制修改；若有“按 session 复用”需求可单独评估。 |
| **每 job 新建 AggregationStage / TextForwardMergeManager** | 无状态，创建成本低。 | 同上，可接受；按 session 复用可后续审议。 |

### 4.3 错误调用

- **未发现**同一逻辑被错误地多次调用（如重复送 ASR、重复调语义修复、重复 `getLastCommittedText` 用于同一用途等）。

---

## 六、总结与建议

| 项目 | 结论 |
|------|------|
| **节点端 Job 调度** | 单 job 单次 `runJobPipeline`，步骤顺序与条件执行清晰，无重复编排。 |
| **AudioAggregator** | 从收到 job → `buildBufferKey` → `decodeAudioChunk` → 获取/创建 buffer → `shouldReturnEmptyInput`（2 次）→ `checkTimeoutTTL` → 更新 buffer → 若 `shouldProcessNow`：`aggregateAudioChunks` → `handleFinalize`（`mergePendingTimeoutAudio`、`mergePendingSmallSegments`）→ `splitAudioByEnergy` → `createStreamingBatchesWithPending` → 返回多段 → asr-step 按段调用 **`routeASRTask`**。路径清晰，**无重复送 ASR**。 |
| **Utterance 聚合** | ASR 结果 → **getLastCommittedText（1 次）** → **processUtterance（1 次）** → **isDuplicate（1 次）** → **processText（1 次）** → segmentForJobResult / shouldSendToSemanticRepair → **semanticRepairStage.process（1 次）** → **routeSemanticRepairTask** → **updateLastCommittedTextAfterRepair（1 次）**。无重复或错误调用。 |
| **重复/冗余** | 唯一可审议点为 **processAudioChunk 内 `shouldReturnEmptyInput` 调用 2 次**；其余为每 job 新建轻量实例，可接受。 |
| **错误调用** | 未发现。 |

**总体结论**：当前节点端 Job 调度、AudioAggregator 与 Utterance 聚合的调用链清晰，**未发现错误调用或明显重复导致的不必要开销**。建议决策部门据此闭环；若需进一步简化分支，可单独审议「processAudioChunk 内第二次 shouldReturnEmptyInput 是否保留」。
