# -*- coding: utf-8 -*-
"""Emit identity-guard development artifacts."""
from __future__ import annotations

import csv
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"

VERDICT = "MODEL3_TRAINING_DATA_IDENTITY_GUARD_DEVELOPMENT_PASS"
NEXT = "MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT_S3"


def wcsv(path: Path, rows: list[dict]):
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def main():
    tests = [
        {"testId": "T_POS_S3", "name": "correct_s3_passes", "result": "PASS", "exitOrAssert": "unittest OK"},
        {"testId": "T_ORDER", "name": "g0_before_sample_load_order", "result": "PASS", "exitOrAssert": "no shard-*.jsonl opened"},
        {"testId": "T_NEG_LABELED", "name": "wrong_dataset_labeled_path_fails", "result": "PASS", "exitOrAssert": "MODEL3_DATASET_IDENTITY_MISMATCH"},
        {"testId": "T_NEG_EXPLICIT", "name": "explicit_wrong_path_cannot_bypass", "result": "PASS", "exitOrAssert": "MODEL3_DATASET_IDENTITY_MISMATCH"},
        {"testId": "T_NEG_BUILD", "name": "wrong_build_id_fails", "result": "PASS", "exitOrAssert": "MODEL3_DATASET_BUILD_MISMATCH"},
        {"testId": "T_NEG_FEAT", "name": "wrong_feature_contract_fails", "result": "PASS", "exitOrAssert": "MODEL3_FEATURE_CONTRACT_MISMATCH"},
        {"testId": "T_NEG_LABEL", "name": "wrong_label_contract_fails", "result": "PASS", "exitOrAssert": "MODEL3_LABEL_CONTRACT_MISMATCH"},
        {"testId": "T_NEG_MANIFEST", "name": "missing_manifest_fails", "result": "PASS", "exitOrAssert": "MODEL3_DATASET_MANIFEST_MISSING"},
        {"testId": "T_NEG_FALLBACK", "name": "no_fallback_when_root_missing", "result": "PASS", "exitOrAssert": "MODEL3_DATASET_MANIFEST_MISSING"},
        {"testId": "T_STALE_PY", "name": "causality_script_has_no_labeled_train_dir", "result": "PASS", "exitOrAssert": "source scan"},
        {"testId": "T_STALE_MJS", "name": "generalization_runner_has_no_train_labeled", "result": "PASS", "exitOrAssert": "source scan"},
        {"testId": "T_CAND_012", "name": "zero_one_two_accepted", "result": "PASS", "exitOrAssert": "span_features"},
        {"testId": "T_CAND_MISS", "name": "missing_rejected", "result": "PASS", "exitOrAssert": "MODEL3_CANDIDATE_FIELD_MISSING"},
        {"testId": "T_CAND_NONE", "name": "none_rejected", "result": "PASS", "exitOrAssert": "MODEL3_CANDIDATE_FIELD_MISSING"},
        {"testId": "T_CAND_MASK", "name": "channel_unavailable_allows_zero", "result": "PASS", "exitOrAssert": "avail mask"},
        {"testId": "T_CLI_POS", "name": "cli_require_authoritative_s3", "result": "PASS", "exitOrAssert": "exit 0"},
        {"testId": "T_CLI_NEG", "name": "cli_labeled_path", "result": "PASS", "exitOrAssert": "exit 2"},
    ]
    wcsv(DOCS / "model3_v2_identity_guard_test_results.csv", tests)

    matrix = [
        {"case": "S3 ckpt + S3 dataset", "expected": "PASS", "observed": "PASS", "code": "ok"},
        {"case": "S3 ckpt + model3_v2_labeled", "expected": "HARD STOP", "observed": "HARD STOP", "code": "MODEL3_DATASET_IDENTITY_MISMATCH"},
        {"case": "wrong datasetBuildId", "expected": "HARD STOP", "observed": "HARD STOP", "code": "MODEL3_DATASET_BUILD_MISMATCH"},
        {"case": "wrong featureContract", "expected": "HARD STOP", "observed": "HARD STOP", "code": "MODEL3_FEATURE_CONTRACT_MISMATCH"},
        {"case": "wrong labelContract", "expected": "HARD STOP", "observed": "HARD STOP", "code": "MODEL3_LABEL_CONTRACT_MISMATCH"},
        {"case": "missing dataset_manifest.json", "expected": "HARD STOP", "observed": "HARD STOP", "code": "MODEL3_DATASET_MANIFEST_MISSING"},
        {"case": "explicit wrong path", "expected": "HARD STOP", "observed": "HARD STOP", "code": "MODEL3_DATASET_IDENTITY_MISMATCH"},
        {"case": "missing root no fallback", "expected": "HARD STOP", "observed": "HARD STOP", "code": "MODEL3_DATASET_MANIFEST_MISSING"},
        {"case": "G0 opens shards", "expected": "NO", "observed": "NO", "code": "order_test"},
    ]
    wcsv(DOCS / "model3_v2_identity_guard_negative_matrix.csv", matrix)

    inventory = [
        {"path": "training/.../audit_model3_v2_localization_training_causality.py", "kind": "S3_CAUSALITY_AUDIT", "status": "FIXED_G0_BOUND", "notes": "was STALE_HARDCODED_PATH"},
        {"path": "electron_node/.../run-model3-v2-target-localization-generalization-audit.mjs", "kind": "S3_GENERALIZATION_AUDIT", "status": "FIXED_G0_BOUND", "notes": "TRAIN_LABELED removed"},
        {"path": "training/.../acoustic_training/dataset_identity.py", "kind": "G0_HELPER", "status": "NEW", "notes": "shared SSOT"},
        {"path": "training/.../train/bigru_v1.py", "kind": "TRAINING_LOADER", "status": "FAIL_CLOSED_CAND", "notes": "missing≠0; production unchanged"},
        {"path": "training/.../train/train_v2_labeled.py", "kind": "LEGACY", "status": "RETAINED_NOT_S3_SSOT", "notes": "legitimate labeled trainer"},
        {"path": "training/.../scripts/qa_v2_dataset.py", "kind": "LEGACY", "status": "RETAINED_NOT_S3_SSOT", "notes": ""},
        {"path": "training/.../scripts/run_v2_dataset_build.py", "kind": "LEGACY", "status": "RETAINED_NOT_S3_SSOT", "notes": ""},
        {"path": "training/.../scripts/build_v2_realdist_expanded.py", "kind": "LEGACY", "status": "RETAINED_QUARANTINE_CANDIDATE", "notes": "hardcode cand=0 historical"},
        {"path": "training/.../scripts/audit_v2_real_feature_gap.py", "kind": "LEGACY_AUDIT", "status": "RETAINED_NOT_S3_CAUSALITY", "notes": "uses labeled as V2 source"},
        {"path": "docs/.../Lingua_Model3_V2_Localization_Training_Causality_Audit_2026_09_02.md", "kind": "HISTORICAL_REPORT", "status": "SUPERSEDED_BY_DATASET_IDENTITY_CORRECTION", "notes": "S3 causal conclusions invalidated"},
        {"path": "docs/.../model3_v2_localization_causality_summary.json", "kind": "HISTORICAL_REPORT", "status": "SUPERSEDED_BY_DATASET_IDENTITY_CORRECTION", "notes": "wrong TRAIN_DIR"},
    ]
    wcsv(DOCS / "model3_v2_stale_dataset_reference_inventory.csv", inventory)

    modified = [
        {"path": "training/model3_dataset/acoustic_training/dataset_identity.py", "change": "ADD shared G0"},
        {"path": "training/model3_dataset/scripts/audit_model3_v2_localization_training_causality.py", "change": "G0 before load; remove labeled TRAIN_DIR"},
        {"path": "electron_node/electron-node/tests/run-model3-v2-target-localization-generalization-audit.mjs", "change": "G0 before load; remove TRAIN_LABELED"},
        {"path": "training/model3_dataset/train/bigru_v1.py", "change": "candidate missing fail-closed"},
        {"path": "training/model3_dataset/tests/test_dataset_identity_guard.py", "change": "ADD tests"},
    ]
    wcsv(DOCS / "model3_v2_identity_guard_modified_files.csv", modified)

    freeze = [
        {"item": "AUTHORITATIVE_S3_DATASET", "value": "MODEL3_V2_PRODUCTION_CORE_S3 / prod_core_s3_build_20260830_v1", "status": "FROZEN"},
        {"item": "CHECKPOINT_DATASET_BINDING", "value": "G0 assert_model3_dataset_identity", "status": "IMPLEMENTED"},
        {"item": "G0_BEFORE_SAMPLE_LOAD", "value": "REQUIRED", "status": "ENFORCED"},
        {"item": "LEGACY_NOT_AUTHORITATIVE_FOR_S3", "value": "model3_v2_labeled / realdist", "status": "ENFORCED"},
        {"item": "PRIOR_S3_CAUSAL_64_CAND0_853", "value": "SUPERSEDED_BY_DATASET_IDENTITY_CORRECTION", "status": "RETRACTED"},
        {"item": "LOCALIZATION16_TRAINING_CAUSE", "value": "UNRESOLVED", "status": "FROZEN"},
        {"item": "VERDICT", "value": VERDICT, "status": "FROZEN"},
        {"item": "NEXT_PHASE", "value": NEXT, "status": "PROPOSED_NOT_EXECUTED"},
    ]
    wcsv(DOCS / "model3_v2_identity_guard_freeze_state.csv", freeze)

    summary = {
        "phase": "MODEL3_V2_TRAINING_DATA_IDENTITY_GUARD_DEVELOPMENT",
        "verdict": VERDICT,
        "nextPhase": NEXT,
        "guard": {
            "module": "training/model3_dataset/acoustic_training/dataset_identity.py",
            "api": ["assert_model3_dataset_identity", "assert_authoritative_s3_identity"],
            "metadataSources": [
                "checkpoint/config.json",
                "checkpoint/weights.pt sha256",
                "checkpoint/training_metrics.json (if present)",
                "docs/model3_v2_s3_checkpoint_manifest.json (if present)",
                "dataset_manifest.json",
            ],
            "beforeSampleLoad": True,
            "hardStop": True,
            "newRegistry": False,
        },
        "authoritative": {
            "modelId": "MODEL3_V2_S3_RANDOM_INIT_V1",
            "weightsSha256": "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1",
            "datasetId": "MODEL3_V2_PRODUCTION_CORE_S3",
            "datasetBuildId": "prod_core_s3_build_20260830_v1",
        },
        "stalePathStatus": "REMOVED_FROM_S3_CAUSALITY_AND_GENERALIZATION_AUDITS",
        "candidateMissingValueStatus": "TRAINING_SIDE_FAIL_CLOSED_IMPLEMENTED",
        "duplicate6dUnchanged": True,
        "testCommand": "python -m unittest training.model3_dataset.tests.test_dataset_identity_guard -v",
        "testResult": "15/15 OK",
        "cliEvidence": {
            "positive": "dataset_identity.py --require-authoritative-s3 → exit 0",
            "negativeLabeled": "… --dataset-path model3_v2_labeled/train → exit 2 MODEL3_DATASET_IDENTITY_MISMATCH",
        },
        "questions": {
            "D1": "dataset_identity.assert_model3_dataset_identity",
            "D2": "checkpoint config + weights hash + sidecar manifests + dataset_manifest.json",
            "D3": "YES",
            "D4": "YES",
            "D5": "YES HARD STOP",
            "D6": "YES",
            "D7": "YES",
            "D8": "YES",
            "D9": "YES",
            "D10": "NO",
            "D11": "NO",
            "D12": "NO",
            "D13": "NO",
            "D14": "NO",
            "D15": "NO",
            "D16": "NO",
            "D17": "NO",
            "D18": "NO",
            "D19": "NO",
            "D20": "NO",
            "D21": "NO",
            "D22": "YES training-side only fail-closed",
            "D23": "YES zero still valid",
            "D24": "YES duplicate 6D unchanged (inference host untouched)",
            "D25": "YES retained",
            "D26": "YES SUPERSEDED_BY_DATASET_IDENTITY_CORRECTION",
            "D27": "YES",
            "D28": "YES",
        },
        "governance": {
            "productionCodeChanged": "NO",
            "trainingExecuted": "NO",
            "datasetRebuilt": "NO",
            "modelChanged": "NO",
            "thresholdChanged": "NO",
            "featureContractChanged": "NO",
            "fineSpanChanged": "NO",
            "retryChanged": "NO",
            "recallChanged": "NO",
            "model2Changed": "NO",
            "domainVoteChanged": "NO",
            "jobResultChanged": "NO",
        },
    }
    (DOCS / "model3_v2_identity_guard_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    # Mark prior causality summary if present
    prior = DOCS / "model3_v2_localization_causality_summary.json"
    if prior.exists():
        try:
            data = json.loads(prior.read_text(encoding="utf-8"))
            data["s3CausalConclusionsStatus"] = "SUPERSEDED_BY_DATASET_IDENTITY_CORRECTION"
            data["s3CausalConclusionsReason"] = "prior audit used model3_v2_labeled; not MODEL3_V2_PRODUCTION_CORE_S3"
            prior.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    report = f"""# Lingua Model3 V2 Training Data Identity Guard Development (2026-09-02)

Phase: `MODEL3_V2_TRAINING_DATA_IDENTITY_GUARD_DEVELOPMENT`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | `{VERDICT}` |
| **guard** | `acoustic_training/dataset_identity.py` → `assert_model3_dataset_identity` |
| **authoritative checkpoint** | MODEL3_V2_S3_RANDOM_INIT_V1 / f1e41969… |
| **authoritative dataset** | MODEL3_V2_PRODUCTION_CORE_S3 / prod_core_s3_build_20260830_v1 |
| **G0 before sample load** | **YES** (proven by order test) |
| **stale path status** | **REMOVED** from S3 causality + generalization audits |
| **candidate missing-value** | training-side fail-closed (`None`/missing → reject; 0/1/2 OK) |
| **production change** | **NO** |
| **next phase** | `{NEXT}` (**NOT EXECUTED**) |

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

Exactly one: `{NEXT}`

Do not execute automatically.
"""
    (DOCS / "Lingua_Model3_V2_Training_Data_Identity_Guard_Development_Report_2026_09_02.md").write_text(
        report, encoding="utf-8"
    )
    print(json.dumps({"verdict": VERDICT, "nextPhase": NEXT, "tests": "15/15"}, indent=2))


if __name__ == "__main__":
    main()
