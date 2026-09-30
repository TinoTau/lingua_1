# LINGUA_PILOT200_REPLAY_FROZEN_TONE_EVIDENCE_SINGLE_DELTA — Report

**Phase:** `LINGUA_PILOT200_REPLAY_FROZEN_TONE_EVIDENCE_SINGLE_DELTA`  
**Capture batch:** `tonecap_2026-09-12T0001`  
**Replay batch:** `tonereplay_2026-09-12T0001`  
**Mode:** HARNESS EVIDENCE PERSIST + REPLAY / NO Tone bypass / NO Model2 / NO Profile learning  

---

## 1. Goal (this delta only)

```text
Full-audio run → RAW + asrSegments + acousticToneSlices → persist
Frozen Replay → same RAW/timing/Tone + different UserProfile → production post-ASR pipeline
```

Not in scope: Tone model, Tone gate, Model2, `tone_bias`, D materialization, old Block B backfill.

---

## 2. Confirmed pre-delta facts (accepted)

| Fact | Value |
|------|-------|
| `BLOCK_B_TONE_EVIDENCE` | `PRESENT_BUT_NOT_PERSISTED` |
| `REPLAY_TONE_LOSS_OWNER` | `BLOCK_B_NOT_PERSISTED` |
| `OLD_BLOCK_B_TONE_REPLAY` | `NOT_RECOVERABLE` (immutable; no invent/backfill) |
| Production Tone gate | Expected fail-closed design — **unchanged** |
| `MODEL2_USER_TONE_PROFILE` | `DEFERRED_FUNCTION_GAP` |

---

## 3. Code delta (harness only)

| File | Change |
|------|--------|
| `inference-service.ts` `runPipelineWithMockAsr` | Optional inject of production `asrSegments` + `acousticToneSlices` into `JobContext` |
| `test-server.ts` `POST /run-lexicon-mock` | Accepts `segments` + `utterance_tone.acousticToneSlices`; flags `tone_inference_skipped`, `frozen_post_asr_evidence_injected` |
| `tests/run-pilot200-frozen-tone-evidence-delta.mjs` | New capture+replay diagnostic runner |

**JobResult:** reused existing `segments` + `extra.utterance_tone` — **no new JobResult fields**.

**Frozen SSOT:** raw text + segments + acousticToneSlices (not derived `acousticTonePattern`).

---

## 4. Diagnostic procedure

### Step A — NEW full-audio capture (`tonecap_2026-09-12T0001`)

8 representative cases via `POST /run-pipeline-with-audio` (Faster-Whisper + Tone + pipeline).

| caseId | tone slices | segments | tone present |
|--------|-------------|----------|--------------|
| p2_u001_002 | 15 | 1 | YES |
| p2_u002_001 | 6 | 1 | YES |
| p2_u002_016 | 13 | 1 | YES |
| p2_u003_001 | 8 | 1 | YES |
| p2_u004_001 | 6 | 1 | YES |
| p2_u001_016 | 17 | 1 | YES |
| p2_u003_016 | 12 | 1 | YES |
| p2_u001_004 | 16 | 1 | YES |

`CAPTURE_TONE_PRESENT_COUNT = 8/8`

### Step B — Frozen evidence Replay (`tonereplay_2026-09-12T0001`)

Same RAW + segments + slices × `{NO_PROFILE, CORRECT_PROFILE, WRONG_PROFILE}` via `POST /run-lexicon-mock`.

| Gate | Result |
|------|--------|
| ASR invocation | **0** |
| Tone inference | **not invoked** |
| RAW / SEGMENT / TONE identity across 3 profiles | **PASS** |
| Old Block B / old Replay hashes | **unchanged** |

---

## 5. Transport / Tone readiness (CORRECT_PROFILE)

| caseId | acousticTonePattern_present | toneRecallReadiness | p_retrieval_status | p_added | P owner |
|--------|----------------------------|---------------------|--------------------|---------|---------|
| p2_u001_002 | true | ready | P_RETRIEVAL_RUN_EMPTY | 0 | P_RETRIEVAL_READY_BUT_NO_HITS |
| p2_u002_001 | true | null | NO_P_ACTION | 0 | MODEL_DECISION_NO_P_ACTION |
| p2_u002_016 | true | ready | P_RETRIEVAL_RUN_EMPTY | 0 | P_RETRIEVAL_READY_BUT_NO_HITS |
| p2_u003_001 | true | ready | P_RETRIEVAL_RUN_EMPTY | 0 | P_RETRIEVAL_READY_BUT_NO_HITS |
| p2_u004_001 | true | ready | P_RETRIEVAL_RUN_EMPTY | 0 | P_RETRIEVAL_READY_BUT_NO_HITS |
| p2_u001_016 | true | ready | P_RETRIEVAL_RUN_HIT | 2 | **P_ADDED** |
| p2_u003_016 | true | ready | P_RETRIEVAL_RUN_EMPTY | 0 | P_RETRIEVAL_READY_BUT_NO_HITS |
| p2_u001_004 | true | ready | P_RETRIEVAL_RUN_EMPTY | 0 | P_RETRIEVAL_READY_BUT_NO_HITS |

```text
P_RETRIEVAL_TONE_NOT_READY among tone captures = 0
→ P_RETRIEVAL_TONE_NOT_READY_OWNER = RESOLVED
```

`P_STAGE_J_EXPANSION_PATH_REACHED = YES` (p2_u001_016: p_hits=2, p_added=2).

---

## 6. D path (observe only)

CORRECT_PROFILE D owners: `D_ADDED=5`, `D_MATERIALIZATION_EMPTY=3`. **No D fix this delta.**

---

## 7. Acceptance

```text
SINGLE_DELTA_SCOPE_PASS                  = PASS
FULL_AUDIO_TONE_CAPTURE_PASS             = PASS
REPLAY_RAW_IDENTITY_PASS                 = PASS
REPLAY_SEGMENT_IDENTITY_PASS             = PASS
REPLAY_TONE_EVIDENCE_IDENTITY_PASS       = PASS
REPLAY_ASR_NOT_INVOKED                   = true
REPLAY_TONE_INFERENCE_NOT_INVOKED        = true
PRODUCTION_TONE_GATE_UNCHANGED           = true
MODEL2_UNCHANGED                         = true
PROFILE_LEARNING_UNCHANGED               = true
RECALL_SEMANTICS_UNCHANGED               = true
LEXICON_UNCHANGED                        = true
D_PATH_UNCHANGED                         = true
OLD_BLOCK_B_IMMUTABLE                    = true
OLD_REPLAY_IMMUTABLE                     = true
```

### Required verdicts

```text
TONE_EVIDENCE_CAPTURE_STATUS       = PASS
FROZEN_TONE_REPLAY_STATUS          = PASS
PROFILE_ONLY_VARIABLE_ISOLATION    = PASS
P_RETRIEVAL_TONE_NOT_READY_OWNER   = RESOLVED
```

---

## 8. Next owner (single)

```text
NEXT_CONFIRMED_P_OWNER = P_RETRIEVAL_READY_BUT_NO_HITS
ONE_RECOMMENDED_NEXT_DELTA =
  Observe/fix P retrieval empty-hit owner under frozen Tone evidence
  (separate delta; no Tone bypass; no Model2 retrain; no tone_bias)
```

Dominant CORRECT distribution: 6/8 `P_RETRIEVAL_READY_BUT_NO_HITS`, 1 `MODEL_DECISION_NO_P_ACTION`, 1 `P_ADDED`.

STOP.
