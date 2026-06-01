# Pipeline Orchestrator — 音频聚合

ASR 前音频缓冲、切分、batch 归属。源码：`audio-aggregator.ts`、`audio-aggregator-*.ts`。

Pipeline ASR 步骤见 [`../pipeline/steps/asr-step.ts`](../pipeline/steps/asr-step.ts)。

---

## 1. 关键参数（AudioAggregator）

| 参数 | 值 |
|------|-----|
| MAX_BUFFER_DURATION_MS | 20000 |
| MIN_AUTO_PROCESS_DURATION_MS | 10000 |
| PENDING_TIMEOUT_AUDIO_TTL_MS | 10000 |
| MIN_ACCUMULATED_DURATION_MS | 5000 |
| SPLIT_HANGOVER_MS | 600 |

---

## 2. AudioBuffer 字段

| 字段 | 说明 |
|------|------|
| audioChunks | PCM16 累积块 |
| pendingTimeoutAudio | 超时 finalize 单条 Buffer |
| pendingPauseAudio | pause finalize 短音频 |
| pendingSmallSegments | <5s 小片段待合并 |

---

## 3. AudioProcessorResult

| 字段 | 说明 |
|------|------|
| audioSegments | base64 数组，每段一 ASR 批次 |
| originalJobIds | 每段对应 job_id（头部对齐） |
| originalJobInfo | utteranceIndex 等 |
| shouldReturnEmpty | true = 仅缓冲 |

数据流：Opus → 解码 → 累积 → splitAudioByEnergy → ≥5s 批次 → base64 返回。

---

## 4. 长语音 Job 容器策略

多 Job 拆分后的 batch→job 归属：

| 规则 | 说明 |
|------|------|
| R1 | 最终文本段数 ≤ job 数 |
| R2 | 头部对齐：batch 归属由首帧所在 job 决定 |
| R3 | 容器装满：累计时长 ≥ 预计时长则切换 |
| R4 | 向前吸收未满容器 |
| R5 | 最后容器可空 → `NO_TEXT_ASSIGNED` 核销 |

无 batch 的 job 发一次空结果，不可占坑/心跳。

---

## 相关

| 文档 | 路径 |
|------|------|
| 文本 Aggregator | [`../aggregator/README.md`](../aggregator/README.md) |
| Pipeline | [`../pipeline/README.md`](../pipeline/README.md) |
