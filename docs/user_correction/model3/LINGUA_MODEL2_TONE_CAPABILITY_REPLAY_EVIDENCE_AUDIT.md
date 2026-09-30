# LINGUA_MODEL2_TONE_CAPABILITY_AND_REPLAY_EVIDENCE_AUDIT

**Phase:** `LINGUA_MODEL2_TONE_CAPABILITY_AND_REPLAY_EVIDENCE_AUDIT`  
**Mode:** READ-ONLY AUDIT / NO PRODUCTION CODE CHANGE  
**Date:** 2026-09-12  

```text
AUDIT_ONLY = true
PRODUCTION_CODE_CHANGED = false
MODEL2_CHANGED = false
PROFILE_CHANGED = false
TONE_CHANGED = false
RECALL_CHANGED = false
REPLAY_CHANGED = false
```

---

## 0. Accepted prior facts

From UTF-8 surrogate delta same-sample diagnostic:

```text
MODEL2_INFERENCE_SUCCESS_COUNT = 8
P_DECISION_REACHED_COUNT = 8
P_RETRIEVAL_TONE_NOT_READY = 7
NO_P_ACTION = 1
acousticTonePattern_present = false
toneRecallReadiness = no_pattern
MANDATORY_TONE_FAIL_CLOSED_WHEN_P_SELECTED = CONFIRMED
```

This audit does **not** challenge the Tone readiness gate.

---

## 1. Audit A — Tone production lineage

| # | Stage | Owner | Input | Output / field | Req? | JobResult? | → Model2 P? |
|---|--------|-------|-------|----------------|------|------------|-------------|
| 1 | Audio → word timestamps | `faster_whisper_vad` ASR | PCM | `words[].start/end` | for Tone | segments | indirect |
| 2 | Tone inference | `tone_module/inference.py` `run_tone_inference` | audio + words | `AcousticToneSlice[]` (`tonePosterior`) | optional (skip: no_audio / non_zh / no_timestamps) | via ASR `tone` | yes as slices |
| 3 | Node ASR step | `pipeline/steps/asr-step.ts` | ASR tone payload | `ctx.acousticToneSlices` | optional | → `utterance_tone` | yes |
| 4 | WordTimeSpan | `fw-detector/tone-time-align.ts` `buildWordTimeSpans` | rawText + segments | `WordTimeSpan[]` | for mapping | internal | yes |
| 5 | Pattern map | `mapToneEvidenceForRecall` / `extractAcousticTonePatternForRecall` | slices + spans + geometry | `acousticTonePattern: number[] \| null` | optional→null | internal | yes |
| 6 | FineSpan rebind | `tone-fine-span-rebind.ts` `rebindToneForFineSpan` | PathFineSpan + slices | `toneRebindTrace.acousticTonePattern` | gated by `toneTimestampOnlyEnabled` | internal | **Model2 source** |
| 7 | Orchestrator | `span-assembly-v4-orchestrator.ts` | first non-empty FineSpan pattern | `acousticTonePattern` arg | optional | internal | **into expand** |
| 8 | Stage-J infer | `finespan-adapter` / host | profile phonetic_bias… | selected_actions | **no tone in policy features** | — | N/A |
| 9 | P lexicon queries | `relation-lexicon-adapter.ts` | actions + pattern | `recallSpanTopKV2({ acousticTonePattern })` | soft-required length | obs | yes |
| 10 | Readiness SSOT | `tone-recall-readiness.ts` | pattern + runtime + caller | `ready` / `no_pattern` / … | authoritative | obs | gates P |
| 11 | Tone-first recall | `tone-first-tier-collector.ts` | `tonePinyinKey` | tone_exact hits only | fail-closed if not ready | internal | P hits |

**Production Tone gate (P pronunciation recall):** Batch 1.1C Mandatory Tone Recall — **fail-closed**. No Plain fill when not ready.

**Note:** `toneTokens` is not on the production path; pattern is derived from slice posteriors (argmax).

---

## 2. Audit B — Block B Tone evidence

Batch: `blockb_2026-09-11T1021`

**Runner:** `tests/run-pilot200-block-b-profile-runner.mjs`  
- Calls `POST /run-pipeline-with-audio` (real wav; env includes `TONE_P10_VAD_CPU=1`)  
- Persists: `rawMergedAsrText`, audio path/sha256, profile meta, compact `model2Trace`  
- **Does not persist:** `asrSegments`, `acousticToneSlices`, `utterance_tone`, `acousticTonePattern`

**Dump verification (600 executions + sample traces):**  
Zero occurrences of `acousticTone*`, `asrSegment*`, `utterance_tone`, `tonePosterior` in `executions.jsonl` / compact traces.

Production JobResult **can** carry `segments` + `extra.utterance_tone` (`asr-step.ts`, `result-builder-core.ts`, `test-server.ts`). Block B extractor drops them.

```text
BLOCK_B_TONE_EVIDENCE = PRESENT_BUT_NOT_PERSISTED
```

Meaning: full-audio production path is Tone-capable and was invoked under Tone-enabled env; **frozen batch artifacts do not retain Tone/timestamp evidence**. Dump alone cannot re-prove per-case `sliceCount > 0`.

---

## 3. Audit C — Replay Tone loss

**Replay inject:**

```text
POST /session-bootstrap (UserProfile)
POST /run-lexicon-mock { asrText: frozen NO_PROFILE RAW, pilot200_replay: true }
→ runPipelineWithMockAsr
→ runJobPipeline (ASR skipped)
```

`inference-service.ts` `runPipelineWithMockAsr`:

```text
// Exact RAW representation. Do not invent acoustic metadata.
ctx.asrText = asrText;
```

No audio, no segments, no tone slices.

### Comparison

| Evidence | Production | Block B dump | Replay |
|----------|------------|--------------|--------|
| raw ASR text | yes | yes (`rawMergedAsrText`) | yes (frozen NO_PROFILE RAW) |
| FW timestamps / asrSegments | yes | **no** | **no** |
| original audio | yes | path+sha only | **not used** |
| tone slices | yes (ctx / utterance_tone) | **no** | **no** |
| acousticTonePattern | derived | **no** | unavailable → `no_pattern` |
| UserProfile | yes | yes | yes (varied by condition) |

**FIRST point Tone becomes unavailable for the frozen Replay experiment:**

```text
REPLAY_TONE_LOSS_OWNER = BLOCK_B_NOT_PERSISTED
```

Downstream confirmation (cannot regenerate Tone without ASR/audio):  
`RUNPIPELINE_SKIP_ASR_DROPS_ACOUSTIC_CONTEXT` + `MOCK_ASR_CONTRACT_OMITS_TIMESTAMPS` — secondary, not the first frozen-artifact gap.

---

## 4. Audit D — Replay Tone reuse feasibility

Desired controlled experiment:

```text
same RAW + same frozen Tone/timing + different UserProfile
```

With **current** frozen artifacts: no Tone/segments to inject.

```text
REPLAY_TONE_REUSE_FEASIBILITY = NOT_FEASIBLE_WITH_CURRENT_ARTIFACTS
```

If a future capture persisted `asrSegments` + `acousticToneSlices` (or equivalent), harness inject would likely be a **SMALL_HARNESS_DELTA** (not assessed as implemented). Types already exist on JobContext / JobResult; `/run-lexicon-mock` today has **no** inject API for them.

**Not implemented in this audit.**

---

## 5. Audit E — Model2 user Tone capability

### E1. UserProfile store tone bias?

```text
USER_PROFILE_TONE_STORAGE = YES
```

Evidence: `UserProfileV1.tone_bias` in `shared/protocols/messages.ts`; Gateway/profile apply maps exist; feature schema lists `TONE_FEATURE_KEYS` (`tone_1_2`…).

### E2. ProfileDelta learn tone?

```text
PROFILE_DELTA_TONE_LEARNING = NO
```

Evidence: `central_server/scheduler/.../profile_delta.rs`:

```rust
tone_updates: vec![], // no acoustic tone evidence
```

Correction features extract phonetic keys (e.g. `n_l`), not tone pairs. Apply path could write `tone_updates` if non-empty — production never emits them.

### E3. Model2 consume user tone bias?

```text
MODEL2_TONE_PROFILE_CONSUMPTION = NO
```

Evidence: `finespan-adapter.ts` only `phonetic_bias` (+ personal_terms / domain / term evidence). Host/`model2_inference_host.py` pack `phonetic_bias` only. No `tone_bias` in Stage-J feature pack.

### E4. Tone pattern generalization to unseen lexical terms?

```text
MODEL2_TONE_GENERALIZATION = DESIGNED_NOT_CONNECTED
```

Schema/storage and historical feature keys exist; learning empty; runtime consumption absent. Hard-coded word maps are not Tone generalization and are not the Stage-J P path.

**Phonetic (n_l / z_zh / …) generalization via `phonetic_bias` is a separate, implemented channel** — not Tone.

---

## 6. Acoustic Tone vs user Tone profile

| Role | Status |
|------|--------|
| **A) Current-utterance acoustic tone** | Implemented as `acousticTonePattern` for Mandatory Tone Recall |
| **B) User-specific historical tone tendency** | Stored as `tone_bias` only; not learned; not consumed by Model2 |

```text
ACOUSTIC_TONE_INPUT_PRESENT = YES   # production path; Replay = false in practice
USER_TONE_PROFILE_PRESENT = NO      # for Model2 consumption (schema-only)
MODEL2_COMBINES_BOTH = NO
```

Conceptual target (acoustic X + user Y→X tendency) is **not** implemented.

---

## 7. Audit F — SSOT `TONE DEFERRED`

From `LINGUA_DIALOG2000_V2_PILOT200_SSOT.md`:

```text
TONE_AS_MODEL2_PROFILE_TARGET = DEFERRED
tone_bias reconnect
```

Plus: Tone may appear in TTS/ASR; **not scored as Model2 profile capability**.

```text
TONE_DEFERRED_MEANING =
  User-specific tone_bias as Model2 profile learn/score target is deferred;
  acoustic Tone evidence for recall may still exist in production;
  tone_bias reconnect is out of Pilot scope.
```

Distinction:

```text
4. Tone acoustic evidence can be active; user-specific tone learning is deferred.
```

```text
ARCHITECTURE_CONFLICT_FOUND = NO
```

Mandatory acoustic Tone for P recall does **not** contradict “tone_bias profile target deferred.”

---

## 8. Audit G — ACTIVE_SET_V1

Runtime (`training/model2_v2/runtime/active_set.py`):

```text
ACTIVE_SET_V1 = n_l, z_zh, ch_c, sh_s, eng_en, in_ing, h_f
```

Host uses this set for P applicability / permission. Pilot SSOT uses the same set. Tone relations are not in ACTIVE_SET_V1; deferred phonetic WEAK/REVERSED are separate from Tone.

```text
ACTIVE_SET_SCOPE = BOTH
```

Meaning: **Model2 runtime limit for Stage-J P relation catalog** and **Pilot scoring scope** — not “Pilot-only exclusion while runtime supports Tone relations.”

---

## 9. Independent verdicts

### A. Replay

```text
REPLAY_TONE_EVIDENCE_VERDICT =
  Fixed-RAW Replay lacks acousticTonePattern because frozen Block B artifacts
  omit asrSegments/acousticToneSlices; mock ASR injects text only and skips ASR.
  Tone gate then correctly fail-closes (no_pattern).
```

### B. Production Tone gate

```text
PRODUCTION_TONE_GATE_VERDICT = EXPECTED_DESIGN
```

Aligned with architecture intent: pronunciation recall requires current acoustic Tone evidence.

### C. Model2 consonant/final (ACTIVE relations)

```text
MODEL2_ACTIVE_RELATION_CAPABILITY = CONFIRMED
```

Via `phonetic_bias` + ACTIVE_SET_V1; UTF-8 delta showed P actions selected under CORRECT_PROFILE.

### D. Model2 user-specific Tone capability

```text
MODEL2_USER_TONE_CAPABILITY = DESIGNED_NOT_IMPLEMENTED
```

(storage reserved; learn/consume disconnected)

### E. Tone relation generalization to unseen words

```text
MODEL2_TONE_GENERALIZATION_CAPABILITY = NOT_CONFIRMED
```

---

## 10. Next action (do not implement)

```text
ONE_NEXT_OWNER = BLOCK_B_TONE_PERSISTENCE

ONE_RECOMMENDED_NEXT_DELTA =
  Capture/persist asrSegments + acousticToneSlices (or equivalent SSOT)
  from full-audio runs so a later harness can freeze RAW+Tone while varying
  UserProfile only. Do not bypass Tone; do not reconnect tone_bias yet;
  do not change Model2 weights.
```

Rationale: without persisted Tone artifacts, Replay cannot answer profile-conditioned P recall under the mandatory Tone gate. User Tone profile learning remains a **separate** deferred track (`MODEL2_TONE_PROFILE_GAP`).

---

## Final principle check

| Question | Answer |
|----------|--------|
| What evidence does design require for P recall? | Current-utterance `acousticTonePattern` (Mandatory Tone) |
| What exists in production? | Full lineage audio→slices→pattern→fail-closed recall |
| What did Replay discard / never freeze? | timestamps + Tone slices (Block B persist gap) |
| Which Model2 capabilities are implemented? | phonetic ACTIVE_SET relations via `phonetic_bias`; **not** user Tone profile |
