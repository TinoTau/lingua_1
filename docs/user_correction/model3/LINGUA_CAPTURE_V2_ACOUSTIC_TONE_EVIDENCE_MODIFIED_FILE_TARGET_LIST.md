# Capture V2 Acoustic Tone Evidence — Planned Modified File Inventory

## Trace summary (Production authority)

| Item | Value |
|------|--------|
| Producer | `asr-step.ts` — Tone model via ASR HTTP `asrResult.tone.acousticToneSlices`, offset-merged per batch |
| Runtime SSOT | `ctx.acousticToneSlices: AcousticToneSlice[]` |
| Shape | `{ start, end, tonePosterior:{t1..t5}, confidence }` |
| Consumer | `fw-detector-v4-path` → `acousticSlices: ctx.acousticToneSlices` → span-assembly / mapToneEvidenceForRecall |
| Export (JobResult diagnostic) | `buildUtteranceToneFromSsot` → `extra.utterance_tone.acousticToneSlices` (sort copy) |
| Mutation | Batches **push** into ctx during ASR; FW consumers read; Capture must deep-copy before any further use |
| Capture point | Span-assembly entry (post-ASR merge complete), same moment as B2/B3 — before Tone mapping consumers |

## Canonical schema placement (ONE authority)

**Path:** `capture_artifact.boundaries.B4.payload.acousticToneSlices`  
**Role:** `INJECTION_STATE` (Boundary Contract B4.replay_role + Role Matrix)  
**Not** duplicated under B2.  
**B4.windows** remains COMPARISON_ONLY mapped Tone.

## Modified files

| Path | Function | Change class | Contract restored | Prod algo? | Decision? | Test |
|------|----------|--------------|-------------------|------------|-----------|------|
| `main/src/capture-v2/collector.ts` | `captureV2Boundary` B4 merge | CAPTURE_OBSERVABILITY_ONLY | Preserve slices+windows | NO | NO | T3–T5 merge |
| `main/src/capture-v2/completeness.ts` | B4 structural + tone status | COMPLETENESS_VALIDATOR_REPAIR | Missing slices → INCOMPLETE | NO | NO | T12–T15 T25 |
| `main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts` | Snapshot slices into B4 | CAPTURE_OBSERVABILITY_ONLY | INJECTION_STATE persist | NO | NO | T2 T10 T11 |
| `main/src/fw-detector/span-assembly-v4/recall-topk-for-windows.ts` | B4 windows write (merge-safe) | CAPTURE_OBSERVABILITY_ONLY | B4 mapped + slices coexistence | NO | NO | T12 T16 |
| `main/src/capture-v2/capture-v2.contract.test.ts` | T1–T25 related | TEST_ONLY | — | NO | NO | Phase A |
| `tests/run-dialog200-frozen-evidence-capture-v2.mjs` | Injection-state validation + slice coverage | CAPTURE_HARNESS_UPDATE | Recapture gates | NO | NO | Phase B/C |
| docs repair/test/completeness/identity/injection artifacts | Reports | TEST_ONLY / harness output | — | NO | NO | — |

No PRODUCTION_ALGORITHM_CHANGE required.
