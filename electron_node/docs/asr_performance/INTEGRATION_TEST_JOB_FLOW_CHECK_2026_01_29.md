# 集成测试：各 Job 在各服务中的处理过程检查（2026-01-29）

**阅读文本**（本次测试）：  
「现在我们开始进行一次语音识别稳定性测试。我会先读一两句比较短的话……如果这次的长句能够被完整地识别出来……否则，我们还需要继续分析日志，找出到底是在哪一个环节把我的语音吃掉了。」

**现象摘要**：  
- **Job1 / Job2**：截断位置非常微妙，导致原文被截断后翻译出来的意思完全相反。  
- **Job6**：丢失了开头的一部分内容（客户端 [6] 显示「一句会尽量…」缺「接下来这一」）。  
- **Job7**：译文里出现了 NMT 的分隔符（如 SEP_PARC 等）。  
- **Job13 起**：译文又变成了合并文本（长段重复/上下文混在一起）。

本文说明如何在**节点端日志**里按 job 查各服务的**输入/输出**，定位上述问题发生在哪一环节。

---

## 1. 如何跑分析（推荐）

### 1.1 使用增强后的分析脚本

本次已增强 `scripts/analyze_jobs_per_service_flow.ps1`，会按 job 输出：

- **ASR** 输出（asrText）
- **聚合**：`aggregatedText`（送语义修复的合并长句）、**segmentForJobResult**（送 NMT 与 text_asr 的「本段」）、shouldSendToSemanticRepair
- **语义修复**：是否执行、repairedText 预览
- **NMT 输入**：text（= segmentForJobResult）、contextTextLength
- **NMT 输出**：translatedText 长度、translatedTextPreview
- **TTS**：是否有音频

在 **electron_node** 目录下执行（请用本次测试产生的 log 路径）：

```powershell
.\scripts\analyze_jobs_per_service_flow.ps1 -LogPath "electron_node\electron-node\logs\electron-main.log"
# 若日志在其他路径：
.\scripts\analyze_jobs_per_service_flow.ps1 -LogPath "D:\你的路径\electron-main.log"
```

脚本会按 utterance_index 排序列出每个 job，重点看：

- **Job1 / Job2**：`segmentForJobResult` 与 `aggregatedText` 的边界是否与预期一致；NMT 输入的 text 是否就是「本段」、有无被合并进上一句/下一句。
- **Job6**：`segmentForJobResult` 是否缺句首（如缺「接下来这一」），ASR 输出是否就缺、还是聚合阶段丢的。
- **Job7**：NMT 输入的 text 长度、contextTextLength 是否异常大；NMT 输出的 translatedTextPreview 是否含分隔符或整段合并句。
- **Job13 / Job14 / Job15**：`segmentForJobResult` 是否变成整段合并句（应与「本段」一致）；NMT 输入的 text 是否过长、与前面某段重复。

---

## 2. 各问题在日志里对应查什么

### 2.1 Job1 / Job2 截断位置导致译文相反

**目的**：确认是「切分边界」错了（ASR/聚合把一句拆成 Job1 尾巴 + Job2 头），还是 NMT 对正确本段翻错了。

**在日志里查**（按 Job1、Job2 的 job_id 搜）：

| 步骤     | 日志关键字 / 字段 | 看什么 |
|----------|--------------------|--------|
| ASR      | `asrText` / `ASR completed` | Job1 的 asrText 是否在「用来确认」「不会在句子之间」等处被截断；Job2 是否从「必要的时候」开始，且没有带上 Job1 的尾巴。 |
| 聚合     | `AggregationStage: Processing completed` | **segmentForJobResultPreview**：Job1 的本段是否只到「或者再没有」为止；Job2 的本段是否仅为「必要的时候提前结束本次识别」。若 Job1 的 segmentForJobResult 含「必要的时候」或 Job2 含「不会在句子之间」，说明边界错了。 |
| NMT 输入 | `NMT INPUT: Sending NMT request` | **text** / **textPreview**：必须等于该 job 的 segmentForJobResult。若 Job2 的 NMT 输入是整段合并句（含 Job1 内容），说明送 NMT 的仍是合并句而非本段。 |
| NMT 输出 | `NMT OUTPUT` / `translatedTextPreview` | 若输入正确但译文意思相反，可能是 NMT 模型/上下文问题；若输入就是错的（本段与邻段混在一起），先修聚合/segmentForJobResult 再看 NMT。 |

**结论**：  
- 若 **segmentForJobResult** 与 **NMT 输入 text** 一致且均为「本段」，但译文仍相反 → 问题在 NMT（上下文/语言对）。  
- 若 **segmentForJobResult** 或 NMT 输入已是合并句/边界错 → 问题在聚合或 TextForwardMergeManager 的「本段」切分。

---

### 2.2 Job6 丢失开头（如「接下来这一」）

**目的**：确认是 ASR 就没识别出句首，还是聚合/forward merge 把句首归到上一 job 或丢掉了。

**在日志里查**（按 Job6 的 job_id 搜）：

| 步骤 | 日志关键字 / 字段 | 看什么 |
|------|--------------------|--------|
| ASR  | `asrText` / `ASR batch.*completed` | Job6 的 asrText 是否一开始就是「一句会尽量…」而没有「接下来这一」。若是，则可能是上游切分/静音判定把句首划到前一个 job 或未送 ASR。 |
| 聚合 | `segmentForJobResultPreview` / `aggregatedTextPreview` | segmentForJobResult 是否与 asrText 一致（都缺句首），还是 asrText 有句首但 segmentForJobResult 被截掉。后者说明 forward merge 或「本段」计算有误。 |
| NMT 输入 | `NMT INPUT` 的 **text** | 是否与 segmentForJobResult 一致；若一致且都缺句首，则需往前查 Job5 的 segmentForJobResult 是否把「接下来这一」带走了。 |

**结论**：  
- 若 **asrText** 就缺句首 → 问题在音频切分/ASR 输入或上游调度。  
- 若 **asrText** 有句首但 **segmentForJobResult** 缺 → 问题在聚合/TextForwardMergeManager 的本段划分。

---

### 2.3 Job7 译文里出现 NMT 分隔符

**目的**：确认是 NMT 返回里带了分隔符（如 SEP_PARC），还是节点端把多段拼在一起再送 NMT 导致模型输出分隔符。

**在日志里查**（按 Job7 的 job_id 搜）：

| 步骤 | 日志关键字 / 字段 | 看什么 |
|------|--------------------|--------|
| NMT 输入 | `NMT INPUT` 的 **text**、**contextTextLength** | text 是否为一整段长句、或含明显多句拼接；contextTextLength 是否异常大（例如上百字）。若 context 很大，NMT 可能把上下文当正文译出并插入分隔符。 |
| NMT 输出 | `NMT OUTPUT` 的 **translatedTextPreview** | 是否包含 SEP、PARC、`</s>` 等分隔符或重复句。若输入是「本段」且不长，但输出有分隔符，可能是 NMT 服务行为；若输入已是合并长段或大 context，先修正输入/context 再观查。 |

**结论**：  
- **segmentForJobResult** 与 NMT **text** 应为「本段」；若 Job7 的 text 或 context 过长/合并多句，先修聚合与 context 传递。  
- 若输入/context 正常仍出现分隔符，需查 NMT 服务（模型、num_candidates、返回格式）。

---

### 2.4 Job13 起译文变成合并文本

**目的**：确认是节点端把「本段」错成合并长句送 NMT，还是 NMT 自己把多句合并输出。

**在日志里查**（按 Job13、Job14、Job15 的 job_id 搜）：

| 步骤 | 日志关键字 / 字段 | 看什么 |
|------|--------------------|--------|
| 聚合 | `segmentForJobResultPreview` / `aggregatedTextPreview` | **segmentForJobResult** 是否应为一句短句，却变成整段合并（与 aggregatedText 相同或很长）。若 segmentForJobResult 已是整段，说明 forward merge 在本 job 上把「本段」错写成了合并句。 |
| NMT 输入 | `NMT INPUT` 的 **text** | 是否与 segmentForJobResult 一致且过长/重复前文。若一致且过长，问题在聚合；若不一致（例如 text 更长），需查翻译步骤是否误用了 aggregatedText 或 repairedText。 |
| NMT 输出 | `translatedTextPreview` | 是否出现大段重复、多句连在一起，与「本段」不对应。 |

**结论**：  
- 若 **segmentForJobResult** 在 Job13+ 变成合并长句 → 问题在 TextForwardMergeManager 或 AggregationStage 的 segmentForCurrentJob/segmentForJobResult 赋值（例如 SEND 时误用 processedText 当本段）。  
- 若 segmentForJobResult 正确但 NMT 输入 text 是合并句 → 问题在翻译步骤或 TaskRouter 传参（应只传 segmentForJobResult）。

---

## 3. 字段对应关系（便于对照日志）

| 环节     | 输入 | 输出 / 送下游 |
|----------|------|----------------|
| ASR      | 音频 | **asrText**（本 job 识别结果） |
| 聚合     | asrText | **aggregatedText**（送语义修复，可能为合并长句）；**segmentForJobResult**（送 NMT 与 text_asr，应为「本段」） |
| 语义修复 | aggregatedText | **repairedText**（送去重） |
| 去重     | repairedText | shouldSend |
| 翻译     | **segmentForJobResult**（仅本段） | **translatedText** |
| ResultBuilder | segmentForJobResult → **text_asr**；translatedText → **text_translated** | JobResult |

**关键**：  
- 客户端看到的「原文 (ASR)」= 各 job 的 **text_asr** = 节点端 **segmentForJobResult**。  
- 客户端看到的「译文 (NMT)」= 各 job 的 **text_translated** = 节点端 **translatedText**。  
- 若某 job 的 segmentForJobResult 是合并句或边界错，则原文与译文都会错；若 segmentForJobResult 正确但 translatedText 错，则问题在 NMT 或 TTS 之后。

---

## 4. 小结

1. **先跑脚本**：用本次测试的 `electron-main.log` 跑 `analyze_jobs_per_service_flow.ps1 -LogPath "…"`，按 job 看 ASR、聚合（aggregatedText + **segmentForJobResult**）、NMT 输入/输出、TTS。  
2. **Job1/2**：重点看 segmentForJobResult 与 NMT 输入的边界是否仅为「本段」、有无互相串句；若边界对而译文反，再查 NMT。  
3. **Job6**：看 asrText 与 segmentForJobResult 是否都缺句首，或仅 segmentForJobResult 缺（则问题在聚合）。  
4. **Job7**：看 NMT 输入的 text 与 contextTextLength；若正常仍有分隔符，查 NMT 服务。  
5. **Job13+**：看 segmentForJobResult 是否变成合并长句；若是，修 TextForwardMergeManager/AggregationStage 的「本段」赋值。

日志路径（当前逻辑）：**electron_node/electron-node/logs/electron-main.log**（启动时控制台会打印 `[Logger] Log file path: ...`，以该输出为准）。
