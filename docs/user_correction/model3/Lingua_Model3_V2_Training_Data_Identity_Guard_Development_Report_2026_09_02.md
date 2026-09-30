# Lingua Model3 V2 Training Data Identity Guard Development (2026-09-02)

Phase: `MODEL3_V2_TRAINING_DATA_IDENTITY_GUARD_DEVELOPMENT`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | `MODEL3_TRAINING_DATA_IDENTITY_GUARD_DEVELOPMENT_PASS` |
| **guard** | `acoustic_training/dataset_identity.py` → `assert_model3_dataset_identity` |
| **authoritative checkpoint** | MODEL3_V2_S3_RANDOM_INIT_V1 / f1e41969… |
| **authoritative dataset** | MODEL3_V2_PRODUCTION_CORE_S3 / prod_core_s3_build_20260830_v1 |
| **G0 before sample load** | **YES** (proven by order test) |
| **stale path status** | **REMOVED** from S3 causality + generalization audits |
| **candidate missing-value** | training-side fail-closed (`None`/missing → reject; 0/1/2 OK) |
| **production change** | **NO** |
| **next phase** | `MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT_S3` (**NOT EXECUTED**) |

## IMPLEMENTED FILES

1. `training/model3_dataset/acoustic_training/dataset_identity.py` (NEW)
2. `training/model3_dataset/scripts/audit_model3_v2_localization_training_causality.py`
3. `electron_node/electron-node/tests/run-model3-v2-target-localization-generalization-audit.mjs`
4. `training/model3_dataset/train/bigru_v1.py` (loader only)
5. `training/model3_dataset/tests/test_dataset_identity_guard.py` (NEW)

## G0 IDENTITY FLOW

```
checkpoint config.json + weights.pt sha (+ sidecars)
→ datasetId / datasetBuildId / contracts
→ dataset_manifest.json (content, not directory name)
→ compare exact fields
→ PASS → return train/dev/test paths
→ only then shard load
```

Mismatch → HARD STOP (`MODEL3_DATASET_IDENTITY_MISMATCH` / `_BUILD_` / `_FEATURE_` / `_LABEL_` / `_MANIFEST_MISSING` / `_PROVENANCE_INCOMPLETE`).
No warn-and-continue. No fallback. No latest-directory discovery.

## STALE PATH REMOVAL

- Causality audit: removed `TRAIN_DIR=…/model3_v2_labeled/train`; calls `assert_authoritative_s3_identity()` before `TrainingIndex.load`.
- Generalization audit: removed `TRAIN_LABELED`; spawns shared Python G0 before `loadTrainingIndex(trainDir)`.

## LEGACY DATASET HANDLING

`model3_v2_labeled` / realdist retained for historical trainers/QA. Listed in `NOT_AUTHORITATIVE_FOR_S3`. Cannot satisfy S3 G0.

## CANDIDATE FAIL-CLOSED

`bigru_v1._extract_first_pass_candidate_count`: present 0/1/2 accepted; missing/None rejected; `recallFirstPass=false` still masks to 0. Production packer / Model3 runtime **unchanged**. Duplicate 6-D host formulas **unchanged**.

## TEST RESULTS

Command:

```bash
python -m unittest training.model3_dataset.tests.test_dataset_identity_guard -v
```

Result: **15/15 OK** (~0.06s).

CLI:

```bash
python training/model3_dataset/acoustic_training/dataset_identity.py --require-authoritative-s3
# exit 0

python …/dataset_identity.py --require-authoritative-s3 --dataset-path …/model3_v2_labeled/train
# exit 2 MODEL3_DATASET_IDENTITY_MISMATCH
```

## NEGATIVE TEST MATRIX

See `model3_v2_identity_guard_negative_matrix.csv` — all required negatives PASS.

## REPOSITORY SEARCH RESULTS

Active S3 causality/generalization paths: **no** remaining labeled defaults.
Remaining `model3_v2_labeled` hits: legacy trainers/QA/emit historical docs — classified RETAINED_NOT_S3_SSOT / SUPERSEDED.

## SSOT / DOCUMENTATION UPDATE

- Freeze state CSV records G0 enforced + prior S3 causal conclusions superseded.
- Prior `model3_v2_localization_causality_summary.json` tagged `SUPERSEDED_BY_DATASET_IDENTITY_CORRECTION`.

## GOVERNANCE

| Item | Status |
|---|---|
| production code changed | NO |
| training executed | NO |
| dataset rebuilt | NO |
| model / threshold / features | NO |
| FineSpan / Retry / Recall / Model2 / Domain Vote / JobResult | NO |

## NEXT PHASE

Exactly one: `MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT_S3`

Do not execute automatically.
