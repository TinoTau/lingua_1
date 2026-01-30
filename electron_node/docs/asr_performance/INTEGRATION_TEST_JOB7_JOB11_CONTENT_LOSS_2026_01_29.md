# 集成测试：Job7 译文丢失开头、Job11 原文与译文均丢失前半句（2026-01-29）

## 1. 测试概况

**阅读文本**（完整）：  
「现在我们开始进行一次语音识别稳定性测试。我会先读一两句比较短的话，用来确认系统不会在句子之间随意地把语音切断，或者在没有必要的时候提前结束本次识别。接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断，从而导致前半句和后半句在节点端被拆成两个不同的 job，甚至出现语义上不完整、读起来前后不连贯的情况。如果这次的长句能够被完整地识别出来，而且不会出现半句话被提前发送或者直接丢失的现象，那就说明我们当前的切分策略和超时规则是基本可用的。否则，我们还需要继续分析日志，找出到底是在哪一个环节把我的语音吃掉了。」

**客户端展示的原文 (ASR)**（按 utterance_index）：  
- [0] 開始進行一次語音識別穩定性測試  
- [1] 我會先多一兩句比較短的話…（截断）  
- [2] 要必要的時候提前結束本詞識別。  
- [6] 這句我會盡量連續地說的長一些…（截断）  
- [7] 10秒鐘之後…（截断）  
- [8] 且判據和後半據…（截断）  
- [11] 當天的簽分策略和超市規則是基本可用的  
- [12] 我們還需要繼續拆分日治找出到底是哪一個環節把我的語音給吃掉了?

**现象摘要**：  
- **Job7**：原文开头部分在译文中**完全丢失**（客户端 [7] 译文未见对应「10秒鐘之後」之前的整句前半部分）。  
- **Job11**：**原文和译文都丢失了前半句话**（客户端 [11] 仅显示「當天的簽分策略和超市規則是基本可用的」，缺「如果这次的长句能够被完整地识别出来…那就说明我们当前的」；译文同理）。

---

## 2. 如何用节点端日志检查各 Job 在各服务中的输入/输出

### 2.1 日志文件位置

- **默认路径**：`electron_node/electron-node/logs/electron-main.log`  
- 启动节点时控制台会打印 `[Logger] Log file path: ...`，以该输出为准。

### 2.2 运行分析脚本（推荐）

在 **electron_node** 目录下执行（请用本次测试产生的 log 路径）：

```powershell
.\scripts\analyze_jobs_per_service_flow.ps1 -LogPath "electron_node\electron-node\logs\electron-main.log"
# 若在 electron-node 下执行：
.\scripts\analyze_jobs_per_service_flow.ps1
```

脚本会按 **utterance_index** 排序列出每个 job，并输出：

- **[ASR] 输出**：本 job 的 asrText 预览  
- **[聚合] segmentForJobResult**：送 NMT 与 text_asr 的「本段」预览；**shouldSendToSemanticRepair**  
- **[语义修复]**：是否执行、repairedText 预览  
- **[NMT 输入] text**：送 NMT 的原文（应等于 segmentForJobResult）  
- **[NMT 输出] translatedTextPreview**：NMT 返回的译文预览  
- **[TTS]**：是否有音频  

**字段含义**：  
- 客户端「原文 (ASR)」= 各 job 的 **text_asr** = 节点端 **segmentForJobResult**。  
- 客户端「译文 (NMT)」= 各 job 的 **text_translated** = 节点端 **translatedText**。

---

## 3. Job7：译文丢失开头——在日志里查什么

**目的**：确认是「本段」在节点端就缺前半（segmentForJobResult/NMT 输入缺），还是 NMT 输入完整但 NMT 返回时丢了前半。

| 步骤 | 日志关键字 / 字段 | 看什么 |
|------|-------------------|--------|
| **ASR** | `asrText` / `ASR batch.*completed` | Job7 的 asrText 是否包含整句（含「看看在超过十秒钟之后」之前的部分）。若 ASR 就只给了后半句，则问题在上游切分/静音判定。 |
| **聚合** | `segmentForJobResultPreview` / `segmentForJobResult` | **segmentForJobResult** 是否与 asrText 一致、是否缺句首。若 asrText 完整但 segmentForJobResult 缺前半，则问题在聚合/TextForwardMergeManager 的「本段」划分。 |
| **NMT 输入** | `NMT INPUT: Sending NMT request` 的 **text** / **textPreview** | 送 NMT 的原文是否与 segmentForJobResult 一致；是否缺前半句。若 NMT 输入就缺前半，则译文丢失开头是必然，需修聚合/本段划分。 |
| **NMT 输出** | `NMT OUTPUT` / `translatedTextPreview` | 若 NMT 输入完整但 translatedText 缺前半，则问题在 NMT 服务（长句截断、哨兵提取、返回格式等）。 |

**结论指引**：  
- **segmentForJobResult** 或 **NMT 输入 text** 就缺前半 → 修节点端聚合/本段划分或上游 ASR 切分。  
- NMT 输入完整但 **translatedText** 缺前半 → 查 NMT 服务（nmt_m2m100：长句处理、哨兵、FULL_ONLY 兜底等）。

---

## 4. Job11：原文与译文都丢失前半句——在日志里查什么

**目的**：确认是 ASR/聚合导致「本段」只有后半句，还是多 job 乱序/合并导致 Job11 对应的本段被错误地截成后半句。

| 步骤 | 日志关键字 / 字段 | 看什么 |
|------|-------------------|--------|
| **ASR** | `asrText` / `ASR completed` | Job11 的 asrText 是否仅为「當天的簽分策略和超市規則是基本可用的」、没有「如果这次的长句…那就说明我们当前的」。若 ASR 就只给了后半句，则问题在上游切分或该 job 对应的音频/流被截断。 |
| **聚合** | `segmentForJobResultPreview` / `segmentForJobResult` | **segmentForJobResult** 是否与 asrText 一致。若 asrText 有前半但 segmentForJobResult 被截成只有后半，则问题在聚合或 TextForwardMergeManager（例如本段被错误地当成「后半段」发送）。 |
| **NMT 输入** | `NMT INPUT` 的 **text** | 是否与 segmentForJobResult 一致。若一致且都缺前半，则译文缺前半是必然；根因在 ASR/聚合给出的「本段」就缺前半。 |
| **Job 顺序** | `utterance_index` / `job_assign` | 该 session 下 Job10 与 Job11 的先后顺序、是否出现 Job10 未完成就发 Job11 或合并错误，导致 Job11 的本段被划错。 |

**结论指引**：  
- **asrText** 就缺前半 → 上游音频切分/静音判定/超时把一句拆成两 job，或本 job 对应的音频只包含后半句。  
- **asrText** 完整但 **segmentForJobResult** 缺前半 → 聚合/ForwardMerge 的「本段」划分错误（例如 SEND 时 segmentForCurrentJob 只带了后半）。  
- Job11 的 **segmentForJobResult** 与 **NMT 输入** 一致且都缺前半 → 客户端原文与译文都缺前半是同一根因：节点端「本段」就只有后半句。

---

## 5. 建议排查顺序

1. **跑脚本**：用本次测试的 `electron-main.log` 跑 `analyze_jobs_per_service_flow.ps1`，对 Job7、Job11 重点看：  
   - [ASR] 输出、[聚合] segmentForJobResult、[NMT 输入] text、[NMT 输出] translatedTextPreview。  
2. **Job7**：先对比 Job7 的 segmentForJobResult 与 NMT 输入是否一致、是否已缺前半；再看 NMT 输出是否比输入更短（丢前半）。  
3. **Job11**：先看 Job11 的 asrText 是否就缺前半；再看 segmentForJobResult 是否与 asrText 一致；若一致且都缺前半，则原文/译文缺前半同源，需查上游切分或聚合本段划分。  
4. **NMT 服务**：若多 job 均出现「输入完整、译文缺前半」，再查 NMT 服务（长句、哨兵、FULL_ONLY_LAST_SEGMENT 等），参见 `docs/asr_performance/NMT_EMPTY_RETURN_CAUSE_AND_FIX_2026_01_29.md`。

---

## 6. 相关文档

- **各 Job 流程检查**：`INTEGRATION_TEST_JOB_FLOW_CHECK_2026_01_29.md`  
- **Job7 长译文/Job8 边界**：`JOB7_LONG_TRANSLATION_AND_JOB8_BOUNDARY_2026_01_29.md`  
- **Job 上下文与字段**：`JOB_CONTEXT_FIELDS_AND_FLOW_2026_01_29.md`  
- **NMT 空返回与修复**：`NMT_EMPTY_RETURN_CAUSE_AND_FIX_2026_01_29.md`
