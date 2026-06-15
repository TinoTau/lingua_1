# Legacy FW Detector（回滚链）

> **⚠ Historical Snapshot** — Current production: **FW Detector V4-only**.  
> This document describes archived P1.2b rollback chains. **Not used by orchestrator.**

P1.2b per-span topK + KenLM weak_veto 决策链。

**非默认路径：** V2 sentence-level rerank pipeline（removed during V2/V3 Retirement）。`useSentenceLevelRerank` — orchestrator **不再读取**。

---

## 文件

| 文件 | 职责 |
|------|------|
| `fw-topk-decision-pipeline.ts` | 回滚决策链入口 |
| `candidate-scorer.ts` | finalScore 权重 |
| `pick-approved-replacements.ts` | D-greedy pick |
| `span-replacement-eval.ts` | 诊断 / 单测 |

默认 orchestrator 不再分支至 legacy；手动集成须自行 wiring。

冻结说明：[`../../fw-detector/README.md`](../../fw-detector/README.md) §7。
