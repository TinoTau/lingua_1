# Utterance 聚合流程决策审议文档

**范围**：ASR 返回结果到发送给语义修复服务的完整调用链  
**目的**：逐方法列出调用顺序，识别重复调用或错误调用导致的不必要开销，供决策部门审议。

---

## 1. 调用链（按执行顺序）

### 1.1 ASR 完成后：Pipeline 继续执行

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 1 | runJobPipeline | `executeStep('ASR', ...)` 返回后，`callbacks?.onTaskProcessed?.('ASR')` | job-pipeline.ts |
| 2 | runJobPipeline | `executeStep('AGGREGATION', job, ctx, services)` | job-pipeline.ts → pipeline-step-registry.ts |
| 3 | executeStep | `runAggregationStep(job, ctx, services)` | pipeline-step-registry.ts → aggregation-step.ts |

### 1.2 runAggregationStep 内：文本聚合

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 4 | runAggregationStep | 若 `!ctx.asrText` 或空：直接 `ctx.aggregatedText = ''`，return | aggregation-step.ts |
| 5 | runAggregationStep | 若 `!services.aggregatorManager`：`ctx.aggregatedText = ctx.asrText`，`ctx.shouldSendToSemanticRepair = true`，return | aggregation-step.ts |
| 6 | runAggregationStep | `services.aggregatorManager.getLastCommittedText(session_id, utterance_index)` | aggregation-step.ts |
| 7 | runAggregationStep | `ctx.lastCommittedText = lastCommittedText ?? null` | aggregation-step.ts |
| 8 | runAggregationStep | `new AggregationStage(aggregatorManager, deduplicationHandler)` | aggregation-step.ts |
| 9 | runAggregationStep | `aggregationStage.process(jobWithDetectedLang, tempResult, lastCommittedText)` | aggregation-step.ts |

**AggregationStage.process 内部**：

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 10 | AggregationStage.process | 若 `!aggregatorManager` 或 `!session_id` 或 `!asrTextTrimmed`：直接 return | aggregation-stage.ts |
| 11 | AggregationStage.process | `this.aggregatorManager.processUtterance(session_id, asrTextTrimmed, segments, langProbs, quality_score, isFinal, isManualCut, mode, isTimeoutTriggered)` | aggregation-stage.ts → aggregator-manager（或等价） |
| 12 | AggregationStage.process | 根据 `aggregatorResult.action`（MERGE/NEW_STREAM/COMMIT）处理 `aggregatedText`、`isLastInMergedGroup` 等 | aggregation-stage.ts |
| 13 | AggregationStage.process | `this.forwardMergeManager.processText(...)`（决定是否送语义修复、是否丢弃等） | aggregation-stage.ts → text-forward-merge-manager.ts |
| 14 | runAggregationStep | 写 `ctx.aggregatedText`、`ctx.aggregationAction`、`ctx.aggregationChanged`、`ctx.isLastInMergedGroup`、`ctx.shouldSendToSemanticRepair`、`ctx.aggregationMetrics` | aggregation-step.ts |

### 1.3 runJobPipeline：是否执行语义修复步骤

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 15 | runJobPipeline | `shouldExecuteStep('SEMANTIC_REPAIR', mode, job, ctx)` | job-pipeline.ts → pipeline-mode-config.ts |
| 16 | runJobPipeline | 若通过：`executeStep('SEMANTIC_REPAIR', job, ctx, services)` | job-pipeline.ts |
| 17 | executeStep | `runSemanticRepairStep(job, ctx, services)` | pipeline-step-registry.ts → semantic-repair-step.ts |

### 1.4 runSemanticRepairStep 内：调用语义修复服务

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 18 | runSemanticRepairStep | `textToRepair = ctx.aggregatedText || ctx.asrText || ''`；若空则 `ctx.repairedText = ''`，return | semantic-repair-step.ts |
| 19 | runSemanticRepairStep | 若 `!services.servicesHandler || !services.semanticRepairInitializer`：`ctx.repairedText = textToRepair`，return | semantic-repair-step.ts |
| 20 | runSemanticRepairStep | `semanticRepairInitializer.initialize()`（若未初始化） | semantic-repair-step.ts |
| 21 | runSemanticRepairStep | `semanticRepairInitializer.getSemanticRepairStage()` | semantic-repair-step.ts |
| 22 | runSemanticRepairStep | `ctx.lastCommittedText` 截取为 microContext（上一句尾部，最多 150 字） | semantic-repair-step.ts |
| 23 | runSemanticRepairStep | `semanticRepairStage.process(jobWithDetectedLang, textToRepair, qualityScore, { segments, language_probability, micro_context })` | semantic-repair-step.ts |

**SemanticRepairStage.process 内部（调用语义修复服务）**：

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 24 | SemanticRepairStage.process | 内部决策（是否 repair、语言等）后 | semantic-repair-stage-zh.ts / semantic-repair-stage-en.ts |
| 25 | SemanticRepairStage.process | `this.taskRouter.routeSemanticRepairTask(repairTask)` | semantic-repair-stage-zh.ts / semantic-repair-stage-en.ts |
| 26 | routeSemanticRepairTask | `TaskRouter.routeSemanticRepairTask(task)` → `this.semanticRepairHandler.routeSemanticRepairTask(task)` | task-router.ts → task-router-semantic-repair.ts |

**语义修复完成后**：

| 序号 | 调用方 | 方法 | 文件 |
|------|--------|------|------|
| 27 | runSemanticRepairStep | 写 `ctx.repairedText`、`ctx.semanticDecision`、`ctx.semanticRepairApplied`、`ctx.semanticRepairConfidence` | semantic-repair-step.ts |
| 28 | runSemanticRepairStep | 若 `services.aggregatorManager`：`services.aggregatorManager.updateLastCommittedTextAfterRepair(session_id, utterance_index, textToRepair, ctx.repairedText)` | semantic-repair-step.ts |

---

## 2. 重复调用与潜在开销

| 问题 | 位置 | 说明 | 建议 |
|------|------|------|------|
| **getLastCommittedText 每 job 一次** | runAggregationStep：`aggregatorManager.getLastCommittedText(session_id, utterance_index)` | 每个 job 在聚合前取一次“上一句已提交文本”，结果写入 `ctx.lastCommittedText`，后续语义修复步骤直接读 ctx，不再调 getLastCommittedText | 无重复；设计合理 |
| **lastCommittedText 传递** | runAggregationStep 将 `lastCommittedText` 传入 `aggregationStage.process(..., lastCommittedText)` | 避免 AggregationStage 内部再调 getLastCommittedText；语义修复步骤用 `ctx.lastCommittedText` | 无重复调用 |
| **aggregatorManager.processUtterance 每 job 一次** | AggregationStage.process | 每个 job 只调用一次 processUtterance，无重复 | 无需改动 |
| **forwardMergeManager.processText 每 job 一次** | AggregationStage.process | 每个 job 只调用一次，用于决定 shouldSendToSemanticRepair 等 | 无需改动 |
| **routeSemanticRepairTask 每 job 至多一次** | 仅当执行 SEMANTIC_REPAIR 且 shouldSendToSemanticRepair 等条件满足时，SemanticRepairStage.process 内部调用 | 若 shouldExecuteStep 跳过语义修复步骤，则不会调用 routeSemanticRepairTask | 无重复；条件执行正确 |
| **updateLastCommittedTextAfterRepair 每 job 一次** | runSemanticRepairStep 内，语义修复完成后 | 每个完成语义修复的 job 更新一次 committed text | 无重复 |
| **SemanticRepairInitializer 复用** | services.semanticRepairInitializer 来自 ServicesBundle | 单例/复用，initialize 仅未初始化时调用 | 无重复创建 |

---

## 3. 结论与审议要点

1. **ASR → 聚合 → 语义修复**：单链路，每个 job 只经历一次 AGGREGATION 步骤、至多一次 SEMANTIC_REPAIR 步骤；getLastCommittedText、processUtterance、forwardMergeManager.processText、routeSemanticRepairTask、updateLastCommittedTextAfterRepair 均无重复调用。
2. **上下文传递**：`lastCommittedText` 在聚合前取一次并写入 ctx，语义修复步骤只读 ctx，不再次请求 aggregatorManager，避免重复开销。
3. **与语义修复服务的边界**：唯一对外调用为 `taskRouter.routeSemanticRepairTask(repairTask)`，由 TaskRouter 经 semanticRepairHandler 发往语义修复服务；调用次数与“需要语义修复的 job”数量一致。

**提请决策**：当前 Utterance 聚合与语义修复调用链未发现重复或错误调用；是否同意维持现有设计，不做结构性改动？
