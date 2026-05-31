# AudioAggregator 数据格式

内部缓冲区与返回结果的数据结构（与当前代码一致）。

## 1. AudioBuffer 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| audioChunks | Buffer[] | 累积的音频块（PCM16） |
| pendingTimeoutAudio | Buffer? | 超时 finalize 时缓存的**单个**拼接 Buffer |
| pendingPauseAudio | Buffer? | pause finalize 时缓存的**单个**短音频 Buffer |
| pendingSmallSegments | Buffer[] | <5s 小片段，待合并成≥5s 批次 |

pendingTimeoutAudio / pendingPauseAudio 为**单条 Buffer**，非数组；超时触发时 aggregateAudioChunks 合并为一段。

## 2. AudioProcessorResult 返回字段

| 字段 | 类型 | 说明 |
|------|------|------|
| audioSegments | string[]? | base64 字符串数组，每段对应一 ASR 批次 |
| originalJobIds | string[]? | 每段对应的原始 job_id（头部对齐） |
| originalJobInfo | OriginalJobInfo[]? | utteranceIndex 等 |
| shouldReturnEmpty | boolean | true 表示仅缓冲、不返回段 |

## 3. 数据流

输入 job.audio (Opus base64) → 解码 → audioChunks 累积 → 聚合 → 切分（splitAudioByEnergy）→ 流式批次（≥5s）→ base64 → audioSegments 返回。

## 4. 相关文档

- [PIPELINE.md](./PIPELINE.md) — ASR 流程
- `main/src/pipeline-orchestrator/audio-aggregator*.ts` — 源码
