# Lingua Model3 V2 Localization Training Causality Audit (2026-09-02)

> **STATUS: `SUPERSEDED_BY_DATASET_IDENTITY_CORRECTION`**
>
> S3 causal conclusions in this report (64% RETRY tail, first_pass_cand nonzero=0, 8/5/3 root-cause split)
> are **INVALID** for checkpoint `MODEL3_V2_S3_RANDOM_INIT_V1`. Prior audit indexed `model3_v2_labeled`
> instead of `MODEL3_V2_PRODUCTION_CORE_S3` / `prod_core_s3_build_20260830_v1`.
> Do not reuse as S3 evidence. Historical text retained; identity guard development closed the gap.
> See `Lingua_Model3_V2_Training_Data_Identity_Guard_Development_Report_2026_09_02.md`.

Phase: `MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | `MODEL3_LOCALIZATION_CAUSALITY_PASS_TRAINING_POSITION_BIAS_PRIMARY` |
| **final root-cause distribution16** | TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH=3, TRAINING_COVERAGE_GAP=8, MODEL_GENERALIZATION_FAILURE=5 |
| **previous 11/4/1 vs corrected** | MODEL_GENERALIZATION_FAILURE 11→5, TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH 4→3, TRAINING_COVERAGE_GAP 1→8 |
| **largest proven cause (bucket)** | TRAINING_COVERAGE_GAP (8/16) |
| **second cause** | MODEL_GENERALIZATION_FAILURE (5/16) |
| **feature replay parity** | 30/30 PASS |
| **position bias status** | PROVEN GLOBAL — training RETRY tail share [0.9,1.0)=64.4%; production expected-RETRY early bins [0.0,0.3)=94.1% |
| **candidate-feature status** | Production 14/30 nonzero; training nonzero fraction=0 (S3 labeled shards) |
| **feature limitation** | NOT PROVEN (scalar features distinguish most target/neighbor pairs; BiGRU uses surface embeddings) |
| **capacity limitation** | NOT PROVEN |
| **ACP** | NO |
| **next phase** | `MODEL3_V2_LOCALIZATION_TRAINING_DATA_CORRECTION_DESIGN_AUDIT` (NOT EXECUTED) |

## FROZEN RUNTIME OWNERS

- Path-local Domain Vote; deriveRetryRegions contract; KEEP/Anchor barrier; OLD_BOUNDARY_LOCK=13; RECALL_TARGET_MISS=8
- MODEL3_LOCALIZATION_FAILURE16 frozen; other-path FineSpan5 excluded
- S3 checkpoint `MODEL3_V2_S3_RANDOM_INIT_V1`; six features frozen; threshold frozen

## EXACT PRODUCTION FEATURE CAPTURE

Source: `model3_v2_s3_mainline_s3_raw_cases.jsonl` → `inference_input_traces` (same 0/0/200 S3 acceptance snapshot).

- 30 production spans captured (16 cases + 8 shifted neighbors + partial multi-spans)
- **No margin-CSV default substitution** — `rawFirstPassCandidateCount` taken from trace
- Example d008 target 散: `first_pass_cand_log1p=0.693` (cand=1), not 0

Artifact: `model3_v2_production_feature_vectors.csv`

## FEATURE REPLAY PARITY

Checkpoint SHA `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1`. Offline BiGRU replay using exact `tokenIds`, `featVector`, `availMask`.

- **30/30 spans PASS** (margin tolerance 1e-3, decision exact)
- Hard stop B not triggered

## TRAINING DATASET IDENTITY

| Field | Value |
|---|---|
| datasetId | MODEL3_V2_PRODUCTION_CORE_S3 |
| datasetBuildId | prod_core_s3_build_20260830_v1 |
| modelId | MODEL3_V2_S3_RANDOM_INIT_V1 |
| indexed spans | 1517309 (KEEP 1505118, RETRY 12191) |

## TRAIN / RUNTIME FEATURE CONTRACT

- Production packer formula verified against `bigru_v1.span_features` for all captured spans
- **featureContractMismatchCount = 0**
- Training vs runtime **first_pass_cand_log1p**: training collapsed at 0; runtime 46.7% nonzero — distribution gap (not formula mismatch)

## GLOBAL FEATURE DISTRIBUTIONS

See `model3_v2_training_feature_distribution.csv`. Key findings:

- `span_rel_position` RETRY: p50=1.0, p95=1.0 (tail-heavy)
- `first_pass_cand_log1p`: unique=1 at 0.0 for both labels in training
- `span_len_log1p` / `current_cjk_len_log1p`: collapsed at log1p(1) for single-char spans

## SPAN_REL_POSITION DISTRIBUTION

See `model3_v2_position_histogram.csv`.

| Bin | Training RETRY share | Production expected-RETRY |
|---|---:|---:|
| [0.0,0.1) | 0.10% | 10 |
| [0.1,0.2) | 0.03% | 3 |
| [0.2,0.3) | 0.02% | 3 |
| [0.3,0.4) | 0.80% | 0 |
| [0.4,0.5) | 14.95% | 0 |
| [0.5,0.6) | 13.12% | 1 |
| [0.6,0.7) | 0.30% | 0 |
| [0.7,0.8) | 1.15% | 0 |
| [0.8,0.9) | 5.15% | 0 |
| [0.9,1.0) | 64.38% | 0 |

Production failures concentrate in early bins; training RETRY concentrates at tail (64.4% in [0.9,1.0)).

## POSITION SHORTCUT AUDIT

- P(RETRY|bin) peaks at tail: [0.9,1.0) retry rate 3.97% vs [0.0,0.1) 0.007%
- Wrong shifted neighbors: 3/8 in better-supported mid/tail bins vs targets in early bins
- **Shortcut bias PROVEN globally**; not family-specific in this audit slice

## FIRST_PASS_CAND FEATURE AUDIT

| Metric | Value |
|---|---|
| Production nonzero spans | 14/30 |
| Training nonzero | 0 |
| Prior audit substitution | INVALID (used margin CSV default 0) |

## FALSE NEGATIVE 4

| caseId | support | rootCause |
|---|---|---|
| d065 | TRAIN_SUPPORT_MODERATE (tupleRetry=8) | TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH |
| d109 | TRAIN_COMBINATION_MISSING (tupleRetry=0) | TRAINING_COVERAGE_GAP |
| d114 | TRAIN_SUPPORT_MODERATE (tupleRetry=8) | TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH |
| d138 | TRAIN_COMBINATION_MISSING (tupleRetry=0) | TRAINING_COVERAGE_GAP |

**Prior claim "4/4 strong/moderate support" does NOT survive.** Corrected: strong/moderate=2/4, weak/missing=2/4.

## PARTIAL COVERAGE 4

| caseId | failing span | support | rootCause |
|---|---|---|---|
| d022 | 显 | TRAIN_SUPPORT_WEAK | TRAINING_COVERAGE_GAP |
| d094 | 成 | TRAIN_COMBINATION_MISSING | TRAINING_COVERAGE_GAP |
| d102 | 这/个 | MODERATE/WEAK | MODEL_GENERALIZATION_FAILURE |
| d129 | 马 | TRAIN_SUPPORT_WEAK | TRAINING_COVERAGE_GAP |

## SHIFTED NEARBY 8

See `model3_v2_localization_causality_summary.json` → `shiftedPairs`.

| caseId | target bin | neighbor bin | dominant Δ | rootCause |
|---|---|---|---|---|
| d008 | [0.2,0.3) | [0.4,0.5) | span_rel_position | TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH |
| d040 | [0.0,0.1) | [0.0,0.1) | first_pass_cand_log1p | TRAINING_COVERAGE_GAP |
| d042 | [0.1,0.2) | [0.3,0.4) | span_rel_position | MODEL_GENERALIZATION_FAILURE |
| d051 | [0.0,0.1) | [0.2,0.3) | span_rel_position | MODEL_GENERALIZATION_FAILURE |
| d054 | [0.1,0.2) | [0.1,0.2) | span_rel_position | MODEL_GENERALIZATION_FAILURE |
| d085 | [0.0,0.1) | [0.0,0.1) | first_pass_cand_log1p | TRAINING_COVERAGE_GAP |
| d172 | [0.0,0.1) | [0.2,0.3) | first_pass_cand_log1p | MODEL_GENERALIZATION_FAILURE |
| d175 | [0.0,0.1) | [0.0,0.1) | first_pass_cand_log1p | TRAINING_COVERAGE_GAP |

## TRAINING NEAREST-NEIGHBOR SUPPORT

- Metric: z-score normalized Euclidean on 6 features (training mean/std)
- topK=20 per production target span
- Artifact: `model3_v2_training_nearest_neighbors.csv`
- Note: exact tuple matches can show RETRY support while topK scalar neighbors are KEEP-only (embedding/context not in scalar NN)

## FEATURE INFORMATION SUFFICIENCY

NOT PROVEN. Target/neighbor pairs differ in surface tokens and/or scalar features; BiGRU consumes character embeddings.

## STRICT CAUSAL FUNNEL

| Stage | In | Out | Loss |
|---|---:|---:|---:|
| localization failures | 16 | 16 | 0 |
| exact production vector | 16 | 16 | 0 |
| replay parity | 16 | 16 | 0 |
| expected RETRY verified | 16 | 16 | 0 |
| training dataset verified | 16 | 16 | 0 |
| feature contract parity | 16 | 16 | 0 |
| root cause assigned | 16 | 16 | 0 |

## ROOT CAUSE RECONCILIATION

- **d008** (MODEL3_RETRY_SHIFTED_NEARBY): TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH
- **d022** (MODEL3_TARGET_PARTIAL_COVERAGE): TRAINING_COVERAGE_GAP
- **d040** (MODEL3_RETRY_SHIFTED_NEARBY): TRAINING_COVERAGE_GAP
- **d042** (MODEL3_RETRY_SHIFTED_NEARBY): MODEL_GENERALIZATION_FAILURE
- **d051** (MODEL3_RETRY_SHIFTED_NEARBY): MODEL_GENERALIZATION_FAILURE
- **d054** (MODEL3_RETRY_SHIFTED_NEARBY): MODEL_GENERALIZATION_FAILURE
- **d065** (MODEL3_TARGET_FALSE_NEGATIVE): TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH
- **d085** (MODEL3_RETRY_SHIFTED_NEARBY): TRAINING_COVERAGE_GAP
- **d094** (MODEL3_TARGET_PARTIAL_COVERAGE): TRAINING_COVERAGE_GAP
- **d102** (MODEL3_TARGET_PARTIAL_COVERAGE): MODEL_GENERALIZATION_FAILURE
- **d109** (MODEL3_TARGET_FALSE_NEGATIVE): TRAINING_COVERAGE_GAP
- **d114** (MODEL3_TARGET_FALSE_NEGATIVE): TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH
- **d129** (MODEL3_TARGET_PARTIAL_COVERAGE): TRAINING_COVERAGE_GAP
- **d138** (MODEL3_TARGET_FALSE_NEGATIVE): TRAINING_COVERAGE_GAP
- **d172** (MODEL3_RETRY_SHIFTED_NEARBY): MODEL_GENERALIZATION_FAILURE
- **d175** (MODEL3_RETRY_SHIFTED_NEARBY): TRAINING_COVERAGE_GAP

Sum: 16/16

## FREEZE UPDATE

- MODEL3_LOCALIZATION_FAILURE16, SHIFTED8, FN4, PARTIAL4: frozen
- Feature replay parity: 30/30 PASS
- Training root cause: **position/data bias primary**; per-case buckets above
- Threshold change: NOT PROVEN
- Model expansion / new features / Retry expansion / FineSpan redesign: NO

## GOVERNANCE

| Item | Status |
|---|---|
| production code changed | NO |
| Model3 retrained | NO |
| training data changed | NO |
| threshold changed | NO |
| features changed | NO |
| FineSpan changed | NO |
| Retry changed | NO |
| Recall changed | NO |
| Domain Vote changed | NO |
| JobResult changed | NO |

## NEXT PHASE

Exactly one: `MODEL3_V2_LOCALIZATION_TRAINING_DATA_CORRECTION_DESIGN_AUDIT` — **do not execute until user review.**

## KEY QUESTIONS (D1–D57 summary)

- D1: 16/16 recovered **YES**
- D4/D5: first_pass_cand from production trace **YES**; 14/30 nonzero
- D8/D9: replay parity **YES**; failures **0**
- D10/D11: packer matches training formula **YES**; contract mismatch **0**
- D12–D16: tail training vs early production RETRY **proven**
- D18: position shortcut **PROVEN** (global)
- D21–D23: FN4 strong/moderate **2/4**; prior claim **REJECTED**
- D26–D28: generalization **5**, coverage gap **8**, distribution mismatch **3**
- D37: provisional 11/4/1 **changed** to 5/3/8
- D40–D42: retraining alone **unlikely sufficient**; data correction **required**
- D43–D48: threshold/model/features/Retry/FineSpan changes **NO**
- D51–D55: no production/training/threshold/JobResult changes **YES**

## ARTIFACTS (8)

1. `Lingua_Model3_V2_Localization_Training_Causality_Audit_2026_09_02.md`
2. `model3_v2_production_feature_vectors.csv`
3. `model3_v2_training_feature_distribution.csv`
4. `model3_v2_position_histogram.csv`
5. `model3_v2_training_nearest_neighbors.csv`
6. `model3_v2_localization_causal_root_causes.csv`
7. `model3_v2_localization_causality_summary.json`
8. `model3_v2_localization_causality_freeze_state.csv`
