# -*- coding: utf-8 -*-
"""Offline V1 vs V2 Model3 evaluation + real dialog_200 FineSpan probe.

Validation-only. Does not modify production runtime or promote checkpoint.
Production Electron client hard-locks V1 weights SHA; real FineSpan probes
use offline BiGRU forward on stored feature-contract span inputs.
"""
from __future__ import annotations

import csv
import json
import math
import sys
from collections import Counter
from pathlib import Path

import torch

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.train.bigru_v1 import (  # noqa: E402
    FEAT_DIM,
    Model3BiGRUV1,
    collate_batch,
    encode_surface,
    sample_to_tensors,
    span_features,
)
from training.model3_dataset.train.train_v2_labeled import (  # noqa: E402
    UtteranceDataset,
    compute_metrics,
    load_split,
)

DOCS = REPO / "docs/user_correction/model3"
V1_CKPT = REPO / "training/model3_dataset/model3_v1_full100k_strict_integration_ckpts/seed_2026082520"
V2_CKPT = REPO / "training/model3_dataset/model3_v2_region_label_v1_ckpts/seed_2026082901"
DIALOG_JSONL = DOCS / "model3_v1_feature_contract_dialog200_anchored.jsonl"
INVENTORY = DOCS / "model3_real_retry_target_inventory.csv"


def load_bundle(ckpt: Path):
    cfg = json.loads((ckpt / "config.json").read_text(encoding="utf-8"))
    vocab = json.loads((ckpt / "vocab.json").read_text(encoding="utf-8"))
    model = Model3BiGRUV1(
        len(vocab),
        cfg.get("embed_dim", 64),
        cfg.get("hidden_dim", 128),
        cfg.get("feat_dim", FEAT_DIM),
    )
    state = torch.load(ckpt / "weights.pt", map_location="cpu")
    model.load_state_dict(state)
    model.eval()
    return model, vocab, cfg


def infer_utterance_spans(model, vocab, spans: list[dict], fa: dict | None = None):
    """Run BiGRU on a list of FineSpan-like dicts; return per-span decision/margin."""
    fa = fa or {"pinyinTextDerived": True, "recallFirstPass": True}
    n = len(spans)
    tokens = []
    feats = []
    avail = []
    for i, sp in enumerate(spans):
        tokens.append(encode_surface(sp.get("surface") or "", vocab))
        # Build span feature inputs expected by span_features
        packed = {
            "surface": sp.get("surface") or "",
            "isAnchor": bool(sp.get("isAnchor")),
            "recallEvidence": {
                "firstPassCandidateCount": int(sp.get("firstPassCandidateCount") or 0)
            },
        }
        f, a = span_features(packed, fa, span_index=i, n_spans=n)
        feats.append(f)
        avail.append(a)
    if not tokens:
        return []
    item = {
        "tokens": tokens,
        "feats": feats,
        "avail": avail,
        "target_mask": [0 if sp.get("isAnchor") else 1 for sp in spans],
        "labels": [-100] * n,
        "anchor_mask": [int(bool(sp.get("isAnchor"))) for sp in spans],
        "sampleId": "probe",
        "split": "probe",
    }
    batch = collate_batch([item], torch.device("cpu"))
    with torch.no_grad():
        logits = model(batch["tokens"], batch["feats"], batch["avail"])[0]
    out = []
    for i, sp in enumerate(spans):
        keep_l = float(logits[i, 0])
        retry_l = float(logits[i, 1])
        margin = retry_l - keep_l
        decision = "RETRY" if retry_l > keep_l else "KEEP"
        if sp.get("isAnchor"):
            decision = "MASKED"
        out.append(
            {
                "surface": sp.get("surface"),
                "isAnchor": bool(sp.get("isAnchor")),
                "keep_logit": keep_l,
                "retry_logit": retry_l,
                "margin": margin,
                "decision": decision,
            }
        )
    return out


def pct(arr, p):
    if not arr:
        return None
    arr = sorted(arr)
    i = min(len(arr) - 1, int((p / 100) * (len(arr) - 1)))
    return arr[i]


def margin_stats(margins):
    if not margins:
        return {}
    m = sorted(margins)
    return {
        "n": len(m),
        "min": m[0],
        "p50": pct(m, 50),
        "p95": pct(m, 95),
        "max": m[-1],
        "positive": sum(1 for x in m if x > 0),
        "near_boundary_abs_lt1": sum(1 for x in m if abs(x) < 1),
        "strong_keep_lt_neg5": sum(1 for x in m if x < -5),
    }


def load_inventory():
    if not INVENTORY.exists():
        return []
    rows = []
    with INVENTORY.open(encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append(row)
    return rows


def main():
    if not V2_CKPT.exists():
        raise SystemExit(f"missing V2 checkpoint: {V2_CKPT}")

    print("loading checkpoints...", flush=True)
    v1_model, v1_vocab, v1_cfg = load_bundle(V1_CKPT)
    v2_model, v2_vocab, v2_cfg = load_bundle(V2_CKPT)

    device = torch.device("cpu")
    print("evaluating V2 test set...", flush=True)
    test_samples = load_split("test")
    # evaluate with V2 vocab/model
    v2_test = compute_metrics(
        v2_model,
        torch.utils.data.DataLoader(
            UtteranceDataset(test_samples, v2_vocab),
            batch_size=64,
            shuffle=False,
            collate_fn=lambda b: collate_batch(b, device),
        ),
        device,
    )
    # V1 on same V2-labeled test (diagnostic — labels are V2)
    v1_on_v2test = compute_metrics(
        v1_model,
        torch.utils.data.DataLoader(
            UtteranceDataset(test_samples, v1_vocab),
            batch_size=64,
            shuffle=False,
            collate_fn=lambda b: collate_batch(b, device),
        ),
        device,
    )

    print("loading dialog_200 FineSpan probe inputs...", flush=True)
    cases = []
    with DIALOG_JSONL.open(encoding="utf-8") as f:
        for line in f:
            if line.strip():
                cases.append(json.loads(line))

    inv = {r["caseId"]: r for r in load_inventory()}
    probe_rows = []
    v1_all_margins = []
    v2_all_margins = []
    v1_elig_margins = []
    v2_elig_margins = []
    v1_keep_ctrl_margins = []
    v2_keep_ctrl_margins = []

    eligible_cases = 0
    eligible_spans = 0
    v1_retry_on_elig = 0
    v2_retry_on_elig = 0
    keep_controls = 0
    v1_false_retry = 0
    v2_false_retry = 0

    for case in cases:
        cid = case.get("id")
        meta = inv.get(cid) or {}
        audit_class = meta.get("audit_class") or "UNKNOWN"
        conf = meta.get("confidence") or "LOW"
        is_elig = audit_class in (
            "ERROR_INSIDE_NON_ANCHOR_FINESPAN",
            "ERROR_REQUIRES_LOCAL_RESEGMENTATION",
        ) and conf in ("HIGH", "MEDIUM")
        is_keep_ctrl = audit_class == "NO_ERROR" or (
            int(meta.get("mismatch") or 0) == 0
        )

        # Prefer span_margins structure (has surface/isAnchor/firstPassCandidateCount if present)
        raw_spans = case.get("span_margins") or case.get("spans") or []
        spans_in = []
        for s in raw_spans:
            spans_in.append(
                {
                    "surface": s.get("surface") or "",
                    "isAnchor": bool(s.get("isAnchor")),
                    "firstPassCandidateCount": int(
                        s.get("firstPassCandidateCount")
                        or s.get("cand")
                        or 0
                    ),
                }
            )

        v1_out = infer_utterance_spans(v1_model, v1_vocab, spans_in)
        v2_out = infer_utterance_spans(v2_model, v2_vocab, spans_in)

        for a, b in zip(v1_out, v2_out):
            if a["isAnchor"]:
                continue
            v1_all_margins.append(a["margin"])
            v2_all_margins.append(b["margin"])

        probe_surface = meta.get("probe_surface") or ""
        if is_elig:
            eligible_cases += 1
            # Match probe surface if available; else all non-anchor
            matched = False
            for a, b in zip(v1_out, v2_out):
                if a["isAnchor"]:
                    continue
                if probe_surface and a["surface"] != probe_surface and a["surface"] != probe_surface[:1]:
                    continue
                matched = True
                eligible_spans += 1
                v1_elig_margins.append(a["margin"])
                v2_elig_margins.append(b["margin"])
                if a["decision"] == "RETRY":
                    v1_retry_on_elig += 1
                if b["decision"] == "RETRY":
                    v2_retry_on_elig += 1
                probe_rows.append(
                    {
                        "caseId": cid,
                        "surface": a["surface"],
                        "isAnchor": False,
                        "audit_class": audit_class,
                        "confidence": conf,
                        "expected": "RETRY",
                        "v1_decision": a["decision"],
                        "v1_margin": a["margin"],
                        "v2_decision": b["decision"],
                        "v2_margin": b["margin"],
                    }
                )
                if probe_surface:
                    break
            if not matched and not probe_surface:
                # take first non-anchor as proxy
                for a, b in zip(v1_out, v2_out):
                    if a["isAnchor"]:
                        continue
                    eligible_spans += 1
                    v1_elig_margins.append(a["margin"])
                    v2_elig_margins.append(b["margin"])
                    if a["decision"] == "RETRY":
                        v1_retry_on_elig += 1
                    if b["decision"] == "RETRY":
                        v2_retry_on_elig += 1
                    probe_rows.append(
                        {
                            "caseId": cid,
                            "surface": a["surface"],
                            "isAnchor": False,
                            "audit_class": audit_class,
                            "confidence": conf,
                            "expected": "RETRY",
                            "v1_decision": a["decision"],
                            "v1_margin": a["margin"],
                            "v2_decision": b["decision"],
                            "v2_margin": b["margin"],
                        }
                    )
                    break

        if is_keep_ctrl:
            keep_controls += 1
            # false RETRY if any non-anchor RETRY
            v1_fr = any(x["decision"] == "RETRY" for x in v1_out if not x["isAnchor"])
            v2_fr = any(x["decision"] == "RETRY" for x in v2_out if not x["isAnchor"])
            if v1_fr:
                v1_false_retry += 1
            if v2_fr:
                v2_false_retry += 1
            for a, b in zip(v1_out, v2_out):
                if a["isAnchor"]:
                    continue
                v1_keep_ctrl_margins.append(a["margin"])
                v2_keep_ctrl_margins.append(b["margin"])
                probe_rows.append(
                    {
                        "caseId": cid,
                        "surface": a["surface"],
                        "isAnchor": False,
                        "audit_class": audit_class or "NO_ERROR",
                        "confidence": conf or "HIGH",
                        "expected": "KEEP",
                        "v1_decision": a["decision"],
                        "v1_margin": a["margin"],
                        "v2_decision": b["decision"],
                        "v2_margin": b["margin"],
                    }
                )
                break  # one control span per case

    comparison = [
        {
            "metric": "test_retry_precision",
            "V1_on_V2labels": v1_on_v2test["retry_precision"],
            "V2": v2_test["retry_precision"],
            "delta": v2_test["retry_precision"] - v1_on_v2test["retry_precision"],
        },
        {
            "metric": "test_retry_recall",
            "V1_on_V2labels": v1_on_v2test["retry_recall"],
            "V2": v2_test["retry_recall"],
            "delta": v2_test["retry_recall"] - v1_on_v2test["retry_recall"],
        },
        {
            "metric": "test_retry_f1",
            "V1_on_V2labels": v1_on_v2test["retry_f1"],
            "V2": v2_test["retry_f1"],
            "delta": v2_test["retry_f1"] - v1_on_v2test["retry_f1"],
        },
        {
            "metric": "test_pred_retry_rate",
            "V1_on_V2labels": v1_on_v2test["pred_retry_rate"],
            "V2": v2_test["pred_retry_rate"],
            "delta": v2_test["pred_retry_rate"] - v1_on_v2test["pred_retry_rate"],
        },
        {
            "metric": "real_elig_retry_count",
            "V1_on_V2labels": v1_retry_on_elig,
            "V2": v2_retry_on_elig,
            "delta": v2_retry_on_elig - v1_retry_on_elig,
        },
        {
            "metric": "real_false_retry_cases",
            "V1_on_V2labels": v1_false_retry,
            "V2": v2_false_retry,
            "delta": v2_false_retry - v1_false_retry,
        },
    ]

    summary = {
        "v2_test": v2_test,
        "v1_on_v2_test_labels": v1_on_v2test,
        "comparison": comparison,
        "real_retry_heldout": {
            "eligible_cases": eligible_cases,
            "eligible_spans": eligible_spans,
            "v1_retry": v1_retry_on_elig,
            "v2_retry": v2_retry_on_elig,
            "v1_recall": v1_retry_on_elig / eligible_spans if eligible_spans else 0.0,
            "v2_recall": v2_retry_on_elig / eligible_spans if eligible_spans else 0.0,
        },
        "real_keep_control": {
            "controls": keep_controls,
            "v1_false_retry": v1_false_retry,
            "v2_false_retry": v2_false_retry,
            "v1_false_retry_rate": v1_false_retry / keep_controls if keep_controls else 0.0,
            "v2_false_retry_rate": v2_false_retry / keep_controls if keep_controls else 0.0,
        },
        "margins": {
            "v1_all_non_anchor": margin_stats(v1_all_margins),
            "v2_all_non_anchor": margin_stats(v2_all_margins),
            "v1_eligible": margin_stats(v1_elig_margins),
            "v2_eligible": margin_stats(v2_elig_margins),
            "v1_keep_control": margin_stats(v1_keep_ctrl_margins),
            "v2_keep_control": margin_stats(v2_keep_ctrl_margins),
        },
        "dialog200_mainline_v2": {
            "status": "BLOCKED_BY_PRODUCTION_CHECKPOINT_HASH_LOCK",
            "reason": "Electron model3-inference-client and model3_inference_host hard-require V1 weights SHA; candidate V2 cannot load without production promotion/hash unlock",
            "offline_finespan_probe": "COMPLETED",
        },
        "productionPromotion": "NOT_READY_FOR_PROMOTION",
    }

    with (DOCS / "model3_v2_v1_comparison.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["metric", "V1_on_V2labels", "V2", "delta"])
        w.writeheader()
        for row in comparison:
            w.writerow(row)

    with (DOCS / "model3_v2_real_probe_results.csv").open("w", encoding="utf-8", newline="") as f:
        fields = list(probe_rows[0].keys()) if probe_rows else ["caseId"]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in probe_rows:
            w.writerow(row)

    # merge into training summary if present
    train_sum_path = DOCS / "model3_v2_training_summary.json"
    if train_sum_path.exists():
        train_sum = json.loads(train_sum_path.read_text(encoding="utf-8"))
    else:
        train_sum = {}
    train_sum["offlineEval"] = summary
    train_sum_path.write_text(json.dumps(train_sum, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
