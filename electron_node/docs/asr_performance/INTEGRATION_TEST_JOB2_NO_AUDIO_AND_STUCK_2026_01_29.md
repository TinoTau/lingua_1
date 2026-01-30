# 集成测试：Job2 起无音频、之后无返回 — 节点端日志检查指南

**日期**：2026-01-29  
**现象**：朗读长段话后，客户端显示 [0][1] 有原文+译文，[2] 原文为「[音频丢失]」且无译文，之后无任何返回。  
**目的**：在节点端日志中按 job 查各步骤的输入/输出，定位从 job2 起「无音频」、之后「无返回」卡在哪个环节。

---

## 1. 你本次测试的结果摘要

| 序号 | 原文 (ASR) | 译文 (NMT) | 说明 |
|------|------------|------------|------|
| [0] | 我们开始进行一次语音时别稳定性测试 | 有 | 正常 |
| [1] | 我会先读一 一两句比较短的话…（长句前半） | 有 | 正常 |
| [2] | [音频丢失] 必要的时候提前结束本次识别 | 无 | **从本 job 起无音频** |
| [3]+ | （无） | （无） | **之后没有任何返回** |

- **「[音频丢失]」**：Web 端在 **tts_audio 为空** 时加的前缀，不代表节点「丢了音频」，只表示这条结果没有 TTS 音频。
- 要区分的是：**节点是否发了 job2 的结果但 tts 为空**，还是 **job2 根本没发 / 发了空核销**；**job3+ 是没到节点、没跑完流水线，还是发了但被过滤**。

---

## 2. 日志文件与按 Job 过滤

- **日志路径**：`electron_node/electron-node/logs/electron-main.log`（或你运行节点时工作目录下的 `logs/electron-main.log`）。
- **按 job 查**：日志里用 `jobId` 或 `job_id` 标识 job，建议先找到本次测试的 **session_id**，再对每个 **job_id** 搜一遍，按时间顺序看该 job 在各步骤的日志。

### 2.1 推荐：用现有脚本做「按 job → 各服务」汇总

在 **electron_node** 目录下执行（可指定本次测试的 log 路径）：

```powershell
.\scripts\analyze_jobs_per_service_flow.ps1
# 或指定日志路径
.\scripts\analyze_jobs_per_service_flow.ps1 -LogPath "D:\你的路径\electron-node\logs\electron-main.log"
# 若只关心某一 session
.\scripts\analyze_jobs_per_service_flow.ps1 -LogPath "..." -SessionId "你的session_id"
```

脚本会按 job 列出：ASR 输出、聚合（aggregatedText / shouldSendToSemanticRepair）、语义修复是否执行、NMT 是否执行及 translatedText 长度、TTS 是否有音频。  
**若某 job 的 NMT 译文为空或 TTS 无音频，客户端就会显示 [音频丢失]。**

---

## 3. 各步骤在日志中的「输入/输出」关键字

下面按**流水线顺序**列出每个步骤在日志里最容易识别的关键字，便于你手动搜「某个 job_id」时对照。

### 3.1 音频层（ASR 之前）

| 步骤 | 日志消息（搜这些） | 输入/输出含义 |
|------|--------------------|----------------|
| 音频聚合 | `PipelineOrchestrator: Audio chunk buffered, waiting for more chunks` | **输入**：当前 job 的音频块。**输出**：本 job 被判定为「缓冲」，不送 ASR，直接返回空。 |
| 同上 | `PipelineOrchestrator: No audio segments returned from aggregator` | 聚合器没有返回任何音频段 → 本 job 无音频送 ASR。 |
| 同上 | `PipelineOrchestrator: Audio processed with streaming split, proceeding to ASR` | 有音频段，继续 ASR。 |
| ASR 步骤 | `runAsrStep: Audio buffered, returning empty` | 上一步 `shouldReturnEmpty=true`，本 job 未做 ASR，ctx 置 `audioBuffered`，后续会走空核销或不下发。 |
| ASR 步骤 | `runAsrStep: Empty containers recorded in ctx` | 本 job 属于「空容器」（无 segment 分配），仅核销，无真实 ASR 文本。 |

若 **job2** 出现 `Audio chunk buffered` 或 `Audio buffered, returning empty` 或 `Empty containers recorded`，则 job2 在节点端就没有真实 ASR 输出，自然也没有 NMT/TTS，客户端会显示无译文、[音频丢失]。

### 3.2 ASR

| 步骤 | 日志消息 | 输入/输出含义 |
|------|----------|----------------|
| ASR | `runAsrStep: [ASRService] Calling ASR service for batch 1/1`（或 1/N） | **输入**：本 job 的音频段。**输出**：见下一行。 |
| ASR | `runAsrStep: [ASRService] ASR batch 1/1 completed` | 本 batch 识别完成，会写入 `ctx.asrText` 等。 |
| ASR | `runAsrStep: ASR completed` | 本 job 所有 batch 完成，含 asrTextLength。 |
| ASR | `runAsrStep: ASR result is empty or meaningless, skipping` | ASR 结果为空或无意义，后续不送语义修复/NMT。 |

### 3.3 聚合

| 步骤 | 日志消息 | 输入/输出含义 |
|------|----------|----------------|
| 聚合 | `runAggregationStep: Aggregation completed` | **输入**：ctx.asrText。**输出**：aggregatedText、segmentForJobResult、**shouldSendToSemanticRepair**。 |
| 聚合 | `AggregationStage: Processing completed with forward merge` | 含 aggregatedTextPreview、segmentForJobResultPreview、**shouldSendToSemanticRepair**。 |

若 **shouldSendToSemanticRepair** 为 **false**，本 job 不会走语义修复和 NMT/TTS，最终无译文、无 TTS → 客户端 [音频丢失]。

### 3.4 语义修复

| 步骤 | 日志消息 | 输入/输出含义 |
|------|----------|----------------|
| 语义修复 | `runSemanticRepairStep: Semantic repair completed` | **输入**：ctx.aggregatedText。**输出**：repairedText、decision。 |
| 语义修复 | `Skipping step SEMANTIC_REPAIR (condition not met)` | 上一步未设 shouldSendToSemanticRepair=true，跳过。 |

### 3.5 去重

| 步骤 | 日志消息 | 输入/输出含义 |
|------|----------|----------------|
| 去重 | `runDedupStep: Deduplication check completed` | **输入**：ctx.repairedText、ctx.translatedText。**输出**：shouldSend、dedupReason。 |

若 **shouldSend=false**，本 job 结果不会发送，客户端不会收到这条（或收到被过滤的占位）。

### 3.6 翻译（NMT）

| 步骤 | 日志消息 | 输入/输出含义 |
|------|----------|----------------|
| 翻译 | `runTranslationStep: Translation completed` | **输入**：ctx.segmentForJobResult（本段）。**输出**：ctx.translatedText。 |
| 翻译 | `runTranslationStep: Translation failed` | NMT 调用失败，translatedText 置空 → 无 TTS → [音频丢失]。 |
| 翻译 | （无 Translation completed 且本 job 应走 NMT） | 可能被跳过（shouldSendToSemanticRepair=false）或报错未打到这里。 |

### 3.7 TTS

| 步骤 | 日志消息 | 输入/输出含义 |
|------|----------|----------------|
| TTS | `runTtsStep: TTS completed` 或 `runYourTtsStep: YourTTS voice cloning completed` | **输入**：ctx.translatedText。**输出**：ctx.ttsAudio。 |
| TTS | `runTtsStep: TTS failed` | 无 tts 音频 → 客户端 [音频丢失]。 |

### 3.8 结果发送

| 步骤 | 日志消息 | 含义 |
|------|----------|------|
| 发送 | `NodeAgent: Audio buffered, skipping job_result send` | 本 job 为「音频缓冲」或空容器，**不发送** job_result。 |
| 发送 | `NodeAgent: Job filtered by JobPipeline, skipping job_result send` | 去重等逻辑决定不发送。 |
| 发送 | `Job processing completed successfully`（或 sendJobResult 相关 info） | 含 textAsrLength、textTranslatedLength、ttsAudioLength；若 ttsAudioLength 为 0，客户端会显示 [音频丢失]。 |

---

## 4. 针对「Job2 无音频、之后无返回」的排查顺序

### 4.1 Job2：为何无音频？

按 **job2 的 job_id** 在日志里搜，建议顺序：

1. **是否根本没做 ASR？**  
   搜：`job2的job_id` + `Audio chunk buffered` / `Audio buffered, returning empty` / `Empty containers recorded`。  
   - 若有 → job2 在节点端就是「缓冲」或「空容器」，无 ASR 无 NMT 无 TTS；客户端收到的是空核销或占位，显示 [音频丢失] 正常。

2. **是否做了 ASR 但没送语义修复？**  
   搜：`job2的job_id` + `runAggregationStep: Aggregation completed` 或 `AggregationStage: Processing completed`，看 **shouldSendToSemanticRepair**。  
   - 若为 false → 本 job 故意不走 NMT/TTS（例如 HOLD/丢弃），无译文无 TTS → [音频丢失]。

3. **是否送了 NMT 但译文为空？**  
   搜：`job2的job_id` + `runTranslationStep: Translation completed` 或 `Translation failed`。  
   - 若 Translation failed 或 translatedTextLength 为 0 → 无 TTS → [音频丢失]。

4. **是否发了 result 但 tts 为空？**  
   搜：`job2的job_id` + `Job processing completed successfully` 或 `sendJobResult`，看 **ttsAudioLength**。  
   - 若为 0 → 客户端显示 [音频丢失]。

5. **是否被过滤未发送？**  
   搜：`job2的job_id` + `Audio buffered, skipping job_result send` 或 `Job filtered by JobPipeline, skipping job_result send`。  
   - 若有 → 节点没发这条 result，前端显示可能来自调度/前端的占位。

结论：**job2 在节点端要么「无 ASR/空容器/缓冲」、要么「未送语义修复」、要么「NMT 失败/译文为空」、要么「未发送或被过滤」**，任一种都会导致无音频/无译文。

### 4.2 Job3+：为何完全没有返回？

可能情况：

1. **后续 job 根本没到节点**  
   - 调度/Web 未再下发 job3、job4…；或连接断开。  
   - 在节点日志里搜 **job3、job4 的 job_id**，若完全没有任何 `runAsrStep` / `Executing pipeline step`，说明这些 job 未在节点执行。

2. **节点卡在某个步骤**  
   - 若 job2 之后还有 job3 的日志，但 job3 只有 `runAsrStep` 或 `runAggregationStep`，没有后续 `runTranslationStep` / `runTtsStep` / `sendJobResult`，说明流水线在 job3 的某一阶段卡住（例如 NMT/语义修复/网络长时间未返回）。  
   - 同时看是否有 **Step XXX failed** 或 **Translation failed** 等错误。

3. **后续 job 全部被判定为「缓冲」或「空容器」**  
   - 每个 job 都出现 `Audio chunk buffered` 或 `Audio buffered, returning empty`，则不会产生可发送的 result，客户端就「没有任何返回」。

4. **WebSocket 断开或发送失败**  
   - 搜 `Cannot send result: WebSocket not ready` 或发送错误，若在 job2 之后出现，可能导致后续 result 都发不出去。

建议：对 **job2、job3、job4** 各搜一次其 **job_id**，看每条 job 是否出现：  
`Executing pipeline step` → `runAsrStep` → `runAggregationStep` → … → `runTranslationStep` → `runTtsStep` → `Job processing completed successfully`（或 skip 原因）。  
**哪一步之后再也没有后续步骤的日志，卡住就在哪一步。**

---

## 5. 小结：你这边要做的操作

1. **跑脚本**（推荐）：  
   `.\scripts\analyze_jobs_per_service_flow.ps1 -LogPath "本次测试的 electron-main.log 路径"`  
   看每个 job 的 ASR / 聚合 / 语义修复 / NMT / TTS 是否执行、译文和 TTS 是否有长度。

2. **针对 job2**：  
   在日志里搜 job2 的 job_id，按 4.1 顺序确认：是「无 ASR/缓冲/空容器」还是「未送语义修复」还是「NMT 失败/译文空」还是「未发送/被过滤」。

3. **针对 job3+ 无返回**：  
   在日志里搜 job3、job4 的 job_id，看是否有任意步骤日志：  
   - 完全没有 → job 未到节点或 session 已变。  
   - 有 ASR/聚合但没有翻译/TTS/发送 → 卡在中间某步（或该 job 被 HOLD/过滤）。  
   - 有 `WebSocket not ready` 或发送错误 → 连接或发送问题。

把上述脚本输出（或按 job 截取的关键日志）贴出来，可以进一步判断是**音频聚合策略**、**门控（HOLD）**、**NMT 超时/失败**，还是**连接/发送**导致的现象。
