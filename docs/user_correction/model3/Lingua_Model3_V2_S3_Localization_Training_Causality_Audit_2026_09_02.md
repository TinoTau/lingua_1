> **SSOT CORRECTION (2026-09-02):** Root-cause table corrected to 12 HIGH `MODEL_GENERALIZATION_FAILURE` + 4 MEDIUM `INSUFFICIENT_EVIDENCE` (d008,d022,d051,d094). See generalization correction design audit.

# Lingua Model3 V2 S3 Localization Training Causality Audit (2026-09-02)

Phase: `MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT_S3`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | `MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_MODEL_GENERALIZATION_PRIMARY` |
| **G0_DATASET_IDENTITY** | **PASS** |
| **fresh artifact status** | All training-derived CSV/JSON regenerated from authoritative S3 |
| **model/checkpoint** | `MODEL3_V2_S3_RANDOM_INIT_V1` / `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1` |
| **dataset/build** | `MODEL3_V2_PRODUCTION_CORE_S3` / `prod_core_s3_build_20260830_v1` |
| **localization16 status** | 16/16 analyzed; replay parity 30/30 PASS |
| **dominant cause** | `MODEL_GENERALIZATION_FAILURE` (12 HIGH + 4 MEDIUM) |
| **root-cause distribution16** | GEN=16 (HIGH=12, MEDIUM=4); COVERAGE=0; DIST_MISMATCH=0 |
| **feature replay** | 30/30 PASS (margin + decision) |
| **feature distribution summary** | S3 healthy variance on 5/6 scalars; `pinyin_channel_avail` collapsed (always 1 in train) |
| **position bias (S3)** | **NOT PROVEN** — RETRY tail `[0.9,1.0)` share **5.85%** (prior 64% **retired**) |
| **candidate feature (S3)** | RETRY nonzero **61.76%**; raw 0/1/2 present (prior cand=0 **retired**) |
| **ACP** | **NO** |
| **next phase** | `MODEL3_V2_S3_MODEL_GENERALIZATION_CORRECTION_DESIGN_AUDIT` (**NOT EXECUTED**) |

## G0 IDENTITY EVIDENCE

```
G0_DATASET_IDENTITY = PASS
modelId     = MODEL3_V2_S3_RANDOM_INIT_V1
weightsSha256 = f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1
datasetId   = MODEL3_V2_PRODUCTION_CORE_S3
datasetBuildId = prod_core_s3_build_20260830_v1
trainDir    = model3_v2_production_core_s3/train
```

G0 executed **before** `TrainingIndex.load()` (373,889 spans indexed only after PASS).

## FRESH ARTIFACT PROVENANCE

All outputs carry `phase`, `modelId`, `weightsSha256`, `datasetId`, `datasetBuildId`, `generatedAt`, `generator`.

| Artifact | Status |
|---|---|
| `model3_v2_s3_feature_distribution.csv` | FRESH |
| `model3_v2_s3_position_histogram.csv` | FRESH |
| `model3_v2_s3_candidate_distribution.csv` | FRESH |
| `model3_v2_s3_localization_root_causes.csv` | FRESH |
| `model3_v2_s3_training_support.csv` | FRESH |
| `model3_v2_s3_localization_causality_summary.json` | FRESH |
| `model3_v2_s3_causality_freeze_state.csv` | FRESH |

**No** superseded `model3_v2_labeled` artifacts used as inputs.

## PRODUCTION FEATURE CAPTURE

Source: `model3_v2_s3_mainline_s3_raw_cases.jsonl` → `inference_input_traces` (frozen 16-case snapshot).

- 30 spans captured (16 targets + 8 shifted neighbors + partial multi-spans)
- `rawFirstPassCandidateCount` from trace (not margin CSV defaults)
- Production nonzero cand spans: **14/30**

## FEATURE REPLAY PARITY

Checkpoint offline replay vs runtime: **30/30 PASS** (margin tolerance 1e-3, decision match).

Formula parity (training `span_features` vs captured production): **0 mismatches**.

## AUTHORITATIVE S3 TRAINING INDEX

| Metric | Value |
|---|---:|
| Training spans indexed | 373,889 |
| KEEP | 349,683 |
| RETRY | 24,206 |
| RETRY class ratio | 6.47% |

## SIX-FEATURE DISTRIBUTIONS

See `model3_v2_s3_feature_distribution.csv`.

| Feature | S3 classification |
|---|---|
| isAnchor | EXPECTED_CONSTANT |
| span_len_log1p | EXPECTED_VARIABLE_HEALTHY |
| span_rel_position | EXPECTED_VARIABLE_HEALTHY |
| first_pass_cand_log1p | EXPECTED_VARIABLE_HEALTHY |
| current_cjk_len_log1p | EXPECTED_VARIABLE_HEALTHY |
| pinyin_channel_avail | EXPECTED_VARIABLE_COLLAPSED (train always 1; avail mask not reflected in scalar alone) |

## POSITION DISTRIBUTION

Fresh S3 RETRY shares roughly uniform across bins (~6–14% each). Tail bin `[0.9,1.0)`:

- **RETRY share: 5.85%** (1,417 / 24,206)
- Early bins `[0.0,0.3)`: **38.2%** of all RETRY

Production expected-RETRY targets concentrate early (~94% in bins `[0.0,0.3)`), but **authoritative S3 does not show global tail position bias**. Prior 64% tail hypothesis **retired**.

## CANDIDATE FEATURE DISTRIBUTION

| RETRY raw count | Count | Share |
|---|---:|---:|
| 0 | 9,256 | 38.2% |
| 1 | 14,660 | 60.6% |
| 2 | 290 | 1.2% |

RETRY `first_pass_cand_log1p` nonzero: **61.76%**. Prior labeled-audit cand=0 claim **not reproduced**.

## LABEL / GEOMETRY DISTRIBUTION

No systematic RETRY geometry bias proven on authoritative S3 (position spread early/mid/late; no tail domination). Label semantics unchanged.

## SOURCE FAMILY DISTRIBUTION

RETRY spread across semantic families (top-5 in summary JSON). No single-family tail shortcut proven.

## FALSE NEGATIVE 4

| Case | Support | Root cause | Confidence |
|---|---|---|---|
| d065 | TRAIN_SUPPORT_STRONG | MODEL_GENERALIZATION_FAILURE | HIGH |
| d109 | TRAIN_SUPPORT_STRONG | MODEL_GENERALIZATION_FAILURE | HIGH |
| d114 | TRAIN_SUPPORT_STRONG | MODEL_GENERALIZATION_FAILURE | HIGH |
| d138 | TRAIN_SUPPORT_STRONG | MODEL_GENERALIZATION_FAILURE | HIGH |

All four: materially similar RETRY tuples exist (e.g. tupleRetry=288 for surface `这`), yet model predicts KEEP with strongly negative margin.

## PARTIAL COVERAGE 4

| Case | Failing span support | Root cause | Confidence |
|---|---|---|---|
| d022 | TRAIN_COMBINATION_MISSING (primary row) | MODEL_GENERALIZATION_FAILURE | MEDIUM |
| d094 | TRAIN_SUPPORT_WEAK | MODEL_GENERALIZATION_FAILURE | MEDIUM |
| d102 | TRAIN_SUPPORT_STRONG | MODEL_GENERALIZATION_FAILURE | HIGH |
| d129 | TRAIN_SUPPORT_STRONG | MODEL_GENERALIZATION_FAILURE | HIGH |

Per-span analysis preserved in root-cause table; d129 primary target already RETRY — failure is adjacent KEEP span `马`.

## SHIFTED NEARBY 8

Correct target vs wrong neighbor differ by surface + often `span_rel_position` + sometimes cand/pinyin scalars. Dominant delta varies by case (position **or** cand **or** cjk_len). **Not** uniformly position-driven on S3 evidence.

Scalar NN support is **DIAGNOSTIC_ONLY**; BiGRU surface embeddings materially relevant (distinct surfaces in all 8 pairs).

## TRAINING SUPPORT ANALYSIS

Support thresholds (DIAGNOSTIC_ONLY): strong ≥5 RETRY in top-20 norm-dist ≤1.5 or tupleRetry≥10; moderate ≥2/≤2.5 or tuple≥3; weak ≥1/≤3.0 or tuple≥1.

12/16 cases HIGH confidence generalization; 4 MEDIUM (weak/missing scalar NN but not sufficient alone for coverage-gap proof).

## ROOT CAUSE RECONCILIATION

| Category | Count |
|---|---:|
| MODEL_GENERALIZATION_FAILURE | 16 |
| TRAINING_COVERAGE_GAP | 0 |
| TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH | 0 |
| LABEL_DISTRIBUTION_BIAS | 0 |
| FEATURE_INFORMATION_LIMITATION | 0 |
| INSUFFICIENT_EVIDENCE | 0 |

Superseded prior split 8/5/3: **NOT reproduced**.

## STRICT CAUSAL FUNNEL

| Stage | Count |
|---|---:|
| localization failures | 16 |
| production feature trace recovered | 16 |
| replay parity pass | 30/30 |
| G0 PASS | YES |
| fresh S3 training index | 373,889 spans |
| root-cause eligible | 16 |
| HIGH confidence classified | 12 |
| MEDIUM (partial unresolved) | 4 |

## FREEZE UPDATE

- Localization16 population frozen
- Prior S3 causal claims (64% tail, cand=0, 8/5/3) remain **SUPERSEDED**
- S3 training cause on authoritative data: **generalization-primary** (not data coverage / not global position bias)

## GOVERNANCE

| Item | Status |
|---|---|
| production code changed | NO |
| training executed | NO |
| dataset rebuilt | NO |
| model changed | NO |
| threshold changed | NO |
| features changed | NO |
| FineSpan / Retry / Recall / Model2 / Domain Vote / JobResult | NO |

## TEST COMMAND

```bash
python training/model3_dataset/scripts/audit_model3_v2_localization_training_causality.py
# exit 0
# g0=PASS, verdict=MODEL3_S3_LOCALIZATION_CAUSALITY_PASS_MODEL_GENERALIZATION_PRIMARY
# trainingSpans=373889, retryTailShare=0.0585, candNonzeroRetry=0.6176
```

## NEXT PHASE

Exactly one: **`MODEL3_V2_S3_MODEL_GENERALIZATION_CORRECTION_DESIGN_AUDIT`**

Do not execute automatically.
