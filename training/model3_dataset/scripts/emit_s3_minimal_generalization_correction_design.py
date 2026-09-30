# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_MINIMAL_GENERALIZATION_CORRECTION_DESIGN — design only, no training."""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DOCS = REPO / "docs/user_correction/model3"

PHASE = "MODEL3_V2_S3_MINIMAL_GENERALIZATION_CORRECTION_DESIGN"
GENERATOR = "training/model3_dataset/scripts/emit_s3_minimal_generalization_correction_design.py"
GENERATED_AT = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

VERDICT = "MODEL3_S3_MINIMAL_CORRECTION_DESIGN_CLASS_WEIGHT_FIRST"
NEXT = "MODEL3_V2_S3_CLASS_WEIGHT_EXPERIMENT_DEVELOPMENT"
FIRST_EXPERIMENT = "CLASS_WEIGHT_ONLY"

IDENTITY = {
    "modelId": "MODEL3_V2_S3_RANDOM_INIT_V1",
    "weightsSha256": "f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1",
    "datasetId": "MODEL3_V2_PRODUCTION_CORE_S3",
    "datasetBuildId": "prod_core_s3_build_20260830_v1",
    "labelContractVersion": "MODEL3_LABEL_CONTRACT_V2_20260829",
}

HIGH_12 = [
    "d040", "d042", "d054", "d065", "d085", "d102", "d109", "d114", "d129", "d138", "d172", "d175"
]
UNRESOLVED_4 = ["d008", "d022", "d051", "d094"]
CLEAR_OOS = ["d040", "d042", "d085", "d129", "d172", "d175"]
LOCAL_FIT_WEAK = ["d065", "d102", "d138"]
SURFACE_REPLAY_UNRESOLVED = ["d054", "d109", "d114"]


def prov() -> dict:
    return {
        "phase": PHASE,
        "generator": GENERATOR,
        "generatedAt": GENERATED_AT,
        **IDENTITY,
        "featureContract": "packModel3SpanInferFields",
    }


def write_csv(path: Path, rows: list[dict]):
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)


def patch_prior_ssot():
    gen_sum = DOCS / "model3_v2_s3_generalization_audit_summary.json"
    if gen_sum.exists():
        data = json.loads(gen_sum.read_text(encoding="utf-8"))
        data["firstCausalOwner"] = "NOT_YET_ISOLATED"
        data["firstCausalOwnerCorrectedBy"] = PHASE
        data["hypotheses"] = {
            "CLASS_IMBALANCE": "VERIFIED_PRESENT",
            "CLASS_IMBALANCE_CAUSALITY": "NOT_PROVEN",
            "RETRY_SAMPLING_IMBALANCE": "VERIFIED_PRESENT",
            "RETRY_SAMPLING_CAUSALITY": "NOT_PROVEN",
            "HARD_NEGATIVE_DISTRIBUTION": "STRONG_HYPOTHESIS",
            "HARD_NEGATIVE_CAUSALITY": "NOT_PROVEN",
            "SEQUENCE_CONTEXT_GENERALIZATION": "PROVEN_RELEVANT_LIKELY_OWNER",
        }
        if "checkpointSelection" in data:
            data["checkpointSelection"]["retryRecallPeakedAtSelectedEpoch"] = False
            data["checkpointSelection"]["bestDevRetryRecallEpoch"] = 4
            data["checkpointSelection"]["bestDevRetryF1Epoch"] = 8
        gen_sum.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    freeze = DOCS / "model3_v2_s3_causality_corrected_freeze_state.csv"
    if freeze.exists():
        rows = list(csv.DictReader(freeze.open(encoding="utf-8")))
        rows = [r for r in rows if r.get("item") not in ("FIRST_CAUSAL_OWNER", "RETRY_RECALL_PEAKED_AT_SELECTED_EPOCH")]
        p = prov()
        rows.extend([
            {**p, "item": "FIRST_CAUSAL_OWNER", "value": "NOT_YET_ISOLATED", "status": "FROZEN"},
            {**p, "item": "RETRY_RECALL_PEAKED_AT_SELECTED_EPOCH", "value": "FALSE", "status": "CORRECTED"},
            {**p, "item": "BEST_DEV_RETRY_F1_EPOCH", "value": "8", "status": "FROZEN"},
            {**p, "item": "BEST_DEV_RETRY_RECALL_EPOCH", "value": "4", "status": "FROZEN"},
            {**p, "item": "CHECKPOINT_SELECTION_CRITERION", "value": "best_dev_retry_f1", "status": "FROZEN"},
            {**p, "item": "HIGH_DIAGNOSTIC_SUBGROUP_CLEAR_OOS", "value": ",".join(CLEAR_OOS), "status": "FROZEN"},
            {**p, "item": "FIRST_EXPERIMENT_FAMILY", "value": FIRST_EXPERIMENT, "status": "DESIGN_FROZEN"},
        ])
        write_csv(freeze, rows)


def main():
    patch_prior_ssot()
    p = prov()

    baseline_metrics = {
        "trainRetryRecall": 0.911757,
        "trainRetryF1": 0.941473,
        "trainRetryPrecision": 0.97319,
        "devRetryRecall": 0.790852,
        "devRetryF1": 0.850018,
        "devRetryPrecision": 0.918752,
        "trainKeepFalseRetryRate": 0.001739,
        "devKeepFalseRetryRate": 0.005159,
    }

    matrix = [
        {
            **p,
            "experimentId": "MODEL3_V2_S3_EXP_BASELINE",
            "parentCheckpoint": "MODEL3_V2_S3_RANDOM_INIT_V1",
            "singleChangedFactor": "NONE",
            "classWeightRetry": 1.0,
            "samplingMode": "uniform_shuffle_utterance",
            "hardNegativeMode": "NONE",
            "seed": 2026083013,
            "checkpointMetric": "best_dev_retry_f1",
            "trainMetrics": json.dumps(baseline_metrics),
            "devMetrics": "PENDING_EXPERIMENT",
            "heldout12Evaluation": "BASELINE_REFERENCE",
            "falseRetryEvaluation": "BASELINE_REFERENCE",
            "status": "FROZEN_EXISTING",
        },
        {
            **p,
            "experimentId": "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1",
            "parentCheckpoint": "MODEL3_V2_S3_RANDOM_INIT_V1",
            "singleChangedFactor": "class_weight_retry_only",
            "classWeightRetry": 2.0,
            "samplingMode": "uniform_shuffle_utterance",
            "hardNegativeMode": "NONE",
            "seed": 2026083013,
            "checkpointMetric": "best_dev_retry_f1",
            "trainMetrics": "PENDING",
            "devMetrics": "PENDING",
            "heldout12Evaluation": "PENDING_HELDOUT",
            "falseRetryEvaluation": "PENDING",
            "status": "DESIGN",
        },
        {
            **p,
            "experimentId": "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A2",
            "parentCheckpoint": "MODEL3_V2_S3_RANDOM_INIT_V1",
            "singleChangedFactor": "class_weight_retry_only",
            "classWeightRetry": 4.0,
            "samplingMode": "uniform_shuffle_utterance",
            "hardNegativeMode": "NONE",
            "seed": 2026083013,
            "checkpointMetric": "best_dev_retry_f1",
            "trainMetrics": "PENDING",
            "devMetrics": "PENDING",
            "heldout12Evaluation": "PENDING_HELDOUT",
            "falseRetryEvaluation": "PENDING",
            "status": "DESIGN",
        },
        {
            **p,
            "experimentId": "MODEL3_V2_S3_EXP_RETRY_SAMPLING_B1",
            "parentCheckpoint": "MODEL3_V2_S3_RANDOM_INIT_V1",
            "singleChangedFactor": "retry_utterance_weighted_sampler_only",
            "classWeightRetry": 1.0,
            "samplingMode": "retry_utterance_weight_2x",
            "hardNegativeMode": "NONE",
            "seed": 2026083013,
            "checkpointMetric": "best_dev_retry_f1",
            "trainMetrics": "PENDING",
            "devMetrics": "PENDING",
            "heldout12Evaluation": "PENDING_HELDOUT",
            "falseRetryEvaluation": "PENDING",
            "status": "DESIGN_DEFERRED",
        },
        {
            **p,
            "experimentId": "MODEL3_V2_S3_EXP_HARD_NEG_C1",
            "parentCheckpoint": "MODEL3_V2_S3_RANDOM_INIT_V1",
            "singleChangedFactor": "hard_negative_index_sampler_only",
            "classWeightRetry": 1.0,
            "samplingMode": "uniform_shuffle_utterance",
            "hardNegativeMode": "keep_near_boundary_surface_cluster_v1",
            "seed": 2026083013,
            "checkpointMetric": "best_dev_retry_f1",
            "trainMetrics": "PENDING",
            "devMetrics": "PENDING",
            "heldout12Evaluation": "PENDING_HELDOUT",
            "falseRetryEvaluation": "PENDING",
            "status": "DESIGN_DEFERRED",
        },
    ]
    write_csv(DOCS / "model3_v2_s3_controlled_experiment_matrix.csv", matrix)

    targets = [
        {
            **p,
            "family": "CLASS_WEIGHT_ONLY",
            "file": "training/model3_dataset/train/train_s3_random.py",
            "symbol": "CLASS_WEIGHT_RETRY / config.class_weight_retry",
            "changeRequired": "Parameterize class_weight_retry per experimentId; write to config.json + training_metrics.json",
            "changeScope": "TRAINING_ONLY",
            "productionImpact": "NONE",
            "rollback": "Revert constant / experiment launcher flag",
        },
        {
            **p,
            "family": "CLASS_WEIGHT_ONLY",
            "file": "training/model3_dataset/train/train_s3_random.py",
            "symbol": "main() CrossEntropyLoss weight tensor",
            "changeRequired": "Uses CLASS_WEIGHT_RETRY — no logic change beyond value",
            "changeScope": "TRAINING_ONLY",
            "productionImpact": "NONE",
            "rollback": "Same as above",
        },
        {
            **p,
            "family": "RETRY_SAMPLING_ONLY",
            "file": "training/model3_dataset/train/train_s3_random.py",
            "symbol": "DataLoader(..., shuffle=True)",
            "changeRequired": "Optional WeightedRandomSampler on utterance index; weight=2 if any RETRY span else 1",
            "changeScope": "TRAINING_ONLY",
            "productionImpact": "NONE",
            "rollback": "Remove sampler; restore shuffle=True",
        },
        {
            **p,
            "family": "HARD_NEGATIVE_ONLY",
            "file": "training/model3_dataset/train/train_s3_random.py",
            "symbol": "new helper + sampler index",
            "changeRequired": "Pre-scan train with baseline ckpt; build KEEP hard-neg index (same-surface high KEEP mass); weighted sampler — DEFER until A/B tested",
            "changeScope": "TRAINING_ONLY",
            "productionImpact": "NONE",
            "rollback": "Disable hardNegativeMode flag",
        },
        {
            **p,
            "family": "ALL",
            "file": "training/model3_dataset/scripts/eval_s3_experiment_arm.py",
            "symbol": "NEW (future)",
            "changeRequired": "G0 + train/dev metrics + held-out 12 + false RETRY gate evaluator",
            "changeScope": "AUDIT/TRAINING",
            "productionImpact": "NONE",
            "rollback": "N/A read-only eval",
        },
    ]
    write_csv(DOCS / "model3_v2_s3_training_strategy_target_files.csv", targets)

    gates = [
        {**p, "gateId": "G_DEV_QUALITY", "metric": "dev retry F1/precision vs baseline", "rule": "No material F1 drop; recall gain must not collapse precision", "baselineRef": "MODEL3_V2_S3_EXP_BASELINE", "thresholdType": "DELTA_VS_BASELINE", "status": "DESIGN"},
        {**p, "gateId": "G_FALSE_RETRY", "metric": "dev KEEP→RETRY rate", "rule": "Must not exceed baseline + controlled margin", "baselineRef": "0.005159 dev FP rate", "thresholdType": "ABSOLUTE_DELTA", "status": "DESIGN"},
        {**p, "gateId": "G_HELDOUT12", "metric": "12 HIGH localization cases", "rule": "Net improvement; not required 12/12; no mandatory wins on unresolved4", "baselineRef": "frozen production traces", "thresholdType": "NET_IMPROVEMENT", "status": "DESIGN"},
        {**p, "gateId": "G_MAINLINE_SAFETY", "metric": "architecture / Retry semantics", "rule": "No runtime/JobResult/FineSpan change", "baselineRef": "frozen architecture", "thresholdType": "HARD", "status": "DESIGN"},
        {**p, "gateId": "G_DOWNSTREAM", "metric": "Retry utility (future)", "rule": "Design only — candidate must improve assembly path not just Model3 margin", "baselineRef": "TBD next phase", "thresholdType": "FUTURE", "status": "DESIGN"},
        {**p, "gateId": "G_SINGLE_VARIABLE", "metric": "experiment attribution", "rule": "Exactly one mechanism differs from baseline per arm", "baselineRef": "matrix", "thresholdType": "HARD", "status": "DESIGN"},
    ]
    write_csv(DOCS / "model3_v2_s3_experiment_acceptance_gates.csv", gates)

    freeze_rows = [
        {**p, "item": "FIRST_CAUSAL_OWNER", "value": "NOT_YET_ISOLATED", "status": "FROZEN"},
        {**p, "item": "GENERALIZATION_PRIMARY", "value": "YES", "status": "FROZEN"},
        {**p, "item": "HIGH_CONF_GENERALIZATION", "value": "12", "status": "FROZEN"},
        {**p, "item": "UNRESOLVED_MEDIUM", "value": "4", "status": "FROZEN"},
        {**p, "item": "RETRY_RECALL_PEAKED_AT_SELECTED_EPOCH", "value": "FALSE", "status": "FROZEN"},
        {**p, "item": "BASELINE_CLASS_WEIGHT_RETRY", "value": "1.0", "status": "FROZEN"},
        {**p, "item": "BASELINE_SAMPLING", "value": "uniform_shuffle_utterance", "status": "FROZEN"},
        {**p, "item": "FIRST_EXPERIMENT_FAMILY", "value": FIRST_EXPERIMENT, "status": "DESIGN_FROZEN"},
        {**p, "item": "EXPERIMENT_ARMS_DESIGNED", "value": "5", "status": "FROZEN"},
        {**p, "item": "VERDICT", "value": VERDICT, "status": "FROZEN"},
        {**p, "item": "NEXT_PHASE", "value": NEXT, "status": "PROPOSED_NOT_EXECUTED"},
    ]
    write_csv(DOCS / "model3_v2_s3_corrected_generalization_freeze_state.csv", freeze_rows)

    summary = {
        **p,
        "g0Required": True,
        "ssotCorrections": {
            "firstCausalOwner": "NOT_YET_ISOLATED",
            "retryRecallPeakedAtSelectedEpoch": False,
            "bestDevRetryF1Epoch": 8,
            "bestDevRetryRecallEpoch": 4,
        },
        "verdict": VERDICT,
        "nextPhase": NEXT,
        "firstExperimentalFamily": FIRST_EXPERIMENT,
        "whyClassWeightFirst": [
            "Smallest code change: single constant in train_s3_random.py",
            "Cleanest single-variable attribution",
            "CLASS_IMBALANCE verified present (14.4:1, weight=1.0)",
            "Repository precedent: v1 bigru used 4.0 without architecture change",
            "Does not require new sampler/index infrastructure first",
        ],
        "experimentArms": 5,
        "singleVariableArms": True,
        "classWeightSearchRange": [2.0, 4.0],
        "classWeightSearchRationale": "Moderate (2.0) and higher (4.0) — NOT mechanical 14.4; aligned with historical Model3 training scale",
        "executionOrder": ["CLASS_WEIGHT_A1/A2", "RETRY_SAMPLING_B1 deferred", "HARD_NEG_C1 deferred"],
        "combinationForbiddenUntil": "One single-factor arm shows benefit",
        "baselineMetrics": baseline_metrics,
        "diagnosticSubgroups": {
            "CLEAR_OOS_GENERALIZATION": CLEAR_OOS,
            "LOCAL_PATTERN_TRAIN_FIT_WEAK": LOCAL_FIT_WEAK,
            "SURFACE_SUPPORT_REPLAY_UNRESOLVED": SURFACE_REPLAY_UNRESOLVED,
        },
        "heldOut12Role": "evaluation_only",
        "unresolved4Role": "diagnostic_only",
        "acpRequired": False,
        "questions": {
            "D1": True,
            "D2": True,
            "D3": True,
            "D4": True,
            "D5": True,
            "D6": True,
            "D7": "NOT_PROVEN",
            "D8": True,
            "D9": "NOT_PROVEN",
            "D10": True,
            "D11": "NOT_PROVEN",
            "D12": "CLASS_WEIGHT_ONLY A1/A2",
            "D13": "train_s3_random.py CLASS_WEIGHT_RETRY + CrossEntropyLoss",
            "D17": "CLASS_WEIGHT_ONLY",
            "D18": "CLASS_WEIGHT_ONLY",
            "D19": 5,
            "D20": True,
            "D21": True,
            "D23": True,
            "D26": "held-out evaluation only",
            "D27": "diagnostic only",
            "D28": False,
            "D29": False,
            "D30": False,
            "D41": False,
            "D42": FIRST_EXPERIMENT,
            "D43": NEXT,
        },
        "governance": {
            "productionCodeChanged": "NO",
            "trainingExecuted": "NO",
            "datasetRebuilt": "NO",
            "modelArchitectureChanged": "NO",
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
    (DOCS / "model3_v2_s3_minimal_correction_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    report = f"""# Lingua Model3 V2 S3 Minimal Generalization Correction Design (2026-09-02)

Phase: `{PHASE}`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | `{VERDICT}` |
| **SSOT corrections** | `FIRST_CAUSAL_OWNER` → **NOT_YET_ISOLATED**; `retryRecallPeakedAtSelectedEpoch` → **FALSE** |
| **first experiment** | **CLASS_WEIGHT_ONLY** (A1=2.0, A2=4.0) |
| **why selected** | 最小代码改动、单变量归因最干净、类别不平衡已验证存在 |
| **experiment arms** | **5** (baseline + 2 class-weight + 2 deferred designs) |
| **ACP** | **NO** |
| **next phase** | `{NEXT}` (**NOT EXECUTED**) |

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

`{NEXT}`
"""
    (DOCS / "Lingua_Model3_V2_S3_Minimal_Generalization_Correction_Design_2026_09_02.md").write_text(
        report, encoding="utf-8"
    )

    print(json.dumps({"verdict": VERDICT, "nextPhase": NEXT, "arms": 5}, indent=2))


if __name__ == "__main__":
    main()
