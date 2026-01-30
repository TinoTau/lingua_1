# Utterance 聚合流程：调用链与开销审议文档

**文档类型**：决策部门审议  
**范围**：从 ASR 返回结果到发送给语义修复服务的完整调用链  
**日期**：2026-01-28  

---

## 1. 流程概览

单次 Job 的 Pipeline 步骤序列（以通用语音转译为例）：

```
ASR → AGGREGATION → SEMANTIC_REPAIR → DEDUP → TRANSLATION → TTS
```

本文档仅覆盖 **ASR 返回结果 → 语义修复服务** 这一段，即：**ASR 步骤结束 → AGGREGATION → SEMANTIC_REPAIR（含一次语义修复 HTTP 调用）**。

---

## 2. 调用链（按执行顺序、具体到方法）

### 2.1 入口与步骤调度

| 序号 | 调用方 | 被调方法 | 说明 |
|------|--------|----------|------|
| 1 | 调度器 | `runJobPipeline(options)` | job-pipeline.ts，唯一编排入口 |
| 2 | runJobPipeline | `inferPipelineMode(job)` | 根据 job.pipeline 推断模式（步骤列表） |
| 3 | runJobPipeline | `shouldExecuteStep(step, mode, job, ctx)` | 每步前判断是否执行（如 SEMANTIC_REPAIR 依赖 ctx.shouldSendToSemanticRepair） |
| 4 | runJobPipeline | `executeStep(step, job, ctx, services, options)` | pipeline-step-registry.ts |
| 5 | executeStep | `STEP_REGISTRY[step](job, ctx, services, options)` | 根据 step 调用 runAsrStep / runAggregationStep / runSemanticRepairStep 等 |

以下按步骤展开：**ASR 已完成后** 仅列出 **AGGREGATION** 与 **SEMANTIC_REPAIR** 的调用。

---

### 2.2 AGGREGATION 步骤（runAggregationStep）

| 序号 | 调用方 | 被调方法 | 说明 |
|------|--------|----------|------|
| 6 | runAggregationStep | `services.aggregatorManager.getLastCommittedText(session_id, utterance_index)` | **唯一一次** 在本步骤获取“上一句已提交文本”，用于 Trim；结果写入 `ctx.lastCommittedText` |
| 7 | runAggregationStep | `new AggregationStage(aggregatorManager, deduplicationHandler)` | **每 Job 新建** AggregationStage 实例 |
| 8 | runAggregationStep | `aggregationStage.process(jobWithDetectedLang, tempResult, lastCommittedText)` | 执行聚合与门控 |

#### 2.2.1 AggregationStage.process 内部

| 序号 | 调用方 | 被调方法 | 说明 |
|------|--------|----------|------|
| 9 | AggregationStage.process | `this.aggregatorManager.processUtterance(session_id, asrTextTrimmed, segments, langProbs, qualityScore, isFinal, isManualCut, mode, isTimeoutTriggered)` | 聚合器：MERGE/NEW_STREAM/COMMIT 决策 |
| 10 | AggregatorManager.processUtterance | `this.getOrCreateState(sessionId, mode)` | 获取或创建会话状态 |
| 11 | AggregatorState | `state.processUtterance(...)` | 实际 utterance 处理与提交逻辑 |
| 12 | AggregationStage.process | `this.deduplicationHandler.isDuplicate(session_id, aggregatedText, job_id, utterance_index)` | 完全重复/子串/高相似度判定（若提供 deduplicationHandler） |
| 13 | AggregationStage.process | `this.forwardMergeManager.processText(session_id, textAfterDeduplication, previousText, job_id, utterance_index, isManualCut, lastSentText)` | **Trim + 门控**（SEND/HOLD/DROP）；previousText 即传入的 lastCommittedText，**此处不再调用 getLastCommittedText** |

#### 2.2.2 TextForwardMergeManager.processText 内部

| 序号 | 调用方 | 被调方法 | 说明 |
|------|--------|----------|------|
| 14 | processText | `this.pendingTexts.get(sessionId)` | 查当前 session 是否有待合并文本 |
| 15 | processText | `this.mergeByTrim(pending.text, currentText)` 或 `this.mergeByTrim(previousText, currentText)` | 边界重叠裁剪（内部调用 dedupMergePrecise） |
| 16 | mergeByTrim | `dedupMergePrecise(base, incoming, this.dedupConfig)` | aggregator/dedup 精确去重 |
| 17 | processText | `this.decideGateAction(mergedText, ...)` | 长度门控：&lt;6 丢弃，6–20/20–40 等待，&gt;40 发送等 |

**说明**：`loadNodeConfig()` 在 TextForwardMergeManager 构造函数、LengthDecisionConfig 等处可能被调用，属于配置读取，不在此展开。

---

### 2.3 SEMANTIC_REPAIR 步骤（runSemanticRepairStep）

**前置条件**：`shouldExecuteStep('SEMANTIC_REPAIR', ...)` 为 true，即 `ctx.shouldSendToSemanticRepair === true`（由 AGGREGATION 步骤写入）。

| 序号 | 调用方 | 被调方法 | 说明 |
|------|--------|----------|------|
| 18 | runSemanticRepairStep | 读取 `ctx.aggregatedText \|\| ctx.asrText` | 待修复文本，**不再次调用 getLastCommittedText**；使用 `ctx.lastCommittedText` 作微上下文 |
| 19 | runSemanticRepairStep | `services.semanticRepairInitializer.isInitialized()` | 若未初始化则 `await semanticRepairInitializer.initialize()`（含 getServiceRegistry、loadNodeConfig、new SemanticRepairStage） |
| 20 | runSemanticRepairStep | `semanticRepairInitializer.getSemanticRepairStage()` | 获取已初始化的 SemanticRepairStage（**单例复用**，不每 Job 新建） |
| 21 | runSemanticRepairStep | `semanticRepairStage.process(jobWithDetectedLang, textToRepair, qualityScore, meta)` | 语义修复入口 |

#### 2.3.1 SemanticRepairStage.process 内部

| 序号 | 调用方 | 被调方法 | 说明 |
|------|--------|----------|------|
| 22 | SemanticRepairStage.process | `this.processChinese(job, text, qualityScore, meta)` 或 `this.processEnglish(...)` | 按 src_lang 路由 |

#### 2.3.2 中文语义修复（SemanticRepairStageZH.process）

| 序号 | 调用方 | 被调方法 | 说明 |
|------|--------|----------|------|
| 23 | SemanticRepairStageZH.process | `this.scorer.score(...)` | 质量/长度等打分，决定是否走修复 |
| 24 | SemanticRepairStageZH.process | `tryAcquireGpuLease('SEMANTIC_REPAIR', ...)` | 获取 GPU 租约（若启用） |
| 25 | SemanticRepairStageZH.process | `this.taskRouter.routeSemanticRepairTask(repairTask)` | **一次 HTTP 调用** 语义修复服务（如 /zh/repair） |
| 26 | TaskRouter | `this.semanticRepairHandler.routeSemanticRepairTask(task)` | task-router-semantic-repair.ts：选端点、查缓存、发请求 |

#### 2.3.3 语义修复步骤收尾

| 序号 | 调用方 | 被调方法 | 说明 |
|------|--------|----------|------|
| 27 | runSemanticRepairStep | `services.aggregatorManager.updateLastCommittedTextAfterRepair(session_id, utterance_index, textToRepair, ctx.repairedText)` | **唯一写回**“已提交文本”的点；供后续 NMT context 与下一句 Trim 使用 |

---

## 3. 重复调用与冗余分析

### 3.1 getLastCommittedText

| 调用位置 | 次数/Job | 用途 |
|----------|----------|------|
| runAggregationStep | 1 | 取“上一句已提交文本”作 Trim 的 previousText，并写入 `ctx.lastCommittedText` |
| TranslationStage（TRANSLATION 步骤） | 1 | 取“上一句已提交文本”作 NMT 的 context_text |

**结论**：  
- **非重复**。两次调用发生在不同步骤、不同语义（聚合 Trim vs 翻译上下文）。  
- 且语义修复步骤会调用 `updateLastCommittedTextAfterRepair`，Translation 步骤在 SEMANTIC_REPAIR 之后执行，因此 Translation 阶段读到的是“刚提交的修复后文本”，符合设计。

### 3.2 AggregationStage / TextForwardMergeManager 实例化

| 对象 | 创建时机 | 说明 |
|------|----------|------|
| AggregationStage | 每个 Job 在 runAggregationStep 内 `new AggregationStage(...)` | 每 Job 新建 |
| TextForwardMergeManager | 每个 AggregationStage 内部 `new TextForwardMergeManager()` | 每 Job 新建，**状态不跨 Job 共享** |

**结论**：  
- **存在设计风险**。`TextForwardMergeManager` 内部通过 `pendingTexts` 实现“等待若干秒再合并”的 HOLD 逻辑。  
- 由于每个 Job 都新建一个 `TextForwardMergeManager`，`pendingTexts` 无法在多个 Job 之间共享，因此**跨 Job 的 HOLD（例如 Job1 HOLD，3 秒后 Job2 再合并）在当前实现下不会生效**。  
- 若产品需求是“跨 utterance 等待合并”，则应将 `TextForwardMergeManager` 改为按 session 复用（例如通过 ServicesBundle 注入单例或按 sessionId 缓存）。

### 3.3 DeduplicationHandler.getLastSentText

| 调用位置 | 说明 |
|----------|------|
| AggregationStage.process | 在调用 `forwardMergeManager.processText` 前，仅用于**日志**（lastSentText），不参与 Trim 逻辑；Trim 使用参数传入的 `lastCommittedText` |

**结论**：  
- 每 Job 在聚合阶段调用一次，仅读一次，无重复调用问题。

### 3.4 SemanticRepairInitializer / SemanticRepairStage

| 对象 | 使用方式 |
|------|----------|
| SemanticRepairInitializer | 来自 `services.semanticRepairInitializer`，**复用**；仅未初始化时调用 `initialize()` |
| SemanticRepairStage | 由 Initializer 内部创建并缓存，**单例复用**，不每 Job 新建 |

**结论**：  
- 无重复创建；语义修复服务调用为**每 Job 至多一次 HTTP**（在决定 REPAIR 且通过 GPU 等检查后）。

### 3.5 runDedupStep 中的 DedupStage

| 行为 | 说明 |
|------|------|
| `if (!services.dedupStage) { services.dedupStage = new DedupStage(); }` | 若 bundle 未注入则懒创建并写回；InferenceService 一般已注入，通常不会重复创建 |

**结论**：  
- 仅为兜底，不视为冗余。

---

## 4. 潜在错误调用与不必要开销

### 4.1 重复或错误调用

- **未发现**对同一语义的重复调用（如对 getLastCommittedText 的两次调用语义不同，且时机正确）。  
- **未发现**在“从 ASR 到语义修复”这段内对语义修复服务的多次 HTTP 调用。

### 4.2 不必要开销（可优化）

| 项目 | 说明 | 建议 |
|------|------|------|
| 每 Job 新建 AggregationStage | 仅包含轻量依赖与一个 TextForwardMergeManager，若不做跨 Job HOLD，可考虑复用 Stage 或只复用 ForwardMergeManager（需确认 HOLD 需求） | 若确认不做跨 Job HOLD，可改为单例或按 session 复用，减少短生命周期对象创建 |
| buildPrompt（ASR 步骤）中的 getOrCreateState + getRecentCommittedText 等 | 仅在启用 S1 Prompt 时执行，且与 getLastCommittedText 不同 API（Recent 列表 vs 单条 Last） | 保持现状；若后续统一“上一句”语义，可评估与 getLastCommittedText 的数据源是否合并 |
| loadNodeConfig 多次调用 | 在多个 Stage/Manager 构造函数或初始化路径中被调用 | 若配置在进程内不变，可考虑在应用启动时加载一次并注入，减少重复读文件/解析 |

---

## 5. 小结与审议要点

### 5.1 调用链小结（ASR 结果 → 语义修复服务）

1. **runJobPipeline** 按模式执行步骤，对 AGGREGATION、SEMANTIC_REPAIR 分别调用 **runAggregationStep**、**runSemanticRepairStep**。  
2. **AGGREGATION**：  
   - 调用 **getLastCommittedText** 一次 → 传入 **AggregationStage.process** → **processUtterance**（聚合）→ **DeduplicationHandler.isDuplicate**（去重）→ **TextForwardMergeManager.processText**（Trim + 门控）→ 写回 `ctx.aggregatedText`、`ctx.segmentForJobResult`、`ctx.shouldSendToSemanticRepair` 等。  
3. **SEMANTIC_REPAIR**（仅当 `ctx.shouldSendToSemanticRepair === true`）：  
   - 使用 **ctx.lastCommittedText** 作微上下文，**不再次调用 getLastCommittedText**；  
   - 复用 **SemanticRepairInitializer / SemanticRepairStage**，调用 **SemanticRepairStageZH/EN.process** → **taskRouter.routeSemanticRepairTask**，产生**一次**语义修复 HTTP 调用；  
   - 结束后调用 **updateLastCommittedTextAfterRepair** 写回已提交文本。

### 5.2 审议要点

- **getLastCommittedText**：两处调用（聚合、翻译）语义与时机均合理，**非重复**。  
- **TextForwardMergeManager 每 Job 新建**：导致**跨 Job 的 HOLD 合并不生效**；若需求包含“跨 utterance 等待合并”，需改为按 session 复用或注入单例。  
- **语义修复**：单例 Stage + 单次 HTTP，无重复调用与多余开销。  
- **可优化项**：AggregationStage/TextForwardMergeManager 实例化策略、loadNodeConfig 集中加载与注入，可按优先级在后续迭代中处理。

---

**文档结束。** 若决策部门需要补充某一段的代码路径或希望针对某一环节做优化方案，可在此基础上扩展。
