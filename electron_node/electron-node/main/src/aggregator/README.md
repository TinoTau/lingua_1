# Aggregator 模块

ASR 结果后的文本聚合、去重与边界决策。位于 **NodeAgent** 与 JobResult 发送之间。

实现：`aggregator-*.ts`、`dedup.ts`、`tail-carry.ts`；中间件 `agent/aggregator-middleware.ts`。

Pipeline 内聚合步骤：`pipeline/steps/aggregation-step.ts` → `agent/postprocess/aggregation-stage.ts`。

---

## 1. 数据流

Scheduler JobAssign → Pipeline（ASR/NMT/TTS）→ **AggregatorMiddleware.process()** → JobResult 上报。

不改变 Pipeline 内部步骤，仅对结果做后处理。

---

## 2. 核心组件

| 组件 | 文件 | 说明 |
|------|------|------|
| 决策 | `aggregator-decision.ts` | Text Incompleteness、Language Gate、merge/new_stream |
| 会话态 | `aggregator-state.ts` | per-session 状态、gap_ms |
| 多会话 | `aggregator-manager.ts` | TTL/LRU 回收 |
| 去重 | `dedup.ts` | 边界重叠裁剪 |
| Tail Carry | `tail-carry.ts` | 尾巴延迟归属 |
| 中间件 | `aggregator-middleware.ts` | 入口 |

---

## 3. 决策要点

- **Text Incompleteness**：短句、gap、句末标点、连接词尾 → 判断是否「未说完」
- **Language Stability Gate**：语言置信与切换 → 稳定后再 commit
- **merge / new_stream**：受手动断句、大 gap 等硬规则约束

配置：`enabled`、`mode`（offline/room）、`ttlMs`、`maxSessions` 等。

---

## 4. 模式参数（参考）

| 模式 | hard_gap_ms | commit_interval_ms |
|------|-------------|-------------------|
| Offline | 2000 | 1200–1500 |
| Room | 1500 | 800–1200 |

---

## 5. 注意事项

1. P0 只处理 final 结果；partial 不参与聚合
2. stop/leave 时需 `flush()` 避免丢尾句
3. 会话 TTL 默认约 5 分钟自动清理

---

## 6. Duplicate Guard（冻结）

Pipeline `dedup-step.ts` 在 Enhancement 之后、DedupStage 之前调用 `sanitizeSegmentForOutput`，裁剪单段内重复片段（前缀循环 ×N 等）。

| 机制 | 函数 | 职责 |
|------|------|------|
| Duplicate Guard | `sanitizeSegmentForOutput` | 段内重复裁剪 |
| 边界 Dedup | `dedupMerge` / `dedupMergePrecise` | 跨 utterance 重叠 |
| Job Dedup | `DedupStage` | 同 job_id TTL |

冻结合约：[`DEDUP.md`](./DEDUP.md)

---

## 相关

| 文档 | 路径 |
|------|------|
| Duplicate Guard | [`DEDUP.md`](./DEDUP.md) |
| 音频聚合 | [`../pipeline-orchestrator/README.md`](../pipeline-orchestrator/README.md) |
| Pipeline | [`../pipeline/README.md`](../pipeline/README.md) |
| 架构 | [`../../../docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) |
