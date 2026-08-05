#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""READ ONLY — Repair Completeness Formula Freeze: case matrix from traces."""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path("/mnt/d/Programs/github/lingua_1")
OUT = ROOT / "docs/acceptance/Audit/2026-08-05_Repair_Completeness_Formula_Freeze_Audit"
TRACE = ROOT / "docs/tone-v2/_audit_scratch/dialog200_sentence_assembly_trace"
OUT.mkdir(parents=True, exist_ok=True)


def load(cid: str) -> dict:
    return json.loads((TRACE / f"{cid[1:]}.json").read_text(encoding="utf-8"))


def slot_flags(bucket_spans: list) -> list[dict]:
    """Per FineSpan: repairable if sameDomain or base has non-empty alt beyond spanText."""
    slots = []
    for sp in bucket_spans:
        text = sp.get("spanText") or ""
        alts = list(dict.fromkeys((sp.get("sameDomain") or []) + (sp.get("base") or [])))
        # repair candidates = budgeted/sameDomain/base words that differ from spanText
        repair_alts = [a for a in alts if a and a != text]
        # also check budgeted for non-raw options
        budgeted = sp.get("budgeted") or []
        for b in budgeted:
            if b != text and b not in repair_alts:
                # if appears in sameDomain/base it's repair; if only budgeted equal span skip
                if b in alts or b in (sp.get("sameDomain") or []):
                    repair_alts.append(b)
        # deterministic: repairable if any sameDomain/base entry differs from spanText
        # OR budgeted contains a word != spanText that is in sameDomain
        repairable = len(repair_alts) > 0 or any(
            (w != text) for w in (sp.get("sameDomain") or []) + (sp.get("base") or [])
        )
        # simplify
        domain_or_base = (sp.get("sameDomain") or []) + (sp.get("base") or [])
        non_canonical_options = [w for w in dict.fromkeys(domain_or_base) if w != text]
        repairable = len(non_canonical_options) > 0
        slots.append(
            {
                "spanText": text,
                "repairable": repairable,
                "nonCanonicalOptions": non_canonical_options,
                "budgeted": budgeted,
            }
        )
    return slots


def analyze_combo(raw: str, combo: dict, slots: list[dict]) -> dict:
    reps = combo.get("replacements") or []
    repairs = []
    for r in reps:
        if not isinstance(r, dict):
            continue
        span = r.get("span") or {}
        word = r.get("word") or ""
        span_text = span.get("text") or ""
        if r.get("repairTarget") and word != span_text:
            repairs.append({"spanText": span_text, "word": word, "start": span.get("start"), "end": span.get("end")})
        elif word and span_text and word != span_text:
            repairs.append({"spanText": span_text, "word": word, "start": span.get("start"), "end": span.get("end")})

    repaired_span_texts = {r["spanText"] for r in repairs}
    repairable = [s for s in slots if s["repairable"]]
    raw_only = [s for s in slots if not s["repairable"]]
    selected_repairable = [s for s in repairable if s["spanText"] in repaired_span_texts]
    # unrepaired: repairable but this combo did not apply a non-canonical replacement covering that span
    unrepaired = [s for s in repairable if s["spanText"] not in repaired_span_texts]

    repair_pick_count = len(repairs)
    unrepaired_n = len(unrepaired)
    repairable_n = len(repairable)
    raw_only_n = len(raw_only)

    # Formula A
    if repair_pick_count == 0:
        fa = "RAW"
    elif unrepaired_n == 0:
        fa = "COMPLETE_SELECTION"  # raw-only may remain
    else:
        fa = "PARTIAL_SELECTION"

    # Formula B — adjacent repairable clusters (by slot index adjacency among repairable only)
    clusters = []
    cur = []
    for i, s in enumerate(slots):
        if s["repairable"]:
            cur.append(i)
        else:
            if cur:
                clusters.append(cur)
                cur = []
    if cur:
        clusters.append(cur)

    def cluster_status(idxs):
        reps_hit = 0
        unrepaired_hit = 0
        for i in idxs:
            st = slots[i]["spanText"]
            if st in repaired_span_texts:
                reps_hit += 1
            else:
                unrepaired_hit += 1
        if reps_hit == 0:
            return "untouched"
        if unrepaired_hit == 0:
            return "complete"
        return "partial"

    cluster_states = [cluster_status(c) for c in clusters]
    if repair_pick_count == 0:
        fb = "RAW"
    elif any(s == "partial" for s in cluster_states):
        fb = "PARTIAL_SELECTION"
    elif any(s == "complete" for s in cluster_states):
        fb = "COMPLETE_SELECTION"
    else:
        fb = "RAW"

    # Formula C — ratio
    total_rep_len = sum(len(s["spanText"]) for s in repairable) or 0
    repaired_len = sum(len(s["spanText"]) for s in selected_repairable)
    ratio = (repaired_len / total_rep_len) if total_rep_len else 1.0
    if repair_pick_count == 0:
        fc = "RAW"
    elif ratio >= 1.0:
        fc = "COMPLETE_SELECTION"
    elif ratio >= 0.5:
        fc = "PARTIAL_SELECTION"  # arbitrary threshold — for comparison only
    else:
        fc = "PARTIAL_SELECTION"

    return {
        "repairableSlots": "|".join(s["spanText"] for s in repairable) or "(none)",
        "selectedRepairSlots": "|".join(s["spanText"] for s in selected_repairable) or "(none)",
        "unrepairedRepairableSlots": "|".join(s["spanText"] for s in unrepaired) or "(none)",
        "rawOnlySlotsSample": "|".join(s["spanText"] for s in raw_only[:8]) + ("|..." if len(raw_only) > 8 else ""),
        "repairableSlotCount": repairable_n,
        "unrepairedRepairableSlotCount": unrepaired_n,
        "rawOnlySlotCount": raw_only_n,
        "repairPickCount": repair_pick_count,
        "clusterCount": len(clusters),
        "clusterStates": "|".join(cluster_states) or "(none)",
        "formulaA": fa,
        "formulaB": fb,
        "formulaC": fc,
        "formulaC_ratio": round(ratio, 4),
    }


# Cases of interest
targets = [
    ("d043", "候选声城", "SEMANTIC_PARTIAL_AUDIT_EXPECT"),  # offline expectation only
    ("d088", "候选声城", "SEMANTIC_PARTIAL_AUDIT_EXPECT"),
    ("d019", "候选生城", "SEMANTIC_PARTIAL_AUDIT_EXPECT"),
    ("d044", "上线计划已经确认", "STRUCTURAL_COMPLETE_EXPECT"),
    ("d044", "周四商务", "SEMANTIC_OR_STRUCTURAL_PARTIAL_EXPECT"),
    ("d043", None, "RAW"),  # raw text combo
]

rows = []
for cid, text_substr, expected in [
    ("d043", "候选声城", "SEMANTIC_PARTIAL_offline_only"),
    ("d088", "候选声城", "SEMANTIC_PARTIAL_offline_only"),
    ("d133", "候选声城", "SEMANTIC_PARTIAL_offline_only"),
    ("d178", "候选声城", "SEMANTIC_PARTIAL_offline_only"),
    ("d019", "候选生城", "SEMANTIC_PARTIAL_offline_only"),
    ("d020", "候选生城", "SEMANTIC_PARTIAL_offline_only"),
    ("d044", "上线计划已经确认，上线计划评审安排在周四上午", "STRUCTURAL_COMPLETE_offline"),
    ("d044", "上线计划已经确认，上线计划评审安排在周四商务", "CHECK_STRUCTURAL"),
    ("d044", "这周的上线计花已经确认，上线计划评审安排在周四上午", "CHECK_PARTIAL_OR_COMPLETE"),
    ("d007", None, "RAW_offline"),
]:
    t = load(cid)
    raw = t["rawText"]
    spans = (t.get("buckets") or [{}])[0].get("spans") or []
    slots = slot_flags(spans)
    combos = t.get("uniqueBeforeCap") or []
    matched = []
    for i, c in enumerate(combos):
        text = c.get("text") or ""
        if text_substr is None:
            if text == raw:
                matched.append((i, c))
        elif text_substr in text:
            matched.append((i, c))
    if not matched and text_substr is None:
        # synthesize raw analysis
        matched = [(-1, {"text": raw, "replacements": []})]
    for i, c in matched[:2]:
        a = analyze_combo(raw, c, slots)
        rows.append(
            {
                "caseId": cid,
                "candidateId": f"{cid}:u{i}",
                "candidateText": (c.get("text") or "")[:80],
                "rawText": raw[:60],
                **a,
                "expectedAuditClass": expected,
                "semanticPartialDetectable": a["formulaA"] == "PARTIAL_SELECTION",
            }
        )

with (OUT / "formula_case_matrix.csv").open("w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

# print key lines
for r in rows:
    if "候选声" in r["candidateText"] or "候选生" in r["candidateText"] or "计划已经确认" in r["candidateText"] or r["candidateText"] == r["rawText"][:80]:
        print(
            r["caseId"],
            r["formulaA"],
            "unrepaired=",
            r["unrepairedRepairableSlots"],
            "repairable=",
            r["repairableSlots"],
            "|",
            r["candidateText"][:40],
        )
print("rows", len(rows))
