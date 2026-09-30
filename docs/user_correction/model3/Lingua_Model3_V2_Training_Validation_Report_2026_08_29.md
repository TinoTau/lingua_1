# Lingua — Model3 V2 Dataset Training & Validation

**Phase:** MODEL3_V1_V2_DATASET_TRAINING  
**Date:** 2026-08-29  
**Production architecture changed:** NO  
**V1 baseline overwritten:** NO  
**V2 auto-promoted:** NO

---

## MAIN VERDICT

| Field | Verdict |
|-------|---------|
| **Checkpoint verdict** | **V2_MODEL_PROMISING_NOT_ACCEPTED** |
| **Failure classification** | **SYNTHETIC_TO_REAL_GENERALIZATION_GAP** |
| **Ready for promotion** | **NO** |
| **Next phase** | **MODEL3_V2_REAL_DISTRIBUTION_DATA_EXPANSION** |

V2 labels alone restore strong **synthetic** RETRY learning and break V1’s absolute ALL_KEEP on real FineSpans (2 positive margins; **1/13** HIGH eligible cases fire RETRY). Real held-out recall remains far too low for acceptance.

---

## TRAINING CONFIGURATION

| Item | Value |
|------|-------|
| Dataset | `MODEL3_V2_LABELED` / `model3_v2_labeled_20260829` |
| Samples | train 80,034 / dev 11,777 / test 22,607 |
| Checkpoint | `MODEL3_V2_REGION_LABEL_V1` |
| Path | `training/model3_dataset/model3_v2_region_label_v1_ckpts/seed_2026082901` |
| Seed | **2026082901** |
| Architecture | Small BiGRU (emb 64 / hidden 128 / feat 6) |
| Epochs | 8 (best by dev RETRY F1) |
| Batch | 64 |
| Optimizer | Adam |
| LR | 0.001 |
| Class weight RETRY | **1.0** (no tuning) |
| Sampling | uniform utterance shuffle (V2 flat corpus; no new balance logic) |
| Pair loss | OFF (V2 corpus not STRICT-pair structured; documented) |
| Init | random from scratch |
| Train time | ~1281 s CPU |
| Weights SHA256 | `d0291b7d4c4bdf6c7b5c3b5f0169e7b60840bae21caa41bec7c3bd711b3e029a` |

V1 `MODEL3_SYNTHETIC_V1` / `seed_2026082520` **preserved**.

---

## DATASET TEST RESULTS

| Metric | V2 test |
|--------|--------:|
| KEEP precision | 0.9993 |
| KEEP recall | 0.9997 |
| RETRY precision | 0.9714 |
| RETRY recall | 0.9370 |
| RETRY F1 | **0.9539** |
| Confusion | TP 4212 / FP 124 / FN 283 / TN 409399 |
| Pred RETRY rate | 1.05% |
| True RETRY rate | 1.09% |

---

## CLASSIFIER BEHAVIOR

| Check | Result |
|-------|--------|
| ALL_KEEP | **NO** |
| NEAR_ALL_KEEP | **NO** |
| OVER_RETRY | **NO** |
| Predicted vs true RETRY rate | 1.05% vs 1.09% |

---

## V1 VS V2

| metric | V1 | V2 | delta |
|--------|---:|---:|------:|
| test RETRY precision (on V2 labels) | 0.852 | 0.971 | +0.119 |
| test RETRY recall | 0.771 | 0.937 | +0.166 |
| test RETRY F1 | 0.810 | 0.954 | +0.144 |
| real HIGH eligible case RETRY | **0 / 13** | **1 / 13** | +1 |
| real case recall | 0.0 | **0.077** | +0.077 |
| false RETRY on NO_ERROR controls | 0 / 6 | 0 / 6 | 0 |
| offline latency ms/utt | 11.77 | 11.95 | +0.17 |

---

## REAL RETRY HELD-OUT

| Item | Value |
|------|------:|
| Eligible cases (HIGH/MEDIUM) | 13 |
| V1 case-level RETRY | **0** |
| V2 case-level RETRY | **1** (d179 — RETRY on an in-region FineSpan; inventory probe surface still KEEP) |
| Additional V2 RETRY | d200 (UNKNOWN mismatch), margin +1.47 |
| Total V2 positive margins (all non-Anchor FineSpans) | **2 / 3733** |

Primary question answer: V2 **begins** to emit real RETRY, but **does not** restore meaningful coverage of genuine RETRY-eligible targets.

---

## REAL KEEP CONTROL

| Item | Value |
|------|------:|
| Controls (NO_ERROR) | 6 |
| False RETRY | **0** |
| False RETRY rate | **0.0** |

No RETRY_EVERYWHERE failure observed on controls.

---

## MARGIN DISTRIBUTION (dialog_200 FineSpans, offline)

| Stat | V1 | V2 |
|------|---:|---:|
| n | 3733 | 3733 |
| min | -26.43 | -25.19 |
| p50 | -18.52 | **-15.24** |
| p95 | -12.42 | **-9.68** |
| max | **-5.85** | **+4.53** |
| positive | **0** | **2** |
| \|margin\|&lt;1 | 0 | 0 |
| strong KEEP (&lt;-5) | 3733 | 3700 |

Decision boundary moved; still overwhelmingly KEEP on real data.

---

## DIALOG_200 MAINLINE

| Item | Status |
|------|--------|
| V2 full pipeline via Electron | **BLOCKED_BY_PRODUCTION_CHECKPOINT_HASH_LOCK** |
| Reason | `model3-inference-client` + `model3_inference_host` hard-require V1 weights SHA; candidate load fails without promotion/hash unlock |
| Offline FineSpan probe | **COMPLETED** (authoritative for this phase) |
| Production code changed to unlock | **NO** (forbidden) |

Mainline invariants / Retry consumer / ASR path were **not** re-run under V2 weights. Prior V1 acceptance remains the runtime regression baseline.

---

## MAINLINE INVARIANTS

Not re-measured under V2 (blocked). Prior accepted V1 dialog_200 acceptance remains:

Model3 once / Domain Vote once / Retry ≤1 / no recursive Retry / no ASR rerun / no Anchor crossing / candidate ≤16 — **PASS** under V1.

---

## PERFORMANCE

| | V1 | V2 |
|--|---:|---:|
| Offline ms/utterance (53 cases) | 11.77 | 11.95 |
| Regression | **none meaningful** (~+1.5%) |

---

## ARCHITECTURE GOVERNANCE

All **NO**: Model3 architecture, FineSpan, Retry, Recall, Lattice, Domain Vote, Model2, Assembly, JobResult.

Threshold not tuned. Class weights not retuned after results.

---

## CHECKPOINT STATUS

| Checkpoint | Status |
|------------|--------|
| V1 `MODEL3_SYNTHETIC_V1` | **PRESERVED** (production baseline) |
| V2 `MODEL3_V2_REGION_LABEL_V1` | **CANDIDATE** |
| Production promotion | **NO** |

---

## INTERPRETATION

1. Corrected V2 labels are **learnable** under frozen BiGRU + `class_weight=1.0`.
2. Synthetic→real gap **persists**: perfect-ish test RETRY ≠ real trigger quality.
3. Real progress is **real but insufficient** (0→1 HIGH cases; 0→2 positive margins).
4. Next work is **more real-ASR-like / region-distribution training data**, not architecture, not threshold, not silent class-weight chase on dialog_200.

---

## NEXT PHASE

**MODEL3_V2_REAL_DISTRIBUTION_DATA_EXPANSION**

Do not execute in this phase.

---

## Artifacts

1. This report  
2. `model3_v2_v1_comparison.csv`  
3. `model3_v2_real_probe_results.csv`  
4. `model3_v2_training_summary.json`  
5. `model3_v2_training_governance.json`

**STOP.**
