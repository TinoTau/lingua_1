# -*- coding: utf-8 -*-
"""Finalize V2 real probe CSV + latency (validation-only)."""
from __future__ import annotations

import csv
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.eval_v2_checkpoint_offline import (
    DIALOG_JSONL,
    DOCS,
    V1_CKPT,
    V2_CKPT,
    infer_utterance_spans,
    load_bundle,
    load_inventory,
)

v1_m, v1_v, _ = load_bundle(V1_CKPT)
v2_m, v2_v, _ = load_bundle(V2_CKPT)
cases = [json.loads(l) for l in DIALOG_JSONL.open(encoding="utf-8") if l.strip()]
by_id = {c["id"]: c for c in cases}
inv = load_inventory()


def spans_of(case):
    return [
        {
            "surface": s.get("surface") or "",
            "isAnchor": bool(s.get("isAnchor")),
            "firstPassCandidateCount": int(s.get("firstPassCandidateCount") or s.get("cand") or 0),
        }
        for s in (case.get("span_margins") or [])
    ]


def time_all(model, vocab):
    t0 = time.time()
    n = 0
    for case in cases:
        spans = spans_of(case)
        if not spans:
            continue
        infer_utterance_spans(model, vocab, spans)
        n += 1
    return (time.time() - t0) * 1000 / max(n, 1), n


infer_utterance_spans(v1_m, v1_v, [{"surface": "测", "isAnchor": False, "firstPassCandidateCount": 1}])
infer_utterance_spans(v2_m, v2_v, [{"surface": "测", "isAnchor": False, "firstPassCandidateCount": 1}])
v1_ms, n = time_all(v1_m, v1_v)
v2_ms, _ = time_all(v2_m, v2_v)

probe_rows = []
v1_case_retry = v2_case_retry = elig = 0
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
    spans = spans_of(case)
    v1o = infer_utterance_spans(v1_m, v1_v, spans)
    v2o = infer_utterance_spans(v2_m, v2_v, spans)
    surf = r.get("probe_surface") or ""
    hit_v1 = next((x for x in v1o if not x["isAnchor"] and (not surf or x["surface"] == surf)), None)
    hit_v2 = next((x for x in v2o if not x["isAnchor"] and (not surf or x["surface"] == surf)), None)
    if hit_v1 is None:
        hit_v1 = next((x for x in v1o if not x["isAnchor"]), None)
    if hit_v2 is None:
        hit_v2 = next((x for x in v2o if not x["isAnchor"]), None)
    any_v2 = [x for x in v2o if not x["isAnchor"] and x["decision"] == "RETRY"]
    any_v1 = [x for x in v1o if not x["isAnchor"] and x["decision"] == "RETRY"]
    elig += 1
    if any_v1:
        v1_case_retry += 1
    if any_v2:
        v2_case_retry += 1
    probe_rows.append(
        {
            "caseId": r["caseId"],
            "surface": surf or (hit_v2["surface"] if hit_v2 else ""),
            "isAnchor": False,
            "audit_class": r["audit_class"],
            "confidence": r["confidence"],
            "expected": "RETRY",
            "v1_decision": hit_v1["decision"] if hit_v1 else "",
            "v1_margin": hit_v1["margin"] if hit_v1 else "",
            "v2_decision": hit_v2["decision"] if hit_v2 else "",
            "v2_margin": hit_v2["margin"] if hit_v2 else "",
            "v2_any_retry_surfaces": "|".join(f"{x['surface']}:{x['margin']:.2f}" for x in any_v2),
            "case_level_v2_retry": int(bool(any_v2)),
        }
    )

keep_controls = 0
v2_false = 0
for r in inv:
    if r.get("audit_class") != "NO_ERROR":
        continue
    case = by_id.get(r["caseId"])
    if not case:
        continue
    spans = spans_of(case)
    v1o = infer_utterance_spans(v1_m, v1_v, spans)
    v2o = infer_utterance_spans(v2_m, v2_v, spans)
    a = next((x for x in v1o if not x["isAnchor"]), None)
    b = next((x for x in v2o if not x["isAnchor"]), None)
    if not a or not b:
        continue
    keep_controls += 1
    if any(x["decision"] == "RETRY" for x in v2o if not x["isAnchor"]):
        v2_false += 1
    probe_rows.append(
        {
            "caseId": r["caseId"],
            "surface": a["surface"],
            "isAnchor": False,
            "audit_class": "NO_ERROR",
            "confidence": "HIGH",
            "expected": "KEEP",
            "v1_decision": a["decision"],
            "v1_margin": a["margin"],
            "v2_decision": b["decision"],
            "v2_margin": b["margin"],
            "v2_any_retry_surfaces": "",
            "case_level_v2_retry": 0,
        }
    )

out = DOCS / "model3_v2_real_probe_results.csv"
with out.open("w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(probe_rows[0].keys()))
    w.writeheader()
    w.writerows(probe_rows)

comp_path = DOCS / "model3_v2_v1_comparison.csv"
existing = []
if comp_path.exists():
    with comp_path.open(encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            # normalize older rows
            if "V1_on_V2labels" in row:
                existing.append(
                    {
                        "metric": row["metric"],
                        "V1": row["V1_on_V2labels"],
                        "V2": row["V2"],
                        "delta": row["delta"],
                    }
                )
            elif "V1" in row:
                existing.append(row)

extra = [
    {
        "metric": "real_elig_case_retry",
        "V1": v1_case_retry,
        "V2": v2_case_retry,
        "delta": v2_case_retry - v1_case_retry,
    },
    {
        "metric": "real_elig_case_recall",
        "V1": v1_case_retry / elig if elig else 0,
        "V2": v2_case_retry / elig if elig else 0,
        "delta": (v2_case_retry - v1_case_retry) / elig if elig else 0,
    },
    {
        "metric": "offline_latency_ms_per_utt",
        "V1": v1_ms,
        "V2": v2_ms,
        "delta": v2_ms - v1_ms,
    },
    {
        "metric": "false_retry_keep_controls",
        "V1": 0,
        "V2": v2_false,
        "delta": v2_false,
    },
]
# drop old real/latency rows then append
skip = {
    "real_elig_case_retry",
    "real_elig_case_recall",
    "offline_latency_ms_per_utt",
    "false_retry_keep_controls",
    "real_elig_retry_count",
    "real_false_retry_cases",
}
merged = [r for r in existing if r.get("metric") not in skip] + extra
with comp_path.open("w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["metric", "V1", "V2", "delta"])
    w.writeheader()
    for row in merged:
        w.writerow(row)

summary = {
    "eligible_cases": elig,
    "v1_case_retry": v1_case_retry,
    "v2_case_retry": v2_case_retry,
    "v1_case_recall": v1_case_retry / elig if elig else 0,
    "v2_case_recall": v2_case_retry / elig if elig else 0,
    "keep_controls": keep_controls,
    "v2_false_retry": v2_false,
    "latency_ms_per_utt": {"v1": v1_ms, "v2": v2_ms, "n": n},
}
(DOCS / "model3_v2_real_probe_summary.json").write_text(
    json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(json.dumps(summary, ensure_ascii=False, indent=2))
