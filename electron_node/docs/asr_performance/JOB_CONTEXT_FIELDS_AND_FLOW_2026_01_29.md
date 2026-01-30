# Job 上下文字段与流程说明（供决策部门审议）

**日期**：2026-01-29  
**原则**：每个步骤只读上游明确产出的字段，无回退逻辑；问题暴露在日志中，不通过多层回退掩盖。

---

## 一、设计约定

1. **单一数据源**：下游步骤只读「上一环节写入的字段」，不再使用 `|| ctx.xxx`、`?? ctx.xxx` 等回退。
2. **缺字段即告警**：若某字段未设置而被读取，打 `warn` 日志并视情况用空串，便于排查。
3. **谁产出谁负责**：聚合步骤保证在任意分支下都写出 `segmentForJobResult`；不送语义修复时由聚合步骤写出 `repairedText`，保证去重步骤只读 `repairedText`。

---

## 二、JobContext 文本相关字段（谁写 / 谁读）

| 字段 | 类型 | 写入步骤 | 读取步骤 | 用途 |
|------|------|----------|----------|------|
| **asrText** | string | ASR | 聚合（仅作输入） | 本 job 的 ASR 原始识别文本 |
| **asrResult** | ASRResult | ASR | ResultBuilder（extra/quality） | ASR 完整结果 |
| **asrSegments** | any[] | ASR | ResultBuilder / 语义修复（可选） | ASR 片段列表 |
| **segmentForJobResult** | string | 聚合 | 语义修复 | 本 job 的本段；语义修复只读此字段，产出 repairedText → text_asr / NMT；空 ASR 时聚合步骤设为 '' |
| **lastCommittedText** | string \| null | 聚合步骤从 aggregatorManager 取后写入 ctx；语义修复步骤写回 aggregatorManager | 语义修复（只读 ctx） | 上一句已提交文本，用于 Trim 与修复上下文 |
| **repairedText** | string | 语义修复 或 聚合（当 shouldSendToSemanticRepair=false 时） | 去重、ResultBuilder | 语义修复后的文本；去重只读此字段 |
| **shouldSendToSemanticRepair** | boolean | 聚合 | 流水线（是否执行语义修复）、翻译 | 是否送入语义修复 |
| **translatedText** | string | 翻译 | TTS、ResultBuilder | NMT 译文 |
| **shouldSend** | boolean | 去重 | 流水线、TTS、ResultBuilder | 是否发送该 job_result |
| **dedupReason** | string | 去重 | ResultBuilder（仅透传） | 去重原因 |
| **ttsAudio** / **toneAudio** | string | TTS / TONE | ResultBuilder | 合成音频 |

---

## 三、各步骤读写一览（无回退）

### 3.1 ASR 步骤

- **读**：无（输入为音频）。
- **写**：`asrText`、`asrResult`、`asrSegments`、`languageProbabilities`、`qualityScore`。

### 3.2 聚合步骤

- **读**：`asrText`、`asrSegments`；`lastCommittedText` 从 aggregatorManager 取后写入 ctx。
- **写**：`segmentForJobResult`、`shouldSendToSemanticRepair`、`lastCommittedText`（写入 ctx）。  
  **约定**：当 `shouldSendToSemanticRepair === false` 时，本步骤写 `repairedText = ''`。  
  当 ASR 为空时，写 `segmentForJobResult = ''`、`repairedText = ''`。

### 3.3 语义修复步骤

- **读**：`segmentForJobResult`（唯一待修输入）；`lastCommittedText`（ctx）；可选 `asrResult`/`asrSegments`。
- **写**：`repairedText`；并写回 `lastCommittedText` 到 aggregatorManager。

### 3.4 去重步骤

- **读**：`repairedText`（唯一“原文”输入，无 aggregatedText/asrText 回退）；`translatedText`（与 DedupStage 逻辑配合，通常为空）。
- **写**：`shouldSend`、`dedupReason`。

### 3.5 翻译步骤

- **读**：`repairedText`（唯一待译输入，无兼容回退；未送语义修复时由聚合步骤写入）；`shouldSend`、`shouldSendToSemanticRepair`；可选 quality/semantic 相关。
- **写**：`translatedText`。

### 3.6 TTS 步骤

- **读**：`translatedText`、`shouldSend`。
- **写**：`ttsAudio`（或 tone 分支的 `toneAudio`）。

### 3.7 ResultBuilder

- **读**：`repairedText`（唯一 text_asr 来源，无兼容回退）→ **text_asr**；`translatedText` → **text_translated**；`ttsAudio`/`toneAudio` → **tts_audio**；`repairedText` 同时写入 **text_asr_repaired**；其余 extra/quality/segments 等。
- **写**：无（产出 JobResult）。

---

## 四、数据流（文本）简图

```
ASR          → asrText
                ↓
聚合          → segmentForJobResult, [repairedText 当不送语义修复]
                ↓
语义修复      → 只读 segmentForJobResult → repairedText；lastCommittedText 写回 aggregatorManager
                ↓
去重          → 只读 repairedText → shouldSend, dedupReason
                ↓
翻译          → 只读 repairedText → translatedText（无兼容回退）
                ↓
TTS           → 只读 translatedText → ttsAudio
                ↓
ResultBuilder → 只读 repairedText → text_asr（无兼容回退）；只读 translatedText → text_translated；只读 ttsAudio/toneAudio → tts_audio
```

---

## 五、已移除的回退逻辑（变更摘要）

| 位置 | 原逻辑 | 现逻辑 |
|------|--------|--------|
| 聚合步骤 | 空 ASR 时只写 segmentForJobResult | 空 ASR 时写 `segmentForJobResult = ''`、`repairedText = ''` |
| 聚合步骤 | — | 当 shouldSendToSemanticRepair=false 时写 `repairedText = ''` |
| AggregationStage | segmentForJobResult = segmentForCurrentJob ?? textAfterDeduplication | 仅 segmentForCurrentJob ?? ''；缺时打 warn |
| 语义修复步骤 | textToRepair = aggregatedText | 仅 segmentForJobResult ?? ''；不写 ctx.aggregatedText |
| 去重步骤 | finalText = repairedText \|\| aggregatedText \|\| asrText | 仅 repairedText ?? ''；缺时打 warn |
| 翻译步骤 | textToTranslate = segmentForJobResult ?? asrText | 仅 repairedText；缺时打 warn（无兼容回退） |
| ResultBuilder | finalAsrText = segmentForJobResult ?? asrText ?? '' | 仅 repairedText；缺时打 warn（无兼容回退） |

---

## 六、供决策部门审议的结论

- **无冗余字段**：JobContext 已移除 `aggregatedText`；语义修复只读 `segmentForJobResult`，产出 `repairedText`；去重/翻译/ResultBuilder 只读 `repairedText`。
- **无重复回退**：各步骤仅读上表所列“读取步骤”对应字段，缺则告警并用空串，不再用多层回退掩盖问题。
- **调用关系**：见第三节「各步骤读写一览」与第四节数据流；若需进一步裁剪字段或步骤，可在本表基础上标注拟删除项再议。
