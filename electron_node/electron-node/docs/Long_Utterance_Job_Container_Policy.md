# 长语音 Job 容器策略

超长语音多 Job 拆分后，节点端 batch→job 归属与空容器核销。适用于调度、节点 AudioAggregator 与 ASR→语义/NMT/TTS 管线。

## 1. 概念

- **Job**：用户可感知的文本容器；每个 job 只发送一次最终结果；文本可由多个 batch 合并。
- **Batch**：ASR 内部技术切片；不直接对外，须通过容器分配映射到 job。

## 2. 容器分配规则

- **R1**：最终文本段数 ≤ job 数量  
- **R2**：头部对齐 — batch 归属由 batch 首帧所在 job 决定  
- **R3**：容器装满 — 累计 batch 时长 ≥ 该 job 预计时长则切换  
- **R4**：向前吸收 — 未满容器可吸收下一 batch  
- **R5**：最后容器可空 — 无 batch 的 job 用空结果核销（NO_TEXT_ASSIGNED）

## 3. 空结果核销

无 batch 的 job 发送一次空结果，reason 为 NO_TEXT_ASSIGNED；不可用于占坑、心跳或先空后文本。

## 4. 节点端实现要点

batch→job 分配、start_job/时长识别、容器装满切换、容器完成即发唯一结果、空容器发空核销；utterance_index 使用原始 job 的 index。

## 5. 相关文档

- `ASR_Module_Flow.md` — ASR 流程与 originalJobIds
- `AUDIO_AGGREGATOR_Data_Format.md` — 聚合数据格式
