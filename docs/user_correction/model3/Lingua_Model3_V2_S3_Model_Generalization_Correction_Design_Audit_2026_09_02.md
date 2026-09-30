# Lingua Model3 V2 S3 Model Generalization Correction Design Audit (2026-09-02)

Phase: `MODEL3_V2_S3_MODEL_GENERALIZATION_CORRECTION_DESIGN_AUDIT`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | `MODEL3_S3_GENERALIZATION_AUDIT_MIXED` |
| **SSOT correction** | **APPLIED** — 12 HIGH + 4 unresolved |
| **dominant proven cause** | `MODEL_GENERALIZATION_FAILURE` (12 HIGH only; NOT all 16) |
| **training-fit status** | `TRAIN_FIT_HEALTHY` — train RETRY recall **91.18%** |
| **class balance** | 14.4:1 **uncompensated** (`class_weight_retry=1.0`, uniform sampling) |
| **checkpoint selection** | best dev `retry_f1` → epoch **8** (appropriate) |
| **hard-negative status** | **LIKELY** — e.g. surface `这`: 6264 KEEP vs 50 RETRY |
| **context/surface generalization** | **LIKELY** — 6/12 HIGH: training RETRY support fits, production fails |
| **capacity status** | **NOT PROVEN** |
| **ACP** | **NO** |
| **smallest correction** | class_weight_retry ↑ + RETRY batch balancing + hard-negative mining (training-only) |
| **next phase** | `MODEL3_V2_S3_MINIMAL_GENERALIZATION_CORRECTION_DESIGN` (**NOT EXECUTED**) |

## SSOT CAUSAL CLASSIFICATION CORRECTION

Previous S3 causality report over-classified **16/16** as `MODEL_GENERALIZATION_FAILURE`.

**Corrected SSOT** (`model3_v2_s3_localization_root_causes.csv`):

| Bucket | Count | Cases |
|---|---:|---|
| `MODEL_GENERALIZATION_FAILURE` / **HIGH** | 12 | d040,d042,d054,d065,d085,d102,d109,d114,d129,d138,d172,d175 |
| `INSUFFICIENT_EVIDENCE` / **MEDIUM** | 4 | **d008, d022, d051, d094** |

`GENERALIZATION_PRIMARY = YES` but `ALL_16_GENERALIZATION = NO`.

Retired hypotheses remain **SUPERSEDED**: 64% tail, cand=0, 8/5/3 split.

## AUTHORITATIVE IDENTITY

`G0_DATASET_IDENTITY = PASS` — `MODEL3_V2_S3_RANDOM_INIT_V1` on `MODEL3_V2_PRODUCTION_CORE_S3` / `prod_core_s3_build_20260830_v1`.

## TRAINING-SET INFERENCE RESULTS

| Split | TP | FP | FN | TN | RETRY prec | RETRY recall | RETRY F1 | KEEP→RETRY rate |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **train** | 22070 | 608 | 2136 | 349075 | 0.973 | **0.912** | 0.941 | 0.17% |
| **dev** | 2386 | 211 | 631 | 40691 | 0.919 | **0.791** | 0.850 | 0.52% |

**Outcome: CASE B** — training RETRY largely predicted correctly; production held-out targets fail → true out-of-sample generalization problem, **not** primary training-set fit failure.

Train RETRY margin: p05=−1.10, p50=+5.47, p95=+14.36; negative fraction **8.82%**.

## RETRY TRAIN-FIT ANALYSIS

| Class | Evidence |
|---|---|
| `TRAIN_FIT_HEALTHY` | train RETRY recall ≥ 0.75 (actual **0.912**) |
| `TRAIN_FIT_FAIL` | **NOT PRIMARY** — only 2136/24206 (8.8%) training RETRY predicted KEEP |

## 12 HIGH CASE SUPPORT REPLAY

Same-surface RETRY support replay (see `model3_v2_s3_high_case_training_support_replay.csv`):

| Pattern | Cases | Finding |
|---|---|---|
| OOS generalization (support fit ≥80%, production fails) | d040,d042,d085,d129,d172,d175 | **6 cases** |
| Train-fit weak on same-surface RETRY (75.9%) | d065,d102 | `这` — model still misclassifies 14/58 training RETRY rows |
| Sparse same-char surface in S3 | d054,d109,d114 | scalar-tuple support exists (causality audit) but single-char surface scan sparse — tuple replay needed |

## SAME-SURFACE LABEL ANALYSIS

| Surface | KEEP | RETRY | Conflict | Train RETRY recall (same surface) |
|---|---:|---:|---|---:|
| 这 | 6264 | 50 | YES | 0.84 |
| 自 | 78 | 28 | YES | 0.89 |
| 病 | 6 | 15 | YES | 0.67 |
| 爆 | 0 | 25 | NO | 1.00 |
| 候 / 发 / 戏 | KEEP-only in sampled scan | — | — | tuple support elsewhere |

Same-surface KEEP/RETRY conflict is **context-dependent** (expected), not label error.

## HARD-NEGATIVE ANALYSIS

Surface `这`: **125:1** KEEP:RETRY ratio drives KEEP preference despite RETRY tuple support (288 exact-feature matches in causality audit). Strong production margins (e.g. d109 ≈ −11) argue against threshold-only fix.

## CLASS IMBALANCE / LOSS

| Item | Value |
|---|---|
| KEEP:RETRY | 349683:24206 ≈ **14.4:1** |
| `class_weight_retry` | **1.0** (verified in `train_s3_random.py` + checkpoint config) |
| Sampling | `uniform_shuffle_utterance` — **no** RETRY oversampling |
| Auto class-weight formula | **false** |
| Compensated | **NO** |

KEEP dominates batch loss materially; imbalance is **contributing** but not proven sole cause from ratio alone.

## TRAINING CURVES

From `training_metrics.json` (existing logs, not re-run):

| Epoch | train loss | dev RETRY F1 | dev RETRY recall |
|---:|---:|---:|---:|
| 1 | 0.179 | 0.597 | 0.467 |
| 4 | 0.049 | 0.823 | 0.800 |
| 8 (selected) | 0.027 | **0.850** | 0.791 |

Convergence: **normal**; under/overfit **not proven** as primary owner.

## CHECKPOINT SELECTION

Criterion: **best dev `retry_f1`** (appropriate for RETRY task). Selected epoch **8** (final); RETRY recall peaked at epoch 4 (0.800) but F1 best at 8.

## SEED STABILITY

No additional same-contract seed sweep in this phase → `SEED_STABILITY = UNRESOLVED`.

## SURFACE EMBEDDING SUPPORT

Target surfaces present under RETRY in S3 (tuple + surface evidence). Not primary OOV failure.

## SEQUENCE CONTEXT SUPPORT

Production sequence neighborhoods differ from training materialization for held-out dialog_200 cases → **context generalization** plausible for OOS failures.

## MARGIN DISTRIBUTIONS

Production FN margins strongly negative; training RETRY margins mostly positive (median +5.47). Misclassified training RETRY margins (e.g. `这` median −5.03) reproduce inverted behavior on **similar** training rows — hard-negative + context interaction.

## FIRST CAUSAL OWNER

**`MIXED`** among:

1. **CLASS_IMBALANCE_LOSS** — uncompensated 14.4:1, `class_weight_retry=1.0`
2. **HARD_NEGATIVE_DISTRIBUTION** — same-surface KEEP ≫ RETRY
3. **SEQUENCE_CONTEXT_GENERALIZATION** — train fit OK, production context fails

**NOT primary:** training-set fit failure, checkpoint selection error, threshold calibration, model capacity, pinyin scalar collapse, dataset rebuild.

## MINIMAL CORRECTION BOUNDARY

Smallest evidence-backed direction (design only, **not implemented**):

1. Raise `class_weight_retry` + RETRY-aware batch balancing
2. Hard-negative mining emphasizing same-surface KEEP vs target RETRY
3. Re-evaluate checkpoint on RETRY recall + held-out localization16 (not accuracy alone)

**NOT justified now:** retrain same config, threshold tune, model expansion, feature change, dataset rebuild, runtime architecture change.

## FREEZE UPDATE

See `model3_v2_s3_causality_corrected_freeze_state.csv`.

## GOVERNANCE

| Item | Status |
|---|---|
| production code changed | NO |
| training executed | NO |
| dataset rebuilt | NO |
| model architecture changed | NO |
| threshold / features / FineSpan / Retry / Recall / Model2 / Domain Vote / JobResult | NO |

## TEST COMMAND

```bash
python training/model3_dataset/scripts/audit_model3_v2_s3_generalization_correction_design.py
# exit 0 · verdict=MODEL3_S3_GENERALIZATION_AUDIT_MIXED · trainRetryRecall=0.9118
```

## NEXT PHASE

Exactly one: **`MODEL3_V2_S3_MINIMAL_GENERALIZATION_CORRECTION_DESIGN`**

Do not execute automatically.
