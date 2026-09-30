# -*- coding: utf-8 -*-
"""S1/S2/S3 learning curve + protected L1–L4 localization acceptance."""
from __future__ import annotations

import csv
import json
import statistics
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import torch
from torch.utils.data import DataLoader

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.audit_s2_protected_localization import (  # noqa: E402
    clause_id,
    distance_to_interval,
    grounding_class,
    logical_key,
    margin_bucket,
    overlaps,
    classify_retry_vs_target,
    target_intervals,
)
from training.model3_dataset.scripts.replay_model3_live_input_trace import (  # noqa: E402
    ELIG_CLASSES,
    load_bundle,
    replay_path,
    span_payload,
)
from training.model3_dataset.train.bigru_v1 import collate_batch  # noqa: E402
from training.model3_dataset.train.train_s3_random import UtteranceDataset  # noqa: E402
from training.model3_dataset.train.train_v2_labeled import compute_metrics  # noqa: E402

DOCS = REPO / "docs/user_correction/model3"
TRACE = DOCS / "model3_v2_live_input_trace.jsonl"
INV = DOCS / "model3_real_retry_target_inventory.csv"

S1_CKPT = REPO / "training/model3_dataset/model3_v2_s1_random_init_v1_ckpts/seed_2026083007"
S2_CKPT = REPO / "training/model3_dataset/model3_v2_s2_random_init_v1_ckpts/seed_2026083011"
S3_CKPT = REPO / "training/model3_dataset/model3_v2_s3_random_init_v1_ckpts/seed_2026083013"
S1_DATA = REPO / "training/model3_dataset/model3_v2_production_core_s1"
S2_DATA = REPO / "training/model3_dataset/model3_v2_production_core_s2"
S3_DATA = REPO / "training/model3_dataset/model3_v2_production_core_s3"

# S2 localization audit baseline (logical)
S2_L2_BASELINE = 13
S2_L3_LOGICAL = 24
S2_L3_STRONG = 10
S2_L4 = 0


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


def load_inventory() -> dict[str, dict]:
    inv = {}
    with INV.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            inv[row["caseId"]] = row
    return inv


def load_trace_groups() -> tuple[dict, dict]:
    groups: dict[tuple[str, str], list] = defaultdict(list)
    meta: dict[str, dict] = {}
    for line in TRACE.open(encoding="utf-8"):
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("status") not in (None, "OK"):
            continue
        sp = span_payload(row)
        if not sp.get("features"):
            continue
        sp = dict(sp)
        sp.pop("tokenIds", None)
        sp.pop("token_ids", None)
        cid = row.get("caseId") or row.get("id")
        pid = row.get("pathId") or "_"
        groups[(cid, pid)].append({**sp, "pathId": pid})
        meta[cid] = {
            "raw": row.get("raw_asr") or row.get("sourceText") or "",
            "expected": row.get("expected") or row.get("expectedText") or "",
        }
    return groups, meta


def protected_localization(model, vocab: dict) -> dict:
    inv = load_inventory()
    elig = sorted(
        cid
        for cid, r in inv.items()
        if r.get("confidence") in ("HIGH", "MEDIUM") and r.get("audit_class") in ELIG_CLASSES
    )
    keep_controls = sorted(cid for cid, r in inv.items() if r.get("audit_class") == "NO_ERROR")
    groups, meta = load_trace_groups()

    case_rows = []
    distant_fp_rows = []
    l1_cases = 0
    l2_cases = 0
    any_retry_cases = 0
    clear_fp_logical = {}
    clear_fp_margins = []
    keep_false = 0
    keep_logical = 0
    keep_max_margin = None
    anchor_retry = 0

    for cid in elig:
        cur = meta.get(cid, {}).get("raw") or inv[cid].get("raw") or ""
        exp = meta.get(cid, {}).get("expected") or inv[cid].get("expected") or ""
        probe = inv[cid].get("probe_surface") or ""
        targets, target_src = target_intervals(cur, exp, probe)
        target_valid = len(targets) > 0 and target_src != "STALE_OR_EMPTY_TARGET"

        path_results = []
        for (c, _pid), spans in groups.items():
            if c != cid:
                continue
            for r in replay_path(model, vocab, spans):
                path_results.append(r)
                if r.get("isAnchor") and r.get("decision") == "RETRY":
                    anchor_retry += 1

        retries = [r for r in path_results if r.get("decision") == "RETRY" and not r.get("isAnchor")]
        any_retry = len(retries) > 0
        any_retry_cases += int(any_retry)

        logical: dict[tuple, dict] = {}
        has_overlap = False
        has_local = False
        for r in retries:
            s0 = int(r.get("rawStart") or 0)
            s1 = int(r.get("rawEnd") or 0)
            surf = r.get("surface") or cur[s0:s1]
            rel = classify_retry_vs_target(s0, s1, targets, cur, exp) if target_valid else "STALE_TARGET_DEFINITION"
            if rel == "TARGET_OVERLAP":
                has_overlap = True
                has_local = True
            elif rel in ("TARGET_ADJACENT", "SAME_LOCAL_ERROR_REGION"):
                has_local = True
            g = grounding_class(cur, exp, s0, s1, rel)
            margin = float(r.get("margin") if r.get("margin") is not None else (float(r.get("retryLogit", 0)) - float(r.get("keepLogit", 0))))
            key = logical_key({"rawStart": s0, "rawEnd": s1, "surface": surf, "isAnchor": False})
            prev = logical.get(key)
            if prev is None or margin > prev["margin"]:
                logical[key] = {
                    "caseId": cid,
                    "surface": surf,
                    "start": s0,
                    "end": s1,
                    "relation": rel,
                    "grounding": g,
                    "margin": margin,
                    "bucket": margin_bucket(margin),
                    "candidateCount": r.get("first_pass_candidate_count") or r.get("rawFirstPassCandidateCount"),
                    "pathDup": 1 if prev is None else prev["pathDup"] + 1,
                }
            else:
                logical[key]["pathDup"] += 1

        if has_overlap:
            l1_cases += 1
        if has_local:
            l2_cases += 1

        case_clear = []
        for row in logical.values():
            if row["grounding"] == "CLEAR_FALSE_POSITIVE" and row["relation"] not in (
                "TARGET_OVERLAP",
                "TARGET_ADJACENT",
                "SAME_LOCAL_ERROR_REGION",
            ):
                case_clear.append(row)
                clear_fp_logical[(cid, row["start"], row["end"], row["surface"])] = row
                clear_fp_margins.append(row["margin"])
                distant_fp_rows.append(row)

        case_rows.append(
            {
                "caseId": cid,
                "targetValid": int(target_valid),
                "L1_exactOverlap": int(has_overlap),
                "L2_localErrorRegion": int(has_local),
                "anyRetry": int(any_retry),
                "rawRetry": len(retries),
                "logicalRetry": len(logical),
                "clearDistantLogical": len(case_clear),
                "strongestLocalMargin": max(
                    (v["margin"] for v in logical.values() if v["relation"] in ("TARGET_OVERLAP", "TARGET_ADJACENT", "SAME_LOCAL_ERROR_REGION")),
                    default="",
                ),
                "strongestDistantMargin": max((x["margin"] for x in case_clear), default=""),
            }
        )

    for cid in keep_controls:
        path_results = []
        for (c, _pid), spans in groups.items():
            if c != cid:
                continue
            path_results.extend(replay_path(model, vocab, spans))
        retries = [r for r in path_results if r.get("decision") == "RETRY" and not r.get("isAnchor")]
        if retries:
            keep_false += 1
        seen = {}
        for r in retries:
            s0 = int(r.get("rawStart") or 0)
            s1 = int(r.get("rawEnd") or 0)
            surf = r.get("surface") or ""
            margin = float(r.get("margin") if r.get("margin") is not None else (float(r.get("retryLogit", 0)) - float(r.get("keepLogit", 0))))
            key = logical_key({"rawStart": s0, "rawEnd": s1, "surface": surf, "isAnchor": False})
            seen[key] = max(seen.get(key, -1e9), margin)
            if keep_max_margin is None or margin > keep_max_margin:
                keep_max_margin = margin
        keep_logical += len(seen)

    strong = sum(1 for m in clear_fp_margins if m >= 3)
    moderate = sum(1 for m in clear_fp_margins if 1 <= m < 3)
    weak = sum(1 for m in clear_fp_margins if 0 <= m < 1)
    affected = len({r["caseId"] for r in distant_fp_rows})

    # surface pattern among strong distant FP
    strong_surfs = Counter(r["surface"] for r in distant_fp_rows if r["bucket"] == "STRONG")
    pattern = "isolated_or_mixed"
    if strong_surfs and strong_surfs.most_common(1)[0][1] >= 3:
        pattern = "repeated_surface_shortcut"
    elif strong >= 8 and affected >= 8:
        pattern = "broad_over_retry"
    elif strong <= 3:
        pattern = "limited_natural_fp"

    return {
        "eligible": len(elig),
        "anyRetryCases": any_retry_cases,
        "L1_exactTargetOverlapCases": l1_cases,
        "L2_localErrorRegionCases": l2_cases,
        "L3": {
            "affectedCases": affected,
            "logicalUniqueSpans": len(clear_fp_logical),
            "STRONG": strong,
            "MODERATE": moderate,
            "WEAK": weak,
            "meanMargin": statistics.mean(clear_fp_margins) if clear_fp_margins else None,
            "medianMargin": statistics.median(clear_fp_margins) if clear_fp_margins else None,
            "maxMargin": max(clear_fp_margins) if clear_fp_margins else None,
            "systematicPattern": pattern,
            "topStrongSurfaces": strong_surfs.most_common(10),
        },
        "L4": {
            "falseRetryCases": keep_false,
            "controls": len(keep_controls),
            "logicalSpans": keep_logical,
            "maxMargin": keep_max_margin,
        },
        "anchorRetryViolation": anchor_retry,
        "caseRows": case_rows,
        "distantFpRows": distant_fp_rows,
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


def surface_shortcut(model, test_samples: list[dict], vocab: dict, label: str) -> list[dict]:
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
    for surf, d in sorted(by_surface.items(), key=lambda x: -(x[1]["KEEP"] + x[1]["RETRY"]))[:50]:
        support = d["KEEP"] + d["RETRY"]
        rows.append(
            {
                "model": label,
                "surface": surf,
                "true_keep": d["KEEP"],
                "true_retry": d["RETRY"],
                "pred_retry": d["pred_retry"],
                "one_sided_true": d["RETRY"] == 0 or d["KEEP"] == 0,
                "pred_retry_rate": round(d["pred_retry"] / support, 4) if support else 0,
            }
        )
    return rows


def eval_ckpt(name: str, ckpt: Path, data: Path, with_loc: bool = False) -> dict:
    model, vocab = load_bundle(ckpt)
    test = load_split_from(data, "test")
    loader = DataLoader(
        UtteranceDataset(test, vocab),
        batch_size=64,
        shuffle=False,
        collate_fn=lambda b: collate_batch(b, torch.device("cpu")),
    )
    formal = compute_metrics(model, loader, torch.device("cpu"))
    lat = latency_ms(model, test, vocab)
    tm = {}
    mp = ckpt / "training_metrics.json"
    if mp.exists():
        tm = json.loads(mp.read_text(encoding="utf-8"))
    out = {
        "name": name,
        "modelId": tm.get("modelId") or name,
        "formal": formal,
        "latency": lat,
        "bestEpoch": tm.get("bestEpoch"),
        "weightsSha256": tm.get("weightsSha256"),
        "families": json.loads((data / "dataset_manifest.json").read_text(encoding="utf-8")).get("families")
        if (data / "dataset_manifest.json").exists()
        else None,
        "surface": surface_shortcut(model, test, vocab, name),
    }
    if with_loc:
        out["localization"] = protected_localization(model, vocab)
    return out


def decide(s1: dict, s2: dict, s3: dict) -> tuple[str, str]:
    f1g = s3["formal"]["retry_f1"] - s2["formal"]["retry_f1"]
    recg = s3["formal"]["retry_recall"] - s2["formal"]["retry_recall"]
    loc = s3["localization"]
    l2 = loc["L2_localErrorRegionCases"]
    l3 = loc["L3"]["logicalUniqueSpans"]
    l3s = loc["L3"]["STRONG"]
    l4 = loc["L4"]["falseRetryCases"]
    if loc["anchorRetryViolation"]:
        return "ANCHOR_OWNERSHIP_VIOLATION", "STOP_AND_REVIEW"
    if l4 > 0:
        return "S3_LOCALIZATION_DISTRIBUTION_AUDIT_REQUIRED", "MODEL3_V2_S3_LOCALIZATION_DISTRIBUTION_AUDIT"
    if l2 < 11 and l3s >= S2_L3_STRONG + 5:
        return "S3_SYSTEMATIC_LOCALIZATION_FAILURE" if False else "S3_LOCALIZATION_DISTRIBUTION_AUDIT_REQUIRED", "MODEL3_V2_S3_LOCALIZATION_DISTRIBUTION_AUDIT"
    if l3s >= S2_L3_STRONG + 8 or (l3 >= S2_L3_LOGICAL + 15 and l3s > S2_L3_STRONG):
        return "S3_LOCALIZATION_DISTRIBUTION_AUDIT_REQUIRED", "MODEL3_V2_S3_LOCALIZATION_DISTRIBUTION_AUDIT"
    diminishing = abs(f1g) < 0.02 and abs(recg) < 0.03 and l2 >= 12 and l3 <= S2_L3_LOGICAL + 5
    productive = (f1g >= 0.02 or recg >= 0.03 or l3s < S2_L3_STRONG or l3 < S2_L3_LOGICAL) and l2 >= 12 and l4 == 0
    if productive and not diminishing:
        if l3 > 0:
            return "S3_LOCALIZATION_PASS_WITH_NONBLOCKING_FALSE_POSITIVES", "S3_MODEL_ACCEPTANCE_AUDIT"
        return "S3_BUILD_AND_TRAIN_PASS_READY_FOR_MODEL_ACCEPTANCE", "S3_MODEL_ACCEPTANCE_AUDIT"
    if diminishing:
        return "S3_BUILD_AND_TRAIN_PASS_DIMINISHING_RETURNS", "MODEL3_V2_S3_GENERALIZATION_LIMIT_AUDIT"
    if f1g < -0.03 and l2 < S2_L2_BASELINE:
        return "S3_REAL_GENERALIZATION_REGRESSION", "STOP_AND_REVIEW"
    if productive:
        return "S3_BUILD_AND_TRAIN_PASS_SCALE_STILL_PRODUCTIVE", "S3B_DATA_SCALE_DECISION"
    return "S3_GENERALIZATION_LIMIT_AUDIT_REQUIRED", "MODEL3_V2_S3_GENERALIZATION_LIMIT_AUDIT"


def main() -> int:
    print("[eval] S1...", flush=True)
    s1 = eval_ckpt("S1", S1_CKPT, S1_DATA, with_loc=False)
    print("[eval] S2...", flush=True)
    s2 = eval_ckpt("S2", S2_CKPT, S2_DATA, with_loc=True)
    print("[eval] S3...", flush=True)
    s3 = eval_ckpt("S3", S3_CKPT, S3_DATA, with_loc=True)
    verdict, next_phase = decide(s1, s2, s3)

    # learning curve csv
    with (DOCS / "model3_v2_s1_s2_s3_learning_curve.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "scale",
                "modelId",
                "families",
                "retry_precision",
                "retry_recall",
                "retry_f1",
                "keep_precision",
                "keep_recall",
                "pred_retry_rate",
                "true_retry_rate",
                "L1",
                "L2",
                "L3_logical",
                "L3_strong",
                "L4",
                "per_span_ms_p50",
            ]
        )
        for tag, r in (("S1", s1), ("S2", s2), ("S3", s3)):
            loc = r.get("localization") or {}
            l3 = loc.get("L3") or {}
            l4 = loc.get("L4") or {}
            w.writerow(
                [
                    tag,
                    r["modelId"],
                    r.get("families"),
                    round(r["formal"]["retry_precision"], 4),
                    round(r["formal"]["retry_recall"], 4),
                    round(r["formal"]["retry_f1"], 4),
                    round(r["formal"]["keep_precision"], 4),
                    round(r["formal"]["keep_recall"], 4),
                    round(r["formal"]["pred_retry_rate"], 4),
                    round(r["formal"]["true_retry_rate"], 4),
                    loc.get("L1_exactTargetOverlapCases", ""),
                    loc.get("L2_localErrorRegionCases", ""),
                    l3.get("logicalUniqueSpans", ""),
                    l3.get("STRONG", ""),
                    l4.get("falseRetryCases", ""),
                    round(r["latency"]["per_span_ms_p50"], 4),
                ]
            )

    # protected localization csv
    with (DOCS / "model3_v2_s3_protected_localization.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=list(s3["localization"]["caseRows"][0].keys()) if s3["localization"]["caseRows"] else ["caseId"],
        )
        w.writeheader()
        for row in s3["localization"]["caseRows"]:
            w.writerow(row)

    with (DOCS / "model3_v2_s3_distant_fp_analysis.csv").open("w", encoding="utf-8", newline="") as f:
        fields = [
            "caseId",
            "surface",
            "start",
            "end",
            "relation",
            "grounding",
            "margin",
            "bucket",
            "candidateCount",
            "pathDup",
        ]
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in s3["localization"]["distantFpRows"]:
            w.writerow({k: row.get(k) for k in fields})

    # update summary
    summary_path = DOCS / "model3_v2_production_core_s3_summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8")) if summary_path.exists() else {}
    summary.update(
        {
            "trainingCompleted": True,
            "s3Model": {
                "modelId": s3["modelId"],
                "weightsSha256": s3["weightsSha256"],
                "bestEpoch": s3["bestEpoch"],
            },
            "learningCurve": {
                "s1": {"formal": s1["formal"], "families": s1.get("families")},
                "s2": {"formal": s2["formal"], "families": s2.get("families"), "localization": {k: v for k, v in s2["localization"].items() if k not in ("caseRows", "distantFpRows")}},
                "s3": {"formal": s3["formal"], "families": s3.get("families"), "localization": {k: v for k, v in s3["localization"].items() if k not in ("caseRows", "distantFpRows")}},
            },
            "verdict": verdict,
            "nextPhase": next_phase,
            "diminishingReturns": "DIMINISHING" in verdict,
            "runtimeLogicChanged": False,
            "featureChanged": False,
            "thresholdTuned": False,
        }
    )
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(
        json.dumps(
            {
                "verdict": verdict,
                "nextPhase": next_phase,
                "s3_formal_f1": s3["formal"]["retry_f1"],
                "s2_formal_f1": s2["formal"]["retry_f1"],
                "L1": s3["localization"]["L1_exactTargetOverlapCases"],
                "L2": s3["localization"]["L2_localErrorRegionCases"],
                "L3": s3["localization"]["L3"],
                "L4": s3["localization"]["L4"],
            },
            indent=2,
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
