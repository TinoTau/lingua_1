# Lingua Model2 V3 Stage J — Recovery Audit
# Date: 2026-08-17

**Mode: AUDIT ONLY — NO TRAINING / NO ARCHITECTURE / NO RUNTIME CHANGE**

**Baseline:** Stage J ONE Unified Training + Acceptance (2026-08-17) — HOLD; RR≈0.813; D-only TIR=0.0

**Artifacts:** `training/model2_v3/experiments/v3_stage_j_recovery_audit/`

---

## Executive answers (Q1 / Q2)

### Q1 — Why Stage P under FEATURE_HASH_V1 cannot reproduce frozen RR≈1.0?

**Primary layer: TRAINING (reproduction) + DATA (eval contract), not hash collapse.**

1. Frozen Stage P capability came from **`run_v3_phase3_stage_p_refine.py`** (`bce_pairwise_top1`, teacher soft Top-1 labels, hard×3 oversample, lr=3e-4, 12 epochs, **no domain head**, **legacy Python hash**).
2. Stage J never ran that refine recipe under V1: multi-hot labels, different pairwise/BCE path, domain head on, different mix/lr/epochs, held-out denominator **n=439** vs freeze **n=197** (all-split hard).
3. V1 hash **does** remap nearly all vectors vs process-local legacy hash, but occupancy/entropy/unique counts are **not** collapsed (`FEATURE_HASH_INFORMATION_LOSS = NO`). Hash migration requires controlled retrain; it does **not** alone prove representation failure.
4. Under current Stage J ckpt: teacher action at Top1 ≈ **72%**, at Top2 ≈ **95.5%** → residual gap is largely **TOP1_RANKING_QUALITY** under incomplete recipe, not representation wipeout.

### Q2 — Why Stage D evaluation Target Introduction = 0?

**Primary layer: RETRIEVAL + METRIC (+ TEACHER label contract) — NOT proven MODEL failure.**

1. D2 has **no** execute-validated `teacher_any_recover`; labels are synthetic from `target_domains`.
2. Targets are often `domain:…` term_ids; FuzzyPool **surface-dedup keeps `base:`** sibling → teacher domain action execution **TID hit ≈ 0**, **SURFACE hit ≈ 1**.
3. Stage J TIR uses **exact term_id** only (no surface fallback); Stage D1 historically allowed surface match → contract drift.
4. Eligible D-only introduction slice (base-absent ∧ domain-introducible under surface) = **0** → current D-only TIR cannot accept/reject the model.
5. Prior vacuous PASS (`Correct=0`, `Empty=0`) is a **METRIC_BUG**. Soft domain action is still soft prior (not hard filter).

**Stage D model is not proven to fail.** Joint interference is **NOT_YET_AUDITABLE**.

---

## Part A — Stage P under FEATURE_HASH_V1

### A.1 Frozen Stage P recipe (reconstructed)

See `stage_j_recovery_stage_p_frozen_recipe.md`.

| Item | Frozen value |
|------|----------------|
| Authoritative path | `run_v3_phase3_stage_p_refine.py` |
| Dataset | `policy_phase2/rows.jsonl` + baseline_v1 candidate index |
| Hash | legacy `hash()` via `pack_batch_inputs` default |
| Model | `RetrievalPolicyV3()` **without** domain head (~45533) |
| Labels | `top1_labels` teacher soft (not raw multi-hot) |
| Loss | BCE + **1.25×pairwise(margin=0.75)** + **0.25×CE(qb)** |
| Train | train + hard×3; hard weight 5; sampler ≤8000; Adam **3e-4**; **12** epochs |
| Eval | `is_hard_multi ∧ any_recover`, **all splits**, historical n=197 |
| Decode | qb=1; no applicability bonus; hit = tid ∈ new_ids |

### A.2 Legacy vs V1 hash

| Metric (n=500 FineSpan packs / token audit) | Legacy | V1 |
|---------------------------------------------|--------|-----|
| Vectors identical | — | 0% |
| Mean changed dims | — | ~5.5 / 64 |
| Unique vectors | 292 | 297 |
| Used buckets | 62 | 64 |
| Occupancy entropy | ~3.85 | ~3.81–3.83 |
| `FEATURE_HASH_INFORMATION_LOSS` | — | **false** |

Artifacts: `stage_j_hash_legacy_vs_v1_features.json`, `stage_j_hash_distribution_audit.json`.

### A.3 Non-hash feature semantics

`stage_j_stagep_feature_semantics_matrix.csv`:

- **CHANGED:** span hash bag; unknown phonetic key_id hashing under V1.
- **NEW_IN_J:** domain evidence slots + domain_action_head (frozen Stage P absent).
- **SAME:** ACTIVE_SET_V1 phonetic bias, applicability bitmask, budgets/state, QB classes, 50 phonetic actions, decode without applicability bonus.

**Non-Hash Feature Drift: YES** (domain head / packing path), but Stage P phonetic core is same aside from hash.

### A.4 Dataset / HardMulti parity

| | Freeze | Stage J |
|--|--------|---------|
| Hard def | `is_hard_multi ∧ any_recover`, all splits | + HARD_VARIANTS + held-out only |
| Eval n | 197 (historical) / 699 today under freeze def | 439 |
| B1 query count | sum `execute_action.n_queries` | `len(actions)` |
| E2E | Q+0.2C+0.001·P50 | Q+0.2C |

**DATASET_DRIFT = YES**, **METRIC_CONTRACT_DRIFT = YES** (`stage_j_stagep_dataset_parity.json`, `stage_j_stagep_hardmulti_parity.json`).

### A.5 Top-1 / Top-2 (V1 Stage J ckpt, sample n=200 hard)

| | Value |
|--|-------|
| Teacher @ Top1 | **72.0%** |
| Teacher @ Top2 | **95.5%** |
| Below Top2 | 4.5% |
| B1 hit / V3 hit | 190 / 149 |
| RR proxy on sample | ~0.784 |

Miss pattern: teacher often sits at Top2 with large Top1–Top2 margin (wrong single relation). Classifies as **TOP1_RANK_MISS** under incomplete training recipe — not collapse.

### A.6 Stage P failure taxonomy (primary)

| Class | Role |
|-------|------|
| TRAINING_REPRODUCTION_PROBLEM | **PRIMARY** |
| DATASET_DRIFT | **PRIMARY** |
| METRIC_CONTRACT_DRIFT | secondary |
| HASH_COLLISION_OR_REPRESENTATION | secondary change, **not** collapse |
| TOP1_RANK_MISS | symptom on miss set (47/57 observed) |
| FEATURE_SEMANTIC_MISMATCH (non-hash) | minor (domain head) |

**VERDICT A: MIXED** — reproduction + dataset/metric drift; **not** capacity; **not** “need new model”.

### A.7 Controlled P1 plan (no train this round)

`stage_j_stagep_v1_reproduction_plan.md`: only intentional change = `feature_hash="v1"`; keep refine recipe; dual-report freeze-parity vs held-out denominators.

**Controlled Stage P V1 Retraining Ready: YES**

---

## Part B — Stage D recoverability

### B.1 Teacher contract

- D2: **no** `teacher_any_recover` field.
- Labels: `soft_labels_for_domains(target_domains)` — **synthetic**, not execute-validated.
- D1 historical `any_recover` ≈ `bool(label_domains)` — also not execute-validated.

### B.2 Teacher action execution (bypass Model2)

On Correct-held D rows (n=40 sample path):

| Metric | Value |
|--------|-------|
| TEACHER_EXECUTION_HIT_RATE (term_id) | **0.0** |
| TEACHER_EXECUTION_HIT_RATE (surface) | **1.0** |
| target_in_index | 1.0 |
| base_visible (surface) | 1.0 |
| ELIGIBLE_D_ONLY (surface absent ∧ introducible) | **0** |

Trace: `stage_j_d_teacher_execution_trace.jsonl`.  
Root mechanism: FuzzyPool surface-dedup prefers `base:` over `domain:` for same surface → tid never returned; surface always “hits”.

### B.3 Train vs eval retrieval

| | Finding |
|--|---------|
| Soft domain action | SOFT PRIOR / soft-rerank; **hard_filter=False** — no DOMAIN_ACTION_EXECUTION_DRIFT as hard filter |
| TRAIN_EVAL_RETRIEVAL_DRIFT | **YES** — synthetic labels vs execute; Stage J tid-only vs D1 surface-or-tid |
| Index | targets exist; multi-tag siblings present (`stage_j_d_index_audit.json`) |

### B.4 Eligible slice / metrics / counterfactual

| Check | Result |
|-------|--------|
| ELIGIBLE_D_ONLY_COUNT | **0** — D-only TIR not usable for model acceptance |
| Metric contract | **FAIL** — vacuous PASS bug; tid vs surface drift |
| Counterfactual structure | **PASS** (same FineSpan/target, profile differs; 0 violations on 50 groups) |

### B.5 Stage D failure taxonomy

| Class | Rate (on audited Correct-held) |
|-------|--------------------------------|
| TARGET_BASE_VISIBLE_SURFACE | 1.0 |
| TEACHER_ACTION_NOT_EXECUTABLE_FOR_TID | 1.0 |
| DOMAIN_ID_POOL_DEDUP_VS_BASE | 1.0 |

**Primary:** RETRIEVAL_EXECUTION_PROBLEM + METRIC_PROBLEM + TEACHER_PROBLEM.  
**Stage_D_Model_Actually_Proven_To_Fail: NO**  
**VERDICT B: MIXED**

---

## Part C — Joint interference

P1 (controlled V1 Stage-P-only refine) and D1 (teacher/exec/metric; no model train) are not yet PASS.

| | |
|--|--|
| Joint mix / loss magnitude | recorded from Stage J config only; **not interpreted** |
| VERDICT C | **NOT_YET_AUDITABLE** |
| JOINT_INTERFERENCE_CONFIRMED | **NOT_YET** |
| POSSIBLE_CAPACITY_LIMIT | **not claimed** (47210 params not primary suspect) |

---

## Architecture conformance

All YES: ONE Model2, FineSpan, UserProfile, Lexicon SSOT, No Stage A/B, No router/gate, No new model, No deterministic replacement, No runtime change.

**Architecture_Change_Required: NO**

---

## Required next experiments (controlled)

1. **Experiment P1** — Stage P only + FEATURE_HASH_V1 + exact frozen refine recipe; dual eval denominators.  
2. **Experiment D1** — **NO model training**; align tid vs surface hit; FuzzyPool `domain:`/`base:` dedup contract; rebuild eligible D-only slice.  
3. **Experiment J1** — joint **only after** P1 + D1 PASS.

Do **not** re-run full Stage J aggregate until then.

---

## Artifact checklist

| Artifact | Path under `v3_stage_j_recovery_audit/` |
|----------|----------------------------------------|
| Frozen recipe | `stage_j_recovery_stage_p_frozen_recipe.md` |
| Hash compare | `stage_j_hash_legacy_vs_v1_features.json` |
| Hash distribution | `stage_j_hash_distribution_audit.json` |
| Feature semantics | `stage_j_stagep_feature_semantics_matrix.csv` |
| Dataset parity | `stage_j_stagep_dataset_parity.json` |
| HardMulti parity | `stage_j_stagep_hardmulti_parity.json` |
| Top1/Top2 | `stage_j_stagep_top1_top2_distribution.json` |
| P failure taxonomy | `stage_j_stagep_failure_taxonomy.json` |
| P1 plan | `stage_j_stagep_v1_reproduction_plan.md` |
| D teacher contract | `stage_j_d_teacher_contract_audit.json` |
| D teacher metrics | `stage_j_d_teacher_execution_metrics.json` |
| D teacher trace | `stage_j_d_teacher_execution_trace.jsonl` |
| D index | `stage_j_d_index_audit.json` |
| D action semantics | `stage_j_d_action_execution_semantics.json` |
| D eligible slice | `stage_j_d_eligible_slice_audit.json` |
| D metric | `stage_j_d_metric_audit.json` |
| D counterfactual | `stage_j_d_counterfactual_audit.json` |
| D failure taxonomy | `stage_j_d_failure_taxonomy.json` |
| Joint mix / loss | `stage_j_joint_mix_audit.json`, `stage_j_joint_loss_magnitude_audit.json` |
| Architecture | `stage_j_recovery_architecture_conformance.json` |
| Summary | `go_summary.json` |

---

## FINAL VERDICT

```
Stage J Recovery Audit:
PARTIAL

Stage J Architecture:
UNCHANGED

Stage P V1 Regression Root Cause:
TRAINING_REPRODUCTION_PROBLEM + DATASET_DRIFT (Top-1 refine recipe not reused; eval denominator differs); hash change requires retrain but is NOT information-loss collapse

Legacy vs V1 Hash Information Loss:
NO

Non-Hash Feature Drift:
YES

Stage P Dataset Drift:
YES

HardMulti Metric Drift:
YES

Correct Teacher Action Top1:
0.72

Correct Teacher Action Top2:
0.955

Primary Stage P Failure Class:
TRAINING_REPRODUCTION_PROBLEM

Controlled Stage P V1 Retraining Ready:
YES

Stage D Eligible Recoverable Cases:
0

Teacher AnyRecover Cases:
D2 field absent; synthetic from target_domains

Teacher Action Execute Hits:
TID=0.0 / SURFACE=1.0

Teacher Execution Hit Rate:
0.0 (term_id contract)

Stage D Evaluation Index:
PASS

Stage D Metric Contract:
FAIL

Stage D Counterfactual Dataset:
PASS

Primary Stage D Failure Class:
RETRIEVAL_EXECUTION_PROBLEM + METRIC_PROBLEM (+ TEACHER_PROBLEM); not MODEL_PROBLEM

Stage D Model Actually Proven To Fail:
NO

Joint Interference Auditable:
NO

Joint Interference Confirmed:
NOT_YET

Architecture Change Required:
NO

Recommended Next Phase:
Experiment P1 (Stage-P-only FEATURE_HASH_V1 + frozen refine recipe) then Experiment D1 (teacher/action/retrieval/metric; no model train); Experiment J1 only after both PASS
```

### Required verdicts (A/B/C)

| | Verdict |
|--|---------|
| A. FEATURE_HASH_V1 Stage P | **MIXED** |
| B. Stage D | **MIXED** |
| C. Joint | **NOT_YET_AUDITABLE** |
