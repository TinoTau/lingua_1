# -*- coding: utf-8 -*-
"""HISTORICAL_NON_PARITY_INPUT probe — NOT production-equivalent RealDist eval.

Uses historical FineSpan dump + silent cand=0 / pinyin=True defaults.
For live-equivalent offline evaluation use:
  training/model3_dataset/scripts/replay_model3_live_input_trace.py
"""
from __future__ import annotations

import csv
import json
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

# Refuse silent use as production-equivalent RealDist acceptance.
if "--allow-historical-non-parity" not in sys.argv:
    raise SystemExit(
        "HISTORICAL_NON_PARITY_INPUT: this script reconstructs Model3 inputs from "
        "historical dumps with cand=0/pinyin=True defaults. "
        "Use replay_model3_live_input_trace.py for production-equivalent eval, "
        "or pass --allow-historical-non-parity for archival comparison only."
    )

from training.model3_dataset.scripts.eval_v2_checkpoint_offline import (  # noqa: E402
    DIALOG_JSONL,
    DOCS,
    INVENTORY,
    infer_utterance_spans,
    load_bundle,
    load_inventory,
    margin_stats,
    pct,
)
from training.model3_dataset.train.bigru_v1 import collate_batch  # noqa: E402
from training.model3_dataset.train.train_v2_labeled import (  # noqa: E402
    UtteranceDataset,
    compute_metrics,
)

V2_CKPT = REPO / "training/model3_dataset/model3_v2_region_label_v1_ckpts/seed_2026082901"
RD_CKPT = REPO / "training/model3_dataset/model3_v2_realdist_v1_ckpts/seed_2026082903"
RD_DATA = REPO / "training/model3_dataset/model3_v2_realdist_expanded_v1"


def load_split(root: Path, split: str):
    rows = []
    for p in sorted((root / split).glob("shard-*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    rows.append(json.loads(line))
    return rows


def pos_bin(rel: float) -> str:
    if rel <= 0.35:
        return "HEAD"
    if rel >= 0.7:
        return "TAIL"
    return "MID"


def spans_of(case):
    return [
        {
            "surface": s.get("surface") or "",
            "isAnchor": bool(s.get("isAnchor")),
            "firstPassCandidateCount": int(s.get("firstPassCandidateCount") or s.get("cand") or 0),
            "path_id": s.get("path_id"),
            "margin_v1_dump": s.get("margin"),
            "decision_dump": s.get("decision"),
        }
        for s in (case.get("span_margins") or [])
    ]


def primary_path_spans(spans):
    by = defaultdict(list)
    for s in spans:
        by[s.get("path_id") or "_"].append(s)
    pid = next(iter(by))
    return by[pid]


def time_all(model, vocab, cases):
    t0 = time.time()
    n = 0
    for case in cases:
        spans = primary_path_spans(spans_of(case))
        if not spans:
            continue
        infer_utterance_spans(model, vocab, spans)
        n += 1
    return (time.time() - t0) * 1000 / max(n, 1), n


def main():
    if not RD_CKPT.exists():
        raise SystemExit(f"missing RealDist checkpoint: {RD_CKPT}")

    print("loading checkpoints...", flush=True)
    v2_m, v2_v, _ = load_bundle(V2_CKPT)
    rd_m, rd_v, _ = load_bundle(RD_CKPT)

    device = torch.device("cpu")
    print("evaluating RealDist test set...", flush=True)
    test = load_split(RD_DATA, "test")
    rd_test = compute_metrics(
        rd_m,
        torch.utils.data.DataLoader(
            UtteranceDataset(test, rd_v),
            batch_size=64,
            shuffle=False,
            collate_fn=lambda b: collate_batch(b, device),
        ),
        device,
    )
    # V2 baseline on same RealDist test labels (diagnostic)
    v2_on_rd_test = compute_metrics(
        v2_m,
        torch.utils.data.DataLoader(
            UtteranceDataset(test, v2_v),
            batch_size=64,
            shuffle=False,
            collate_fn=lambda b: collate_batch(b, device),
        ),
        device,
    )

    cases = [json.loads(l) for l in DIALOG_JSONL.open(encoding="utf-8") if l.strip()]
    by_id = {c["id"]: c for c in cases}
    inv = load_inventory()

    # warmup latency
    infer_utterance_spans(v2_m, v2_v, [{"surface": "测", "isAnchor": False, "firstPassCandidateCount": 0}])
    infer_utterance_spans(rd_m, rd_v, [{"surface": "测", "isAnchor": False, "firstPassCandidateCount": 0}])
    v2_ms, n_lat = time_all(v2_m, v2_v, cases)
    rd_ms, _ = time_all(rd_m, rd_v, cases)

    probe_rows = []
    v2_all, rd_all = [], []
    v2_tgt, rd_tgt = [], []
    v2_keep_m, rd_keep_m = [], []
    pos_stats = {
        "HEAD": Counter(),
        "MID": Counter(),
        "TAIL": Counter(),
    }

    elig = 0
    v2_case_retry = 0
    rd_case_retry = 0
    improved = []
    regressed = []
    keep_controls = 0
    v2_false = 0
    rd_false = 0

    for r in inv:
        if r.get("confidence") not in ("HIGH", "MEDIUM"):
            continue
        if r.get("audit_class") not in (
            "ERROR_INSIDE_NON_ANCHOR_FINESPAN",
            "ERROR_REQUIRES_LOCAL_RESEGMENTATION",
        ):
            continue
        case = by_id.get(r["caseId"])
        if not case:
            continue
        spans = primary_path_spans(spans_of(case))
        v2o = infer_utterance_spans(v2_m, v2_v, spans)
        rdo = infer_utterance_spans(rd_m, rd_v, spans)
        for a, b in zip(v2o, rdo):
            if a["isAnchor"]:
                continue
            v2_all.append(a["margin"])
            rd_all.append(b["margin"])

        surf = r.get("probe_surface") or ""
        hit_v2 = next((x for x in v2o if not x["isAnchor"] and (not surf or x["surface"] == surf)), None)
        hit_rd = next((x for x in rdo if not x["isAnchor"] and (not surf or x["surface"] == surf)), None)
        if hit_v2 is None:
            hit_v2 = next((x for x in v2o if not x["isAnchor"]), None)
        if hit_rd is None:
            hit_rd = next((x for x in rdo if not x["isAnchor"]), None)

        any_v2 = [x for x in v2o if not x["isAnchor"] and x["decision"] == "RETRY"]
        any_rd = [x for x in rdo if not x["isAnchor"] and x["decision"] == "RETRY"]
        elig += 1
        was_v2 = bool(any_v2)
        was_rd = bool(any_rd)
        if was_v2:
            v2_case_retry += 1
        if was_rd:
            rd_case_retry += 1
        if was_rd and not was_v2:
            improved.append(r["caseId"])
        if was_v2 and not was_rd:
            regressed.append(r["caseId"])

        # position of probe span
        rel = 0.0
        if hit_rd is not None:
            # find index
            for i, x in enumerate(rdo):
                if x is hit_rd or (not x["isAnchor"] and x["surface"] == hit_rd["surface"]):
                    # use first matching non-anchor surface
                    pass
            for i, x in enumerate(rdo):
                if not x["isAnchor"] and x["surface"] == (hit_rd["surface"] if hit_rd else ""):
                    rel = i / max(len(rdo) - 1, 1)
                    break
        pb = pos_bin(rel)
        pos_stats[pb]["cases"] += 1
        if was_rd:
            pos_stats[pb]["retry"] += 1
        else:
            pos_stats[pb]["keep"] += 1

        if hit_v2:
            v2_tgt.append(hit_v2["margin"])
        if hit_rd:
            rd_tgt.append(hit_rd["margin"])

        probe_rows.append(
            {
                "caseId": r["caseId"],
                "surface": surf or (hit_rd["surface"] if hit_rd else ""),
                "span_rel_position": rel,
                "position_bin": pb,
                "audit_class": r["audit_class"],
                "confidence": r["confidence"],
                "expected": "RETRY",
                "v2_decision": hit_v2["decision"] if hit_v2 else "",
                "v2_margin": hit_v2["margin"] if hit_v2 else "",
                "v2_case_retry": int(was_v2),
                "v2_any_retry": "|".join(f"{x['surface']}:{x['margin']:.2f}" for x in any_v2),
                "rd_decision": hit_rd["decision"] if hit_rd else "",
                "rd_margin": hit_rd["margin"] if hit_rd else "",
                "rd_case_retry": int(was_rd),
                "rd_any_retry": "|".join(f"{x['surface']}:{x['margin']:.2f}" for x in any_rd),
            }
        )

    for r in inv:
        if r.get("audit_class") != "NO_ERROR":
            continue
        case = by_id.get(r["caseId"])
        if not case:
            continue
        spans = primary_path_spans(spans_of(case))
        v2o = infer_utterance_spans(v2_m, v2_v, spans)
        rdo = infer_utterance_spans(rd_m, rd_v, spans)
        keep_controls += 1
        v2_fr = any(x["decision"] == "RETRY" for x in v2o if not x["isAnchor"])
        rd_fr = any(x["decision"] == "RETRY" for x in rdo if not x["isAnchor"])
        if v2_fr:
            v2_false += 1
        if rd_fr:
            rd_false += 1
        # position false-retry
        for i, (a, b) in enumerate(zip(v2o, rdo)):
            if a["isAnchor"]:
                continue
            rel = i / max(len(rdo) - 1, 1)
            pb = pos_bin(rel)
            pos_stats[pb]["keep_control_spans"] += 1
            if b["decision"] == "RETRY":
                pos_stats[pb]["keep_control_false_retry"] += 1
            v2_keep_m.append(a["margin"])
            rd_keep_m.append(b["margin"])
            probe_rows.append(
                {
                    "caseId": r["caseId"],
                    "surface": a["surface"],
                    "span_rel_position": rel,
                    "position_bin": pb,
                    "audit_class": "NO_ERROR",
                    "confidence": "HIGH",
                    "expected": "KEEP",
                    "v2_decision": a["decision"],
                    "v2_margin": a["margin"],
                    "v2_case_retry": int(v2_fr),
                    "v2_any_retry": "",
                    "rd_decision": b["decision"],
                    "rd_margin": b["margin"],
                    "rd_case_retry": int(rd_fr),
                    "rd_any_retry": "",
                }
            )
            break

    # Also full non-anchor margins for all dialog cases
    for case in cases:
        spans = primary_path_spans(spans_of(case))
        v2o = infer_utterance_spans(v2_m, v2_v, spans)
        rdo = infer_utterance_spans(rd_m, rd_v, spans)
        # already collected for eligible; add remaining only if not already in v2_all from eligible loops
        # Simpler: recompute all margins fresh
    v2_all, rd_all = [], []
    for case in cases:
        spans = primary_path_spans(spans_of(case))
        v2o = infer_utterance_spans(v2_m, v2_v, spans)
        rdo = infer_utterance_spans(rd_m, rd_v, spans)
        for a, b in zip(v2o, rdo):
            if a["isAnchor"]:
                continue
            v2_all.append(a["margin"])
            rd_all.append(b["margin"])

    # Historical V2 test metrics from prior report
    v2_hist_test = {
        "retry_precision": 0.9714,
        "retry_recall": 0.9370,
        "retry_f1": 0.9539,
        "keep_precision": 0.9993,
        "keep_recall": 0.9997,
        "pred_retry_rate": 0.01047,
        "true_retry_rate": 0.01086,
        "tp": 4212,
        "fp": 124,
        "fn": 283,
        "tn": 409399,
    }

    comparison = [
        {"metric": "test_retry_precision", "V2": v2_hist_test["retry_precision"], "RealDist": rd_test["retry_precision"], "delta": rd_test["retry_precision"] - v2_hist_test["retry_precision"]},
        {"metric": "test_retry_recall", "V2": v2_hist_test["retry_recall"], "RealDist": rd_test["retry_recall"], "delta": rd_test["retry_recall"] - v2_hist_test["retry_recall"]},
        {"metric": "test_retry_f1", "V2": v2_hist_test["retry_f1"], "RealDist": rd_test["retry_f1"], "delta": rd_test["retry_f1"] - v2_hist_test["retry_f1"]},
        {"metric": "test_pred_retry_rate", "V2": v2_hist_test["pred_retry_rate"], "RealDist": rd_test["pred_retry_rate"], "delta": rd_test["pred_retry_rate"] - v2_hist_test["pred_retry_rate"]},
        {"metric": "real_elig_case_retry", "V2": v2_case_retry, "RealDist": rd_case_retry, "delta": rd_case_retry - v2_case_retry},
        {"metric": "real_elig_case_recall", "V2": v2_case_retry / elig if elig else 0, "RealDist": rd_case_retry / elig if elig else 0, "delta": (rd_case_retry - v2_case_retry) / elig if elig else 0},
        {"metric": "false_retry_keep_controls", "V2": v2_false, "RealDist": rd_false, "delta": rd_false - v2_false},
        {"metric": "offline_latency_ms_per_utt", "V2": v2_ms, "RealDist": rd_ms, "delta": rd_ms - v2_ms},
        {"metric": "all_non_anchor_positive_margins", "V2": sum(1 for x in v2_all if x > 0), "RealDist": sum(1 for x in rd_all if x > 0), "delta": sum(1 for x in rd_all if x > 0) - sum(1 for x in v2_all if x > 0)},
        {"metric": "v2_on_realdist_test_retry_f1", "V2": v2_on_rd_test["retry_f1"], "RealDist": rd_test["retry_f1"], "delta": rd_test["retry_f1"] - v2_on_rd_test["retry_f1"]},
    ]

    with (DOCS / "model3_v2_realdist_vs_baseline.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["metric", "V2", "RealDist", "delta"])
        w.writeheader()
        for row in comparison:
            w.writerow(row)

    with (DOCS / "model3_v2_realdist_real_probe.csv").open("w", encoding="utf-8", newline="") as f:
        fields = list(probe_rows[0].keys()) if probe_rows else ["caseId"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in probe_rows:
            w.writerow(row)

    # Hypothesis classification
    material = rd_case_retry >= 3 and (rd_case_retry - v2_case_retry) >= 2
    partial = rd_case_retry > v2_case_retry or (
        sum(1 for x in rd_tgt if x > -10) > sum(1 for x in v2_tgt if x > -10)
    )
    shortcut = rd_false > 0 or any(
        pos_stats[b]["keep_control_false_retry"] > 0 for b in ("HEAD", "MID", "TAIL")
    )
    if shortcut and rd_case_retry > v2_case_retry:
        hyp = "PARTIALLY_SUPPORTED"
        verdict = "REALDIST_POSITION_SHORTCUT_FAILURE"
    elif material and rd_false == 0:
        hyp = "SUPPORTED"
        verdict = "REALDIST_MODEL_ACCEPTED_CANDIDATE"
    elif partial and rd_false == 0 and rd_case_retry <= 2:
        hyp = "PARTIALLY_SUPPORTED"
        verdict = "REALDIST_MODEL_PROMISING_NOT_ACCEPTED" if rd_case_retry > v2_case_retry else "REALDIST_MODEL_NO_REAL_IMPROVEMENT"
    elif rd_case_retry < v2_case_retry:
        hyp = "NOT_SUPPORTED"
        verdict = "REALDIST_MODEL_REGRESSION"
    else:
        hyp = "NOT_SUPPORTED"
        verdict = "REALDIST_MODEL_NO_REAL_IMPROVEMENT"

    next_phase = {
        "REALDIST_MODEL_ACCEPTED_CANDIDATE": "MODEL3_V2_REALDIST_ACCEPTANCE_AND_PROMOTION_AUDIT",
        "REALDIST_MODEL_PROMISING_NOT_ACCEPTED": "MODEL3_V2_FEATURE_CAPACITY_AUDIT",
        "REALDIST_MODEL_NO_REAL_IMPROVEMENT": "MODEL3_V2_FEATURE_CAPACITY_AUDIT",
        "REALDIST_POSITION_SHORTCUT_FAILURE": "MODEL3_V2_RETRY_KEEP_CONTRAST_AUDIT",
        "REALDIST_MODEL_REGRESSION": "MODEL3_V2_FEATURE_CAPACITY_AUDIT",
    }.get(verdict, "STOP_AND_REVIEW")

    # If no real improvement and margins still strong KEEP → feature capacity
    if verdict == "REALDIST_MODEL_NO_REAL_IMPROVEMENT" and all(x < -5 for x in rd_tgt):
        next_phase = "MODEL3_V2_FEATURE_CAPACITY_AUDIT"

    out = {
        "verdict": verdict,
        "distributionHypothesis": hyp,
        "readyForPromotion": False,
        "recommendedNextPhase": next_phase,
        "rd_test": rd_test,
        "v2_on_realdist_test": v2_on_rd_test,
        "v2_historical_test": v2_hist_test,
        "comparison": comparison,
        "real_retry": {
            "cases": elig,
            "v2_retry": v2_case_retry,
            "rd_retry": rd_case_retry,
            "v2_recall": v2_case_retry / elig if elig else 0,
            "rd_recall": rd_case_retry / elig if elig else 0,
            "improved": improved,
            "regressed": regressed,
        },
        "real_keep": {
            "controls": keep_controls,
            "v2_false_retry": v2_false,
            "rd_false_retry": rd_false,
            "rd_false_rate": rd_false / keep_controls if keep_controls else 0,
        },
        "position": {k: dict(v) for k, v in pos_stats.items()},
        "margins": {
            "v2_all": margin_stats(v2_all),
            "rd_all": margin_stats(rd_all),
            "v2_targets": margin_stats(v2_tgt),
            "rd_targets": margin_stats(rd_tgt),
            "v2_keep_controls": margin_stats(v2_keep_m),
            "rd_keep_controls": margin_stats(rd_keep_m),
        },
        "latency_ms_per_utt": {"v2": v2_ms, "rd": rd_ms, "n": n_lat},
        "classifierBehavior": {
            "ALL_KEEP": rd_test["pred_retry"] == 0,
            "NEAR_ALL_KEEP": rd_test["pred_retry_rate"] < 0.001,
            "OVER_RETRY": rd_test["pred_retry_rate"] > 0.5,
        },
    }

    # merge into training summary
    sum_path = DOCS / "model3_v2_realdist_training_summary.json"
    if sum_path.exists():
        train_sum = json.loads(sum_path.read_text(encoding="utf-8"))
    else:
        train_sum = {}
    train_sum["offlineEval"] = out
    train_sum["checkpointVerdict"] = verdict
    train_sum["distributionHypothesis"] = hyp
    train_sum["readyForPromotion"] = False
    train_sum["recommendedNextPhase"] = next_phase
    sum_path.write_text(json.dumps(train_sum, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
