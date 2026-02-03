# Aggregator（节点端）

**状态**: 节点端实现；Scheduler 不直接包含 Aggregator 逻辑。

## 一、概念

- **AggregatorMiddleware**：节点端管道中的中间件，用于在 ASR 结果之上做连续性判断、流合并等。
- **UtteranceAggregator**：将多个 ASR 片段/utterance 聚合成完整句子或语义单元，再送下游（NMT/TTS 等）。

## 二、与 Scheduler 的关系

- Scheduler 负责按 Finalize 创建 Job、选节点、投递任务；不负责节点内 AudioAggregator / UtteranceAggregator 的配置与行为。
- 节点端根据 Job 的 finalize 类型（IsFinal / Timeout / MaxDuration）在 AudioAggregator 中决定何时送 ASR、如何清空缓冲；UtteranceAggregator 则对 ASR 输出做聚合。

## 三、常见问题（节点端）

- **hasAggregatorManager / 文本聚合未生效**：属节点端配置与启用逻辑，见节点端文档。
- **NEW_STREAM 判定**：与节点端连续性判断、流边界有关；若所有 job 被判为 NEW_STREAM，需检查节点端 Aggregator 与 Finalize 标识传递。

## 四、相关文档

- 任务与 Finalize：[JOB.md](../job/JOB.md)、[FINALIZE.md](../finalize/FINALIZE.md)
- 节点端实现：见 `electron_node` 文档与节点端 Pipeline/Aggregator 代码。
