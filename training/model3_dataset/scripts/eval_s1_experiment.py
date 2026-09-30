# -*- coding: utf-8
"""Evaluate S1 training experiment: formal test, protected-real, shortcuts, latency."""
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
    FEAT_KEYS,
    attribution,
    load_bundle,
    replay_path,
    span_payload,
)
from training.model3_dataset.scripts.stage2_v2_label import derive_malformed_regions, anchor_ranges  # noqa: E402
from training.model3_dataset.train.bigru_v1 import FEAT_DIM, encode_surface  # noqa: E402
from training.model3_dataset.train.train_s1_experiment import RUNS, load_split  # noqa: E402
from training.model3_dataset.train.train_v2_labeled import compute_metrics  # noqa: E402
from training.model3_dataset.train.bigru_v1 import collate_batch  # noqa: E402
from torch.utils.data import DataLoader
from training.model3_dataset.train.train_s1_experiment import UtteranceDataset  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
TRACE = DOCS / "model3_v2_live_input_trace.jsonl"
INV = DOCS / "model3_real_retry_target_inventory.csv"
DATA = REPO / "training/model3_dataset/model3_v2_production_core_s1"

HISTORICAL = {
    "MODEL3_V2_REGION_LABEL_V1": {
        "source": "historical_accepted",
        "test_retry_f1": 0.9539,
        "protected_eligible_retry_cases": 1,
        "protected_eligible_total": 13,
    },
    "MODEL3_V2_REALDIST_V1": {
        "source": "historical_accepted",
        "test_retry_f1": 0.9620,
        "protected_eligible_retry_cases": 7,
        "protected_eligible_total": 13,
    },
}


def pos_bin(rel: float) -> str:
    if rel <= 0.25:
        return "HEAD"
    if rel >= 0.75:
        return "TAIL"
    return "MID"


def classify_error_family(cur: str, ref: str, sp: dict) -> str:
    anchors = []
    regs = derive_malformed_regions(cur, ref, anchors=anchors)
    s0, s1 = int(sp["rawStart"]), int(sp["rawEnd"])
    for r in regs:
        if r["curStart"] < s1 and r["curEnd"] > s0:
            tag = r.get("tag") or ""
            if tag == "insert" or r.get("deletionGap"):
                return "INSERTION"
            if tag == "delete":
                return "DELETION"
            if (r["curEnd"] - r["curStart"]) > 1:
                return "MULTI_CHAR_REPLACEMENT"
            return "SUBSTITUTION"
    return "NONE"


def detailed_metrics(model, samples: list[dict], vocab: dict) -> dict:
    device = torch.device("cpu")
    loader = DataLoader(
        UtteranceDataset(samples, vocab),
        batch_size=64,
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, device),
    )
    base = compute_metrics(model, loader, device)

    buckets = Counter()
    margins_retry = []
    margins_keep = []
    utt_paths = Counter()
    for s in samples:
        utt_key = f"{s.get('semanticFamilyId')}|{s.get('referenceId')}"
        utt_paths[utt_key] += 1

    model.eval()
    with torch.no_grad():
        for s in samples:
            item = UtteranceDataset([s], vocab)[0]
            tokens = torch.tensor([item["tokens"]], dtype=torch.long)
            feats = torch.tensor([item["feats"]])
            avail = torch.tensor([item["avail"]])
            logits = model(tokens, feats, avail)[0]
            n_sp = len(s.get("spans") or [])
            cur = s.get("currentText") or ""
            ref = s.get("referenceText") or ""
            multipath = utt_paths[f"{s.get('semanticFamilyId')}|{s.get('referenceId')}"] > 1
            for i, sp in enumerate(s.get("spans") or []):
                if item["labels"][i] < 0:
                    continue
                if item["target_mask"][i] <= 0:
                    continue
                keep_l = float(logits[i, 0].item())
                retry_l = float(logits[i, 1].item())
                margin = retry_l - keep_l
                pred = 1 if retry_l > keep_l else 0
                true = item["labels"][i]
                rel = (sp["rawStart"] + sp["rawEnd"]) / max(2 * max(len(cur), 1), 1)
                cand = int((sp.get("recallEvidence") or {}).get("firstPassCandidateCount") or 0)
                cand_b = "cand_gt0" if cand > 0 else "cand0"
                anchor_b = "anchor_near" if sp.get("isAnchor") else "non_anchor"
                path_b = "multipath" if multipath else "single_path"
                pos = pos_bin(rel)
                fam = classify_error_family(cur, ref, sp)
                if true == 1 and fam == "DELETION":
                    fam = "DELETION_WITH_REPAIRABLE_TARGET"
                key = f"{pos}|{cand_b}|{anchor_b}|{path_b}|{fam}"
                buckets[key] += 1
                if true == 1:
                    margins_retry.append(margin)
                else:
                    margins_keep.append(margin)
                buckets[f"pred_{pred}_true_{true}|{key}"] += 1

    return {
        **base,
        "margin_retry_mean": sum(margins_retry) / len(margins_retry) if margins_retry else 0.0,
        "margin_keep_mean": sum(margins_keep) / len(margins_keep) if margins_keep else 0.0,
        "margin_retry_p50": sorted(margins_retry)[len(margins_retry) // 2] if margins_retry else 0.0,
        "bucket_counts": dict(buckets),
    }


def latency_ms(model, samples: list[dict], vocab: dict, n: int = 400) -> dict:
    device = torch.device("cpu")
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
            logits = model(tokens, feats, avail)[0]
            dt = (time.perf_counter() - t0) * 1000.0
            utt_ms.append(dt)
            nsp = max(len(s.get("spans") or []), 1)
            span_ms.append(dt / nsp)
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
        # S1 checkpoints use dataset vocab; encode surfaces instead of RealDist tokenIds.
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

    case_retry = Counter()
    target_retry = Counter()
    unrelated_retry = Counter()
    keep_false_retry = 0
    for cid in elig:
        case_spans = []
        for (c, _pid), spans in groups.items():
            if c == cid:
                replayed = replay_path(model, vocab, spans)
                case_spans.extend(replayed)
        any_retry = any(x["decision"] == "RETRY" and not x["isAnchor"] for x in case_spans)
        case_retry[cid] = int(any_retry)
        attr = attribution(
            [{"surface": x["surface"], "live_decision": x["decision"], "isAnchor": x["isAnchor"]} for x in case_spans],
            inv.get(cid),
        )
        if attr == "TARGET_REGION_RETRY":
            target_retry[cid] = 1
        elif attr == "UNRELATED_REGION_RETRY":
            unrelated_retry[cid] = 1

    for cid in keep_controls:
        case_spans = []
        for (c, _pid), spans in groups.items():
            if c == cid:
                case_spans.extend(replay_path(model, vocab, spans))
        if any(x["decision"] == "RETRY" and not x["isAnchor"] for x in case_spans):
            keep_false_retry += 1

    return {
        "eligible_cases": len(elig),
        "case_level_any_retry": sum(case_retry.values()),
        "target_region_retry_cases": sum(target_retry.values()),
        "unrelated_retry_cases": sum(unrelated_retry.values()),
        "keep_control_false_retry": keep_false_retry,
        "keep_controls_total": len(keep_controls),
    }


def surface_shortcut_eval(model, test_samples: list[dict], vocab: dict) -> list[dict]:
    """Check high-support surfaces from audit one-sided list."""
    surfaces = Counter()
    one_sided = []
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
                surfaces[(surf, pred, true)] += 1
    by_surface = defaultdict(lambda: {"KEEP": 0, "RETRY": 0, "pred_retry": 0, "pred_keep": 0})
    for (surf, pred, true), n in surfaces.items():
        if true == 0:
            by_surface[surf]["KEEP"] += n
        else:
            by_surface[surf]["RETRY"] += n
        if pred == 1:
            by_surface[surf]["pred_retry"] += n
        else:
            by_surface[surf]["pred_keep"] += n
    rows = []
    for surf, d in sorted(by_surface.items(), key=lambda x: -(x[1]["KEEP"] + x[1]["RETRY"]))[:40]:
        support = d["KEEP"] + d["RETRY"]
        rows.append(
            {
                "surface": surf,
                "true_keep": d["KEEP"],
                "true_retry": d["RETRY"],
                "pred_retry": d["pred_retry"],
                "pred_keep": d["pred_keep"],
                "one_sided_true": d["RETRY"] == 0 or d["KEEP"] == 0,
                "pred_retry_rate": d["pred_retry"] / support if support else 0,
            }
        )
    return rows


def outcome_class(test_m: dict, protected: dict) -> str:
    if test_m["pred_retry"] == 0:
        return "NEAR_ALL_KEEP"
    if test_m["pred_retry_rate"] > 0.5:
        return "OVER_RETRY"
    if protected["case_level_any_retry"] >= 3 and test_m["retry_f1"] > 0.9:
        return "REAL_GENERALIZATION_IMPROVED"
    if test_m["retry_f1"] > 0.9 and protected["case_level_any_retry"] <= 1:
        return "FORMAL_GOOD_REAL_WEAK"
    if test_m["retry_f1"] < 0.5:
        return "UNDERFIT"
    return "BALANCED"


def main():
    test_samples = load_split("test")
    comparison_rows = []
    surface_rows = []
    results = {}
    for mode in ("random", "realdist"):
        ckpt = RUNS[mode]["out"]
        metrics_path = ckpt / "training_metrics.json"
        if not metrics_path.exists():
            print(json.dumps({"error": f"missing checkpoint for {mode}"}))
            continue
        model, vocab = load_bundle(ckpt)
        test_m = detailed_metrics(model, test_samples, vocab)
        lat = latency_ms(model, test_samples, vocab)
        prot = protected_real_eval(model, vocab)
        oc = outcome_class(test_m, prot)
        results[mode] = {
            "modelId": RUNS[mode]["modelId"],
            "test": test_m,
            "latency": lat,
            "protectedReal": prot,
            "outcomeClass": oc,
        }
        comparison_rows.append(
            {
                "model": RUNS[mode]["modelId"],
                "metric_group": "formal_test",
                "retry_f1": round(test_m["retry_f1"], 4),
                "retry_precision": round(test_m["retry_precision"], 4),
                "retry_recall": round(test_m["retry_recall"], 4),
                "keep_precision": round(test_m["keep_precision"], 4),
                "keep_recall": round(test_m["keep_recall"], 4),
                "pred_retry_rate": round(test_m["pred_retry_rate"], 4),
                "true_retry_rate": round(test_m["true_retry_rate"], 4),
                "notes": oc,
            }
        )
        comparison_rows.append(
            {
                "model": RUNS[mode]["modelId"],
                "metric_group": "protected_real",
                "retry_f1": "",
                "retry_precision": "",
                "retry_recall": "",
                "keep_precision": "",
                "keep_recall": "",
                "pred_retry_rate": prot["case_level_any_retry"],
                "true_retry_rate": prot["eligible_cases"],
                "notes": f"target={prot['target_region_retry_cases']} unrelated={prot['unrelated_retry_cases']} keep_fp={prot['keep_control_false_retry']}",
            }
        )
        comparison_rows.append(
            {
                "model": RUNS[mode]["modelId"],
                "metric_group": "latency",
                "retry_f1": lat["per_span_ms_p50"],
                "retry_precision": lat["per_span_ms_p95"],
                "retry_recall": lat["per_utterance_ms_p50"],
                "keep_precision": lat["per_utterance_ms_p95"],
                "keep_recall": "",
                "pred_retry_rate": "",
                "true_retry_rate": "",
                "notes": "ms p50/p95 span/utt",
            }
        )
        if mode == "random":
            surface_rows = surface_shortcut_eval(model, test_samples, vocab)

    for hist_id, hist in HISTORICAL.items():
        comparison_rows.append(
            {
                "model": hist_id,
                "metric_group": "historical_baseline",
                "retry_f1": hist["test_retry_f1"],
                "retry_precision": "",
                "retry_recall": "",
                "keep_precision": "",
                "keep_recall": "",
                "pred_retry_rate": hist["protected_eligible_retry_cases"],
                "true_retry_rate": hist["protected_eligible_total"],
                "notes": hist["source"],
            }
        )

    with (DOCS / "model3_v2_s1_model_comparison.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(comparison_rows[0].keys()))
        w.writeheader()
        w.writerows(comparison_rows)

    with (DOCS / "model3_v2_s1_surface_shortcut_analysis.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(surface_rows[0].keys()) if surface_rows else ["surface"])
        w.writeheader()
        w.writerows(surface_rows)

    # init preference
    r = results.get("random", {}).get("protectedReal", {})
    rd = results.get("realdist", {}).get("protectedReal", {})
    r_score = (r.get("target_region_retry_cases", 0), r.get("case_level_any_retry", 0), -r.get("unrelated_retry_cases", 0))
    rd_score = (rd.get("target_region_retry_cases", 0), rd.get("case_level_any_retry", 0), -rd.get("unrelated_retry_cases", 0))
    if r_score == rd_score:
        init_pref = "NO_MATERIAL_DIFFERENCE"
    elif rd_score > r_score:
        init_pref = "REALDIST_INIT_PREFERRED"
    else:
        init_pref = "RANDOM_INIT_PREFERRED"

    summary = {
        "phase": "MODEL3_V2_PRODUCTION_CORE_S1_TRAINING_EXPERIMENT",
        "deletionAuditPassed": True,
        "results": results,
        "initPreference": init_pref,
        "historicalBaselines": HISTORICAL,
    }
    (DOCS / "model3_v2_s1_training_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps({"initPreference": init_pref, "results": {k: v.get("outcomeClass") for k, v in results.items()}}, indent=2))


if __name__ == "__main__":
    main()
