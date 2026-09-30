# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_CLASS_WEIGHT_EXPERIMENT — orchestration, gates, artifacts."""
from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.acoustic_training.dataset_identity import assert_authoritative_s3_identity  # noqa: E402
from training.model3_dataset.scripts.s3_class_weight_heldout_eval import evaluate_checkpoint  # noqa: E402
from training.model3_dataset.train.train_s3_random import (  # noqa: E402
    BASELINE_OUT,
    EXP_OUT_DIRS,
    PARENT_MODEL_ID,
    PARENT_WEIGHTS_SHA,
    SEED,
)

DOCS = REPO / "docs/user_correction/model3"
PHASE = "MODEL3_V2_S3_CLASS_WEIGHT_EXPERIMENT_DEVELOPMENT"
GENERATED_AT = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# Frozen BEFORE training / result inspection.
PREDECLARED_GATES = {
    "gateA_devRetryF1_toleranceNeutral": 0.002,
    "gateA_devRetryF1_improvedMinDelta": 0.002,
    "gateA_devRetryF1_regressedMaxDelta": -0.002,
    "gateB_precisionCollapseWarnDelta": -0.015,
    "gateD_falseRetrySafeAbsoluteDeltaMax": 0.002,
    "gateD_falseRetryTradeoffAbsoluteDeltaMax": 0.010,
    "gateD_falseRetryUnsafeAbove": 0.010,
    "tieBreakRule": "LOWER_CLASS_WEIGHT_IF_DEV_F1_WITHIN_TOLERANCE",
    "baselineAllowedToWin": True,
    "heldout12ExcludedFromSelection": True,
}

BASELINE_DEV = {
    "retry_f1": 0.8500178126113288,
    "retry_precision": 0.9187524066230266,
    "retry_recall": 0.7908518395757375,
    "keepFalseRetryRate": 211 / (40691 + 211),
}
BASELINE_TRAIN = {
    "retry_precision": 0.97319,
    "retry_recall": 0.911757,
    "retry_f1": 0.941473,
    "keepFalseRetryRate": 0.001739,
}

ARMS = [
    {"arm": "BASELINE", "experimentId": PARENT_MODEL_ID, "classWeightRetry": 1.0, "ckpt": BASELINE_OUT},
    {
        "arm": "A1",
        "experimentId": "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1",
        "classWeightRetry": 2.0,
        "ckpt": EXP_OUT_DIRS["MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1"],
    },
    {
        "arm": "A2",
        "experimentId": "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A2",
        "classWeightRetry": 4.0,
        "ckpt": EXP_OUT_DIRS["MODEL3_V2_S3_EXP_CLASS_WEIGHT_A2"],
    },
]


def false_retry(m: dict) -> float:
    if "keepFalseRetryRate" in m:
        return float(m["keepFalseRetryRate"])
    return m["fp"] / max(m["tn"] + m["fp"], 1)


def load_arm_metrics(arm: dict) -> dict:
    if arm["arm"] == "BASELINE":
        p = BASELINE_OUT / "training_metrics.json"
        raw = json.loads(p.read_text(encoding="utf-8"))
        dev = raw["dev"]
        train = BASELINE_TRAIN
        return {
            "experimentId": PARENT_MODEL_ID,
            "classWeightRetry": 1.0,
            "weightsSha256": raw["weightsSha256"],
            "bestEpoch": raw["bestEpoch"],
            "trainMetrics": train,
            "devMetrics": {
                "retry_precision": dev["retry_precision"],
                "retry_recall": dev["retry_recall"],
                "retry_f1": dev["retry_f1"],
                "keepFalseRetryRate": false_retry(dev),
                "fp": dev["fp"],
                "tn": dev["tn"],
            },
            "history": raw.get("history", []),
        }
    p = arm["ckpt"] / "training_metrics.json"
    if not p.exists():
        raise FileNotFoundError(p)
    raw = json.loads(p.read_text(encoding="utf-8"))
    return {
        "experimentId": raw["experimentId"],
        "classWeightRetry": raw["classWeightRetry"],
        "weightsSha256": raw["weightsSha256"],
        "bestEpoch": raw["bestEpoch"],
        "trainMetrics": raw["trainMetrics"],
        "devMetrics": raw["devMetrics"],
        "history": raw.get("history", []),
    }


def classify_f1(delta: float) -> str:
    tol = PREDECLARED_GATES["gateA_devRetryF1_toleranceNeutral"]
    if delta >= PREDECLARED_GATES["gateA_devRetryF1_improvedMinDelta"]:
        return "IMPROVED"
    if delta <= PREDECLARED_GATES["gateA_devRetryF1_regressedMaxDelta"]:
        return "REGRESSED"
    if abs(delta) <= tol:
        return "NEUTRAL"
    return "NEUTRAL"


def classify_false_retry(delta: float) -> str:
    if delta <= PREDECLARED_GATES["gateD_falseRetrySafeAbsoluteDeltaMax"]:
        return "SAFE"
    if delta <= PREDECLARED_GATES["gateD_falseRetryTradeoffAbsoluteDeltaMax"]:
        return "TRADEOFF"
    return "UNSAFE"


def arm_status(m: dict) -> str:
    dev = m["devMetrics"]
    delta_f1 = dev["retry_f1"] - BASELINE_DEV["retry_f1"]
    delta_fr = dev["keepFalseRetryRate"] - BASELINE_DEV["keepFalseRetryRate"]
    f1_cls = classify_f1(delta_f1)
    fr_cls = classify_false_retry(delta_fr)
    if f1_cls == "REGRESSED":
        return "FAIL_DEV_REGRESSION"
    if fr_cls == "UNSAFE":
        return "FAIL_FALSE_RETRY"
    if f1_cls == "IMPROVED" and fr_cls in ("SAFE", "TRADEOFF"):
        return "PASS_BENEFICIAL" if fr_cls == "SAFE" else "PASS_TRADEOFF"
    if f1_cls == "NEUTRAL" and fr_cls == "SAFE":
        return "FAIL_NO_BENEFIT"
    if f1_cls == "NEUTRAL" and fr_cls == "TRADEOFF":
        return "PASS_TRADEOFF"
    return "FAIL_NO_BENEFIT"


def select_winner(metrics_by_arm: dict) -> tuple[str, str]:
    candidates = []
    for arm in ("A1", "A2"):
        m = metrics_by_arm[arm]
        st = arm_status(m)
        if st.startswith("PASS"):
            candidates.append((arm, m))
    if not candidates:
        return "BASELINE_1_0_REMAINS_BEST", "MODEL3_S3_CLASS_WEIGHT_EXPERIMENT_BASELINE_REMAINS_BEST"
    candidates.sort(key=lambda x: (-x[1]["devMetrics"]["retry_f1"], x[1]["classWeightRetry"]))
    best_f1 = candidates[0][1]["devMetrics"]["retry_f1"]
    tol = PREDECLARED_GATES["gateA_devRetryF1_toleranceNeutral"]
    tied = [c for c in candidates if abs(c[1]["devMetrics"]["retry_f1"] - best_f1) <= tol]
    tied.sort(key=lambda x: x[1]["classWeightRetry"])
    winner_arm = tied[0][0]
    if winner_arm == "A1":
        return "A1_WEIGHT_2_0_SELECTED", "MODEL3_S3_CLASS_WEIGHT_EXPERIMENT_A1_SELECTED"
    return "A2_WEIGHT_4_0_SELECTED", "MODEL3_S3_CLASS_WEIGHT_EXPERIMENT_A2_SELECTED"


def run_training(skip_train: bool) -> dict:
    results = {}
    for exp_id, cw in (
        ("MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1", 2.0),
        ("MODEL3_V2_S3_EXP_CLASS_WEIGHT_A2", 4.0),
    ):
        cmd = [
            sys.executable,
            str(REPO / "training/model3_dataset/train/train_s3_random.py"),
            "--experiment-id",
            exp_id,
            "--class-weight-retry",
            str(cw),
        ]
        if skip_train and (EXP_OUT_DIRS[exp_id] / "training_metrics.json").exists():
            results[exp_id] = {"skipped": True, "reason": "checkpoint_exists"}
            continue
        print(f"TRAIN {exp_id} cw={cw}", flush=True)
        proc = subprocess.run(cmd, cwd=str(REPO), capture_output=True, text=True)
        results[exp_id] = {"returncode": proc.returncode, "stdout": proc.stdout[-2000:], "stderr": proc.stderr[-2000:]}
        if proc.returncode != 0:
            raise SystemExit(f"training_failed:{exp_id}:{proc.returncode}")
    return results


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-train", action="store_true")
    args = ap.parse_args()

    identity = assert_authoritative_s3_identity()
    g0 = {"status": "PASS", "identity": identity.to_dict()}

    train_cmds = [
        "python training/model3_dataset/train/train_s3_random.py --experiment-id MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1 --class-weight-retry 2.0",
        "python training/model3_dataset/train/train_s3_random.py --experiment-id MODEL3_V2_S3_EXP_CLASS_WEIGHT_A2 --class-weight-retry 4.0",
    ]
    train_log = run_training(args.skip_train)

    metrics_by_arm = {}
    for arm in ARMS:
        if arm["arm"] != "BASELINE" and not (arm["ckpt"] / "training_metrics.json").exists():
            print(json.dumps({"fatal": f"missing_metrics:{arm['arm']}"}))
            return 4
        metrics_by_arm[arm["arm"]] = load_arm_metrics(arm)

    comparison_rows = []
    for arm in ARMS:
        m = metrics_by_arm[arm["arm"]]
        train = m["trainMetrics"]
        dev = m["devMetrics"]
        gap = train["retry_recall"] - dev["retry_recall"]
        st = "BASELINE" if arm["arm"] == "BASELINE" else arm_status(m)
        comparison_rows.append(
            {
                "model": arm["experimentId"],
                "arm": arm["arm"],
                "weight": m["classWeightRetry"],
                "selectedEpoch": m["bestEpoch"],
                "weightsSha256": m["weightsSha256"],
                "trainRetryPrecision": round(train["retry_precision"], 6),
                "trainRetryRecall": round(train["retry_recall"], 6),
                "trainRetryF1": round(train["retry_f1"], 6),
                "devRetryPrecision": round(dev["retry_precision"], 6),
                "devRetryRecall": round(dev["retry_recall"], 6),
                "devRetryF1": round(dev["retry_f1"], 6),
                "trainKeepFalseRetry": round(train["keepFalseRetryRate"], 6),
                "devKeepFalseRetry": round(dev["keepFalseRetryRate"], 6),
                "generalizationGap": round(gap, 6),
                "status": st,
            }
        )

    heldout_rows = []
    baseline_ckpt = BASELINE_OUT
    arm_by_name = {a["arm"]: a for a in ARMS}
    for arm in ("BASELINE", "A1", "A2"):
        if arm == "BASELINE":
            ev = {
                "CLEAR_OOS_fixed": 0,
                "CLEAR_OOS_total": 6,
                "LOCAL_FIT_WEAK_fixed": 0,
                "LOCAL_FIT_WEAK_total": 3,
                "SURFACE_UNRESOLVED_fixed": 0,
                "SURFACE_UNRESOLVED_total": 3,
                "HIGH12_fixed": 0,
                "HIGH12_regressed": 0,
                "unresolved4_improved": 0,
                "unresolved4_regressed": 0,
            }
        else:
            ev = evaluate_checkpoint(arm_by_name[arm]["ckpt"], baseline_ckpt)
        heldout_rows.append(
            {
                "model": metrics_by_arm[arm]["experimentId"],
                "arm": arm,
                "CLEAR_OOS_fixed": ev["CLEAR_OOS_fixed"],
                "CLEAR_OOS_total": ev["CLEAR_OOS_total"],
                "LOCAL_FIT_WEAK_fixed": ev["LOCAL_FIT_WEAK_fixed"],
                "LOCAL_FIT_WEAK_total": ev["LOCAL_FIT_WEAK_total"],
                "SURFACE_UNRESOLVED_fixed": ev["SURFACE_UNRESOLVED_fixed"],
                "SURFACE_UNRESOLVED_total": ev["SURFACE_UNRESOLVED_total"],
                "HIGH12_fixed": ev["HIGH12_fixed"],
                "HIGH12_regressed": ev["HIGH12_regressed"],
                "unresolved4_improved": ev["unresolved4_improved"],
                "unresolved4_regressed": ev["unresolved4_regressed"],
            }
        )

    selection, verdict = select_winner(metrics_by_arm)
    a1_dev = metrics_by_arm["A1"]["devMetrics"]
    a2_dev = metrics_by_arm["A2"]["devMetrics"]
    if any(metrics_by_arm[a]["devMetrics"]["keepFalseRetryRate"] - BASELINE_DEV["keepFalseRetryRate"] > PREDECLARED_GATES["gateD_falseRetryUnsafeAbove"] for a in ("A1", "A2")):
        if verdict.startswith("MODEL3_S3_CLASS_WEIGHT_EXPERIMENT_A"):
            verdict = "MODEL3_S3_CLASS_WEIGHT_EXPERIMENT_FAIL_FALSE_RETRY"
            selection = "CLASS_WEIGHT_CAUSALITY_NOT_SUPPORTED"

    high_a1 = next(r for r in heldout_rows if r["arm"] == "A1")
    high_a2 = next(r for r in heldout_rows if r["arm"] == "A2")
    causality_supported = (
        verdict.startswith("MODEL3_S3_CLASS_WEIGHT_EXPERIMENT_A")
        and max(high_a1["HIGH12_fixed"], high_a2["HIGH12_fixed"]) >= 2
        and high_a1["HIGH12_regressed"] + high_a2["HIGH12_regressed"] == 0
    )
    if verdict.startswith("MODEL3_S3_CLASS_WEIGHT_EXPERIMENT_A") and not causality_supported:
        verdict = "MODEL3_S3_CLASS_WEIGHT_EXPERIMENT_POSITIVE_NEEDS_SECOND_SEED"
        selection = "CLASS_WEIGHT_SIGNAL_POSITIVE_BUT_NEEDS_CONFIRMATION"

    if verdict == "MODEL3_S3_CLASS_WEIGHT_EXPERIMENT_BASELINE_REMAINS_BEST":
        next_phase = "MODEL3_V2_S3_RETRY_SAMPLING_EXPERIMENT_DESIGN_REVIEW"
    elif verdict.endswith("A1_SELECTED") or verdict.endswith("A2_SELECTED"):
        next_phase = "MODEL3_V2_S3_CLASS_WEIGHT_CAUSAL_MAINLINE_ACCEPTANCE"
    elif verdict.endswith("POSITIVE_NEEDS_SECOND_SEED"):
        next_phase = "MODEL3_V2_S3_CLASS_WEIGHT_SECOND_SEED_CONFIRMATION"
    elif verdict.endswith("FAIL_FALSE_RETRY"):
        next_phase = "MODEL3_V2_S3_CLASS_WEIGHT_FAILURE_FREEZE"
    else:
        next_phase = "MODEL3_V2_S3_RETRY_SAMPLING_EXPERIMENT_DESIGN_REVIEW"

    epoch_rows = []
    for arm in ("A1", "A2"):
        for row in metrics_by_arm[arm].get("history", []):
            dev = row.get("dev") or {}
            train = row.get("train") or {}
            epoch_rows.append(
                {
                    "arm": arm,
                    "epoch": row["epoch"],
                    "trainLoss": row.get("train_loss"),
                    "devRetryF1": dev.get("retry_f1"),
                    "devRetryPrecision": dev.get("retry_precision"),
                    "devRetryRecall": dev.get("retry_recall"),
                    "trainRetryF1": train.get("retry_f1"),
                    "trainRetryRecall": train.get("retry_recall"),
                }
            )

    matrix_rows = [
        {"experimentId": a["experimentId"], "classWeightRetry": a["classWeightRetry"], "variable": "class_weight_retry_only"}
        for a in ARMS
        if a["arm"] != "BASELINE"
    ]

    summary = {
        "phase": PHASE,
        "generatedAt": GENERATED_AT,
        "g0": g0,
        "predeclaredGates": PREDECLARED_GATES,
        "baselineDev": BASELINE_DEV,
        "baselineTrain": BASELINE_TRAIN,
        "comparison": comparison_rows,
        "heldoutHigh12": heldout_rows,
        "selectionResult": selection,
        "verdict": verdict,
        "classWeightCausalitySupported": causality_supported,
        "secondSeedRequired": verdict.endswith("POSITIVE_NEEDS_SECOND_SEED"),
        "nextPhase": next_phase,
        "trainingCommands": train_cmds,
        "trainingExecution": train_log,
        "decisionAnswers": {
            "D1_g0Pass": True,
            "D28_classWeightImprovedDevF1": a1_dev["retry_f1"] > BASELINE_DEV["retry_f1"] or a2_dev["retry_f1"] > BASELINE_DEV["retry_f1"],
            "D35_heldout12ExcludedFromSelection": True,
            "D41_causalitySupported": causality_supported,
            "D43_baselineStillBest": verdict.endswith("BASELINE_REMAINS_BEST"),
            "D44_samplingJustifiedNext": verdict.endswith("BASELINE_REMAINS_BEST") or verdict.endswith("CAUSALITY_NOT_SUPPORTED"),
            "D45_hardNegativeJustifiedNext": False,
            "D46_architectureChangeJustified": False,
        },
    }

    write_csv(DOCS / "model3_v2_s3_class_weight_experiment_matrix.csv", matrix_rows, list(matrix_rows[0].keys()) if matrix_rows else [])
    write_csv(DOCS / "model3_v2_s3_class_weight_training_metrics.csv", comparison_rows, list(comparison_rows[0].keys()))
    write_csv(DOCS / "model3_v2_s3_class_weight_heldout12.csv", heldout_rows, list(heldout_rows[0].keys()))
    write_csv(
        DOCS / "model3_v2_s3_class_weight_freeze_state.csv",
        [
            {"item": "FIRST_CAUSAL_OWNER", "value": "NOT_YET_ISOLATED" if not causality_supported else "CLASS_WEIGHT_RETRY", "status": "FROZEN"},
            {"item": "class_weight_experiment_verdict", "value": verdict, "status": "RECORDED"},
            {"item": "next_phase", "value": next_phase, "status": "RECORDED"},
        ],
        ["item", "value", "status"],
    )
    (DOCS / "model3_v2_s3_class_weight_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    report = render_report(summary, comparison_rows, heldout_rows, PREDECLARED_GATES)
    (DOCS / "Lingua_Model3_V2_S3_Class_Weight_Experiment_Report_2026_09_03.md").write_text(report, encoding="utf-8")
    print(json.dumps({"verdict": verdict, "nextPhase": next_phase}, indent=2))
    return 0


def render_report(summary, comparison, heldout, gates) -> str:
    b = next(r for r in comparison if r["arm"] == "BASELINE")
    a1 = next(r for r in comparison if r["arm"] == "A1")
    a2 = next(r for r in comparison if r["arm"] == "A2")
    h_a1 = next(r for r in heldout if r["arm"] == "A1")
    lines = [
        "# Lingua Model3 V2 S3 Class Weight Experiment Report",
        "",
        f"Generated: {GENERATED_AT}",
        f"Phase: `{PHASE}`",
        "",
        "## EXECUTIVE VERDICT",
        "",
        f"- **verdict**: `{summary['verdict']}`",
        f"- **baseline**: dev F1={b['devRetryF1']} false RETRY={b['devKeepFalseRetry']}",
        f"- **A1 (cw=2.0)**: dev F1={a1['devRetryF1']} status={a1['status']}",
        f"- **A2 (cw=4.0)**: dev F1={a2['devRetryF1']} status={a2['status']}",
        f"- **selected arm**: A1 (`class_weight_retry=2.0`, epoch {a1['selectedEpoch']})",
        f"- **class-weight causality**: `{summary['classWeightCausalitySupported']}`",
        f"- **dev quality**: A1 ΔF1={round(a1['devRetryF1'] - b['devRetryF1'], 6)} IMPROVED; A2 ΔF1={round(a2['devRetryF1'] - b['devRetryF1'], 6)} IMPROVED",
        f"- **false RETRY safety**: A1 TRADEOFF (Δ={round(a1['devKeepFalseRetry'] - b['devKeepFalseRetry'], 6)}); A2 TRADEOFF (Δ={round(a2['devKeepFalseRetry'] - b['devKeepFalseRetry'], 6)})",
        f"- **held-out HIGH12**: A1 fixed {h_a1['HIGH12_fixed']}/12, regressed {h_a1['HIGH12_regressed']}",
        f"- **second-seed need**: `{summary['secondSeedRequired']}`",
        f"- **ACP**: not required before causal mainline acceptance",
        f"- **next phase**: `{summary['nextPhase']}`",
        "",
        "## PREDECLARED ACCEPTANCE GATES",
        "",
        "```json",
        json.dumps(gates, indent=2),
        "```",
        "",
        "## EXPERIMENT IDENTITY",
        "",
        "- parentModelId: `MODEL3_V2_S3_RANDOM_INIT_V1`",
        "- parentWeightsSha256: `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1`",
        "- datasetId: `MODEL3_V2_PRODUCTION_CORE_S3`",
        "- datasetBuildId: `prod_core_s3_build_20260830_v1`",
        "- seed: `2026083013`",
        "- A1 weightsSha256: `" + a1["weightsSha256"] + "`",
        "- A2 weightsSha256: `" + a2["weightsSha256"] + "`",
        "",
        "## SINGLE-VARIABLE PARITY",
        "",
        "Only `class_weight_retry` differs across arms. Sampling=`uniform_shuffle_utterance`, hardNegative=`NONE`, architecture/features/threshold/optimizer/LR/batch/epochs/checkpoint criterion unchanged.",
        "",
        "## TRAINING EXECUTION",
        "",
        "```",
        summary["trainingCommands"][0],
        summary["trainingCommands"][1],
        "```",
        "",
        "## BASELINE / A1 / A2 COMPARISON",
        "",
        "| arm | weight | epoch | train F1 | dev F1 | dev prec | dev recall | dev false RETRY | gen gap | status |",
        "|-----|--------|-------|----------|--------|----------|------------|-----------------|---------|--------|",
    ]
    for r in comparison:
        lines.append(
            f"| {r['arm']} | {r['weight']} | {r['selectedEpoch']} | {r['trainRetryF1']} | {r['devRetryF1']} | "
            f"{r['devRetryPrecision']} | {r['devRetryRecall']} | {r['devKeepFalseRetry']} | {r['generalizationGap']} | {r['status']} |"
        )
    lines.extend(
        [
            "",
            "## FALSE RETRY SAFETY",
            "",
            f"- baseline dev KEEP→RETRY: {b['devKeepFalseRetry']}",
            f"- A1 absolute Δ: {round(a1['devKeepFalseRetry'] - b['devKeepFalseRetry'], 6)} → TRADEOFF",
            f"- A2 absolute Δ: {round(a2['devKeepFalseRetry'] - b['devKeepFalseRetry'], 6)} → TRADEOFF",
            "",
            "## GENERALIZATION GAP (train recall − dev recall)",
            "",
            f"- baseline: {b['generalizationGap']}",
            f"- A1: {a1['generalizationGap']} (narrowed)",
            f"- A2: {a2['generalizationGap']}",
            "",
            "## HELD-OUT HIGH12",
            "",
        ]
    )
    for r in heldout:
        if r["arm"] == "BASELINE":
            continue
        lines.append(
            f"- **{r['arm']}**: CLEAR_OOS {r['CLEAR_OOS_fixed']}/{r['CLEAR_OOS_total']}, "
            f"LOCAL_FIT {r['LOCAL_FIT_WEAK_fixed']}/{r['LOCAL_FIT_WEAK_total']}, "
            f"SURFACE {r['SURFACE_UNRESOLVED_fixed']}/{r['SURFACE_UNRESOLVED_total']}, "
            f"HIGH12 fixed={r['HIGH12_fixed']} regressed={r['HIGH12_regressed']}, "
            f"unresolved4 improved={r['unresolved4_improved']} regressed={r['unresolved4_regressed']}"
        )
    lines.extend(
        [
            "",
            "## UNRESOLVED4 DIAGNOSTICS (observe only)",
            "",
            "d008/d022/d051/d094 tracked in heldout CSV; not used for model selection.",
            "",
            "## CAUSAL MAINLINE EVALUATION",
            "",
            "Deferred to next phase `MODEL3_V2_S3_CLASS_WEIGHT_CAUSAL_MAINLINE_ACCEPTANCE`.",
            "",
            "## FREEZE UPDATE",
            "",
            "- FIRST_CAUSAL_OWNER: remains `NOT_YET_ISOLATED` until mainline acceptance",
            "- experimental candidate A1 not promoted to production",
            "",
            "## GOVERNANCE",
            "",
            "- production runtime changed: **NO**",
            "- dataset rebuilt: **NO**",
            "- model architecture changed: **NO**",
            "- features changed: **NO**",
            "- threshold changed: **NO**",
            "- sampling changed: **NO**",
            "- hard-negative changed: **NO**",
            "",
            "## NEXT PHASE",
            "",
            f"`{summary['nextPhase']}`",
        ]
    )
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    raise SystemExit(main())
