# LINGUA_DIALOG2000_V2_PILOT200 — Profile A/B Replay Development Report

**Phase:** `LINGUA_DIALOG2000_V2_PILOT200_PROFILE_A_B_REPLAY_RUNNER_DEVELOPMENT`  
**Verdict:** `LINGUA_DIALOG2000_V2_PILOT200_PROFILE_A_B_REPLAY_FROZEN`  
**Dataset build:** `build_20260911_091806`  
**Source Block B batch:** `blockb_2026-09-11T1021` (`FULL_AUDIO_PROFILE_RUN_V1`, immutable)  
**Replay batch:** `replay_2026-09-11T1347`  
**Runner:** `pilot200-profile-ab-replay-v1`

---

## Scope

```text
EXPERIMENT CONTROL HARNESS ONLY
NOT a production pipeline stage
NOT Model2 quality evaluation / PROFILE_GAIN
NOT dataset / Lexicon / Model2–3 / Retry changes
```

**Question answered:** Given identical frozen RAW, can NO / CORRECT / WRONG profile differences be attributed cleanly through the production post-ASR chain?

**Not answered:** Whether Model2 / profile improves quality (Block C).

---

## Files added

| Path | Role |
|------|------|
| `electron_node/electron-node/tests/run-pilot200-profile-ab-replay-runner.mjs` | Replay harness |
| `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_Profile_AB_Replay_Summary.json` | Machine summary |
| `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_Profile_AB_Replay_Development_Report.md` | This report |
| `test wav/LINGUA_DIALOG2000_V2_PILOT200/pilot200_replay/replay_2026-09-11T1347/` | Runtime dumps |

## Files modified (thin harness wiring — no production semantics)

| Path | Change |
|------|--------|
| `main/src/inference/inference-service.ts` | `runPipelineWithMockAsr` binds `userProfile` / `profileVersion` like `processJob` |
| `main/src/test-server.ts` | `/run-lexicon-mock` reads SessionBootstrap cache; allows empty RAW for `pilot200_replay`; reports `asr_step_invocation_delta`; clears `pilot200-replay::*` sessions |
| `main/src/pipeline/steps/asr-step.ts` | Observability counter `getAsrStepInvocationCount` (no ASR behavior change) |
| `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_SSOT.md` | Experiment evidence / phase status only |

---

## SSOT authority used

```text
1. Frozen Lingua architecture / active SSOT
2. Pilot200 frozen dataset SSOT
3. Block A build_20260911_091806
4. Block B runner frozen + batch blockb_2026-09-11T1021
5. This replay harness contract
```

No new business SSOT. No Architecture Change Proposal. No second mainline.

---

## Authoritative RAW policy

```text
AUTHORITATIVE_RAW_SOURCE = NO_PROFILE execution from frozen Block B batch
Policy string = NO_PROFILE_FROM_FROZEN_BLOCK_B
```

Per case: `rawMergedAsrText` + `rawAsrHash` + `sourceRunId` from Block B.  
Forbidden: majority vote, best-looking RAW, reference-aware selection, re-ASR.

One empty RAW (`p2_u001_001`, hash of empty string) is still authoritative and replayed exactly.

---

## Post-ASR production entry / mainline reuse

```text
POST /session-bootstrap  (UserProfileV1)
        ↓
POST /run-lexicon-mock   (asrText = authoritative RAW)
        ↓
InferenceService.runPipelineWithMockAsr
        ↓
runJobPipeline(ctx with asrText set)  → ASR step SKIPPED
        ↓
FW_SPAN_DETECTOR → SpanAssemblyV4
  FineSpan → Recall → Model2 → Domain Vote → SameDomain
  → Anchors → Model3 → Retry → Assembly → KenLM → final postprocess
```

**Reused modules:** `runJobPipeline`, `runFwDetectorStep`, `runFwDetectorOrchestrator`, `runFwDetectorV4Path`, `runSpanAssemblyV4Orchestrator`, SessionBootstrap / node profile cache.

**Not duplicated:** FineSpan, Recall, Model2 orchestration, Domain Vote, Retry, Assembly.

---

## ASR non-invocation evidence

| Evidence | Result |
|----------|--------|
| `asr_step_invocation_delta` per execution | always 0 |
| `ASR_INVOCATION_COUNT` batch | **0** |
| Acceptance / full batch with `--asr-down` (:6007 killed) | **PASS** (600/600 completed) |

---

## Session / profile isolation

- Namespace: `pilot200-replay::<caseId>::<condition>::<runId>` (distinct from Block B `pilot200::`)
- `SESSION_ID_COLLISION_COUNT = 0`
- Profile identity verified **600 / 600**
- Profiles READ_ONLY; no ProfileDelta writeback; dataset + Block B fingerprints unchanged

---

## Small acceptance

Batch `replay_2026-09-11T1346` (`--accept-only --asr-down`): **24/24 OK**  
Same RAW 8/8, ASR 0, collisions 0, profile mismatch 0 → `PROFILE_A_B_REPLAY_SMALL_ACCEPTANCE_PASS`

---

## 600 replay results

| Metric | Value |
|--------|------:|
| REPLAY_EXECUTION_EXPECTED | 600 |
| REPLAY_EXECUTION_COMPLETED | 600 |
| REPLAY_EXECUTION_FAILED | 0 |
| SAME_RAW_ACROSS_CONDITIONS | **200 / 200** |
| ASR_INVOCATION_COUNT | **0** |
| SESSION_ID_COLLISION_COUNT | **0** |
| PROFILE_IDENTITY_MISMATCH_COUNT | **0** |
| MODEL2_TRACE_PRESENT | 600 |
| MODEL2_TRACE_MISSING | **0** |
| MODEL2_NOT_INVOKED | 3 (empty RAW × 3 conditions) |
| CANDIDATE_CAP_MAX | 1 |
| CANDIDATE_CAP_VIOLATION_COUNT | 0 |
| DATASET_IMMUTABILITY | true |
| BLOCK_B_SOURCE_IMMUTABILITY | true |

---

## Production freeze check

```text
MODEL2_CHANGED = false
MODEL3_CHANGED = false
RETRY_CHANGED = false
LEXICON_CHANGED = false
ASR_CHANGED = false
FINE_SPAN / DOMAIN_VOTE / ASSEMBLY / KENLM = false
PRODUCTION_SEMANTIC_CHANGE = false
```

Wiring only: mock path can receive SessionBootstrap profile (parity with audio harness).

---

## Known limitations

1. **Tone / acoustic slices:** Block B `executions.jsonl` does not store `asrSegments` / `acousticToneSlices`. Replay Tone path is consistently `NOT_INVOKED` across all three conditions — still valid for **profile** attribution control; not bit-identical to full-audio Tone path.
2. **Empty RAW case** (`p2_u001_001`): classified `MODEL2_NOT_INVOKED`, not TRACE_MISSING.
3. Replay ≠ full end-to-end audio acceptance (Block B remains that layer).

---

## Two-layer evidence model

| Layer | Batch | Answers |
|-------|-------|---------|
| Full audio | `blockb_2026-09-11T1021` | Can frozen WAV run with profile conditions? |
| Controlled RAW replay | `replay_2026-09-11T1347` | Given identical RAW, can profile effects be attributed cleanly? |

---

## Final verdict

```text
LINGUA_DIALOG2000_V2_PILOT200_PROFILE_A_B_REPLAY_FROZEN
```

```text
ONE_NEXT_PHASE =
LINGUA_DIALOG2000_V2_PILOT200_BLOCK_C_PROFILE_AWARE_EVALUATOR_DEVELOPMENT
```
