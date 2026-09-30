# LINGUA_DIALOG2000_V2_PILOT200 — Block A Freeze Correction Report

**Phase:** `LINGUA_DIALOG2000_V2_PILOT200_BLOCK_A_FREEZE_CORRECTION`  
**Final verdict:** `LINGUA_DIALOG2000_V2_PILOT200_BLOCK_A_DATASET_FROZEN`

---

## Build identity

| | |
|--|--|
| OLD_BUILD_ID | `build_20260911_010554` |
| NEW_BUILD_ID | `build_20260911_091806` |
| previous status | `SUPERSEDED_BY_BLOCK_A_FREEZE_CORRECTION` |
| dataset_id | `LINGUA_DIALOG2000_V2_PILOT200` |
| version | `V1` |
| seed | `20260911` |
| generator | `pilot200-builder-v1.1-freeze-correction` |

---

## Problem A — Model2 lexicon eligibility

### Old stats (superseded build)

```text
TARGET_NOT_IN_LEXICON_COUNT = 89
(core Model2 target eligibility was not separately reported; many PROFILE_TARGET terms missing from Lexicon)
```

### New stats

```text
MODEL2_TARGET_CASE_COUNT = 158
MODEL2_LEXICON_ELIGIBLE_TARGET_COUNT = 158
MODEL2_LEXICON_INELIGIBLE_TARGET_COUNT = 0
MODEL2_LEXICON_ELIGIBILITY_RATE = 1.0
TARGET_NOT_IN_LEXICON_COUNT = 0
```

### How targets were reselected

1. Read-only scan of frozen `node_runtime/lexicon/v3/lexicon.sqlite`
2. Keep / pad **build** banks to lexicon-present surfaces per ACTIVE relation
3. Mine **eval** banks = lexicon ∩ ACTIVE-applicable ∖ build-universe
4. Deterministic seed rank (`seed=20260911`); prefer natural multi-char surfaces
5. Materialize references from templates + new eval surfaces → regenerate audio → freeze

Selection basis only:

```text
lexicon_membership
active_relation_applicability
profile_eval_isolation
deterministic_seed_rank
domain-appropriate templates / natural sentence quality
frozen allocation rules
```

**Confirmed:** ASR / Model2 / KenLM / final repair outcomes were **not** used for target selection.

**Lexicon:** READ_ONLY — no INSERT/UPDATE/Pilot patch.

Artifact: `training/dialog2000_v2_pilot200/generated_term_banks_v1.json`

---

## Lexical isolation (re-proven)

```text
PROFILE_LEXICAL_ISOLATION_PASS = PASS
HOLDOUT_ISOLATION = PASS
case-level ∩ = empty
global Pilot build ∩ eval = empty
holdout eval ∩ all profile histories = empty
```

---

## Problem B — ProfileDelta parity

```text
PROFILE_DELTA_PARITY = PASS
```

- Authority dump: Rust `apply_profile_delta` / `apply_profile_delta_with_lexicon`  
  test `dump_pilot_profile_delta_parity_vectors` →  
  `training/dialog2000_v2_pilot200/parity/profile_delta_parity_vectors.json`
- Offline replay: `parity_check.py` against those vectors
- Histories: H_P0, H_P1, H_P2, H_P3, H_LEX (single/dual relation, repeats, multi-term lexical)
- Compared Pilot-used fields: `phonetic_bias`, `personal_terms`, `personal_term_evidence`, `profile_version`
- Note: offline helper does not rebuild `long_term_domain_evidence`; not required for phonetic-primary Pilot profiles; H_LEX phonetic+term evidence matched

**Production semantic change for ProfileDelta apply logic:** none (test-only dump added).

---

## Problem C — Real ASR audio smoke

```text
REAL_ASR_AUDIO_SMOKE = PASS
SMOKE_CASE_COUNT = 8
```

- Path: Pilot WAV → existing `FasterWhisperClient` → `:6007/utterance`
- Coverage: `PIPER_TTS_SURFACE` (clean) ×3, `CORRUPTOR_SURFACE_PIPER` ×3, `PHONEME_REALIZER` ×2; multiple relations
- Local start note: `TONE_P10_VAD_CPU=1` (existing service env) to avoid Silero VAD cuDNN crash on this machine; ASR model still CUDA Faster-Whisper medium
- Smoke ASR text **not** used to retarget dataset
- Report: `test wav/LINGUA_DIALOG2000_V2_PILOT200/validation/real_asr_audio_smoke.json`

---

## Validators (re-run)

All PASS:

- MANIFEST_VALID  
- PROFILE_LEXICAL_ISOLATION_PASS  
- HOLDOUT_ISOLATION  
- RELATION_DISTRIBUTION_PASS  
- DOMAIN_DECONFOUND_PASS  
- NO_KNOWN_TEST_LEAK  
- AUDIO_IDENTITY_COMPLETE  
- REFERENCE_FROZEN  
- WRONG_PROFILE_VALID  
- OLD_DIALOG200_UNCHANGED  
- LEXICON_READ_ONLY  
- MODEL2_LEXICON_ELIGIBILITY (rate=1.0)

Structure preserved: 200 cases, 5×40, 120/60/20, clean=42, ACTIVE_SET only.

---

## Files changed (this correction)

| Path | Change |
|------|--------|
| `training/dialog2000_v2_pilot200/lexicon_term_miner.py` | added |
| `training/dialog2000_v2_pilot200/term_bank_runtime.py` | added |
| `training/dialog2000_v2_pilot200/generated_term_banks_v1.json` | added |
| `training/dialog2000_v2_pilot200/parity/*` | production vectors + checker |
| `training/dialog2000_v2_pilot200/asr_smoke.py` | added |
| `training/dialog2000_v2_pilot200/build.py` | eligibility + banks wire-up |
| `training/dialog2000_v2_pilot200/validators.py` | MODEL2 eligibility gate |
| `training/dialog2000_v2_pilot200/profile_builder.py` | build_banks param |
| `training/dialog2000_v2_pilot200/constants.py` | generator v1.1 |
| `central_server/api-gateway/src/profile_delta.rs` | **test-only** parity dump (no apply semantics change) |
| `test wav/LINGUA_DIALOG2000_V2_PILOT200/**` | rematerialized dataset |

---

## Production freezes

| Flag | Value |
|------|-------|
| LEXICON_CHANGED | false |
| MODEL2_CHANGED | false |
| MODEL3_CHANGED | false |
| RETRY_CHANGED | false |
| PRODUCTION_SEMANTIC_CHANGE | false |
| OLD_DIALOG200_CHANGED | false |

---

## Final principle check

```text
DO NOT CHANGE LEXICON TO FIT DATASET — DONE
CHANGE DATASET TARGET SELECTION — DONE
RELATION GENERALIZATION > MEMORIZATION — holdout/isolation preserved
No outcome-based selection — confirmed
```

---

## Verdict

```text
LINGUA_DIALOG2000_V2_PILOT200_BLOCK_A_DATASET_FROZEN

ONE_NEXT_PHASE =
LINGUA_DIALOG2000_V2_PILOT200_BLOCK_B_PROFILE_AWARE_RUNNER_DEVELOPMENT
```
