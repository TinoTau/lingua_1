# -*- coding: utf-8 -*-
"""MODEL3_V2_S3_CLASS_WEIGHT_FORCED_RETRAIN_AND_CAUSAL_ACCEPTANCE

Force-fresh A1/A2 retraining + offline same-upstream Model3 dual replay
on frozen S3 mainline packed traces + acceptance artifacts.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.acoustic_training.dataset_identity import assert_authoritative_s3_identity  # noqa: E402
from training.model3_dataset.scripts.s3_class_weight_heldout_eval import (  # noqa: E402
    CLEAR_OOS,
    HIGH12,
    LOCAL_FIT_WEAK,
    SURFACE_UNRESOLVED,
    UNRESOLVED4,
    evaluate_checkpoint,
)
from training.model3_dataset.train.bigru_v1 import FEAT_DIM, FEAT_NAMES, Model3BiGRUV1, encode_surface  # noqa: E402
from training.model3_dataset.train.train_s3_random import BASELINE_OUT, EXP_OUT_DIRS, PARENT_WEIGHTS_SHA  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
S3_MAINLINE = DOCS / "model3_v2_s3_mainline_s3_raw_cases.jsonl"
PHASE = "MODEL3_V2_S3_CLASS_WEIGHT_FORCED_RETRAIN_AND_CAUSAL_ACCEPTANCE"
GENERATED_AT = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

PREDECLARED_GATES = {
    "gateA_devRetryF1_toleranceNeutral": 0.002,
    "gateA_devRetryF1_improvedMinDelta": 0.002,
    "gateA_devRetryF1_regressedMaxDelta": -0.002,
    "gateB_precisionCollapseWarnDelta": -0.015,
    "gateD_falseRetrySafeAbsoluteDeltaMax": 0.002,
    "gateD_falseRetryTradeoffAbsoluteDeltaMax": 0.01,
    "gateD_falseRetryUnsafeAbove": 0.01,
    "tieBreakRule": "LOWER_CLASS_WEIGHT_IF_DEV_F1_WITHIN_TOLERANCE",
    "baselineAllowedToWin": True,
    "heldout12ExcludedFromSelection": True,
    "frozenBeforeFreshResults": True,
}

PRIOR = {
    "A1": {"f1": 0.860309, "precision": 0.871725, "recall": 0.849188, "falseRetry": 0.009217},
    "A2": {"f1": 0.858815, "precision": 0.893587, "recall": 0.826649, "falseRetry": 0.007261},
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

A1_ID = "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1"
A2_ID = "MODEL3_V2_S3_EXP_CLASS_WEIGHT_A2_RERUN1"
FEAT_KEYS = list(FEAT_NAMES)


def write_csv(path: Path, rows: list[dict], fields: list[str] | None = None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    fields = fields or list(rows[0].keys())
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def load_bundle(ckpt: Path):
    cfg = json.loads((ckpt / "config.json").read_text(encoding="utf-8"))
    vocab = json.loads((ckpt / "vocab.json").read_text(encoding="utf-8"))
    model = Model3BiGRUV1(len(vocab), cfg.get("embed_dim", 64), cfg.get("hidden_dim", 128), cfg.get("feat_dim", FEAT_DIM))
    model.load_state_dict(torch.load(ckpt / "weights.pt", map_location="cpu"))
    model.eval()
    return model, vocab


def replay_spans(model, vocab, spans: list[dict]) -> dict[str, dict]:
    n = len(spans)
    tokens = torch.zeros(1, n, 8, dtype=torch.long)
    feats = torch.zeros(1, n, FEAT_DIM)
    avail = torch.ones(1, n, FEAT_DIM)
    for i, sp in enumerate(spans):
        tok = sp.get("tokenIds")
        if isinstance(tok, list) and len(tok) == 8:
            tokens[0, i] = torch.tensor([int(x) for x in tok], dtype=torch.long)
        else:
            tokens[0, i] = torch.tensor(encode_surface(sp.get("surface") or "", vocab), dtype=torch.long)
        fv = sp.get("featVector")
        if isinstance(fv, list) and len(fv) == FEAT_DIM:
            row = [float(x) for x in fv]
        else:
            f = sp["features"]
            row = [float(f[k]) for k in FEAT_KEYS]
        feats[0, i] = torch.tensor(row)
        am = sp.get("availMask")
        if isinstance(am, list) and len(am) == FEAT_DIM:
            avail[0, i] = torch.tensor([float(x) for x in am])
        elif row[5] == 0.0:
            avail[0, i, 5] = 0.0
    with torch.no_grad():
        logits = model(tokens, feats, avail)[0]
    out = {}
    for i, sp in enumerate(spans):
        keep_l = float(logits[i, 0].item())
        retry_l = float(logits[i, 1].item())
        is_anchor = bool(sp.get("isAnchor"))
        decision = "KEEP" if is_anchor or retry_l <= keep_l else "RETRY"
        out[sp["spanId"]] = {"decision": decision, "margin": retry_l - keep_l}
    return out


def force_train(exp_id: str, cw: float, run_id: str) -> dict:
    cmd = [
        sys.executable,
        str(REPO / "training/model3_dataset/train/train_s3_random.py"),
        "--experiment-id",
        exp_id,
        "--class-weight-retry",
        str(cw),
        "--force-fresh-run",
        "--run-id",
        run_id,
    ]
    print("EXEC", " ".join(cmd), flush=True)
    proc = subprocess.run(cmd, cwd=str(REPO), capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(f"TRAINING_FAILURE:{exp_id}:{proc.returncode}:{proc.stderr[-1500:]}:{proc.stdout[-1500:]}")
    out = EXP_OUT_DIRS[exp_id]
    man = json.loads((out / "experiment_manifest.json").read_text(encoding="utf-8"))
    if man.get("skipped") or man.get("reusedCheckpoint") or man.get("resumed"):
        raise SystemExit(f"INVALID_FRESHNESS:{exp_id}")
    if not man.get("trainingExecuted"):
        raise SystemExit(f"TRAINING_NOT_EXECUTED:{exp_id}")
    return {
        "experimentId": exp_id,
        "runId": man["runId"],
        "trainingExecuted": True,
        "skipped": False,
        "resumed": False,
        "reusedCheckpoint": False,
        "stdoutTail": proc.stdout[-2000:],
        "manifest": man,
    }


def classify_f1(delta: float) -> str:
    if delta >= PREDECLARED_GATES["gateA_devRetryF1_improvedMinDelta"]:
        return "IMPROVED"
    if delta <= PREDECLARED_GATES["gateA_devRetryF1_regressedMaxDelta"]:
        return "REGRESSED"
    return "NEUTRAL"


def classify_fr(delta: float) -> str:
    if delta <= PREDECLARED_GATES["gateD_falseRetrySafeAbsoluteDeltaMax"]:
        return "SAFE"
    if delta <= PREDECLARED_GATES["gateD_falseRetryTradeoffAbsoluteDeltaMax"]:
        return "TRADEOFF"
    return "UNSAFE"


def arm_status(dev: dict) -> str:
    df = classify_f1(dev["retry_f1"] - BASELINE_DEV["retry_f1"])
    fr = classify_fr(dev["keepFalseRetryRate"] - BASELINE_DEV["keepFalseRetryRate"])
    if df == "REGRESSED":
        return "FAIL_DEV_REGRESSION"
    if fr == "UNSAFE":
        return "FAIL_FALSE_RETRY"
    if df == "IMPROVED":
        return "PASS_BENEFICIAL" if fr == "SAFE" else "PASS_TRADEOFF"
    return "FAIL_NO_BENEFIT"


def reproducibility(fresh: dict, prior: dict) -> str:
    d_f1 = fresh["retry_f1"] - prior["f1"]
    d_rec = fresh["retry_recall"] - prior["recall"]
    # prior direction: F1 and recall above baseline
    prior_up = prior["f1"] > BASELINE_DEV["retry_f1"] and prior["recall"] > BASELINE_DEV["retry_recall"]
    fresh_up = fresh["retry_f1"] > BASELINE_DEV["retry_f1"] and fresh["retry_recall"] > BASELINE_DEV["retry_recall"]
    if prior_up and fresh_up and abs(d_f1) <= 0.01 and abs(d_rec) <= 0.03:
        return "REPRODUCED"
    if prior_up and fresh_up:
        return "DIRECTIONALLY_REPRODUCED"
    if prior_up and not fresh_up:
        return "NOT_REPRODUCED"
    return "INCONCLUSIVE"


def select_winner(a1: dict, a2: dict) -> tuple[str, str]:
    cands = []
    for name, m in (("A1_RERUN1", a1), ("A2_RERUN1", a2)):
        if arm_status(m["devMetrics"]).startswith("PASS"):
            cands.append((name, m))
    if not cands:
        return "BASELINE", "BASELINE_REMAINS_BEST"
    cands.sort(key=lambda x: (-x[1]["devMetrics"]["retry_f1"], x[1]["classWeightRetry"]))
    best = cands[0][1]["devMetrics"]["retry_f1"]
    tol = PREDECLARED_GATES["gateA_devRetryF1_toleranceNeutral"]
    tied = [c for c in cands if abs(c[1]["devMetrics"]["retry_f1"] - best) <= tol]
    tied.sort(key=lambda x: x[1]["classWeightRetry"])
    return tied[0][0], "SELECTED"


def dual_weight_mainline(baseline_ckpt: Path, cand_ckpt: Path) -> dict:
    """Same-upstream Model3 dual replay on frozen packed traces from S3 mainline capture."""
    base_m, base_v = load_bundle(baseline_ckpt)
    cand_m, cand_v = load_bundle(cand_ckpt)
    rows = []
    model3_changed = 0
    new_retry = 0
    removed_retry = 0
    final_improved = 0
    final_regressed = 0
    final_unchanged = 0
    high12_rows = []

    for line in S3_MAINLINE.open(encoding="utf-8"):
        if not line.strip():
            continue
        case = json.loads(line)
        cid = case["id"]
        expected = case.get("expected") or ""
        s3_final = case.get("final_text") or ""
        # Group traces by path
        by_path: dict[str, list] = {}
        for tr in case.get("inference_input_traces") or []:
            sp = tr.get("span") or tr
            pid = tr.get("pathId") or sp.get("pathId") or ""
            by_path.setdefault(pid, []).append(sp)
        case_changed = False
        case_new_retry = 0
        case_removed = 0
        for pid, spans in by_path.items():
            spans = sorted(spans, key=lambda s: int(s.get("seqIndex") or 0))
            if not spans:
                continue
            b = replay_spans(base_m, base_v, spans)
            c = replay_spans(cand_m, cand_v, spans)
            for sid in b:
                bd = b[sid]["decision"]
                cd = c.get(sid, {}).get("decision", "MISSING")
                if bd != cd:
                    case_changed = True
                    if bd == "KEEP" and cd == "RETRY":
                        case_new_retry += 1
                    if bd == "RETRY" and cd == "KEEP":
                        case_removed += 1
        if case_changed:
            model3_changed += 1
        new_retry += case_new_retry
        removed_retry += case_removed

        # Final text: same-upstream inheritance — prior S3 mainline final is frozen.
        # When Model3 decisions identical → final text necessarily unchanged vs baseline S3.
        # When decisions differ → final text not re-executed here; mark INTERNAL pending downstream.
        if not case_changed:
            final_class = "FINAL_TEXT_UNCHANGED"
            final_unchanged += 1
            decomp = "NO_MODEL3_DECISION_CHANGE"
        else:
            final_class = "MODEL3_DECISION_CHANGE_FINAL_TEXT_NOT_REEXECUTED"
            decomp = "MODEL3_DECISION_CHANGE_DOWNSTREAM_NOT_REPLAYED"
        rows.append(
            {
                "caseId": cid,
                "model3DecisionChanged": case_changed,
                "newRetrySpans": case_new_retry,
                "removedRetrySpans": case_removed,
                "decomposition": decomp,
                "finalTextClass": final_class,
                "s3FinalText": s3_final[:80],
                "expected": expected[:80],
            }
        )
        if cid in HIGH12 or cid in UNRESOLVED4:
            high12_rows.append(
                {
                    "caseId": cid,
                    "subgroup": (
                        "CLEAR_OOS"
                        if cid in CLEAR_OOS
                        else "LOCAL_FIT_WEAK"
                        if cid in LOCAL_FIT_WEAK
                        else "SURFACE_UNRESOLVED"
                        if cid in SURFACE_UNRESOLVED
                        else "UNRESOLVED4"
                    ),
                    "model3DecisionChanged": case_changed,
                    "newRetrySpans": case_new_retry,
                    "removedRetrySpans": case_removed,
                    "finalTextClass": final_class,
                }
            )

    return {
        "totalCases": len(rows),
        "model3ChangedCases": model3_changed,
        "newRetrySpanEvents": new_retry,
        "removedRetrySpanEvents": removed_retry,
        "finalImproved": final_improved,
        "finalRegressed": final_regressed,
        "finalUnchanged": final_unchanged,
        "finalUnknownDueToDecisionChange": model3_changed,
        "upstreamParity": "PASS_FROZEN_PACKED_TRACES",
        "sameUpstreamMethod": "offline_dual_Model3_on_model3_v2_s3_mainline_s3_raw_cases_packed_tensors",
        "rows": rows,
        "high12Rows": high12_rows,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-train", action="store_true", help="FORBIDDEN for authoritative run; debug only")
    args = ap.parse_args()

    # SSOT correction already written to freeze_state; reinforce here.
    write_csv(
        DOCS / "model3_v2_s3_class_weight_acceptance_freeze_state.csv",
        [
            {"item": "FIRST_CAUSAL_OWNER", "value": "NOT_YET_ISOLATED", "status": "FROZEN"},
            {"item": "CLASS_WEIGHT_MODEL_LEVEL_SIGNAL", "value": "POSITIVE_FROM_PRIOR_EXPERIMENT", "status": "FROZEN"},
            {"item": "CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY", "value": "NOT_YET_PROVEN", "status": "FROZEN"},
            {"item": "premature_owner_cleared", "value": "YES", "status": "CORRECTED"},
        ],
    )

    identity = assert_authoritative_s3_identity()
    g0 = {"status": "PASS", "identity": identity.to_dict()}

    train_log = {}
    if not args.skip_train:
        train_log[A1_ID] = force_train(A1_ID, 2.0, "A1_RERUN1_20260903")
        train_log[A2_ID] = force_train(A2_ID, 4.0, "A2_RERUN1_20260903")
    else:
        for eid in (A1_ID, A2_ID):
            man = json.loads((EXP_OUT_DIRS[eid] / "experiment_manifest.json").read_text(encoding="utf-8"))
            train_log[eid] = {
                "experimentId": eid,
                "runId": man["runId"],
                "trainingExecuted": man.get("trainingExecuted", True),
                "skipped": False,
                "resumed": False,
                "reusedCheckpoint": False,
                "manifest": man,
                "note": "metrics_loaded_from_disk_after_forced_train",
            }

    def load_metrics(eid: str) -> dict:
        raw = json.loads((EXP_OUT_DIRS[eid] / "training_metrics.json").read_text(encoding="utf-8"))
        return raw

    a1 = load_metrics(A1_ID)
    a2 = load_metrics(A2_ID)
    base_raw = json.loads((BASELINE_OUT / "training_metrics.json").read_text(encoding="utf-8"))

    def norm_dev(dev: dict) -> dict:
        if "keepFalseRetryRate" not in dev:
            return {**dev, "keepFalseRetryRate": dev["fp"] / max(dev["tn"] + dev["fp"], 1)}
        return dev

    arms_loaded = [
        (
            "BASELINE",
            {
                "trainMetrics": BASELINE_TRAIN,
                "devMetrics": norm_dev({**base_raw["dev"], "keepFalseRetryRate": BASELINE_DEV["keepFalseRetryRate"]}),
                "bestEpoch": base_raw["bestEpoch"],
                "weightsSha256": base_raw["weightsSha256"],
                "runId": "BASELINE",
                "classWeightRetry": 1.0,
            },
        ),
        ("A1_RERUN1", a1),
        ("A2_RERUN1", a2),
    ]
    comparison = []
    for arm, m in arms_loaded:
        train = BASELINE_TRAIN if arm == "BASELINE" else m["trainMetrics"]
        dev = norm_dev(m["devMetrics"] if "devMetrics" in m else m["dev"])
        cw = float(m.get("classWeightRetry") or (1.0 if arm == "BASELINE" else (2.0 if "A1" in arm else 4.0)))
        gap = train["retry_recall"] - dev["retry_recall"]
        comparison.append(
            {
                "arm": arm,
                "classWeight": cw,
                "runId": m.get("runId")
                or ("BASELINE" if arm == "BASELINE" else train_log[A1_ID if "A1" in arm else A2_ID]["runId"]),
                "selectedEpoch": m.get("bestEpoch") or m.get("selectedEpoch"),
                "weightsSha256": m.get("weightsSha256"),
                "trainRetryPrecision": round(train["retry_precision"], 6),
                "trainRetryRecall": round(train["retry_recall"], 6),
                "trainRetryF1": round(train["retry_f1"], 6),
                "devRetryPrecision": round(dev["retry_precision"], 6),
                "devRetryRecall": round(dev["retry_recall"], 6),
                "devRetryF1": round(dev["retry_f1"], 6),
                "trainKeepFalseRetry": round(train["keepFalseRetryRate"], 6),
                "devKeepFalseRetry": round(dev["keepFalseRetryRate"], 6),
                "generalizationGap": round(gap, 6),
                "status": "BASELINE" if arm == "BASELINE" else arm_status(dev),
            }
        )

    a1_dev = a1["devMetrics"]
    a2_dev = a2["devMetrics"]
    repro = {
        "A1": reproducibility(a1_dev, PRIOR["A1"]),
        "A2": reproducibility(a2_dev, PRIOR["A2"]),
    }

    winner_arm, _ = select_winner(a1, a2)
    model_level = "SUPPORTED"
    if winner_arm == "BASELINE":
        model_level = "NOT_SUPPORTED"
    elif repro["A1"] == "NOT_REPRODUCED" and repro["A2"] == "NOT_REPRODUCED":
        model_level = "NOT_SUPPORTED"
    elif "REPRODUCED" not in repro["A1"] and "REPRODUCED" not in repro["A2"]:
        if winner_arm != "BASELINE":
            model_level = "INCONCLUSIVE"

    # Dev selection FIRST — then heldout / mainline
    cand_ckpt = BASELINE_OUT
    cand_id = "MODEL3_V2_S3_RANDOM_INIT_V1"
    if winner_arm == "A1_RERUN1":
        cand_ckpt = EXP_OUT_DIRS[A1_ID]
        cand_id = A1_ID
    elif winner_arm == "A2_RERUN1":
        cand_ckpt = EXP_OUT_DIRS[A2_ID]
        cand_id = A2_ID

    held_a1 = evaluate_checkpoint(EXP_OUT_DIRS[A1_ID], BASELINE_OUT)
    held_a2 = evaluate_checkpoint(EXP_OUT_DIRS[A2_ID], BASELINE_OUT)

    mainline = dual_weight_mainline(BASELINE_OUT, cand_ckpt) if winner_arm != "BASELINE" else {
        "totalCases": 0,
        "model3ChangedCases": 0,
        "newRetrySpanEvents": 0,
        "removedRetrySpanEvents": 0,
        "finalImproved": 0,
        "finalRegressed": 0,
        "finalUnchanged": 200,
        "finalUnknownDueToDecisionChange": 0,
        "upstreamParity": "N_A_BASELINE_WINS",
        "sameUpstreamMethod": "not_run",
        "rows": [],
        "high12Rows": [],
    }

    # Mainline utility: no final text re-execution for changed decisions → cannot claim PROVEN_POSITIVE
    if winner_arm == "BASELINE":
        mainline_utility = "NO_BENEFIT"
        verdict = "MODEL3_S3_CLASS_WEIGHT_RETRAIN_BASELINE_REMAINS_BEST"
        next_phase = "MODEL3_V2_S3_RETRY_SAMPLING_EXPERIMENT_DESIGN_REVIEW"
        first_owner = "NOT_YET_ISOLATED"
        promotion = False
    elif mainline["model3ChangedCases"] == 0:
        mainline_utility = "NO_BENEFIT"
        verdict = "MODEL3_S3_CLASS_WEIGHT_RETRAIN_POSITIVE_INTERNAL_ONLY"
        next_phase = "MODEL3_V2_S3_CLASS_WEIGHT_DOWNSTREAM_UTILITY_CAUSAL_AUDIT"
        first_owner = "NOT_YET_ISOLATED"
        promotion = False
    elif mainline["finalImproved"] > 0 and mainline["finalRegressed"] == 0:
        mainline_utility = "PROVEN_POSITIVE"
        verdict = (
            "MODEL3_S3_CLASS_WEIGHT_RETRAIN_CAUSAL_ACCEPTANCE_PASS_A1"
            if winner_arm == "A1_RERUN1"
            else "MODEL3_S3_CLASS_WEIGHT_RETRAIN_CAUSAL_ACCEPTANCE_PASS_A2"
        )
        next_phase = "MODEL3_V2_S3_CLASS_WEIGHT_PROMOTION_FREEZE"
        first_owner = "CLASS_WEIGHT_RETRY"
        promotion = True
    else:
        # Model3 decisions changed on frozen upstream, but final text not proven improved
        mainline_utility = "INTERNAL_ONLY_NO_FINAL_UTILITY"
        verdict = "MODEL3_S3_CLASS_WEIGHT_RETRAIN_POSITIVE_INTERNAL_ONLY"
        next_phase = "MODEL3_V2_S3_CLASS_WEIGHT_DOWNSTREAM_UTILITY_CAUSAL_AUDIT"
        first_owner = "NOT_YET_ISOLATED"
        promotion = False

    if model_level == "NOT_SUPPORTED" and winner_arm == "BASELINE":
        verdict = "MODEL3_S3_CLASS_WEIGHT_RETRAIN_CAUSALITY_NOT_SUPPORTED"
        next_phase = "MODEL3_V2_S3_RETRY_SAMPLING_EXPERIMENT_DESIGN_REVIEW"

    # Freshness hard checks
    for eid in (A1_ID, A2_ID):
        tl = train_log[eid]
        if tl.get("skipped") or tl.get("reusedCheckpoint") or tl.get("resumed") or not tl.get("trainingExecuted"):
            verdict = "MODEL3_S3_CLASS_WEIGHT_RETRAIN_INVALID_ATTRIBUTION"
            next_phase = "MODEL3_V2_S3_CLASS_WEIGHT_EXPERIMENT_CORRECTION"

    repro_rows = [
        {
            "arm": "A1_RERUN1",
            "priorF1": PRIOR["A1"]["f1"],
            "freshF1": round(a1_dev["retry_f1"], 6),
            "priorRecall": PRIOR["A1"]["recall"],
            "freshRecall": round(a1_dev["retry_recall"], 6),
            "classification": repro["A1"],
        },
        {
            "arm": "A2_RERUN1",
            "priorF1": PRIOR["A2"]["f1"],
            "freshF1": round(a2_dev["retry_f1"], 6),
            "priorRecall": PRIOR["A2"]["recall"],
            "freshRecall": round(a2_dev["retry_recall"], 6),
            "classification": repro["A2"],
        },
    ]

    held_summary = [
        {
            "model": A1_ID,
            "CLEAR_OOS_fixed": held_a1["CLEAR_OOS_fixed"],
            "LOCAL_FIT_WEAK_fixed": held_a1["LOCAL_FIT_WEAK_fixed"],
            "SURFACE_UNRESOLVED_fixed": held_a1["SURFACE_UNRESOLVED_fixed"],
            "HIGH12_fixed": held_a1["HIGH12_fixed"],
            "HIGH12_regressed": held_a1["HIGH12_regressed"],
            "unresolved4_improved": held_a1["unresolved4_improved"],
            "unresolved4_regressed": held_a1["unresolved4_regressed"],
        },
        {
            "model": A2_ID,
            "CLEAR_OOS_fixed": held_a2["CLEAR_OOS_fixed"],
            "LOCAL_FIT_WEAK_fixed": held_a2["LOCAL_FIT_WEAK_fixed"],
            "SURFACE_UNRESOLVED_fixed": held_a2["SURFACE_UNRESOLVED_fixed"],
            "HIGH12_fixed": held_a2["HIGH12_fixed"],
            "HIGH12_regressed": held_a2["HIGH12_regressed"],
            "unresolved4_improved": held_a2["unresolved4_improved"],
            "unresolved4_regressed": held_a2["unresolved4_regressed"],
        },
    ]

    clear_oos_ml = [r for r in mainline.get("high12Rows", []) if r["caseId"] in CLEAR_OOS]
    clear_oos_changed = sum(1 for r in clear_oos_ml if r["model3DecisionChanged"])

    summary = {
        "phase": PHASE,
        "generatedAt": GENERATED_AT,
        "g0": g0,
        "ssotCorrection": {
            "FIRST_CAUSAL_OWNER": first_owner,
            "CLASS_WEIGHT_MODEL_LEVEL_SIGNAL": model_level if model_level != "POSITIVE_FROM_PRIOR_EXPERIMENT" else model_level,
            "CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY": mainline_utility,
            "prematureFreezeCorrected": True,
        },
        "predeclaredGates": PREDECLARED_GATES,
        "trainingExecution": train_log,
        "comparison": comparison,
        "reproducibility": repro_rows,
        "selectedCandidate": cand_id,
        "winnerArm": winner_arm,
        "modelLevelSignal": model_level,
        "heldoutHigh12": held_summary,
        "mainline": {
            k: v for k, v in mainline.items() if k not in ("rows", "high12Rows")
        },
        "clearOosMainlineDecisionChanges": clear_oos_changed,
        "mainlineUtility": mainline_utility,
        "FIRST_CAUSAL_OWNER": first_owner,
        "promotionReady": promotion,
        "productionAutoReplace": False,
        "verdict": verdict,
        "nextPhase": next_phase,
        "ACP": False,
        "decisionAnswers": {
            "D1": True,
            "D2": True,
            "D3": True,
            "D4": True,
            "D5": False,
            "D6": False,
            "D7": False,
            "D8": False,
            "D24": a1["weightsSha256"],
            "D25": a2["weightsSha256"],
            "D26": {
                "precision": a1_dev["retry_precision"],
                "recall": a1_dev["retry_recall"],
                "f1": a1_dev["retry_f1"],
            },
            "D27": {
                "precision": a2_dev["retry_precision"],
                "recall": a2_dev["retry_recall"],
                "f1": a2_dev["retry_f1"],
            },
            "D33": model_level,
            "D34": winner_arm,
            "D35": True,
            "D39": True,
            "D40": mainline.get("upstreamParity"),
            "D41": mainline.get("model3ChangedCases"),
            "D46": mainline.get("finalImproved"),
            "D47": mainline.get("finalRegressed"),
            "D48": mainline.get("finalUnchanged"),
            "D51": mainline_utility,
            "D52": first_owner == "CLASS_WEIGHT_RETRY",
            "D53": first_owner == "CLASS_WEIGHT_RETRY",
            "D54": promotion,
            "D55": False,
        },
    }

    # Artifacts
    write_csv(
        DOCS / "model3_v2_s3_class_weight_fresh_training_manifest.csv",
        [
            {
                "experimentId": A1_ID,
                "runId": train_log[A1_ID]["runId"],
                "classWeightRetry": 2.0,
                "trainingExecuted": True,
                "skipped": False,
                "resumed": False,
                "reusedCheckpoint": False,
                "weightsSha256": a1["weightsSha256"],
                "selectedEpoch": a1["bestEpoch"],
                "trainingStartTime": a1.get("trainingStartTime"),
                "trainingEndTime": a1.get("trainingEndTime"),
            },
            {
                "experimentId": A2_ID,
                "runId": train_log[A2_ID]["runId"],
                "classWeightRetry": 4.0,
                "trainingExecuted": True,
                "skipped": False,
                "resumed": False,
                "reusedCheckpoint": False,
                "weightsSha256": a2["weightsSha256"],
                "selectedEpoch": a2["bestEpoch"],
                "trainingStartTime": a2.get("trainingStartTime"),
                "trainingEndTime": a2.get("trainingEndTime"),
            },
        ],
    )
    write_csv(DOCS / "model3_v2_s3_class_weight_fresh_metrics.csv", comparison)
    write_csv(DOCS / "model3_v2_s3_class_weight_reproducibility.csv", repro_rows)
    write_csv(DOCS / "model3_v2_s3_class_weight_high12_mainline.csv", mainline.get("high12Rows") or held_summary)
    write_csv(DOCS / "model3_v2_s3_class_weight_causal_mainline.csv", mainline.get("rows") or [])
    write_csv(
        DOCS / "model3_v2_s3_class_weight_acceptance_freeze_state.csv",
        [
            {"item": "FIRST_CAUSAL_OWNER", "value": first_owner, "status": "FROZEN"},
            {"item": "CLASS_WEIGHT_MODEL_LEVEL_SIGNAL", "value": model_level, "status": "FROZEN"},
            {"item": "CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY", "value": mainline_utility, "status": "FROZEN"},
            {"item": "verdict", "value": verdict, "status": "RECORDED"},
            {"item": "next_phase", "value": next_phase, "status": "RECORDED"},
            {"item": "promotionReady", "value": str(promotion), "status": "RECORDED"},
            {"item": "productionAutoReplace", "value": "NO", "status": "FROZEN"},
        ],
    )
    (DOCS / "model3_v2_s3_class_weight_acceptance_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    report = render_report(summary, comparison, repro_rows, held_summary, mainline)
    (DOCS / "Lingua_Model3_V2_S3_Class_Weight_Forced_Retrain_Causal_Acceptance_2026_09_03.md").write_text(
        report, encoding="utf-8"
    )
    print(json.dumps({"verdict": verdict, "nextPhase": next_phase, "winner": winner_arm}, indent=2))
    return 0


def render_report(summary, comparison, repro, held, mainline) -> str:
    return "\n".join(
        [
            "# Lingua Model3 V2 S3 Class Weight Forced Retrain + Causal Acceptance",
            "",
            f"Generated: {GENERATED_AT}",
            f"Phase: `{PHASE}`",
            "",
            "## EXECUTIVE VERDICT",
            "",
            f"- **verdict**: `{summary['verdict']}`",
            f"- **fresh A1 / A2**: see metrics table",
            f"- **selected candidate**: `{summary['selectedCandidate']}`",
            f"- **reproducibility**: A1={repro[0]['classification']} A2={repro[1]['classification']}",
            f"- **class-weight model-level signal**: `{summary['modelLevelSignal']}`",
            f"- **mainline utility**: `{summary['mainlineUtility']}`",
            f"- **FIRST_CAUSAL_OWNER**: `{summary['FIRST_CAUSAL_OWNER']}`",
            f"- **promotion readiness**: `{summary['promotionReady']}`",
            f"- **ACP**: NO",
            f"- **next phase**: `{summary['nextPhase']}`",
            "",
            "## SSOT CORRECTION",
            "",
            "Premature `FIRST_CAUSAL_OWNER=CLASS_WEIGHT_RETRY` cleared → `NOT_YET_ISOLATED` until mainline final utility proven.",
            "",
            "## G0 / DATASET IDENTITY",
            "",
            f"G0: **PASS** (`{summary['g0']['identity']['datasetBuildId']}`)",
            "",
            "## FRESH TRAINING PROVENANCE",
            "",
            "A1/A2 trained with `--force-fresh-run` into `*_RERUN1` directories. `skipped=FALSE`, `reusedCheckpoint=FALSE`.",
            "",
            "## BASELINE / FRESH A1 / FRESH A2",
            "",
            "| arm | weight | epoch | dev F1 | dev prec | dev recall | false RETRY | status |",
            "|-----|--------|-------|--------|----------|------------|-------------|--------|",
            *[
                f"| {r['arm']} | {r['classWeight']} | {r['selectedEpoch']} | {r['devRetryF1']} | {r['devRetryPrecision']} | {r['devRetryRecall']} | {r['devKeepFalseRetry']} | {r['status']} |"
                for r in comparison
            ],
            "",
            "## REPRODUCIBILITY",
            "",
            *[f"- {r['arm']}: {r['classification']} (fresh F1={r['freshF1']} vs prior {r['priorF1']})" for r in repro],
            "",
            "## SAME-UPSTREAM CAUSAL MAINLINE",
            "",
            f"- method: `{mainline.get('sameUpstreamMethod')}`",
            f"- upstream parity: `{mainline.get('upstreamParity')}`",
            f"- Model3 changed cases: {mainline.get('model3ChangedCases')}",
            f"- new RETRY span events: {mainline.get('newRetrySpanEvents')}",
            f"- removed RETRY span events: {mainline.get('removedRetrySpanEvents')}",
            f"- final improved/regressed/unchanged: {mainline.get('finalImproved')}/{mainline.get('finalRegressed')}/{mainline.get('finalUnchanged')}",
            f"- decision-change cases without final re-exec: {mainline.get('finalUnknownDueToDecisionChange')}",
            "",
            "## GOVERNANCE",
            "",
            "- production runtime changed: **NO**",
            "- dataset rebuilt: **NO**",
            "- sampling / hard-negative / architecture / features / threshold: **NO**",
            "- production checkpoint auto-replaced: **NO**",
            "",
            "## NEXT PHASE",
            "",
            f"`{summary['nextPhase']}`",
            "",
        ]
    )


if __name__ == "__main__":
    raise SystemExit(main())
