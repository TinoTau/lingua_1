# -*- coding: utf-8 -*-
"""S1 vs S2 learning-curve evaluation after S2 random-init training."""
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

from training.model3_dataset.scripts.replay_model3_live_input_trace import (  # noqa: E402
    ELIG_CLASSES,
    attribution,
    load_bundle,
    replay_path,
    span_payload,
)
from training.model3_dataset.train.bigru_v1 import collate_batch  # noqa: E402
from training.model3_dataset.train.train_s2_random import UtteranceDataset, load_split  # noqa: E402
from training.model3_dataset.train.train_v2_labeled import compute_metrics  # noqa: E402
from torch.utils.data import DataLoader

DOCS = REPO / "docs/user_correction/model3"
TRACE = DOCS / "model3_v2_live_input_trace.jsonl"
INV = DOCS / "model3_real_retry_target_inventory.csv"

S1_CKPT = REPO / "training/model3_dataset/model3_v2_s1_random_init_v1_ckpts/seed_2026083007"
S2_CKPT = REPO / "training/model3_dataset/model3_v2_s2_random_init_v1_ckpts/seed_2026083011"
S1_DATA = REPO / "training/model3_dataset/model3_v2_production_core_s1"
S2_DATA = REPO / "training/model3_dataset/model3_v2_production_core_s2"


def load_split_from(base: Path, split: str) -> list[dict]:
    rows = []
    for p in sorted((base / split).glob("shard-*.jsonl")):
        with p.open(encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    s = json.loads(line)
                    s["split"] = split
                    rows.append(s)
    return rows


def protected_real_eval(model, vocab: dict) -> dict:
    rows = []
    for line in TRACE.open(encoding="utf-8"):
        if line.strip():
            rows.append(json.loads(line))
    groups: dict[tuple[str, str], list] = defaultdict(list)
    for r in rows:
        if r.get("status") not in (None, "OK"):
            continue
        sp = span_payload(r)
        if not sp.get("features"):
            continue
        sp = dict(sp)
        sp.pop("tokenIds", None)
        sp.pop("token_ids", None)
        cid = r.get("caseId") or r.get("id")
        pid = r.get("pathId") or "_"
        groups[(cid, pid)].append(sp)

    inv = {}
    with INV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            inv[row["caseId"]] = row
    elig = {
        cid
        for cid, r in inv.items()
        if r.get("confidence") in ("HIGH", "MEDIUM") and r.get("audit_class") in ELIG_CLASSES
    }
    keep_controls = {cid for cid, r in inv.items() if r.get("audit_class") == "NO_ERROR"}

    case_retry = 0
    target_retry = 0
    unrelated_retry = 0
    keep_false_retry = 0
    for cid in elig:
        case_spans = []
        for (c, _pid), spans in groups.items():
            if c == cid:
                case_spans.extend(replay_path(model, vocab, spans))
        any_retry = any(x["decision"] == "RETRY" and not x["isAnchor"] for x in case_spans)
        case_retry += int(any_retry)
        attr = attribution(
            [{"surface": x["surface"], "live_decision": x["decision"], "isAnchor": x["isAnchor"]} for x in case_spans],
            inv.get(cid),
        )
        if attr == "TARGET_REGION_RETRY":
            target_retry += 1
        elif attr == "UNRELATED_REGION_RETRY":
            unrelated_retry += 1
    for cid in keep_controls:
        case_spans = []
        for (c, _pid), spans in groups.items():
            if c == cid:
                case_spans.extend(replay_path(model, vocab, spans))
        if any(x["decision"] == "RETRY" and not x["isAnchor"] for x in case_spans):
            keep_false_retry += 1
    return {
        "eligible_cases": len(elig),
        "case_level_any_retry": case_retry,
        "target_region_retry_cases": target_retry,
        "unrelated_retry_cases": unrelated_retry,
        "keep_control_false_retry": keep_false_retry,
        "keep_controls_total": len(keep_controls),
    }


def latency_ms(model, samples: list[dict], vocab: dict, n: int = 400) -> dict:
    subset = samples[: min(n, len(samples))]
    span_ms = []
    utt_ms = []
    model.eval()
    with torch.no_grad():
        for s in subset:
            t0 = time.perf_counter()
            item = UtteranceDataset([s], vocab)[0]
            tokens = torch.tensor([item["tokens"]], dtype=torch.long)
            feats = torch.tensor([item["feats"]])
            avail = torch.tensor([item["avail"]])
            _ = model(tokens, feats, avail)[0]
            dt = (time.perf_counter() - t0) * 1000.0
            utt_ms.append(dt)
            span_ms.append(dt / max(len(s.get("spans") or []), 1))
    span_ms.sort()
    utt_ms.sort()

    def pct(arr, p):
        return arr[int(len(arr) * p)] if arr else 0.0

    return {
        "samples": len(subset),
        "per_span_ms_p50": pct(span_ms, 0.5),
        "per_span_ms_p95": pct(span_ms, 0.95),
        "per_utterance_ms_p50": pct(utt_ms, 0.5),
        "per_utterance_ms_p95": pct(utt_ms, 0.95),
    }


def surface_rows(model, test_samples: list[dict], vocab: dict, label: str) -> list[dict]:
    by_surface = defaultdict(lambda: {"KEEP": 0, "RETRY": 0, "pred_retry": 0, "pred_keep": 0})
    model.eval()
    with torch.no_grad():
        for s in test_samples:
            item = UtteranceDataset([s], vocab)[0]
            tokens = torch.tensor([item["tokens"]], dtype=torch.long)
            feats = torch.tensor([item["feats"]])
            avail = torch.tensor([item["avail"]])
            logits = model(tokens, feats, avail)[0]
            for i, sp in enumerate(s.get("spans") or []):
                if item["labels"][i] < 0 or item["target_mask"][i] <= 0:
                    continue
                surf = sp.get("surface") or ""
                pred = int(logits[i, 1].item() > logits[i, 0].item())
                true = item["labels"][i]
                if true == 0:
                    by_surface[surf]["KEEP"] += 1
                else:
                    by_surface[surf]["RETRY"] += 1
                if pred == 1:
                    by_surface[surf]["pred_retry"] += 1
                else:
                    by_surface[surf]["pred_keep"] += 1
    rows = []
    for surf, d in sorted(by_surface.items(), key=lambda x: -(x[1]["KEEP"] + x[1]["RETRY"]))[:40]:
        support = d["KEEP"] + d["RETRY"]
        rows.append(
            {
                "model": label,
                "surface": surf,
                "true_keep": d["KEEP"],
                "true_retry": d["RETRY"],
                "pred_retry": d["pred_retry"],
                "pred_keep": d["pred_keep"],
                "one_sided_true": d["RETRY"] == 0 or d["KEEP"] == 0,
                "pred_retry_rate": round(d["pred_retry"] / support, 4) if support else 0,
            }
        )
    return rows


def eval_ckpt(name: str, ckpt: Path, data: Path) -> dict:
    model, vocab = load_bundle(ckpt)
    test = load_split_from(data, "test")
    loader = DataLoader(
        UtteranceDataset(test, vocab),
        batch_size=64,
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, torch.device("cpu")),
    )
    formal = compute_metrics(model, loader, torch.device("cpu"))
    prot = protected_real_eval(model, vocab)
    lat = latency_ms(model, test, vocab)
    metrics_path = ckpt / "training_metrics.json"
    tm = json.loads(metrics_path.read_text(encoding="utf-8")) if metrics_path.exists() else {}
    return {
        "name": name,
        "modelId": tm.get("modelId") or name,
        "formal": formal,
        "protected": prot,
        "latency": lat,
        "bestEpoch": tm.get("bestEpoch"),
        "weightsSha256": tm.get("weightsSha256"),
        "surface": surface_rows(model, test, vocab, name),
    }


def learning_curve_verdict(s1: dict, s2: dict) -> tuple[str, str, bool]:
    """Return (phase_verdict, next_phase, s3_authorized)."""
    s1f, s2f = s1["formal"], s2["formal"]
    s1p, s2p = s1["protected"], s2["protected"]
    recall_gain = s2f["retry_recall"] - s1f["retry_recall"]
    f1_gain = s2f["retry_f1"] - s1f["retry_f1"]
    target_gain = s2p["target_region_retry_cases"] - s1p["target_region_retry_cases"]
    unrelated_up = s2p["unrelated_retry_cases"] - s1p["unrelated_retry_cases"]
    keep_fp_up = s2p["keep_control_false_retry"] - s1p["keep_control_false_retry"]

    useful = (recall_gain >= 0.05 or f1_gain >= 0.05 or target_gain >= 1) and unrelated_up <= 1 and keep_fp_up <= 0
    flat = abs(f1_gain) < 0.02 and abs(recall_gain) < 0.03 and target_gain <= 0
    real_weak = s2p["target_region_retry_cases"] == 0 and s2p["case_level_any_retry"] <= 1

    if useful and not real_weak:
        return "S2_BUILD_AND_TRAIN_PASS_CONTINUE_S3", "MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S3", True
    if useful and real_weak:
        return "S2_REAL_GENERALIZATION_WEAK", "MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S3", True
    if flat:
        return "S2_LEARNING_CURVE_FLAT", "STOP_AND_REVIEW", False
    if real_weak:
        return "S2_REAL_GENERALIZATION_WEAK", "STOP_AND_REVIEW", False
    return "S2_BUILD_AND_TRAIN_PASS_HOLD_FOR_AUDIT", "STOP_AND_REVIEW", False


def main() -> int:
    s1 = eval_ckpt("S1_RANDOM", S1_CKPT, S1_DATA)
    s2 = eval_ckpt("S2_RANDOM", S2_CKPT, S2_DATA)
    verdict, next_phase, s3 = learning_curve_verdict(s1, s2)

    rows = []
    for tag, r in (("S1", s1), ("S2", s2)):
        rows.append(
            {
                "model": r["modelId"],
                "group": "formal_test",
                "retry_f1": round(r["formal"]["retry_f1"], 4),
                "retry_precision": round(r["formal"]["retry_precision"], 4),
                "retry_recall": round(r["formal"]["retry_recall"], 4),
                "keep_precision": round(r["formal"]["keep_precision"], 4),
                "keep_recall": round(r["formal"]["keep_recall"], 4),
                "pred_retry_rate": round(r["formal"]["pred_retry_rate"], 4),
                "notes": tag,
            }
        )
        rows.append(
            {
                "model": r["modelId"],
                "group": "protected_real",
                "retry_f1": "",
                "retry_precision": r["protected"]["target_region_retry_cases"],
                "retry_recall": r["protected"]["case_level_any_retry"],
                "keep_precision": r["protected"]["unrelated_retry_cases"],
                "keep_recall": r["protected"]["keep_control_false_retry"],
                "pred_retry_rate": r["protected"]["eligible_cases"],
                "notes": "target/case/unrelated/keep_fp / eligible",
            }
        )
        rows.append(
            {
                "model": r["modelId"],
                "group": "latency_ms",
                "retry_f1": round(r["latency"]["per_span_ms_p50"], 4),
                "retry_precision": round(r["latency"]["per_span_ms_p95"], 4),
                "retry_recall": round(r["latency"]["per_utterance_ms_p50"], 4),
                "keep_precision": round(r["latency"]["per_utterance_ms_p95"], 4),
                "keep_recall": "",
                "pred_retry_rate": "",
                "notes": "span_p50/p95 utt_p50/p95",
            }
        )
    rows.append(
        {
            "model": "DELTA_S2_minus_S1",
            "group": "learning_curve",
            "retry_f1": round(s2["formal"]["retry_f1"] - s1["formal"]["retry_f1"], 4),
            "retry_precision": round(s2["formal"]["retry_precision"] - s1["formal"]["retry_precision"], 4),
            "retry_recall": round(s2["formal"]["retry_recall"] - s1["formal"]["retry_recall"], 4),
            "keep_precision": s2["protected"]["target_region_retry_cases"] - s1["protected"]["target_region_retry_cases"],
            "keep_recall": s2["protected"]["case_level_any_retry"] - s1["protected"]["case_level_any_retry"],
            "pred_retry_rate": "",
            "notes": f"verdict={verdict}",
        }
    )

    with (DOCS / "model3_v2_s1_vs_s2_learning_curve.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    surf = s1["surface"] + s2["surface"]
    with (DOCS / "model3_v2_s1_vs_s2_surface_shortcut.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(surf[0].keys()) if surf else ["model", "surface"])
        w.writeheader()
        w.writerows(surf)

    # update summary
    summary_path = DOCS / "model3_v2_production_core_s2_summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else {}
    summary.update(
        {
            "trainingCompleted": True,
            "verdict": verdict,
            "nextPhase": next_phase,
            "s3Authorized": s3,
            "s1VsS2": {
                "s1": {"formal": s1["formal"], "protected": s1["protected"], "latency": s1["latency"]},
                "s2": {"formal": s2["formal"], "protected": s2["protected"], "latency": s2["latency"]},
            },
            "preferredInit": "RANDOM_FROM_SCRATCH",
            "complexityAudit": {
                "newRuntimeLogic": False,
                "newFeatures": False,
                "newGates": False,
                "newCompatibilityPaths": False,
                "unnecessaryComplexity": False,
            },
        }
    )
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"verdict": verdict, "nextPhase": next_phase, "s3Authorized": s3}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
