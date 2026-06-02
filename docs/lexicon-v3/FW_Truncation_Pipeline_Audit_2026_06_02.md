# FW 主链截断问题只读审计

> **日期：** 2026-06-02  
> **性质：** 只读事实分析；未改代码、配置或提交 Patch  
> **数据：** `electron_node/electron-node/tests/fw-detector-dialog-200-batch-result.json`（dialog_200，`is_manual_cut=true`，整段 WAV）  
> **范围：** 仅调查「整句参考 vs 半句 ASR」；不涉及词库 / KenLM / Detector / Scheduler

---

## 执行摘要

| 发现 | 数据 / 代码依据 |
|------|----------------|
| dialog_200 中**前缀截断型**样本 | **49 / 200（24.5%）** |
| 截断样本 **100%** 为 `node_audio_segment_count=2` | 能量切分 + 双次 FW 调用 |
| 截断样本 **100%** `fw_vad_segment_count=1` | 每批 ASR 请求内 VAD 合并为 1 段 |
| 截断样本平均 `audio_ms` **~1980** vs 非截断 **~4176** | 落盘诊断来自**首批次** ASR |
| **`rawAsrText` 仅冻结首批次** | `asr-step.ts` 设计；`text_asr` 同源 `segmentForJobResult` |
| 用户所述「皇后镇」句 | **不在** dialog_200 manifest；机制同类 |

**结论（dialog_200）：** 观测到的「截断」**主要不是** Utterance Aggregator 丢段，也**不是**整段 WAV 未送进 FW；而是 **(1) AudioAggregator 在句中停顿处能量切分 → 两次 ASR**，**(2) 业务落盘/批测指标只保留第一批次的 `rawAsrText`**，**(3) 第二批次常无有效文本或未进入指标**。FW 对**单次请求**而言输出与送入音频一致；端到端「半句」来自 **Node 切片 + 文本冻结**。

---

## 第一部分 — FW Truncation Pipeline Report

### 1.1 调用链（dialog_200 批测）

```text
POST /run-pipeline-with-audio  { wavPath, is_manual_cut: true }
  → InferenceService.runPipelineWithAudio
       WAV → Opus → JobAssignMessage（单 job）

runAsrStep
  → AudioAggregator.processAudioChunk
       is_manual_cut → executeFinalizeAndReturn
         aggregateAudioChunks（整段 WAV）
         splitAudioByEnergy(max=5000ms, min=2000ms, hangover=600ms)
         createStreamingBatches → audioSegments[]（本批多为 2 段）

  → for each audioSegments[i]:
       executeFasterWhisperASR → POST /utterance
         Silero VAD 提取语音 → Whisper（vad_filter=false）
       i===0: ctx.rawAsrText = text（冻结，不再更新）
       i>0:  ctx.asrText += text

  → segmentForJobResult = rawAsrText（FW 模式）
runAggregationStep（is_manual_cut → 当轮 finalize）
  → text_asr = resolveBusinessAsrText = segmentForJobResult
```

### 1.2 与实时流式路径

| 环节 | dialog_200 | 实时多 chunk |
|------|------------|--------------|
| 触发 | 整文件 + manual cut | 多 chunk + manual/timeout |
| Utterance Aggregator | 当轮 finalize，不累积半 turn | 非 finalize 时 appendTurnSegment |

---

## 第二部分 — FW Raw Output Report

### 2.1 Node 请求参数（FW 模式）

| 参数 | 值 |
|------|-----|
| `beam_size` | 1 |
| `temperature` | 0 |
| `condition_on_previous_text` | false |
| `use_context_buffer` / `use_text_context` | false（P0） |
| ASR rerun | 关闭（`disableAsrRerun`） |

### 2.2 Python 返回

- `text`：本次 **VAD 后 processed_audio** 的全文  
- `segments[]`：Whisper 段（含 `start/end/words`）  
- `duration`：处理音频秒数  
- `diagnostics.audio_segmentation`：`fw_vad_segment_count`、`audio_ms`、`asr_latency_ms`

Whisper：`vad_filter=False`（前置 Silero 已裁切）。

### 2.3 FW 是否「自己截断」？

**单条 `/utterance`：否**——输出覆盖**本次送入**的音频。若首批只送入 660ms，只能识别前几字。

**例 d061：**

| 项 | 值 |
|----|-----|
| WAV 文件时长 | **5666 ms**（文件头解析） |
| 落盘 `audio_ms` | **660 ms**（首批 diagnostics） |
| `raw_asr_text` | `周末` |
| 参考 | 整句 23 字 |

### 2.4 audio_duration vs last_segment_end

批测 JSON **未导出**各 `segments[].end`，**无法逐条算 gap**（见第八部分）。

---

## 第三部分 — Audio Aggregator Report

### 3.1 行为

1. `is_manual_cut` → 整段 WAV finalize  
2. `splitAudioByEnergy(5000, 2000, 600)`：在**最长停顿**处切分（TTS 逗号/换气常见）  
3. `createStreamingBatches`：约 5s 一批；manual 时尾批也发送  
4. `node_audio_segment_count` = 返回批次数（截断集 **均为 2**）

### 3.2 「10s 录音只送 5s」？

| 问题 | 结论 |
|------|------|
| 尾部丢失 | **表现像丢失**：后半在第二切片；若第二批无文本或未写入 raw，指标只见半句 |
| 句中提前切 | **是**：最长停顿在句中 → 首批仅前半句音频 |
| 两批都调 ASR | **是**；**落盘常只有首批文本** |

| 统计 | 值 |
|------|-----|
| 全量 `nodeSeg=2` | **73** |
| 其中前缀截断 | **49（67%）** |

---

## 第四部分 — VAD Truncation Report

| 问题 | 结论 |
|------|------|
| VAD 启用？ | **是**（Silero，`utterance_audio.prepare_audio_with_context`） |
| 裁尾部？ | 非语音不进入本次 `processed_audio` |
| 句中停顿？ | **风险高**；与「皇后镇」类半句模式一致 |
| 批内段数 | 截断集 **49/49** 为 `fw_vad_segment_count=1` |

配置摘录：`VAD_MIN_SILENCE_DURATION_MS=300`，`VAD_SPEECH_PAD_MS=120`，`refine` 最短语音 250ms。

---

## 第五部分 — Utterance Aggregator Report

dialog_200 使用 `is_manual_cut: true` → **当轮 finalize**，不走半 turn 累积。

| 问题 | 结论 |
|------|------|
| FW 完整、Aggregator 截断 | **未见**（`raw_asr` ≈ `text_asr`，49 条中仅 1 条不同） |
| 只保留第一个 segment | **在 ASR 步**（`rawAsrText` 冻结），非 Aggregator |

---

## 第六部分 — FW Parameter Audit Report

| 参数 | 服务默认 | FW 请求 | 提前结束 |
|------|----------|---------|----------|
| beam_size | 1 | 1 | 低 |
| temperature | 0 | 0 | 低 |
| no_speech_threshold | 0.6 | 默认 | 中 |
| compression_ratio_threshold | 2.4 | 默认 | 中 |
| condition_on_previous_text | false | false | 低 |
| Whisper vad_filter | — | false | N/A |

截断主因 **不是** beam 早停，而是 **输入音频长度** 与 **多批文本未合并落盘**。

---

## 第七部分 — Truncation Dataset Report

**筛选：** 参考为 ASR 前缀且缺 ≥4 字，或长度比 &lt;0.55（n=**49**）。

| 指标 | 截断集 |
|------|--------|
| `node_audio_segment_count` | **49/49 = 2** |
| `fw_vad_segment_count` | **49/49 = 1** |
| 首批 `audio_ms` 均值 | **~1980 ms** |
| 非截断 `audio_ms` 均值 | **~4176 ms** |
| TOP 缺失率 | d061 **91%**（`周末` vs 整句江边骑行） |

---

## 第八部分 — 时间轴分析（TOP 案例）

> 批测无 `segments[].end`；用 **WAV 总长 vs 首批 audio_ms** 作代理。

| 样本 ID | WAV(ms) | 首批 audio_ms | 差值(ms) | 说明 |
|---------|---------|---------------|----------|------|
| d061 | 5666 | 660 | ~5006 | 绝大部分在第二切片；首批仅「周末」 |
| d106 | ~5666 | 660 | ~5000 | 同场景模板 |
| d116 | — | 660 | — | 首批「你如何」 |
| d019/d109/d199 | — | 1300 | — | 会议句首批约 6 字 |

**解读：** 大差值 = **首批 FW 请求未覆盖整段 WAV**（能量切分 + 仅首批 diagnostics），非单次 FW 识别 5s 却只出 0.66s 字。

---

## 第九部分 — Truncation Root Cause Report

| 类别 | 含义 | 数量 | 占 49 |
|------|------|------|-------|
| **D** | Node 双批 + `rawAsrText` 仅首批（严格前缀） | 10 | 20% |
| **C** | 双批 + 首批极短 audio_ms（句中切分 + 第二批无有效文本） | 39 | 80% |
| **A** | 单批内 FW/VAD 早停 | 0 | — |
| **B** | 纯 VAD 单批裁尾 | 0 | 截断集均双批 |
| **E** | Utterance Aggregator | 0 | dialog_200 |

**机制链（d061）：** 5.7s WAV → 句中停顿切分 → 首批 660ms → FW「周末」→ `raw_asr_text` 冻结 → 后半在第二批但未体现在指标。

用户「皇后镇」示例：**不在本批数据**；机制 = **停顿前内容成第一批 ASR**。

---

## 第十部分 — 最终结论

1. **主要层次：** Node **AudioAggregator 能量切分** + **多批 ASR** + **`rawAsrText` 首批冻结**；其次每批内 **Silero VAD**。  
2. **FW 本身：** 单请求 **非主因**；端到端 **间接主因**（常只落盘首批）。  
3. **Audio Aggregator：** **句中切分**导致后半进入第二切片；指标上像「丢音」。  
4. **VAD：** **句中停顿误切风险**存在。  
5. **Utterance Aggregator：** dialog_200 **否**。  
6. **最常见模式：** 句中停顿 → 2 段 → 首批 ASR 仅前半句 → raw 只有前半句。  
7. **若只改一处（理论）：** **合并多批 ASR 文本到 `rawAsrText`**，或对整句 manual-cut WAV **禁止句中能量切分**（需产品/架构决策，本次不实施）。  
8. **可恢复样本（理论）：** 多批前缀截断 **49** 条；合并两批后有望显著缓解「半句」（需重跑验证；与 Detector 审计 Category B 有重叠）。

---

## 附录 — TOP20 截断样本

| id | 参考（截断） | raw_asr | 缺失% | audio_ms | nodeSeg | vadSeg |
|----|-------------|---------|-------|----------|---------|--------|
| d061 | 周末要不要去江边骑行？… | 周末 | 91.3 | 660 | 2 | 1 |
| d106 | 同上 | 周末一 | 87.0 | 660 | 2 | 1 |
| d116 | 你如何看待跨团队协作？… | 你如何 | 86.4 | 660 | 2 | 1 |
| d019 | 今天我们团队要讨论后选生城… | 今天,我们团队 | 84.2 | 1300 | 2 | 1 |
| d109 | 同上 | 今天,我们团队 | 84.2 | 1300 | 2 | 1 |
| d199 | 同上 | 今天,我们团队 | 84.2 | 1300 | 2 | 1 |
| d060 | 我想对比一下这两款订单中台… | 我想对比 | 84.0 | 560 | 2 | 1 |
| d105 | 同上 | 我想对比 | 84.0 | 560 | 2 | 1 |
| d150 | 同上 | 我想对比 | 84.0 | 560 | 2 | 1 |
| d067 | 您好，我订单显示已发货… | 您好,我定,您 | 88.0 | — | 2 | 1 |
| d178 | 我们下午讨论后选声城方案… | 我们下午税题 | 88.0 | — | 2 | 1 |
| d089 | 这周的上线计划已经确认… | 这周的事 | 87.5 | — | 2 | 1 |
| d134 | 同上 | 这周的商业节目 | 87.5 | — | 2 | 1 |
| d045 | 关于后选生城和上线计划… | 關於後,學生成為學生 | 96.0 | — | 2 | 1 |
| d090 | 同上 | 關於後,選生成立 | 96.0 | — | 2 | 1 |
| d135 | 同上 | 關於後,選生 | 96.0 | — | 2 | 1 |
| d180 | 同上 | 關於後,選生成立 | 96.0 | — | 2 | 1 |
| d194 | 请问这双鞋有四十码吗… | 請問 這雙鞋也有鞋子嗎? | 95.2 | — | 2 | 1 |
| d006 | 跟会员系统相关的需求… | 跟會員系統相關的訊息 | 85.7 | — | 2 | 1 |
| d051 | 同上 | 跟會員系統相關的訊息 | 85.7 | — | 2 | 1 |

---

## 附录 — 代码锚点

| 项 | 路径 |
|----|------|
| 首批 raw 冻结 | `main/src/pipeline/steps/asr-step.ts`（`i===0` 写 `rawAsrText`，`i>0` 只拼 `asrText`） |
| 能量切分 | `main/src/pipeline-orchestrator/audio-aggregator-process-finalize.ts` |
| Silero VAD | `services/faster_whisper_vad/utterance_audio.py` |
| FW 请求 | `main/src/task-router/faster-whisper-asr-strategy.ts` |
| 批测 | `tests/run-dialog200-timed-batch.mjs` |

**审计确认：** 未修改 Runtime、FW 服务、Aggregator 逻辑、配置或阈值。
