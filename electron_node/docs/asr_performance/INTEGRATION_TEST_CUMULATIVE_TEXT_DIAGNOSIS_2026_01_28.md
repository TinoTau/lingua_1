# 集成测试「所有 job 被合并 / 逐条累积显示」诊断（2026-01-28）

**现象**：朗读长段话后，客户端显示多条「原文 (ASR)」，每条带 `[音频丢失]` 前缀，且内容呈**累积**（[0] 最短，[15] 为整段）。用户问：是否每个 job 在各服务里被合并？是否与近期架构调整有关？

**结论概要**：
1. **「[音频丢失]」** 来自 **Web 客户端**：当 `message.tts_audio` 为空时在展示时加此前缀，与节点是否发送 TTS 无关。
2. **当前节点架构**：一次 flush 只发 **一条「主结果」**（整段 ASR 文本）+ **多条空容器核销**（`NO_TEXT_ASSIGNED`，无 TTS）。不会按 originalJobId 发「多条带累积文本」的 job_result。
3. **若客户端出现 [0]～[15] 每条都有累积文本**，则要么 (a) 调度/其它组件把一条结果拆成多条下发，要么 (b) 节点在其它路径发了多条带文本的 job_result。需用节点端日志按下面步骤确认。

---

## 1. 「[音频丢失]」来源（非节点逻辑）

- **位置**：`webapp/web-client/src/app.ts`，处理 `translation_result` 时：
  - `hasAudio = message.tts_audio && message.tts_audio.length > 0`
  - `audioLossMark = hasAudio ? '' : '[音频丢失] '`
  - 展示时在原文/译文前加 `audioLossMark`。
- **含义**：仅表示「该条消息没有 TTS 音频」。空容器核销（`NO_TEXT_ASSIGNED`）本身就不带 TTS，因此会全部显示为「[音频丢失]」；与「音频在节点或 ASR 丢失」无直接对应关系。

---

## 2. 当前节点端：一 flush 对应一条主结果 + 多条空核销

### 2.1 流程简述

- 调度按会话下发多个 **job**（如 job 0, 1, 2, … 15，每个带 `utterance_index`）。
- 节点 **AudioAggregator** 按会话缓冲，在「手动截断 / 超时 finalize / 达到 10s 等」时 **flush**：
  - 将当前 buffer 聚合并按能量切分为多个 **audioSegments**；
  - 一次只对 **当前触发 flush 的 job** 跑整条 pipeline（ASR → 聚合 → 语义修复 → NMT → TTS）；
  - 该 job 的 `ctx.asrText` = 本 flush 内**所有 segment 的 ASR 按序拼接**（整段），不是「按 utterance_index 的逐段累积」。
- **buildResultsToSend** 只产生：
  - **一条主结果**：`job` + `processResult.finalResult`（含整段 `text_asr`、若有则 TTS）；
  - **若干空容器核销**：来自 `finalResult.extra.pendingEmptyJobs`，每项一条 `NO_TEXT_ASSIGNED`，`text_asr` 为空、无 TTS。
- 因此：**节点只会发 1 条「带整段 ASR 文本」的 job_result + N 条空核销**，不会按 originalJobId 发「多条带累积文本」的 job_result。

### 2.2 与「近期架构调整」的关系

- 单容器、单发送点、`buildResultsToSend` 只组「主结果 + pendingEmptyJobs」空核销，**没有**「按 originalJobIds 拆成多条、每条带累积 text_asr」的逻辑。
- 若之前有「按 originalJobId 发多条累积结果」的行为，那是**旧路径（如 Dispatcher/merge）**；当前架构下已不存在该路径。
- 因此：**当前节点设计下，不会主动产生「多条不同 utterance_index、每条累积文本」的 job_result**。若客户端看到 [0]～[15] 每条都有递增的累积文本，需要到调度或其它环节找「多条结果 / 拆分逻辑」。

---

## 3. 客户端展示方式（有助于理解现象）

- **位置**：`webapp/web-client/src/app/translation_display.ts`
- **逻辑**：按 `utterance_index` 存 `translationResults`；展示时在**同一块原文/译文区域**里**追加**，格式为 `[utterance_index] 对应文本`。
- 因此：
  - 每收到一条 **translation_result**，就会在现有内容后追加 `\n\n[ utterance_index ] 文本`。
  - 若调度/上游给客户端发了**多条** translation_result（例如多条 job_result 被转成多条 translation_result），且每条带**不同**的 `utterance_index` 和**不同长度**的 `text_asr`，就会呈现 [0] 短、[1] 更长、…、[15] 整段的「累积」效果。
- 关键问题：**这些多条、带不同 utterance_index 和不同 text 的消息，是从节点发出的多条 job_result，还是调度把一条 job_result 拆成多条？** 需用节点日志确认「节点实际发了几条 job_result、每条 job_id/utterance_index 和 text_asr 长度」。

---

## 4. 建议的节点端日志排查步骤

在节点上抓一次与本次集成测试同场景的日志（同一段长话、同一会话），按下面要点查。

### 4.1 每个 job 的入口与是否发结果

- 搜索：`Received job_assign` 或 `Received job_assign, processing`（或你当前用的 job 接收日志）。
- **看什么**：一共收到多少个 job（job_id / utterance_index），顺序是否大致为 0, 1, 2, … 或 0, 1, 2, 10, 11, …（与你看到的 [0][1][2][10]… 对应）。

### 4.2 每个 job 在 pipeline 内的输入/输出

- **ASR 入口**：`runAsrStep: [ASRService] Calling ASR service for batch` 或等价日志。
  - 记录：`job_id`、`utterance_index`、`segmentIndex`、`totalSegments`、`audioSizeBytes` / `audioDurationMs`。
- **ASR 出口**：`runAsrStep: [ASRService] ASR batch ... completed` 或等价。
  - 记录：`asrTextLength`、`asrTextPreview`（或前 50 字）。
- **结果构建**：若有 `buildJobResult` / 最终 `JobResult` 的日志，看 `text_asr` 长度或前 50 字。
- **目的**：确认「每个 job」对应的是「仅本 job 的 segment」还是「整段缓冲」；以及最终发出去的 `text_asr` 是「单段」还是「整段」。

### 4.3 实际发送的 job_result 条数与内容

- 搜索：`Sending job_result to scheduler` 或 `sendJobResult` 成功发送的日志（或 ResultSender 里等价日志）。
- **看什么**：
  - 一共几条发送？
  - 每条对应的 `job_id`、`utterance_index`、`text_asr` 长度（或前 50 字）、是否有 TTS（或 `extra.reason` 是否为 `NO_TEXT_ASSIGNED`）。
- **预期（当前架构）**：一次长段话 flush 后，应主要为 **1 条带长 text_asr（+ 可能有 TTS）+ 若干条 NO_TEXT_ASSIGNED（空 text、无 TTS）**。若看到**多条**都带非空且长度递增的 `text_asr`，则说明存在我们上面未考虑的另一条发送路径或调度侧拆分。

### 4.4 若节点确实只发 1 条主结果 + 空核销

- 则「[0]～[15] 每条都有累积文本」一定来自**调度或中间层**（例如把一条 job_result 按 originalJobIds 拆成多条 translation_result、并给每条填了累积文本）。
- 下一步应在 **central_server / 调度** 中查：
  - 收到节点的一条 job_result 后，如何生成发往客户端的 translation_result？
  - 是否有按 `original_job_ids` / `utterance_index` 列表做「拆分」或「复制」并改写 `text_asr`？

---

## 5. 小结与下一步

| 问题 | 结论/建议 |
|------|-----------|
| 「[音频丢失]」从哪来？ | Web 客户端在无 TTS 时加的前缀；空核销本身无 TTS，会全部标成 [音频丢失]。 |
| 是否所有 job 在节点被「合并」成一条？ | 是：当前设计下，一次 flush 只对**一个** job 跑 pipeline，得到**一条**主结果（整段 ASR）+ 多条空核销。 |
| 为何客户端看到 [0]～[15] 逐条累积？ | 要么节点在未知路径发了多条带累积 text 的 job_result，要么调度把一条结果拆成多条并填了累积文本；需节点日志确认发送条数及每条内容。 |
| 是否架构调整导致？ | 当前单容器/单发送点架构**没有**「按 originalJobId 发多条累积结果」的逻辑；若以前有该行为，是旧路径。当前现象更可能是调度/客户端侧或未覆盖到的发送路径。 |

**建议操作顺序**：  
1）按 4.1～4.3 抓节点日志，确认「每个 job 的处理」和「实际发出的 job_result 条数及内容」。  
2）若节点确认为 1 条主结果 + 空核销，再到调度/central_server 查 translation_result 的生成与转发逻辑。

---

**文档版本**：2026-01-28
