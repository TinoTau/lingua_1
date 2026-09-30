# Lingua Model3 V2 S3 Class Weight Forced Retrain + Causal Acceptance

Generated: 2026-09-02T13:37:34Z
Phase: `MODEL3_V2_S3_CLASS_WEIGHT_FORCED_RETRAIN_AND_CAUSAL_ACCEPTANCE`

## EXECUTIVE VERDICT

- **verdict**: `MODEL3_S3_CLASS_WEIGHT_RETRAIN_POSITIVE_INTERNAL_ONLY`
- **fresh A1 / A2**: see metrics table
- **selected candidate**: `MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1`
- **reproducibility**: A1=REPRODUCED A2=REPRODUCED
- **class-weight model-level signal**: `SUPPORTED`
- **mainline utility**: `INTERNAL_ONLY_NO_FINAL_UTILITY`
- **FIRST_CAUSAL_OWNER**: `NOT_YET_ISOLATED`
- **promotion readiness**: `False`
- **ACP**: NO
- **next phase**: `MODEL3_V2_S3_CLASS_WEIGHT_DOWNSTREAM_UTILITY_CAUSAL_AUDIT`

## SSOT CORRECTION

Premature `FIRST_CAUSAL_OWNER=CLASS_WEIGHT_RETRY` cleared → `NOT_YET_ISOLATED` until mainline final utility proven.

## G0 / DATASET IDENTITY

G0: **PASS** (`prod_core_s3_build_20260830_v1`)

## FRESH TRAINING PROVENANCE

A1/A2 trained with `--force-fresh-run` into `*_RERUN1` directories. `skipped=FALSE`, `reusedCheckpoint=FALSE`.

## BASELINE / FRESH A1 / FRESH A2

| arm | weight | epoch | dev F1 | dev prec | dev recall | false RETRY | status |
|-----|--------|-------|--------|----------|------------|-------------|--------|
| BASELINE | 1.0 | 8 | 0.850018 | 0.918752 | 0.790852 | 0.005159 | BASELINE |
| A1_RERUN1 | 2.0 | 6 | 0.860309 | 0.871725 | 0.849188 | 0.009217 | PASS_TRADEOFF |
| A2_RERUN1 | 4.0 | 8 | 0.858815 | 0.893587 | 0.826649 | 0.007261 | PASS_TRADEOFF |

## REPRODUCIBILITY

- A1_RERUN1: REPRODUCED (fresh F1=0.860309 vs prior 0.860309)
- A2_RERUN1: REPRODUCED (fresh F1=0.858815 vs prior 0.858815)

## HIGH12 (post-selection diagnostic)

- A1_RERUN1: CLEAR_OOS 4/6, LOCAL_FIT 1/3, SURFACE 0/3, HIGH12 fixed=5 regressed=0
- A2_RERUN1: CLEAR_OOS 3/6, LOCAL_FIT 1/3, SURFACE 0/3, HIGH12 fixed=4 regressed=0
- Held-out12 excluded from weight/epoch selection: **YES**

## SAME-UPSTREAM CAUSAL MAINLINE

- method: `offline_dual_Model3_on_model3_v2_s3_mainline_s3_raw_cases_packed_tensors`
- upstream parity: `PASS_FROZEN_PACKED_TRACES`
- Model3 changed cases: **158** / 200
- new RETRY span events: 384
- removed RETRY span events: 145
- CLEAR_OOS (6) Model3 decision changes: **6/6**
- final improved/regressed/unchanged: **0 / 0 / 42**
- decision-change cases without dual-weight final re-exec: **158** → cannot claim final-text utility

## FREEZE DECISION

- `FIRST_CAUSAL_OWNER` remains `NOT_YET_ISOLATED` (mainline final utility not proven)
- `CLASS_WEIGHT_MODEL_LEVEL_SIGNAL` = `SUPPORTED`
- `CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY` = `INTERNAL_ONLY_NO_FINAL_UTILITY`
- production checkpoint **not** replaced

## GOVERNANCE

- production runtime changed: **NO**
- dataset rebuilt: **NO**
- sampling / hard-negative / architecture / features / threshold: **NO**
- production checkpoint auto-replaced: **NO**

## NEXT PHASE

`MODEL3_V2_S3_CLASS_WEIGHT_DOWNSTREAM_UTILITY_CAUSAL_AUDIT`
