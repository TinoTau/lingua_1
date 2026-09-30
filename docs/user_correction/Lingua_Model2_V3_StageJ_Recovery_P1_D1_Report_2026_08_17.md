# Lingua Model2 V3 Stage J Recovery — P1 + D1 Report
# Date: 2026-08-17

**Mode:** Controlled development + P1 training allowed. **No joint Stage J. No architecture change.**

**Baseline:** `Lingua_Model2_V3_StageJ_Recovery_Audit_2026_08_17.md`

**Artifacts:** `training/model2_v3/experiments/v3_stage_j_recovery_p1_d1/`

---

## Executive

| Experiment | Result |
|------------|--------|
| **P1** Stage-P-only + FEATURE_HASH_V1 + frozen refine recipe | **PASS** (primary RR **0.955** ≥ 0.95) |
| **D1** teacher/retrieval/metric contract (no model train) | **PASS** (eligible **12**, Oracle TIR **1.0**) |
| Joint J1 | **NOT EXECUTED** (await user confirm) |
| Architecture | **UNCHANGED** |

Interpretation:

- Stage P regression under V1 was **training reproduction**, not hash collapse / capacity.
- Prior D-only TIR=0 was **benchmark/contract**, not proven model failure.

---

## P1 — Stage-P-only FEATURE_HASH_V1

### Controlled variable

Only intentional change: `feature_hash: legacy → v1` (`MODEL2_FEATURE_HASH_V1`).

Unchanged: no domain head; `top1_labels`; BCE+1.25×pairwise(m=0.75)+0.25×CE(qb); train+hard×3; hard weight 5; sampler≤8000; Adam 3e-4; 12 epochs; qb=1; no applicability bonus; Phase2 init.

Checkpoint: `training/p1_stage_p_feature_hash_v1.pt`

### Eval (three denominators)

| Slice | N | RR | Notes |
|-------|---|----|-------|
| A Historical freeze-parity | 197 | N/A | row_id snapshot **not preserved**; not forged |
| B Current frozen-definition (`hard∧any_recover`, all splits) | **699** | **0.955** | **Primary gate** |
| C Held-out (Stage J shape) | 439 | 0.941 | Secondary |

### Top1 / Top2

| | Stage J (ref) | P1 |
|--|---------------|-----|
| Teacher @ Top1 | 0.72 | **0.915** |
| Teacher @ Top2 | 0.955 | **1.0** |

Refine recipe under V1 restored Top-1 ranking quality.

### Efficiency (current frozen-def, qb=1)

- QueryReduction ≈ **0.529**
- CandidateReduction ≈ **0.377**
- E2E (frozen formula) ≈ **0.479**

### Relation slices (subsample)

Most relations ≥0.93; weakest subsample: `in_ing`≈0.907, `ch_c`≈0.922. Aggregate primary still PASS.

### P1 verdict

**PASS** → `STAGE_P_FEATURE_HASH_V1_BASELINE` **READY_TO_FREEZE**.

---

## D1 — Stage D recoverability contract (no training)

### Target identity

Frozen: **`StageDRetrievalTargetIdentityV1`** = `(surface, pinyin_key)`.

- Lexical identity ≠ provenance (`term_id` / `base:` vs `domain:`).
- Module: `training/model2_v3/policy/stage_d_target_identity_v1.py`

### FuzzyPool dedup

- Mechanism: sort `(distance, -prior, term_id)` then first surface wins.
- Often keeps `base:` sibling (term_id ASC).
- **Frozen design, not bug. Production change: NO.** Metric follows identity.

### Teacher

- Was: synthetic domain labels.
- Now: **execute-validated** — base-absent under identity ∧ evidence-guided soft domain action recovers.
- TeacherExecutionHitRate = **1.0** (by construction).

### Eligible D-only

| | |
|--|--|
| Count | **12** (<100; actual recoverable under soft prior + ASR-like FineSpan) |
| Construction | `pronunciation_corrupt_finespan_v1` on D2 CORRECT groups |
| Why not exact D2 spans | Exact syllables → always base-visible under identity → introduction metric vacuous |
| Soft prior | **UNCHANGED** (no hard filter) |
| Base-absent | **PASS** |
| Oracle TIR | **1.0** |
| Correct / Empty / Wrong / Swapped | VALID; Correct=1.0 Empty=0.0 Wrong=0.25 Swapped≈0.42 |
| Vacuous PASS | **REMOVED** |

### D1 verdict

**PASS** → Stage D benchmark **READY** for model learning in J1.  
**Stage D model failure: NOT_TESTED_THIS_ROUND.**

---

## Joint

| | |
|--|--|
| Joint Interference Auditable | **YES** (P1+D1 both PASS) |
| Joint training executed | **NO** |
| Next | `STAGE_J_J1_CONTROLLED_JOINT_TRAINING` after user confirm |

---

## Artifacts

P1: `p1_controlled_variables.json`, `p1_training_config.json`, `p1_dataset_manifest.json`, `p1_freeze_parity_eval.json`, `p1_current_frozen_definition_eval.json`, `p1_heldout_eval.json`, `p1_top1_top2.json`, `p1_relation_slices.json`, `p1_efficiency.json`, `p1_checkpoint_manifest.json`, `p1_regression_comparison.json`

D1: `d1_lexical_identity_vs_provenance_audit.md`, `d1_fuzzypool_dedup_audit.json`, `d1_target_identity_contract.json`, `d1_teacher_contract.json`, `d1_execute_validated_teacher.json`, `d1_eligible_d_only_manifest.json`, `d1_base_absence_validation.json`, `d1_teacher_execution_metrics.json`, `d1_domain_oracle_metrics.json`, `d1_counterfactual_manifest.json`, `d1_metric_contract.json`, `d1_multitag_validation.json`, `d1_negative_controls.json`, `d1_failure_taxonomy.json`

Shared: `modified_file_inventory.csv`, `architecture_conformance_check.json`, `go_summary.json`

---

## FINAL VERDICT

```
Stage J Recovery P1+D1:
PASS

Architecture:
UNCHANGED

====================
P1
====================

P1 Stage-P-only V1:
PASS

Only Intentional Feature Change:
LEGACY_HASH → MODEL2_FEATURE_HASH_V1

Frozen Recipe Reproduced:
PASS

Historical Freeze-Parity N:
197 (row_id snapshot NOT_PRESERVED)

Historical Freeze-Parity RR:
N/A (cannot forge); use Current Frozen-Definition

Current Frozen-Definition N:
699

Current Frozen-Definition RR:
0.955

Held-Out N:
439

Held-Out RR:
0.941

Teacher Top1:
0.915

Teacher Top2:
1.0

Query Reduction:
0.529

Candidate Reduction:
0.377

Stage P V1 Baseline:
READY_TO_FREEZE

Primary Remaining P Issue:
held-out secondary RR 0.941; some relation slices <0.95 on subsample; historical n=197 unreproducible

====================
D1
====================

D1 Recoverability Contract:
PASS

Target Identity Contract:
StageDRetrievalTargetIdentityV1 (surface + pinyin_key)

Lexical Identity / Provenance:
SEPARATED

FuzzyPool Dedup Production Change:
NO

Teacher Recoverability:
EXECUTE_VALIDATED

Eligible D-only Count:
12

Base-Absent Validation:
PASS

Teacher Execute Hit Rate:
1.0

Domain Oracle TIR:
1.0

Metric Contract:
PASS

Vacuous PASS:
REMOVED

Correct / Empty / Wrong / Swapped:
VALID

Soft Domain Prior:
UNCHANGED

Stage D Benchmark:
READY

Stage D Model Failure:
NOT_TESTED_THIS_ROUND

====================
JOINT
====================

Joint Interference Auditable:
YES

Joint Training Executed:
NO

Architecture Change Required:
NO

Recommended Next Phase:
STAGE_J_J1_CONTROLLED_JOINT_TRAINING (await user confirm)
```
