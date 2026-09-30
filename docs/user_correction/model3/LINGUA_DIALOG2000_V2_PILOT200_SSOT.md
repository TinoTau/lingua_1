# LINGUA_DIALOG2000_V2_PILOT200 — SSOT (Design Freeze)

**Status:** `LINGUA_DIALOG2000_V2_PILOT200_DESIGN_FROZEN`  
**Phase:** `LINGUA_DIALOG2000_V2_PILOT200_DESIGN_FREEZE`  
**Frozen date:** 2026-09-11  
**Mode:** DESIGN / SSOT FREEZE / PRE-DEVELOPMENT  

```text
PRODUCTION_CODE_CHANGE = NONE
DATASET_GENERATION = NONE
MODEL2 / MODEL3 / RETRY / LEXICON = KEEP FROZEN
```

This document is the **authoritative design source** for Pilot200 development. Implementation must not contradict it without a new freeze revision.

---

## 1. Identity

| Field | Value |
|-------|-------|
| `dataset_family` | `LINGUA_DIALOG2000_V2` |
| `dataset_stage` | `PILOT200` |
| `dataset_version` | `V1` |
| Formal name | `LINGUA_DIALOG2000_V2_PILOT200` |
| Future full set | `LINGUA_DIALOG2000_V2_FULL` (not this phase) |

**Must not** share identity with frozen golden `dialog_200`.

---

## 2. Scope — single research question

> When Model2 receives a UserProfile that satisfies the frozen Stage-J contract, can it generalize an already-evidenced **phonetic relation** to **lexical terms absent from that user’s profile history**, improving useful candidate expansion and final repair quality **without** systematic false expansion?

```text
learn pronunciation relation → apply to unseen word
≠ memorize wrong word → correct word
```

### In scope

- ACTIVE_SET_V1 relations only: `n_l`, `z_zh`, `ch_c`, `sh_s`, `eng_en`, `in_ing`, `h_f`
- Profile stages P0–P3 via existing `UserProfileV1` / `ProfileDelta`
- Real audio → Faster-Whisper → Lingua
- Pattern-level relation generalization + holdouts
- Clean / wrong-profile / NO_PROFILE controls

### Out of scope (DEFERRED)

```text
TONE_AS_MODEL2_PROFILE_TARGET = DEFERRED
ELISION = DEFERRED
CONNECTED_SPEECH_REDUCTION = DEFERRED
tone_bias reconnect
Model3 / Retry / Lexicon / KenLM redesign
real-world accent completeness claims
```

Tone may appear naturally in TTS/ASR; it is **not scored** as Model2 profile capability.

---

## 3. Old dialog_200 governance

```text
dialog_200 = P0 / NO_PROFILE / regression baseline
```

Forbidden: convert old wavs/references/baseline into Pilot profile-aware corpus.

---

## 4. User model

| userId | Dominant ACTIVE relations (frozen assignment) | Notes |
|--------|-----------------------------------------------|-------|
| U001 | `n_l` moderate, `in_ing` mild | dual-relation |
| U002 | `z_zh` strong, `sh_s` moderate | dual-relation |
| U003 | `eng_en` strong, `h_f` mild | dual-relation |
| U004 | `ch_c` moderate, `n_l` mild | dual; shares `n_l` with U001 for cross-user same-relation / different-lexicon tests |
| U005 | `sh_s` mild only | near-standard / user-pattern control |

- Cardinality: **1–2** dominant relations per user (max **3**, none at max in Pilot V1).
- Relations are **pattern-level**, never word dictionaries.
- Exact strength values come from **correction-history → ProfileDelta**, not hand-tuned magic floats.

---

## 5. Profile stages (P0–P3)

| Stage | Meaning | Construction |
|-------|---------|--------------|
| P0 | NO_PROFILE / empty active phonetic evidence | empty `UserProfileV1` |
| P1 | Sparse evidence; few corrections | short correction history → ProfileDelta |
| P2 | Medium; stable relation evidence | longer history, diversified build terms |
| P3 | Mature; stronger repeated evidence | more repeats / higher EMA strength via same contract |

Stages are **not** “entry count alone”; they reflect evidence strength, stability, and history diversity **within existing schema**.

**Preferred:** synthetic correction history → existing `ProfileDelta` → `UserProfileV1`.  
**Allowed:** direct fixture only for unit / injector verification / controlled A-B harness checks — not as primary Pilot baseline identity.

---

## 6. HARD GATE — profile build vs eval lexical isolation

```text
PROFILE_BUILD_TERMS ∩ EVALUATION_TARGET_TERMS = ∅
```

Same **relation**, different **words**. Violation → `DATASET_BUILD_FAIL`.

Manifest must record `profileBuildSetId` / build term ids and evaluation target term ids for validators.

---

## 7. Case volume and allocation principle

```text
5 users × 40 unique audio/reference utterances = 200 cases
```

- **200** = unique `(audio, reference)` identities.
- Profile conditions (`NO_PROFILE` / `CORRECT_PROFILE` / `WRONG_PROFILE`) and maturity (P1–P3) are **evaluation runs**, not extra dataset cases (§85).

### Counts (frozen targets; ± small tolerance at build)

| Class | Target count | Notes |
|-------|-------------:|-------|
| CLEAN / NON-TARGET | **40** (20%) | false-expansion / preserve checks |
| PROFILE_TARGET (relation opportunity) | **160** | perturbation applied ≠ ASR must fail |
| DEV / VALIDATION / HOLDOUT | **120 / 60 / 20** | see §11 |

### Relation opportunity mix (among targeted; approximate)

| Relation | Approx share of targeted |
|----------|-------------------------:|
| n_l | ~15% |
| z_zh | ~15% |
| eng_en | ~15% |
| in_ing | ~15% |
| ch_c | ~12% |
| sh_s | ~12% |
| h_f | ~10% |
| slack / clean remainder | via clean bucket |

Not an acceptance threshold — build validator only flags **gross domination**.

---

## 8. Domains and anti-confounding

Domains (Pilot must touch all):

```text
general_daily
software_meeting
travel_hotel
food_cafe
medical
retail_service
```

**HARD RULES**

- Each dominant relation spans **≥3 domains** when count allows, else **≥2**.
- No `relation ≡ domain`, no `userId ≡ domain`, no `userId ≡ single relation` monopoly.
- If multiple voices: no `relation ≡ voice`. Single Piper voice → record `SPEAKER_GENERALIZATION_NOT_TESTED`.

---

## 9. Audio generation path (frozen)

```text
referenceText (frozen before ASR)
  → phonetic relation perturbation (ACTIVE_SET only)
  → PronunciationCorruptor / PhonemeRealizer
  → Piper (or documented available TTS)
  → wav (+ audio identity hashes)
  → real Faster-Whisper
  → Lingua postprocess
```

**Forbidden main path:** manual corrupted ASR text → postprocess.  
`training/model3_error_text` = `REJECT_FOR_DIALOG2000_V2_MAIN_PATH` (unit only).

### Perturbation policy

- Severity: **MILD** majority, **MODERATE** minority, **STRONG** small minority.
- `perturbationApplied ≠ ASR must fail`. No regenerate-until-desired-ASR-error.
- ASR still correct → keep as `ASR_RESILIENT_CASE` / `ASR_RESILIENCE_CONTROL`.

### Speaker

- Pilot may use limited speakers; always record `speakerId`, `ttsEngine`, `voiceId`.
- Single-voice Pilot verdict must include: `MECHANISM_VALIDATED` + `REAL_WORLD_SPEAKER_GENERALIZATION_NOT_VALIDATED`.

---

## 10. Profile conditions (evaluation)

| Condition | Definition |
|-----------|------------|
| `NO_PROFILE` | P0 empty active profile |
| `CORRECT_PROFILE` | That user’s profile (P1/P2/P3) with tendencies for the case relation — **not** containing answer terms |
| `WRONG_PROFILE` | Another user’s profile whose dominant relations are **unrelated/conflicting**; must **not** contain correct answer term; if it shares the target relation → **invalid control**, re-pick |

Clean cases also sample all three conditions for overcorrection checks.

### Replay

- Preferred logic: same audio (+ same RAW if available) × 3 conditions.
- `PROFILE_A_B_REPLAY` = **EXPERIMENT_HARNESS_FROZEN** (controlled profile attribution only; **not** a production mainline step).
- Authoritative RAW policy: `NO_PROFILE` `rawMergedAsrText` from frozen Block B batch `blockb_2026-09-11T1021` (build `build_20260911_091806`).
- Replay position: post-ASR test harness — `POST /run-lexicon-mock` → `runPipelineWithMockAsr` → existing `runJobPipeline` (ASR skipped). Production runtime / Faster-Whisper **unchanged** and **not invoked** during replay.
- SessionBootstrap + UserProfileV1 only. No `testOnlyModel2Profile` / `model2ProfileOverride` bypasses.
- Two-layer evidence: Block B = full-audio profile run; Replay = fixed-RAW controlled attribution. Neither replaces the other.
- V1 historical note: same wav × three full pipeline runs recorded `rawAsrHash` variance (Block B rate 0.59) → approved this harness delta.

Injection must use existing **`SessionBootstrap` + `UserProfileV1`**. No `testOnlyModel2Profile` / `model2ProfileOverride` bypasses.

---

## 11. Splits and holdout

| Split | Count | Use |
|-------|------:|-----|
| DEV | 120 | inspect, debug generator/injector/evaluator |
| VALIDATION | 60 | aggregate metrics; no word-rules from case peeking |
| HOLDOUT | 20 | aggregate-only during tuning; no case-answer driven changes |

Holdout composition: unseen lexical targets, multiple relations/domains, wrong-profile controls, clean controls.  
U005 pattern supports limited user-level control — Pilot must not depend on U005 alone.

```text
Pilot200 ≠ Model2 training data
```

No train / finetune / hard-negative / holdout threshold gaming / lexicon patch / relation patch from Pilot failures.

---

## 12. Evaluation levels and metrics

### Level 1 — Acoustic

`REFERENCE`, `RAW_ASR`, normalized RAW, ASR correct/incorrect.

### Level 2 — Model2 expansion

`baseCandidates`, `model2Union`, P/D actions, counts, profile summary.

- **`MODEL2_USEFUL_EXPANSION`**: Lexicon has correct term **AND** Base Recall lacks useful candidate **AND** relevant profile relation applies **AND** Model2 introduces useful candidate.
- If target ∉ Lexicon → `TARGET_NOT_IN_LEXICON` / **not eligible** for useful-expansion metric (case may remain for ASR/corpus).
- **`MODEL2_FALSE_EXPANSION`**: profile-driven unrelated expansion (not count-only; use relation relevance + phonetic membership).

### Level 3 — Final quality

Reuse `LINGUA_ASR_REPAIR_NORMALIZED_BASELINE` logic: exact / CER / FULL_RESCUE / PARTIAL / UNCHANGED / REGRESSION.

### Profile metrics (measure first; **no numeric acceptance gates yet**)

- `PROFILE_GAIN` = quality(CORRECT) − quality(NO)
- `WRONG_PROFILE_DELTA` = quality(WRONG) − quality(NO)
- Candidate p50/p95/max; CrossPath >16 count; cap ≤16 retained
- Clean: `CLEAN_CORRECT_PRESERVED`, `CLEAN_REGRESSION`, `CLEAN_FALSE_EXPANSION`
- P0–P3 learning-curve tables (monotonicity **not** a hard gate yet)

If quality rises with pool explosion → report `QUALITY_GAIN_WITH_EXPANSION_COST` (not simple PASS).

---

## 13. Freeze gates before baseline run

```text
MANIFEST_VALID
PROFILE_LEXICAL_ISOLATION_PASS
RELATION_DISTRIBUTION_PASS
DOMAIN_DECONFOUND_PASS
NO_KNOWN_TEST_LEAK
AUDIO_IDENTITY_COMPLETE
REFERENCE_FROZEN
```

Then only: `PILOT200_PROFILE_AWARE_BASELINE_RUN`.

---

## 14. Development blocks (sequential)

```text
A Dataset Builder (FROZEN)
  → B Profile-Aware Runner (FROZEN)
  → Profile A/B Replay harness (FROZEN)   # inserted after Block B RAW variance
  → C Profile-Aware Evaluator (CURRENT)
```

| Block | Name | Status |
|-------|------|--------|
| **A** | Pilot Dataset Builder | `BLOCK_A_DATASET_FROZEN` (`build_20260911_091806`) |
| **B** | Profile-Aware Dialog Runner | `BLOCK_B_RUNNER_FROZEN` (`blockb_2026-09-11T1021`) |
| **Replay** | Profile A/B Replay (experiment harness) | `PROFILE_A_B_REPLAY_FROZEN` (`replay_2026-09-11T1347`) |
| **C** | Profile-Aware Evaluator | **CURRENT_PHASE** |

```text
CURRENT_PHASE = BLOCK_C_PROFILE_AWARE_EVALUATOR
```

**HISTORICAL DESIGN DECISION (I/J):** early Pilot design treated cached-ASR replay as optional and allowed A→B→C without a mandatory replay gate. After Block B measured `RAW_ASR_STABILITY_RATE=0.59`, replay was approved as an experiment delta for controlled profile attribution. That historical option is superseded by frozen `PROFILE_A_B_REPLAY`; do not interpret old I/J text as current sequencing.

Scripts/harness extensions preferred over new services/engines/DBs.

---

## 15. Architecture freeze during Pilot

```text
MODEL2 WEIGHTS/CODE/THRESHOLDS/RELATION SET = FROZEN
MODEL3 = FROZEN
RETRY = FROZEN
LEXICON = FROZEN DURING PILOT
```

Pilot failure → **failure owner audit**, not immediate retrain.

Full 2000 only after Pilot generation/injection/anti-leak/metrics are reliable → `LINGUA_DIALOG2000_V2_FULL_DESIGN`.

---

## 16. Required answers (A–T)

| # | Answer |
|---|--------|
| A | Relation generalization to unseen lexical terms under frozen UserProfile contract |
| B | ACTIVE_SET_V1 seven relations only |
| C | Tone **out of scope** as Model2 target |
| D | Elision **out of scope** |
| E | **5** users (U001–U005) |
| F | P0 empty; P1 sparse; P2 medium stable; P3 mature — via ProfileDelta history |
| G | Hard empty intersection of build terms vs eval target terms |
| H | NO=P0; CORRECT=user tendencies without answer terms; WRONG=other user, no shared target relation / answer term |
| I | Cached-ASR replay **not required** for first Pilot | **HISTORICAL DESIGN DECISION** — superseded: Replay harness frozen after Block B RAW variance |
| J | Record hashes; variance → ambiguous attribution; build replay only if needed | **HISTORICAL DESIGN DECISION** — Replay now frozen (`replay_2026-09-11T1347`) |
| K | **≥20%** clean (~40/200) |
| L | ≥2–3 domains per relation; forbid 1:1 maps |
| M | DEV120 / VAL60 / HOLD20 |
| N | Holdout aggregate-only; no train; lexical isolation validators |
| O | **No** expectedWrongAsrText / expectedReplacement / expectedFinalText — only `expectedBehaviorClass` |
| P | Model2 **frozen** — no modify during Pilot design/exec |
| Q | Lexicon **frozen** — no auto-add |
| R | Manifest/isolation/distribution/deconfound/leak/audio/reference gates |
| S | Reliable builder+injector+anti-leak+metrics → then FULL design |
| T | Blocks A Dataset Builder, B Runner, C Evaluator |

---

## 17. Final freeze state

```text
LINGUA_DIALOG2000_V2_PILOT200_DESIGN_FROZEN

PILOT200_DESIGN = FROZEN
BLOCK_A_DATASET = FROZEN (build_20260911_091806)
BLOCK_B_RUNNER = FROZEN (batch blockb_2026-09-11T1021)
PROFILE_A_B_REPLAY = EXPERIMENT_HARNESS_FROZEN (batch replay_2026-09-11T1347)
CURRENT_PHASE = BLOCK_C_PROFILE_AWARE_EVALUATOR
BLOCK_C_EVALUATION = COMPLETE
MODEL2_EXPANSION_VERDICT = MODEL2_EXPANSION_NOT_OBSERVED
FINAL_REPAIR_CONVERSION_VERDICT = FINAL_REPAIR_CONVERSION_NOT_APPLICABLE_NO_USEFUL_EXPANSION
MODEL2_PROFILE_EFFECT_VERDICT = MODEL2_PROFILE_EFFECT_NOT_OBSERVED
ONE_NEXT_OWNER = MODEL2_PROFILE_PERMISSION / P ACTION
MODEL2 = KEEP FROZEN
MODEL3 = KEEP FROZEN
RETRY = KEEP FROZEN
LEXICON = KEEP FROZEN
TONE = DEFERRED
ELISION = DEFERRED
OLD_DIALOG200 = KEEP AS P0/REGRESSION BASELINE
```

**Block C freeze note (evaluation only — not a production architecture change):**

```text
Replay = PRIMARY profile attribution evidence
Block B = FULL_AUDIO corroboration only
USEFUL_EXPANSION_CORRECT = 0 / 148 eligible
P_ACTION_COUNTS = 0 across NO/CORRECT/WRONG
PROFILE_GAIN_CER (Replay) = 0
```

**Replay freeze note (experiment harness only):**

```text
Replay Purpose: controlled profile attribution only
Authoritative RAW: NO_PROFILE RAW from frozen Block B batch
Replay Position: post-ASR test harness
Production Runtime: UNCHANGED
ASR: NOT INVOKED DURING REPLAY
```

**Observability diagnostic evidence note (not an architecture change):**

```text
OBSERVABILITY_DIAGNOSTIC_COMPLETE = YES
DIAGNOSTIC_RUN_ID = MODEL2_STAGE_J_OBSERVABILITY_DIAGNOSTIC_V1
FIRST_CONFIRMED_ZERO_ACTION_OWNER = MODEL2_INFERENCE_FAILED
NOTE = CORRECT_PROFILE Stage-J host fails UTF-8 surrogate encode on personal_terms before action selection; frozen Replay model2_invoked classifier overcounted INFERENCE_FAILED as invoked
```

**UTF-8 surrogate transport delta evidence note (not Model2/Tone architecture change):**

```text
UTF8_SURROGATE_SINGLE_DELTA_COMPLETE = YES
DIAGNOSTIC_RUN_ID = MODEL2_STAGE_J_UTF8_SURROGATE_SINGLE_DELTA_V1
ROOT_CAUSE = Windows Python stdin GBK misread of UTF-8 JSONL (byte 0xAA → U+DCAA)
FIX = stdin.buffer UTF-8 + PYTHONUTF8 + IPC unicode scalar sanitize
UTF8_SURROGATE_FAILURE_COUNT = 0
MODEL2_INFERENCE_SUCCESS_COUNT = 8
NEXT_CONFIRMED_OWNER = P_RETRIEVAL_TONE_NOT_READY (P) / D_MATERIALIZATION_EMPTY (D)
```

### MODEL2_FUTURE_TONE_COMPATIBILITY_RULE (FROZEN)

```text
MODEL2_FUTURE_TONE_COMPATIBILITY_RULE_FROZEN = true
MODEL2_USER_TONE_PROFILE = DEFERRED_FUNCTION_GAP

CURRENT:
  phonetic_bias → Model2 → PAction[]

FUTURE (when approved):
  phonetic_bias + tone_bias → Model2 V2 → SAME PAction contract

Downstream must depend only on PAction semantic contract.
Downstream must NOT branch on which UserProfile features produced the action.
Downstream must NOT require redesign of FineSpan ownership, FineSpan-local
acoustic Tone binding, relation adapter, Lexicon Recall, materialization,
assembly, Domain Vote, or KenLM when tone_bias is later enabled.

Acoustic Tone binding ownership (production):
  AcousticToneSlice → FineSpan geometry → toneRebindTrace
  → FineSpan-local acousticTonePattern → that FineSpan's P Recall
  Path-level / first-span Tone reuse is forbidden.
```

**FineSpan-local Tone binding delta note:**

```text
FINESPAN_LOCAL_TONE_BINDING_SINGLE_DELTA = YES
REMOVED = path-level first-non-empty toneRebindTrace reuse
RESTORED = FineSpan-local acousticTonePattern for Model2 P recall
```

**Architecture conflict:** none found — ACTIVE_SET + ProfileDelta + SessionBootstrap + real ASR path suffice for this Pilot; replay reuses the same post-ASR mainline via skip-ASR mock entry.  
Verdict: **`LINGUA_DIALOG2000_V2_PILOT200_DESIGN_FROZEN`** (not blocked).  
Replay harness verdict: **`LINGUA_DIALOG2000_V2_PILOT200_PROFILE_A_B_REPLAY_FROZEN`**.

---

## 18. Final principle

```text
RELATION GENERALIZATION > LEXICAL MEMORIZATION
DATASET VALIDITY > MODEL SCORE
```

If improving scores requires breaking lexical holdout, wrong-profile controls, clean preservation, real ASR, or production profile contract → **keep the low score and report the model limitation**.
