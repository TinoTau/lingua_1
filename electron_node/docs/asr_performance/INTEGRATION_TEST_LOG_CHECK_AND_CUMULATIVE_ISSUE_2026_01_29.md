# 集成测试：节点端日志检查与「译文/音频合并」根因（2026-01-29）

## 1. 如何检查节点端日志（每个 job 在各服务中的输入/输出）

**日志路径**：`electron_node/electron-node/logs/electron-main.log`（或当前工作目录下的 `logs/electron-main.log`）

### 1.1 按 job 过滤

日志中通常带有 `jobId`、`utteranceIndex` 或 `job_id`、`utterance_index`。可按以下关键字在日志中搜索某一 job 的完整链路：

| 阶段 | 建议搜索关键字（含该 job 的 jobId） | 关键字段（输入/输出） |
|------|-------------------------------------|------------------------|
| **ASR** | `runAsrStep`、`ASR completed` | asrText、segmentCount、originalJobIds |
| **聚合** | `AggregationStage: Processing completed`、`runAggregationStep: Aggregation completed` | aggregatedText、aggregatedTextLength、segmentForJobResultPreview、shouldSendToSemanticRepair |
| **语义修复** | `runSemanticRepairStep`、`Semantic repair completed` | textToRepair / aggregatedText（输入）、decision、repairedText、textChanged |
| **NMT** | `NMT INPUT: Sending NMT request`、`NMT OUTPUT: NMT request succeeded` | text、textLength、srcLang、tgtLang、contextText（输入）；translatedText、translatedTextLength（输出） |
| **TTS** | `runTtsStep` 或 `runYourttsStep`、`TTS completed` | textToTts / translatedText（输入）；ttsAudioLength（输出） |
| **结果发送** | `sendJobResult`、`Job processing completed successfully` | textAsr、textAsrLength、textTranslated、textTranslatedLength、ttsAudioLength |

### 1.2 按阶段快速定位

- **语义修复是否被调用**：搜 `runSemanticRepairStep: Semantic repair completed` 或 `runSemanticRepairStep: skipped`。若有 `decision`，则已调用；`decision=PASS` 表示未改文。
- **NMT 输入**：搜 `NMT INPUT: Sending NMT request`，看 `text`、`textLength`、`srcLang`、`tgtLang`。
- **NMT 输出**：搜 `NMT OUTPUT: NMT request succeeded`，看 `translatedText`、`translatedTextLength`。
- **每个 job 最终带出的内容**：搜 `sendJobResult` 或 `Job processing completed successfully`，看 `textAsrLength`、`textTranslatedLength`、`ttsAudioLength`。

### 1.3 可选：生成按 job 的报告

可从 `electron-main.log` 中按 `jobId`/`utterance_index` 抽取上述字段，生成「每个 job → 各阶段输入/输出」的表格（可参考 `logs/docs/asr_performance/JOB_SERVICE_FLOW_REPORT_*.md` 的格式）。

---

## 2. 本次你看到的现象与对应根因

### 2.1 「识别出来的原文结果并没有进行语义修复」

可能有两种情况（都需看日志确认）：

1. **语义修复被调用了，但 decision=PASS（未改文）**  
   - 日志里会有 `runSemanticRepairStep: Semantic repair completed`，且 `decision=PASS`，`textChanged=false`。  
   - 此时「原文」显示的就是 ASR 输出（可能带繁体/同音错字），语义修复服务认为不需要改，所以**看起来**像「没有进行语义修复」。  
   - **建议**：在日志中确认 `decision`、`repairedText` 与 `textToRepair` 是否一致；若一致，即 PASS。

2. **语义修复步骤被跳过**  
   - 若 `ctx.shouldSendToSemanticRepair !== true`，则不会执行语义修复步骤，日志中会有 `Skipping step SEMANTIC_REPAIR`。  
   - 原因多为：该 job 在聚合阶段被判定为 HOLD（等待合并）或 DROP，未触发 SEND。  
   - **建议**：搜该 job 的 `shouldSendToSemanticRepair`、`AggregationStage: Processing completed`，确认是否为 `true`。

另外，若语义修复服务只做「中→中」纠错，而 ASR 检测为英文或其它语言，也可能直接 PASS，需看服务配置与日志中的语言/decision。

---

### 2.2 「译文部分变成合并所有文本了」+「音频也被合并了，每个 jobResult 的音频长度超过 web 端限制」

**设计本意**：「合并后的整句」做 NMT/TTS 指的是**当前 job 的本句**（本 job 贡献的文本，或本 job 内多片段合并成的一句），用于上下文、翻译质量；**不是**整个 session 迄今的全文。

**根因**：实现里把 `aggregatedText` 做成了「上一句已提交（其他 job）+ 本句」= **整个 session 迄今**。  
TextForwardMergeManager 的 `base = previousText`（lastCommittedText），`mergedText = base + currentText`，因此 NMT/TTS 收到的是整 session 的累积句，而不是「当前 job 的整句」。  
该**错误整句**会进入：

- **语义修复** → 输出 `repairedText`（可能等于聚合文）
- **NMT** → 对**整句**翻译，得到**整句译文**
- **TTS** → 对**整句译文**合成，得到**整段音频**

而 **job_result** 里目前是这样写的：

- `text_asr`：已按「本段」修正，用的是 `segmentForJobResult`（本 job 的本段）✅  
- `text_translated`：用的是 **整句译文**（`ctx.translatedText`）❌  
- `tts_audio`：用的是 **整段 TTS 音频**（`ctx.ttsAudio`）❌  

因此：

- 每个触发 SEND 的 job 都会带「从开头到当前」的**累积译文**和**累积音频**；
- 越靠后的 job，译文越长、音频越长，容易超过 web 端对单条结果的长度/大小限制。

也就是说：**不是 NMT/TTS 服务在合并，而是节点端误把「整 session 的翻译 + 整 session 的 TTS」写进了每一个 job 的 result**；设计上应只写「当前 job 的本句」的译文和音频。

---

## 3. 修复方向（与 text_asr 一致：每 job 只带「本段」）

目标：每个 job_result 只带**本 job 对应段落**的原文、译文和音频，而不是整句合并后的结果。

- **text_asr**：已实现，用 `segmentForJobResult`（本段）✅  
- **text_translated**：应改为「本段的译文」，不能再用整句译文。  
- **tts_audio**：应改为「本段译文对应的 TTS 音频」，不能再用整段 TTS。

可选两种实现思路（需产品/架构取舍）：

### 方案 A：按「当前 job 的本句」翻译 + TTS（已实现，符合设计本意）

- **翻译**：对 **当前 job 的本句**（`segmentForJobResult`，即本 job 贡献的文本）单独调 NMT，得到本句译文。  
- **TTS**：只对本句译文做 TTS，得到本句对应音频。  
- **job_result**：  
  - `text_translated` = 本句译文  
  - `tts_audio` = 本句 TTS 音频  

这样 NMT/TTS 的输入就是「当前 job 的整句」，**不是**整个 session 的全文；每个 job 的译文和音频长度与本句对应，不会累积，也不会超 web 端限制。与 text_asr 用本段一致，逻辑简单。

### 方案 B：仍用整句翻译，但只把「本段对应部分」写入 job_result

- 继续用当前「整句 → NMT → 整句译文 → 整段 TTS」的流程（保证翻译质量）。  
- 在写 job_result 时，对「整句译文」做对齐/切分，得到与本段原文对应的**片段译文**，只把该片段写入 `text_translated`；对整段 TTS 做时间或长度切分，得到本段对应的**片段音频**写入 `tts_audio`。  

这样保留整句 NMT 上下文，但实现复杂（需要译文对齐、音频切分或按句 TTS 再映射），且易出错。

**建议**：若产品接受「每条结果 = 本段原文 + 本段译文 + 本段音频」，优先做**方案 A**，在节点端为每个 job 单独用本段做 NMT + TTS，并写入 `text_translated` 与 `tts_audio`；同时可在日志中保留现有「整句」调用的信息便于对比质量。

### 3.1 已实现的修改（方案 A）

在 **`electron_node/electron-node/main/src/pipeline/steps/translation-step.ts`** 中已做如下修改：

- **翻译输入**：当 `ctx.segmentForJobResult` 存在且非空时，使用 **当前 job 的本句**（`segmentForJobResult`）作为 NMT 的输入；否则仍使用 `repairedText || aggregatedText || asrText`（无聚合器时的兼容路径）。
- **效果**：NMT/TTS 的输入从「整个 session 迄今的累积句」改为「当前 job 的本句」；每个 job 的 `text_translated` 与 `tts_audio` 只对应本句，不再带整 session 的译文/音频。

---

## 4. 小结

| 现象 | 根因 | 建议 |
|------|------|------|
| 原文看起来「没有语义修复」 | 多为 decision=PASS（未改文）或该 job 未走语义修复步骤 | 查日志 `decision`、`shouldSendToSemanticRepair` |
| 译文/音频「合并」、单条过长 | 每个 job 的 result 写入了整句译文和整段 TTS | 改为按本段翻译 + 本段 TTS，只把本段译文和本段音频写入 job_result（方案 A） |

完成上述修改后，可再跑一次集成测试，并用同一套日志关键字检查每个 job 在各阶段的输入/输出，确认 `text_translated` 与 `tts_audio` 已按本段写入且长度在 web 端限制内。
