# Model2 Integration Contract Repair Audit

Generated: 2026-09-11  
Phase: `MODEL2_INTEGRATION_CONTRACT_REPAIR_AUDIT`  
Mode: READ_ONLY / CONTRACT-TRACE  
RUN_ID: `dialog200_full_pipeline_20260909_001141`

## Verdict

`MODEL2_INTEGRATION_AUDIT_PASS_NO_BREAK_FOUND`

```text
FIRST_CONFIRMED_CONTRACT_BREAK = NO_CONFIRMED_BREAK
ONE_DELTA_CANDIDATE = NONE
ONE_NEXT_PHASE = MODEL2_EXPANSION_BEHAVIOR_TARGETED_AUDIT
PREVIOUS_6_OF_10 = NOT_CONFIRMED (as integration gap)
PRODUCTION_CODE_CHANGE = NONE
MODEL3 = KEEP FROZEN
RETRY = KEEP FROZEN
LEXICON = UNCHANGED
MODEL2 WEIGHTS = UNCHANGED
```

## Authoritative contract (Q1)

Latest accepted freeze stack (2026-08-17/18):

- Model2 = FineSpan-local **user-conditioned P/D candidate expansion** (RetrievalPolicyV3 Stage-J)
- ACTIVE profile inputs: `phonetic_bias`, `personal_terms`, `personal_term_evidence`, `long_term_domain_evidence`
- `tone_bias` / `confusion_bias` / `domain_bias` = schema retained but **not Stage-J ACTIVE Model2 inputs**
- Empty/missing profile: **still invoke** Model2 (no external skip); P actions require `phonetic_bias[relation]>0`
- dialog_200 evaluation product state: **NO_PROFILE** (200/200)

Sources: Stage D Restoration Freeze; Stage J Model Freeze; Stage J Runtime Swap; Post-Trace Freeze; `model2_v3_userprofile_feature_audit.md`; `user_profile.rs`.

## Signal authority answers

| Signal | Authority | Alignment |
|--------|-----------|-----------|
| phonetic_bias | ACTIVE | ALIGNED |
| personal_terms | ACTIVE | ALIGNED |
| personal_term_evidence | ACTIVE | ALIGNED |
| long_term_domain_evidence | ACTIVE | ALIGNED |
| tone_bias | SUPERSEDED / DEFERRED Tone HOLD → STORAGE_ONLY for Stage J | ALIGNED (not connected by design) |
| confusion_bias | SUPERSEDED / UNUSED | ALIGNED |
| domain_bias | SUPERSEDED for Model2 D (D uses long_term_domain_evidence) | ALIGNED |

### tone_bias (critical)

**D — not A:** `STORAGE_ONLY_NOT_MODEL2_INPUT` under current Stage-J authority (`DEFERRED_BY_DATA` / Tone HOLD).

- Not ACTIVE_REQUIRED_BY_FROZEN_DESIGN for Stage J
- Not renamed-away by phonetic_bias (separate deferred channel)
- Correction `tone_updates` ALWAYS EMPTY
- **DO NOT RECONNECT** as this phase's quality Delta (`STALE_FIELD_CANDIDATE` only)

### phonetic_bias (critical)

**Option 2 — `HARD_PERMISSION_GATE`** for P expansion eligibility.

Evidence: Stage J Runtime Swap + `model2_inference_host.py` relation filter + runtime test *EMPTY profile still invokes ONE Model2 (no P actions)*; Correct profile introduces targets.

Soft neural conditioning also applies when bias is non-empty. Domain **soft prior** freeze (never hard-filter D universe) is a **different** layer — do not conflate with P relation gate.

Current hard gate is **implementation aligned with Stage-P/J authority**, not proven semantics drift.

### Cold start

| Layer | Semantics |
|-------|-----------|
| Model2 invoke | ALWAYS_RUN (no external empty skip) |
| P expansion | `PROFILE_REQUIRED` (empty bias → no P actions) |
| D expansion | GENERIC_ALLOWED (known over-expansion limitation; no empty external gate) |

## Runtime chain (Q2–Q3)

For all ACTIVE signals:

```text
correction/writeback → UserProfile storage → SessionBootstrap load → adapter → sidecar → P/D consumer
```

Status: **CONNECTED** end-to-end in code.

`MODEL2_SPAN_CONTRACT = CONNECTED_BY_CODE` (prior `INPUT_SPAN_PRESENT_COUNT=0` was dump observability mis-stats, not a missing FineSpan→Model2 wire).

### RUN_ID profile (Q4 evidence)

`RUN_ID_PROFILE_RECOVERABLE = true` → value **`NO_PROFILE`**.

Recovery: Post-Trace Freeze + Stage J Dialog200 acceptance (not inventing cafe profiles). Fresh dialog200 runner does not supply session UserProfile.

## Calibration of previous 6/10

`PREVIOUS_6_OF_10_FINDING_STATUS = NOT_CONFIRMED`

Reinterpretation:

| Layer | Fact |
|-------|------|
| EXISTS / STORED / LOADED / PASSED / CONSUMED path | Intact |
| POPULATED on dialog200 RUN | **No** (NO_PROFILE by design) |
| AFFECTS DECISION | Empty bias → P inert — **designed** |

Therefore “MODEL2_REQUIRED_FEATURE_NOT_SUPPLIED” as **integration wiring failure** is **not confirmed**. It described empty population under NO_PROFILE eval.

## First confirmed break

`FIRST_CONFIRMED_CONTRACT_BREAK = NO_CONFIRMED_BREAK`

No ACTIVE authoritative signal shows DROPPED / TRANSFORMED_INCORRECTLY / NOT_CONSUMED unexpectedly.

## Required answers

| # | Answer |
|---|--------|
| A | Stage-J user-conditioned P/D expansion; StageDProfileContractV1 + phonetic_bias |
| B | phonetic_bias, personal_terms, personal_term_evidence, long_term_domain_evidence |
| C | tone_bias, confusion_bias, domain_bias (deferred/storage/not D input) |
| D | **No** — not Stage-J ACTIVE |
| E | **HARD_PERMISSION_GATE** for P (+ soft neural when present) |
| F | Invoke yes; P no until phonetic relations learned; D may still fire |
| G | Yes (phonetic/personal/domain-evidence writeback acceptance) |
| H | Yes (SessionBootstrap → node agent) |
| I | Yes (finespan-adapter) |
| J | Yes (sidecar pack + P/D executors) |
| K | tone_bias, confusion_bias, domain_bias |
| L | Yes — run-level NO_PROFILE |
| M | **NOT_CONFIRMED** as integration break |
| N | Expected empty under NO_PROFILE + P hard gate |
| O | `NO_CONFIRMED_BREAK` |
| P | No retrain |
| Q | Lexicon not this phase |
| R | No Model3/Retry reopen |
| S | `MODEL2_EXPANSION_BEHAVIOR_TARGETED_AUDIT` with **non-empty profile** probes |

## Freeze

```text
MODEL3 = KEEP FROZEN
RETRY_ARCHITECTURE = KEEP FROZEN
LEXICON = UNCHANGED
FULL_MAINLINE = KEEP FROZEN
MODEL2 WEIGHTS = UNCHANGED
MODEL2 RETRAIN = NO
```
