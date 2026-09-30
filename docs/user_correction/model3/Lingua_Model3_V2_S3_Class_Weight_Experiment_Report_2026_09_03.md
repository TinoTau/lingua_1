# Lingua Model3 V2 S3 Class Weight Experiment Report

Generated: 2026-09-02T12:39:32Z
Phase: `MODEL3_V2_S3_CLASS_WEIGHT_EXPERIMENT_DEVELOPMENT`

## EXECUTIVE VERDICT

- **verdict**: `MODEL3_S3_CLASS_WEIGHT_EXPERIMENT_A1_SELECTED`
- **baseline**: dev F1=0.850018 false RETRY=0.005159
- **A1 (cw=2.0)**: dev F1=0.860309 status=PASS_TRADEOFF
- **A2 (cw=4.0)**: dev F1=0.858815 status=PASS_TRADEOFF
- **selected arm**: A1 (`class_weight_retry=2.0`, epoch 6)
- **class-weight causality**: `True`
- **dev quality**: A1 ΔF1=0.010291 IMPROVED; A2 ΔF1=0.008797 IMPROVED
- **false RETRY safety**: A1 TRADEOFF (Δ=0.004058); A2 TRADEOFF (Δ=0.002102)
- **held-out HIGH12**: A1 fixed 5/12, regressed 0
- **second-seed need**: `False`
- **ACP**: not required before causal mainline acceptance
- **next phase**: `MODEL3_V2_S3_CLASS_WEIGHT_CAUSAL_MAINLINE_ACCEPTANCE`

## PREDECLARED ACCEPTANCE GATES

```json
{
  "gateA_devRetryF1_toleranceNeutral": 0.002,
  "gateA_devRetryF1_improvedMinDelta": 0.002,
  "gateA_devRetryF1_regressedMaxDelta": -0.002,
  "gateB_precisionCollapseWarnDelta": -0.015,
  "gateD_falseRetrySafeAbsoluteDeltaMax": 0.002,
  "gateD_falseRetryTradeoffAbsoluteDeltaMax": 0.01,
  "gateD_falseRetryUnsafeAbove": 0.01,
  "tieBreakRule": "LOWER_CLASS_WEIGHT_IF_DEV_F1_WITHIN_TOLERANCE",
  "baselineAllowedToWin": true,
  "heldout12ExcludedFromSelection": true
}
```

## EXPERIMENT IDENTITY

- parentModelId: `MODEL3_V2_S3_RANDOM_INIT_V1`
- parentWeightsSha256: `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1`
- datasetId: `MODEL3_V2_PRODUCTION_CORE_S3`
- datasetBuildId: `prod_core_s3_build_20260830_v1`
- seed: `2026083013`
- A1 weightsSha256: `2d1c763249d5fca5c7586ea41868e391cc70e495069b5bab5f2e5905982e1bd0`
- A2 weightsSha256: `00b822a487b5a8f21a6555aef2a7ed21cf503a2d7d8393a63df105383fcbe868`

## SINGLE-VARIABLE PARITY

Only `class_weight_retry` differs across arms. Sampling=`uniform_shuffle_utterance`, hardNegative=`NONE`, architecture/features/threshold/optimizer/LR/batch/epochs/checkpoint criterion unchanged.

## TRAINING EXECUTION

```
python training/model3_dataset/train/train_s3_random.py --experiment-id MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1 --class-weight-retry 2.0
python training/model3_dataset/train/train_s3_random.py --experiment-id MODEL3_V2_S3_EXP_CLASS_WEIGHT_A2 --class-weight-retry 4.0
```

## BASELINE / A1 / A2 COMPARISON

| arm | weight | epoch | train F1 | dev F1 | dev prec | dev recall | dev false RETRY | gen gap | status |
|-----|--------|-------|----------|--------|----------|------------|-----------------|---------|--------|
| BASELINE | 1.0 | 8 | 0.941473 | 0.850018 | 0.918752 | 0.790852 | 0.005159 | 0.120905 | BASELINE |
| A1 | 2.0 | 6 | 0.931226 | 0.860309 | 0.871725 | 0.849188 | 0.009217 | 0.091405 | PASS_TRADEOFF |
| A2 | 4.0 | 8 | 0.942971 | 0.858815 | 0.893587 | 0.826649 | 0.007261 | 0.125925 | PASS_TRADEOFF |

## FALSE RETRY SAFETY

- baseline dev KEEP→RETRY: 0.005159
- A1 absolute Δ: 0.004058 → TRADEOFF
- A2 absolute Δ: 0.002102 → TRADEOFF

## GENERALIZATION GAP (train recall − dev recall)

- baseline: 0.120905
- A1: 0.091405 (narrowed)
- A2: 0.125925

## HELD-OUT HIGH12

- **A1**: CLEAR_OOS 4/6, LOCAL_FIT 1/3, SURFACE 0/3, HIGH12 fixed=5 regressed=0, unresolved4 improved=1 regressed=0
- **A2**: CLEAR_OOS 3/6, LOCAL_FIT 1/3, SURFACE 0/3, HIGH12 fixed=4 regressed=0, unresolved4 improved=1 regressed=0

## UNRESOLVED4 DIAGNOSTICS (observe only)

d008/d022/d051/d094 tracked in heldout CSV; not used for model selection.

## CAUSAL MAINLINE EVALUATION

Deferred to next phase `MODEL3_V2_S3_CLASS_WEIGHT_CAUSAL_MAINLINE_ACCEPTANCE`.

## FREEZE UPDATE

- FIRST_CAUSAL_OWNER: remains `NOT_YET_ISOLATED` until mainline acceptance
- experimental candidate A1 not promoted to production

## GOVERNANCE

- production runtime changed: **NO**
- dataset rebuilt: **NO**
- model architecture changed: **NO**
- features changed: **NO**
- threshold changed: **NO**
- sampling changed: **NO**
- hard-negative changed: **NO**

## NEXT PHASE

`MODEL3_V2_S3_CLASS_WEIGHT_CAUSAL_MAINLINE_ACCEPTANCE`
