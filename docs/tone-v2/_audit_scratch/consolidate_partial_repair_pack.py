#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Consolidate Partial Repair Admission audit pack to ≤10 files."""
from __future__ import annotations

import csv
import json
from pathlib import Path

OUT = Path(
    "/mnt/d/Programs/github/lingua_1/docs/acceptance/Audit/"
    "2026-08-05_Partial_Repair_Candidate_Admission_Audit"
)


def read_csv(name: str) -> list[dict]:
    p = OUT / name
    if not p.exists() or p.stat().st_size == 0:
        return []
    with p.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_merged(name: str, sections: list[tuple[str, list[dict]]]) -> None:
    fields: list[str] = ["section"]
    seen = {"section"}
    for _, rows in sections:
        for r in rows:
            for k in r:
                if k not in seen:
                    seen.add(k)
                    fields.append(k)
    out = []
    for section, rows in sections:
        for r in rows:
            row = {k: "" for k in fields}
            row["section"] = section
            row.update(r)
            out.append(row)
    with (OUT / name).open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(out)
    print(name, len(out))


write_merged(
    "assembly_and_fallback_trace.csv",
    [
        ("assembly_path", read_csv("assembly_path_inventory.csv")),
        ("raw_fallback_role", read_csv("raw_fallback_role_trace.csv")),
    ],
)
write_merged(
    "scoring_cap_responsibility.csv",
    [
        ("pre_kenlm_scoring", read_csv("pre_kenlm_scoring_inventory.csv")),
        ("cap_and_dedupe", read_csv("cap_and_dedupe_matrix.csv")),
        ("responsibility_overlap", read_csv("responsibility_overlap_matrix.csv")),
    ],
)
write_merged(
    "budget_cases_and_root_cause.csv",
    [
        ("budget", read_csv("candidate_budget_distribution.csv")),
        ("partial_trace", read_csv("partial_repair_case_trace.csv")),
        ("complete_trace", read_csv("complete_repair_case_trace.csv")),
        ("root_cause", read_csv("root_cause_summary.csv")),
    ],
)

# fold options + contrast into report/summary
summary = json.loads((OUT / "summary.json").read_text(encoding="utf-8"))
if (OUT / "_contrast_samples.json").exists():
    summary["contrastSamples"] = json.loads((OUT / "_contrast_samples.json").read_text(encoding="utf-8"))
summary["packFiles"] = [
    "README.md",
    "report.md",
    "summary.json",
    "minimal_adjustment_options.md",
    "candidate_repair_provenance.csv",
    "candidate_repair_classification.csv",
    "assembly_and_fallback_trace.csv",
    "scoring_cap_responsibility.csv",
    "budget_cases_and_root_cause.csv",
]
# 9 files — under 10. Keep provenance+classification separate (large/critical).
(OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

keep = set(summary["packFiles"])
deleted = []
for p in OUT.iterdir():
    if p.is_file() and p.name not in keep:
        p.unlink()
        deleted.append(p.name)
print("deleted", deleted)
print("remaining", sorted(x.name for x in OUT.iterdir() if x.is_file()))
