# Job 容器与各服务文本字段说明（供决策部门审议）

**文档目的**：梳理节点端 Job 上下文（JobContext）及流水线各步骤在处理文本时用到的字段，便于决策部门审议是否存在**冗余、重复或矛盾**的字段/调用。  
**日期**：2026-01-29。

---

## 一、Job 7 问题根因（简要）

**现象**：Job 7 的译文是多个 job 的合并长句，而不是本 job 的本段。

**根因**：  
在 `TextForwardMergeManager` 中，当「仅 flush 待合并的上一段、当前 job 没有 currentText」时，返回结果**未带 `segmentForCurrentJob`**。下游用 `segmentForJobResult = segmentForCurrentJob ?? textAfterDeduplication`，此时退化为 `textAfterDeduplication`（整段合并文），导致 NMT 的输入是整段而非本段，译文变长句。

**修复**：在上述「仅 flush pending、无 currentText」的 return 中补上 **`segmentForCurrentJob: ''`**，表示本 job 无当前文本；`segmentForJobResult` 不再误用整段，NMT 输入为本段（或空）。

---

## 二、JobContext 文本相关字段一览

| 字段名 | 类型 | 写入步骤 | 主要用途 | 备注 |
|--------|------|----------|----------|------|
| **asrText** | string | ASR | 本 job 的 ASR 原始识别文本 | 多 segment 时由 ASR 步骤按序拼接 |
| **asrResult** | ASRResult | ASR | ASR 完整结果（segments、language、badSegment 等） | 供 result 的 extra/quality/segments 等 |
| **asrSegments** | any[] | ASR | ASR 片段列表 | 与 asrResult.segments 可重叠，result 优先 asrSegments |
| **aggregatedText** | string | 聚合 | 聚合后的文本；SEND 时可能为「上一句已提交 + 本句」合并长句 | **语义修复**的输入；**不再**作为 NMT 的“待译文本”（NMT 已改用 segmentForJobResult） |
| **segmentForJobResult** | string | 聚合 | **本 job 的本段**，仅对应当前 job 的原文 | **job_result.text_asr**、**NMT 待译文本**、**TTS 源为译文**的链条：本段→译→读 |
| **lastCommittedText** | string \| null | 聚合步骤只读入并写入 ctx；权威写回在语义修复后 | 上一句已提交的文本 | 用于 Trim（边界裁剪）、NMT context_text、语义修复上下文 |
| **shouldSendToSemanticRepair** | boolean | 聚合 | 是否送入语义修复（及后续 NMT/TTS） | false 时跳过语义修复、翻译、TTS |
| **repairedText** | string | 语义修复 | 语义修复后的文本 | 去重步骤用其做“最终原文”；result 中 text_asr_repaired |
| **translatedText** | string | 翻译 | NMT 译文 | TTS 输入；result 的 text_translated |
| **shouldSend** | boolean | 去重 | 是否最终发送该 job_result | 去重不通过则 false，后续 TTS 等可跳过 |
| **dedupReason** | string | 去重 | 去重原因说明 | 仅记录/排查用 |
| **ttsAudio** / **toneAudio** | string (base64) | TTS / TONE | 合成音频 | result 的 tts_audio |

其他上下文字段（非“文本内容”但参与流程）：  
`aggregationAction`、`aggregationChanged`、`isLastInMergedGroup`、`aggregationMetrics`、`semanticDecision`、`semanticRepairApplied`、`semanticRepairConfidence`、`languageProbabilities`、`qualityScore`、`detectedSourceLang`、`detectedTargetLang` 等，此处不展开。

---

## 三、各步骤对文本字段的读写

### 3.1 ASR 步骤

| 读 | 写 |
|----|-----|
| （无；输入为音频） | **asrText**、**asrResult**、**asrSegments**、**languageProbabilities**、**qualityScore** |

- **asrText**：本 job 的 ASR 识别结果，多 segment 时拼接。
- **asrResult**：完整 ASR 结果，供后续质量、segments、extra 等使用。

---

### 3.2 聚合步骤（AggregationStage + TextForwardMergeManager）

| 读 | 写 |
|----|-----|
| **asrText**、**asrSegments**、**lastCommittedText**（由 aggregatorManager 取后写入 ctx） | **aggregatedText**、**segmentForJobResult**、**shouldSendToSemanticRepair**、**lastCommittedText**（写入 ctx 快照） |

- **aggregatedText**：  
  - SEND：可为「上一句已提交 + 本句」合并长句，供**语义修复**使用。  
  - HOLD/丢弃：可为空。  
- **segmentForJobResult**：  
  - 仅本 job 的本段，用于 **job_result.text_asr** 与 **NMT 待译文本**（在 translation-step 中取 segmentForJobResult ?? asrText）。  
- **lastCommittedText**：  
  - 本步骤从 aggregatorManager 读取并写入 ctx，供语义修复、Trim、NMT context 使用；**不在本步骤写回** aggregatorManager。

---

### 3.3 语义修复步骤

| 读 | 写 |
|----|-----|
| **aggregatedText**（主）、**asrText**（fallback）、**lastCommittedText**、**asrResult**（部分） | **repairedText**；并**写回** lastCommittedText 到 aggregatorManager（权威写点） |

- 输入：**aggregatedText \|\| asrText**，即“当前要修复的句子”（可能是合并长句）。  
- **lastCommittedText**：仅读 ctx，用于修复上下文；修复后通过 **updateLastCommittedTextAfterRepair** 将本次提交内容写回 aggregatorManager。

---

### 3.4 去重步骤

| 读 | 写 |
|----|-----|
| **repairedText**（主）、**aggregatedText**、**asrText**（fallback）、**translatedText** | **shouldSend**、**dedupReason** |

- 用于去重的“最终原文”：**repairedText \|\| aggregatedText \|\| asrText**。  
- 与 **translatedText** 一起参与重复/空洞判定，决定是否 **shouldSend**。

---

### 3.5 翻译步骤

| 读 | 写 |
|----|-----|
| **segmentForJobResult**（主）、**asrText**（fallback）、**shouldSend**、**shouldSendToSemanticRepair**、**qualityScore**、**semanticRepairApplied**、**semanticRepairConfidence** | **translatedText** |

- **NMT 待译文本**：**segmentForJobResult !== undefined ? segmentForJobResult : asrText**（即本 job 本段，不再用 aggregatedText）。  
- NMT 的 context（上一句译文等）由 TranslationStage 内部通过 aggregatorManager 获取，与 **lastCommittedText** 语义相关但不在 ctx 中直接传。

---

### 3.6 TTS 步骤

| 读 | 写 |
|----|-----|
| **translatedText**、**shouldSend** | **ttsAudio** |

- 输入：**translatedText**（本 job 的译文）。  
- 输出：**ttsAudio**（或 tone 分支的 toneAudio）。

---

### 3.7 ResultBuilder（构建 job_result）

| 读（用于 result 文本/音频相关） | 写出到 JobResult |
|--------------------------------|------------------|
| **segmentForJobResult** ?? **asrText** | **text_asr** |
| **translatedText** | **text_translated** |
| **ttsAudio** / **toneAudio** | **tts_audio** |
| **repairedText** | **text_asr_repaired** |
| **shouldSend**、**dedupReason**、**asrResult**、**asrSegments**、**aggregationChanged** 等 | **should_send**、**dedup_reason**、**extra**、**segments**、**aggregation_applied** 等 |

- **text_asr**：仅本 job 本段，**segmentForJobResult ?? asrText**。  
- **text_translated**：本 job 译文。  
- **tts_audio**：本 job 合成音频。

---

## 四、数据流小结（文本）

1. **ASR** → **asrText**（本 job 原文）。
2. **聚合** → **aggregatedText**（可能为合并长句）、**segmentForJobResult**（本 job 本段）；**lastCommittedText** 读入并写入 ctx。
3. **语义修复** → 读 **aggregatedText**，写 **repairedText**；并写回 **lastCommittedText** 到 aggregatorManager。
4. **去重** → 读 **repairedText** / **aggregatedText** / **asrText** 与 **translatedText**，写 **shouldSend**。
5. **翻译** → 读 **segmentForJobResult** ?? **asrText**（本段），写 **translatedText**。
6. **TTS** → 读 **translatedText**，写 **ttsAudio**。
7. **ResultBuilder** → **text_asr** = segmentForJobResult ?? asrText；**text_translated** = translatedText；**tts_audio** = ttsAudio/toneAudio。

设计要点：  
- **本段**只用 **segmentForJobResult**（及 asrText 作 fallback）驱动「原文 → 译文 → TTS → result」。  
- **合并长句**仅用于 **aggregatedText → 语义修复 → repairedText** 和去重输入，**不再**作为 NMT 的输入。

---

## 五、供决策部门审议的问题

1. **aggregatedText 与 segmentForJobResult 双轨**  
   - **aggregatedText**：语义修复输入（可为合并长句）。  
   - **segmentForJobResult**：本段，用于 text_asr、NMT、TTS、result。  
   - 审议：是否保留“语义修复用长句、NMT 用本段”的分离，有无冗余或可合并的命名/职责。

2. **lastCommittedText 的读写点**  
   - 聚合步骤：只读 aggregatorManager 并写入 ctx。  
   - 语义修复步骤：读 ctx，写回 aggregatorManager。  
   - 审议：是否允许仅在语义修复后写回，聚合只读；是否有重复调用或一致性问题。

3. **去重步骤的“最终原文”**  
   - 当前：repairedText \|\| aggregatedText \|\| asrText。  
   - 审议：是否统一为仅 **repairedText**（无语义修复时由上游保证 repairedText 或等价赋值），以减少多源 fallback。

4. **asrText 的 fallback 范围**  
   - 多处：segmentForJobResult 未设置时、aggregatedText 空时、repairedText 空时。  
   - 审议：在“聚合始终产出 segmentForJobResult”的约定下，是否可收窄 asrText 的 fallback 范围，仅保留明确需要的路径。

5. **result 中的 text_asr_repaired**  
   - 来自 **repairedText**，与 **text_asr**（本段）可能不一致（修复 vs 未修复）。  
   - 审议：下游是否必须同时保留 text_asr 与 text_asr_repaired，是否存在冗余或混淆。

请决策部门就以上字段用途与数据流，审议是否存在**冗余、重复或矛盾**的字段/调用，并给出是否精简或重命名的意见。
