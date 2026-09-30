# Lingua Model3 V2 S3 Minimal Generalization Correction Design (2026-09-02)

Phase: `MODEL3_V2_S3_MINIMAL_GENERALIZATION_CORRECTION_DESIGN`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | `MODEL3_S3_MINIMAL_CORRECTION_DESIGN_CLASS_WEIGHT_FIRST` |
| **SSOT corrections** | `FIRST_CAUSAL_OWNER` → **NOT_YET_ISOLATED**; `retryRecallPeakedAtSelectedEpoch` → **FALSE** |
| **first experiment** | **CLASS_WEIGHT_ONLY** (A1=2.0, A2=4.0) |
| **why selected** | 最小代码改动、单变量归因最干净、类别不平衡已验证存在 |
| **experiment arms** | **5** (baseline + 2 class-weight + 2 deferred designs) |
| **ACP** | **NO** |
| **next phase** | `MODEL3_V2_S3_CLASS_WEIGHT_EXPERIMENT_DEVELOPMENT` (**NOT EXECUTED**) |

## SSOT CORRECTION

| Field | Before | After |
|---|---|---|
| FIRST_CAUSAL_OWNER | MIXED (too strong) | **NOT_YET_ISOLATED** |
| retryRecallPeakedAtSelectedEpoch | TRUE (wrong) | **FALSE** |
| BEST_DEV_RETRY_F1_EPOCH | 8 | **8** (unchanged) |
| BEST_DEV_RETRY_RECALL_EPOCH | — | **4** (recall 0.800 vs 0.791 at epoch 8) |

Hypotheses frozen as **NOT_PROVEN** except sequence-context relevance.

## CURRENT BASELINE

| Item | Value |
|---|---|
| class_weight_retry | **1.0** |
| sampling | uniform_shuffle_utterance |
| hard-negative | NONE |
| checkpoint | best dev retry_f1, epoch 8 |
| train RETRY recall | 91.18% |
| dev RETRY recall / F1 | 79.09% / 85.00% |

## CLASS WEIGHT OPTION (FIRST)

Search range (NOT 14.4):

| Arm | class_weight_retry | Rationale |
|---|---:|---|
| A1 | **2.0** | moderate RETRY loss emphasis |
| A2 | **4.0** | matches historical `train_v1_bigru` scale |

Owner: `train_s3_random.py` lines 40, 112-113, 143-144.

## RETRY SAMPLING OPTION (DEFERRED)

B1: `WeightedRandomSampler` — weight=2 for utterances containing any RETRY span. **Second** after class-weight results.

## HARD NEGATIVE OPTION (DEFERRED)

C1: baseline-checkpoint scan → KEEP near-boundary / same-surface cluster index → sampler boost. Higher implementation risk; **third**.

## CONTROLLED EXPERIMENT MATRIX

See `model3_v2_s3_controlled_experiment_matrix.csv` — max 5 arms, each single-variable.

## METRIC / ACCEPTANCE DESIGN

See `model3_v2_s3_experiment_acceptance_gates.csv` — dev F1/precision, false RETRY, held-out 12 net improvement.

## ARCHITECTURE GOVERNANCE

No runtime / feature / threshold / dataset / architecture change. Training-only strategy experiments.

## NEXT PHASE

`MODEL3_V2_S3_CLASS_WEIGHT_EXPERIMENT_DEVELOPMENT`
