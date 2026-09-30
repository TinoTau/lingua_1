# Capture V2 Observability — MODIFIED_FILE_TARGET_LIST

Pre-edit permission list. Only listed Production files may receive OBSERVABILITY_ONLY hooks.

| path | class | boundary | why | Production? | behavior risk | test |
|------|-------|----------|-----|-------------|---------------|------|
| `main/src/capture-v2/gate.ts` | NEW_CAPTURE_INFRASTRUCTURE | gate | FROZEN_EVIDENCE_CAPTURE_V2 | NO | none | T1 T2 |
| `main/src/capture-v2/serialize.ts` | NEW_CAPTURE_INFRASTRUCTURE | serializer | canonical + hash | NO | none | T5–T12 |
| `main/src/capture-v2/float-policy.ts` | NEW_CAPTURE_INFRASTRUCTURE | float | SSOT tolerances | NO | none | T11 T12 |
| `main/src/capture-v2/collector.ts` | NEW_CAPTURE_INFRASTRUCTURE | collector | case-scoped sink | NO | none | T3 T4 T37 |
| `main/src/capture-v2/completeness.ts` | CAPTURE_COMPLETENESS_VALIDATION | all | CAPTURE_INCOMPLETE | NO | none | T31 T40 |
| `main/src/capture-v2/types.ts` | NEW_CAPTURE_INFRASTRUCTURE | schema | B1–B18 types | NO | none | — |
| `main/src/capture-v2/index.ts` | NEW_CAPTURE_INFRASTRUCTURE | export | public API | NO | none | — |
| `main/src/capture-v2/capture-v2.contract.test.ts` | CONTRACT_TEST | T1–T40 | contract tests | NO | none | all |
| `main/src/fw-detector/fw-detector-orchestrator.ts` | OBSERVABILITY_ONLY_HOOK | B1 | repairText at consumer entry | YES | OFF no-op | T13 T35 |
| `main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts` | OBSERVABILITY_ONLY_HOOK | B2 B3 B5 B15 B18 | WTS + alignment + finespans + vote + final path | YES | OFF no-op | T14–T17 T27 T30 |
| `main/src/fw-detector/span-assembly-v4/recall-topk-for-windows.ts` | OBSERVABILITY_ONLY_HOOK | B4 B7 B8 B9 | mapped tone, query, SQL, Base | YES | OFF no-op | T16 T19–T21 |
| `main/src/fw-detector/span-assembly-v4/lattice-fine-span-runtime.ts` | OBSERVABILITY_ONLY_HOOK | B6 B10–B14 | windows, Model2, edges, paths | YES | OFF no-op | T18 T22–T26 |
| `main/src/fw-detector/fw-detector-v4-path.ts` | OBSERVABILITY_ONLY_HOOK | B16 B18 | KenLM + final text | YES | OFF no-op | T28 T30 T35 |
| `main/src/model3-runtime/run-model3-path-step.ts` | OBSERVABILITY_ONLY_HOOK | B17 | anchors/input/decisions | YES | OFF no-op | T29 |
| `main/src/pipeline/result-builder-core.ts` | OBSERVABILITY_ONLY_HOOK | side-channel | attach capture artifact under gate only | YES | OFF absent | T33 T34 |
| `tests/run-capture-v2-observability-dev-probe.mjs` | DEVELOPMENT_PROBE | probe | 3–5 case instrumentation check | NO | none | T40 |

**Not touching:** `dialog200-path-trace.ts` (snapshot before compact instead), Evaluation SSOT, Replay, Frozen Evidence V1, models/lexicon.
