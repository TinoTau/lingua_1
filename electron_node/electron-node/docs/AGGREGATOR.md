# Aggregator 模块说明

Aggregator 负责在节点端对 ASR 输出做聚合、去重与边界决策，再随 JobResult 上报。实现位于 `main/src/aggregator/` 与 `main/src/agent/aggregator-middleware.ts`。

## 1. 位置与数据流

- **集成点**：`NodeAgent.handleJob()` 内，在 `InferenceService.processJob()` 之后、发送 `JobResultMessage` 之前
- **流程**：Scheduler 下发 JobAssign → 主进程执行 Pipeline（ASR/NMT/TTS）→ 得到含 `text_asr`、`segments` 等的结果 → **AggregatorMiddleware.process()** 处理 → 发送 JobResult

不改变 Pipeline 内部实现，仅对结果做后处理，便于开关与替换模型。

## 2. 核心组件（与代码对应）

| 功能 | 位置 | 说明 |
|------|------|------|
| 决策逻辑 | `aggregator-decision.ts` | Text Incompleteness Score、Language Stability Gate、merge/new_stream 决策 |
| 去重 | `aggregator-middleware-deduplication.ts` 等 | 边界重叠裁剪 |
| Tail Carry | 决策与状态中 | 尾巴延迟归属 |
| 会话状态 | `aggregator-state.ts` | 每会话状态、gap_ms 等 |
| 多会话管理 | `aggregator-manager.ts` | TTL/LRU 回收 |
| 中间件入口 | `aggregator-middleware.ts` | 调用上述逻辑并写回结果 |

## 3. 主要决策与参数

- **Text Incompleteness**：短句、短 gap、无句末标点、连接词/语气词尾等，用于判断是否“未说完”
- **Language Stability Gate**：语言识别置信度与切换判断，用于稳定语言再 commit
- **merge / new_stream**：根据上述分数与门控决定是合并到当前流还是新开流；受硬规则（如手动断句、大 gap）约束
- 配置含 `enabled`、`mode`（offline/room）、`ttlMs`、`maxSessions` 等（见 aggregator 相关类型与初始化）

## 4. NMT 重译与修复

- 存在“重触发 NMT”和“NMT Repair”相关逻辑，用于在聚合/修正后对翻译进行补全或修正
- 实现与参数见 `aggregator-decision.ts`、NMT 相关调用链及注释

## 5. 测试与监控

- 单元测试见 `main/src/aggregator/*.test.ts`、`main/src/pipeline-orchestrator/audio-aggregator*.test.ts` 等
- 运行：在 `electron_node/electron-node` 下执行 `npm test` 或对应子目录测试

---

*本文档由原 `docs/AGGREGATOR` 下实现状态与架构类文档合并而成，与当前代码保持一致；设计细节以源码为准。*
