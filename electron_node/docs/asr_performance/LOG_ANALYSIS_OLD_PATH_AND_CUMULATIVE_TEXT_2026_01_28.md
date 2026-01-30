# 日志分析：是否旧路径导致「每条结果累积全文」（2026-01-28）

**结论**：**不是**。日志显示各服务走的是**当前单容器路径**，没有调用已删除的 Dispatcher/merge/consolidated 等旧路径。  
**累积全文**来自**当前设计**：聚合阶段（AggregationStage + TextForwardMergeManager）在 SEND 时把「上一句已提交 + 本句」合并成一条，并作为**本 job 的** `text_asr` 发出，因此每条 job_result 自然就是「迄今全文」。

---

## 1. 是否还在走旧路径？

### 1.1 日志里没有旧路径关键词

在 `electron-main.log` 中检索：

- **Dispatcher**、**runJobPipeline(original)**、**consolidated**、**consolidated_to_job_ids**、**is_consolidated**  
  → 未出现，说明没有走「按 originalJob 分发的旧 Dispatcher」或「合并多 job 再发」的旧逻辑。

- **originalJobIds**、**originalJobInfo**  
  → 仅出现在 **AudioAggregator** / **PipelineOrchestrator** 的日志里，用于「头部对齐 / 空容器核销」等**当前**设计，不是旧的多结果合并路径。

### 1.2 实际调用链是当前单容器路径

从日志可以还原出每条 job 的流程，均为**当前架构**：

| 阶段 | 日志特征 | 说明 |
|------|----------|------|
| 收 job | `Received job_assign, starting processing` + `jobId` / `utteranceIndex` | handleJob → processJob，一 job 一调 |
| 音频 | `AudioAggregator: Sending audio segments to ASR`、`PipelineOrchestrator: Audio segments ready for ASR` | AudioProcessor → 当前聚合/切分逻辑 |
| ASR | `runAsrStep: [ASRService] Calling ASR service`、`runAsrStep: ASR completed` | 单容器 asr-step，多 segment 只写当前 ctx |
| 聚合 | `AggregationStage: Before forward merge`、`TextForwardMergeManager: Merged text length ... (SEND)` | AggregationStage + TextForwardMergeManager |
| 发送 | `Sending job_result to scheduler` + `jobId` / `utteranceIndex` / `textAsrLength` | ResultSender 唯一发送点 |

没有「按 originalJob 再跑一遍 pipeline」或「多 job 合并成一条再发」的日志，可确认**没有走旧路径**。

---

## 2. 为什么每条 job_result 是「累积全文」？

### 2.1 日志里的数量关系

同一 session 下，发送的 job_result 与 text 长度大致如下（节选）：

- utteranceIndex **0**：textAsrLength **15**（首句）
- utteranceIndex **1**：textAsrLength **20**（本句）
- utteranceIndex **2**：textAsrLength **53**（明显变长）
- utteranceIndex **10**：textAsrLength **73**
- utteranceIndex **11**：textAsrLength **128**
- utteranceIndex **12**：textAsrLength **176**
- utteranceIndex **13**：textAsrLength **218**
- utteranceIndex **14**：textAsrLength **242**
- utteranceIndex **15**：textAsrLength **276**

即：**每个 job 发一条 job_result**，但 **textAsrLength 随 utteranceIndex 单调增**，说明每条里的 `text_asr` 是「从开头到本句」的**累积全文**。

### 2.2 来源：AggregationStage 的「向前合并」设计

日志里可以清楚看到聚合阶段在做什么：

- `AggregationStage: Before forward merge ... previousText: "開始進行一次語音識別穩定性測試" ...`
- `TextForwardMergeManager: Merged text length > 40, forcing ... (SEND)`
- `AggregationStage: Processing completed ... aggregatedTextLength: 53, aggregatedTextPreview: "開始進行一次語音識別穩定性測試總統不會在句的之間..."`

含义是：

1. **AggregationStage** 每次用 `getLastCommittedText(session_id)` 取 **previousText**（上一句已提交）。
2. **TextForwardMergeManager.processText** 根据长度/策略决定 SEND 或 HOLD；当 **SEND** 时，**processedText = 上一句已提交 + 本句**（mergedText）。
3. AggregationStage 把 **finalAggregatedText = forwardMergeResult.processedText** 写回 ctx，后续语义修复、result-builder 都用它，最终 **buildJobResult** 的 `text_asr` 就是这条**合并后的长串**。
4. 因此：**每个 job 对应一条 job_result，但这条 result 的 text_asr 被设计成「迄今全文」**，不是「仅本句」。

所以：**不是旧路径在拼结果，而是当前「向前合并 + 按句 SEND」的设计，天然让每条 job_result 带累积全文。**

---

## 3. 需求澄清与已做修复

**正确需求**：节点端收到的**每个 job** 都应建立一个**对应的 jobResult**，将**该 job 的处理结果**（本句/本段）放进该 jobResult，在服务之间传递；**不应**把多个 job 的处理结果都放进同一个容器或把「合并全文」当作某一条 job 的 result。

此前实现有误：AggregationStage 在 SEND 时把「合并全文」（previousCommitted + current）写入了**本 job 的** ctx.aggregatedText，导致该 job 的 job_result.text_asr 变成迄今全文，而非本 job 的 segment。

**当前实现**（`aggregation-stage.ts` + `result-builder.ts` + `translation-step.ts`）：

- **ctx.aggregatedText**：给下游（语义修复、NMT、TTS）的文本；**SEND 时为合并长句**（`forwardMergeResult.processedText`），保证修复/翻译质量；HOLD 或丢弃时为空。
- **ctx.segmentForJobResult**：仅用于 **job_result.text_asr** 的本 job 本段（避免每条 result 带累积全文）。
- **buildJobResult**：`text_asr = ctx.segmentForJobResult ?? ctx.repairedText ?? ctx.aggregatedText ?? ctx.asrText`。
- **Translation**：仅当 `ctx.shouldSendToSemanticRepair === true` 时调用 NMT（即只有「合并长句」才进入翻译）；未走语义修复的 job 不调用 NMT/TTS。

效果：语义修复、NMT、TTS 按原逻辑接收「合并长句」；每个 job 的 job_result.text_asr 仅带本段。

---

## 4. Job8 / Job9 文本重复与 trim delta 修复

**现象**：集成测试中仅 job8 和 job9 出现文本重复（如「切分策略和超市规则是基本可用的」同时出现在两段）。

**原因**：本句与上一句存在**边界重叠**（ASR 尾/首重复）。此前写入 ctx 的是「本句全文」（`textAfterDeduplication`），未使用 ForwardMerge 的 trim 结果，导致重叠部分既在上一句的 job_result 里，又在本句的 job_result 里。

**已做修复**：

- **TextForwardMergeManager**：`mergeByTrim` 增加返回值 `deltaForCurrent`（trim 后本句的增量）；`processText` 在所有调用 `mergeByTrim` 的分支里，将 `segmentForCurrentJob = mergeResult.deltaForCurrent` 写入 `ForwardMergeResult`。
- **AggregationStage**：`finalAggregatedText` 优先使用 `forwardMergeResult.segmentForCurrentJob`（trim 后的 delta），无则退化为 `textAfterDeduplication`。这样本 job 的 job_result.text_asr 只含「与上一句去重后的本句增量」，不再含与上一句重叠的前缀。

**逻辑**：Aggregation 写 ctx 时用 `forwardMergeResult.segmentForCurrentJob ?? textAfterDeduplication`；有 trim 时用 delta，无 trim 时用本句全文，无新增流程。

---

## 5. 语义修复、NMT、TTS 是否执行？如何查日志

若需确认「有没有做语义修复、有没有送入 NMT/TTS」，可在节点端日志中按以下关键词/步骤排查：

| 环节 | 日志关键词 / 步骤 | 说明 |
|------|------------------|------|
| **语义修复** | `runSemanticRepairStep:`、`SemanticRepairStage`、`semanticRepairApplied` | 若出现 `skipped (no semantic repair initializer)` 或 `Semantic repair stage not available`，则未做语义修复；若出现 `Semantic repair completed` / `rejected`，则已执行。 |
| **NMT** | `runTranslationStep:`、`TranslationStage:`、`Sending text to NMT`、`NMT service returned result` | 若 `textToTranslate` 为空会跳过（`runTranslationStep` 内判断）；若出现 `Translation completed` 且 `translatedTextLength > 0`，则已送入 NMT 并有译文。 |
| **TTS** | `tts-step`、`routeTTSTask`、`ttsTimeMs`、`audioLength` | 若 NMT 返回空则不会调 TTS；若出现 `tts_audio` 长度 > 0 的 `Job processing completed successfully`，则已生成并发送 TTS。 |

**常见导致「无译文 / 无 TTS」的原因**：

1. **聚合/过滤**：`ctx.aggregatedText` 为空（如 shouldDiscard、MERGE 非最后一句等），则不会进入语义修复与 NMT。
2. **语义修复未就绪**：未安装或未初始化 semantic-repair 服务，则 `runSemanticRepairStep` 会跳过，用原文走 NMT。
3. **NMT 返回空**：语言对不支持、服务异常或输入被过滤，会导致 `translatedText` 为空，进而无 TTS，客户端显示「音频丢失」。

建议：按 `job_id` / `utterance_index` 在日志中顺序搜上述关键词，确认每个 job 是否经过「聚合 → 语义修复 → NMT → TTS」以及各步的输入/输出长度。

**本次集成测试日志结论**（`electron_node/electron-node/logs/electron-main.log`，sessionId: s-FC9F0089）：

| 环节 | 结论 | 日志依据 |
|------|------|----------|
| **语义修复** | **有执行** | 多条 `runSemanticRepairStep: Semantic repair completed`、`Updated recentCommittedText with repaired text`，decision 为 PASS。 |
| **NMT** | **有调用，但返回为空** | 每条有 `TranslationStage: Sending text to NMT service`，随后 `NMT service returned result` 中 `nmtResultTextLength:0`、`translatedTextLength:0`。 |
| **TTS** | **无有效输出** | 因 NMT 返回空，`Job processing completed successfully` 中 `ttsAudioLength:0`，客户端显示「音频丢失」。 |

**根因（已定位）**：此前曾将下游改为「本句 segment」，导致语义修复/NMT/TTS 收到短切片，修复与翻译质量下降，且 NMT 易返回空。

**当前设计**：utterance 聚合将 string 数组**拼接成长句**发给语义修复，再发给 NMT 和 TTS（原逻辑不变）；仅 **job_result.text_asr** 使用本 job 的本段（`segmentForJobResult`），保证每条 result 只带本段、不带累积全文。

---

## 6. 小结

| 问题 | 结论 |
|------|------|
| 是否 job 容器合并后还在走旧路径？ | **否**。日志显示只有当前单容器路径。 |
| 为何每条结果曾是累积全文？ | **实现偏差**：AggregationStage 曾把合并全文写入本 job 的 ctx，现已改为只写本 job 的 segment。 |
| 每条只带本句是否已满足？ | **是**。已通过「ctx.aggregatedText = 本 job segment」修复，每条 job_result 只带该 job 的处理结果。 |
| Job8/Job9 类重复？ | **已修**。使用 ForwardMerge 的 `segmentForCurrentJob`（trim 后 delta）写入本 job，避免与上一句重叠。 |
| 如何确认语义修复/NMT/TTS？ | 见第 5 节：按 runSemanticRepairStep、TranslationStage、tts-step 等关键词在日志中按 job 排查。 |

**文档版本**：2026-01-28（含需求澄清、job8/job9 重复修复与语义修复/NMT/TTS 日志检查说明）
