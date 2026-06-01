# Legacy FW Detector（回滚链）

P1.2b per-span topK + KenLM weak_veto 决策链。

**非默认路径：** `useSentenceLevelRerank=true` 时使用 [`../../fw-detector/fw-sentence-rerank-pipeline.ts`](../../fw-detector/fw-sentence-rerank-pipeline.ts)。

---

## 文件

| 文件 | 职责 |
|------|------|
| `fw-topk-decision-pipeline.ts` | 回滚决策链入口 |
| `candidate-scorer.ts` | finalScore 权重 |
| `pick-approved-replacements.ts` | D-greedy pick |
| `span-replacement-eval.ts` | 诊断 / 单测 |

`fw-detector-orchestrator.ts` 在 `useSentenceLevelRerank=false` 时 import `runFwTopKDecisionPipeline`。

冻结说明：[`../../fw-detector/README.md`](../../fw-detector/README.md) §7 回滚开关。
