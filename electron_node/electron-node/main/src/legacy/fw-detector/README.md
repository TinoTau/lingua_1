# Legacy FW Detector (Rollback Chain)

P1.2b per-span topK + KenLM weak_veto decision pipeline.

**Not on frozen default path** when `useSentenceLevelRerank=true`.

| File | Role |
|------|------|
| `fw-topk-decision-pipeline.ts` | Rollback decision chain |
| `candidate-scorer.ts` | finalScore weights |
| `pick-approved-replacements.ts` | D-greedy pick |
| `span-replacement-eval.ts` | Diagnostics / unit tests only |

Orchestrator imports `runFwTopKDecisionPipeline` from here when `useSentenceLevelRerank=false`.

See [FREEZE_GUARD.md](../../docs/FREEZE_GUARD.md).
