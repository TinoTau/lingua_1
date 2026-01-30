# 所有 Job 文本累积：根因诊断与日志检查（2026-01-29）

## 1. 现象

集成测试中，每个 job 的**原文 (ASR)** 和**译文 (NMT)** 均呈**累积**状态：

- `[0]`：较短
- `[1]`：包含 [0] 的内容 + 本句
- `[2]`：包含 [0]+[1] 的内容 + 本句
- …  
- `[9]`：包含 [0]～[8] 的全文 + 本句

即：**每个 job 的 `text_asr` / `text_translated` 都是「从会话开始到当前」的整段内容**，而不是「仅本句」。

---

## 2. 数据流（节点端）

```
job.audio (base64) → 解码 → 音频聚合/切分 → ASR(每段) → ctx.asrText（多段时会被拼接）
    → 聚合步骤 → aggregatedText / segmentForJobResult
    → 语义修复(读 aggregatedText) → ctx.repairedText
    → 翻译(读 repairedText) → ctx.translatedText
    → ResultBuilder(读 repairedText / translatedText) → job_result.text_asr / text_translated
```

要点：

- **ctx 按 job 独立**：每次 `runJobPipeline` 使用 `initJobContext(job)` 或新 ctx，不会复用上一 job 的 ctx。
- 若**每个 job** 的 `asrText`/`repairedText` 都变长、且包含前文，则**该 job 的输入（音频或 ASR 输出）必定已是累积的**。

---

## 3. 根因分析：输入何时会「累积」？

### 3.1 节点 ASR 步骤：多段拼接

- `asr-step.ts` 中，若 `audioSegments.length > 1`，会对**本 job** 内各段的 ASR 结果做拼接：
  - `ctx.asrText = asr(seg0) + ' ' + asr(seg1) + ...`
- 这只影响**同一个 job** 内多段音频的合并，不会让 **job 0、job 1、job 2…** 之间出现「越往后越长」的累积。
- 因此：**「每个 job 都变长」的累积，不能仅由 ASR 多段拼接解释**，必须有一层在 **job 维度** 给出累积输入。

### 3.2 每个 job 的输入 = job.audio 解码后的内容

- 节点端：`ctx.asrText` 完全来自**本 job** 的 ASR；ASR 的输入 = **本 job** 的音频（来自 `processAudio(job)` → `decodeAudioChunk(job)` → `job.audio`）。
- 因此：  
  **若 job 0、1、2… 的 ASR 结果依次变长且包含前文，则对应 job 的 `job.audio`（解码后）必定是「从会话开始到当前」的累积音频**。  
  即：**每个 job 携带的是「累积音频」而不是「本句增量音频」**。

### 3.3 调度端：job 的音频从哪来？

两种路径：

| 路径 | 音频来源 | 是否可能累积 |
|------|----------|--------------|
| **Finalize**（手动/超时/MaxDuration） | `audio_buffer.take_combined(session_id, utterance_index)` | **否**。buffer 按 `(session_id, utterance_index)` 隔离，`take_combined` 只取**该 utterance_index** 的缓冲并清空，即**本句增量**。 |
| **Utterance 消息**（直接发整句） | 消息体里的 `audio` 字段（客户端随 Utterance 一起发） | **可能**。若客户端在「Utterance N」里带的是「从 0 到 N 的整段音频」，则每个 job 都会收到累积音频。 |

结论：

- **Finalize 路径**：调度端按 utterance 隔离 buffer，给到节点的应是**本句增量**，不会自然形成「每 job 累积」。
- **Utterance 路径**：若客户端在每条 Utterance 消息里带的是**累积音频**，就会导致「每个 job 文本累积」；修复点应在**客户端**：保证每条 Utterance 的 `audio` 仅为**本句对应的一段音频**（增量）。

---

## 4. 日志检查（确认是否「输入即累积」）

### 4.1 节点端建议看的日志

1. **每个 job 的「输入音频」体量**  
   - 若需排查，可在 `audio-aggregator.ts` 解码后打一条日志：`jobId`、`utteranceIndex`、`decodedAudioBytes`。  
   - 若 **utterance_index 0,1,2,… 对应的 decodedAudioBytes 单调递增**，即可判断：**该 job 收到的是累积音频**。

2. **每个 job 的 ASR 输出长度**  
   - 已有：`runAsrStep: ASR completed` 含 `asrTextLength`。  
   - 若 **同一 session 下，utterance_index 越大 asrTextLength 越大且 asrText 前缀与前 job 一致**，可判断 ASR 输入（即音频）为累积。

3. **聚合 / 语义修复 / 翻译**  
   - 见现有文档：`INTEGRATION_TEST_LOG_CHECK_AND_CUMULATIVE_ISSUE_2026_01_29.md` 中的「按 job 过滤」「按阶段快速定位」。  
   - 重点：每个 job 的 `aggregatedTextLength`、`repairedText` 长度、`text_translated` 长度是否随 utterance_index 单调增且内容包含前文。

### 4.2 客户端/调度端建议确认的点

- **若使用「Utterance 消息」创建 job**：  
  每条 Utterance 的 `audio` 应仅为**本句**的音频（从「本句开始」到「本句结束」），**不要**把「从会话开始到当前」的整段音频都塞进每条 Utterance。
- **若使用「Finalize」**：  
  调度端已按 `(session_id, utterance_index)` 隔离 buffer，理论上给节点的是本句增量；若仍出现累积，需再确认：  
  - 客户端是否在发送 `audio_chunk` 时**正确带了 utterance_index**；  
  - 是否在某处把「整段会话音频」误当成「当前 utterance」的 buffer 写入。

---

## 5. 小结与修复方向

| 现象 | 最可能根因 | 修复方向 |
|------|------------|----------|
| 每个 job 的 ASR/译文都是「从开头到当前」的整段 | **每个 job 收到的音频是累积的** | 1）**Utterance 路径**：客户端保证每条 Utterance 的 `audio` 仅为**本句增量**；<br>2）**Finalize 路径**：确认 `audio_chunk` 的 utterance_index 与 buffer 使用一致，且未误用「整段会话音频」。 |
| 仅个别 job 的译文/音频异常变长 | 可能是 NMT/TTS 用了「整句」而非「本段」等实现问题 | 见 `INTEGRATION_TEST_LOG_CHECK_AND_CUMULATIVE_ISSUE_2026_01_29.md` 的「修复方向」。 |

若需排查，可在节点端临时打每个 job 的「解码后音频字节数」与「asrText 长度」，判断输入是否随 utterance_index 单调增长，从而区分是**音频层累积**还是下游逻辑问题。
