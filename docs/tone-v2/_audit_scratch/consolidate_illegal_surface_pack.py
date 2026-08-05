#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Consolidate Illegal Surface audit pack to ≤10 files."""
from __future__ import annotations

import csv
import json
import shutil
from pathlib import Path

OUT = Path(
    "/mnt/d/Programs/github/lingua_1/docs/acceptance/Audit/"
    "2026-08-05_Illegal_Surface_and_SameDomain_Bucket_Audit"
)


def read_csv(name: str) -> list[dict]:
    p = OUT / name
    if not p.exists():
        return []
    with p.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_merged(name: str, sections: list[tuple[str, list[dict]]]) -> None:
    """Write multi-section CSV with section + all union columns."""
    all_fields: list[str] = ["section"]
    seen = {"section"}
    for _, rows in sections:
        for r in rows:
            for k in r.keys():
                if k not in seen:
                    seen.add(k)
                    all_fields.append(k)
    out_rows = []
    for section, rows in sections:
        for r in rows:
            row = {k: "" for k in all_fields}
            row["section"] = section
            for k, v in r.items():
                row[k] = v
            out_rows.append(row)
    with (OUT / name).open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=all_fields)
        w.writeheader()
        w.writerows(out_rows)
    print(f"wrote {name} rows={len(out_rows)}")


# 1) generation_trace.csv
write_merged(
    "generation_trace.csv",
    [
        ("stage_funnel", read_csv("generation_stage_funnel.csv")),
        ("window_query", read_csv("generation_window_query_trace.csv")),
        ("recall", read_csv("generation_recall_trace.csv")),
    ],
)

# 2) domain_bucket_trace.csv
write_merged(
    "domain_bucket_trace.csv",
    [
        ("membership", read_csv("domain_membership_trace.csv")),
        ("vote", read_csv("domain_vote_trace.csv")),
        ("same_domain_bucket", read_csv("same_domain_bucket_trace.csv")),
    ],
)

# 3) path_assembly_trace.csv
write_merged(
    "path_assembly_trace.csv",
    [
        ("edge_compatibility", read_csv("edge_compatibility_trace.csv")),
        ("segmentation_path", read_csv("segmentation_path_trace.csv")),
        ("assembly", read_csv("assembly_combination_trace.csv")),
        ("crosspath", read_csv("crosspath_trace.csv")),
        ("diagnostic_field_mapping", read_csv("diagnostic_field_mapping.csv")),
    ],
)

# 4) root_cause_and_quality.csv
write_merged(
    "root_cause_and_quality.csv",
    [
        ("root_cause", read_csv("root_cause_summary.csv")),
        ("replacement_quality_distribution", read_csv("replacement_quality_distribution.csv")),
    ],
)

# Enrich summary.json
summary_path = OUT / "summary.json"
summary = json.loads(summary_path.read_text(encoding="utf-8"))
focus = {}
if (OUT / "_focus_trace_identity.json").exists():
    focus = json.loads((OUT / "_focus_trace_identity.json").read_text(encoding="utf-8"))
sqlite = {}
if (OUT / "_sqlite_surface_probe.json").exists():
    probe = json.loads((OUT / "_sqlite_surface_probe.json").read_text(encoding="utf-8"))
    # keep compact
    for db in probe:
        if not db.get("exists"):
            continue
        surfaces = {}
        for s, v in (db.get("surfaces") or {}).items():
            surfaces[s] = {
                "rowCount": len(v.get("rows") or []),
                "domain_tags": v.get("domain_tags") or [],
                "ids": [r.get("id") for r in (v.get("rows") or []) if r.get("id")],
            }
        sqlite = {"path": db.get("path"), "surfaces": surfaces}
        break
summary["focusTraceIdentity"] = focus
summary["sqliteProbeCompact"] = sqlite
summary["packFiles"] = [
    "README.md",
    "report.md",
    "summary.json",
    "case_inventory.csv",
    "surface_lexicon_presence.csv",
    "character_provenance.csv",
    "generation_trace.csv",
    "domain_bucket_trace.csv",
    "path_assembly_trace.csv",
    "root_cause_and_quality.csv",
]
summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Append legacy fragment into report if not already present as dedicated file content
legacy = OUT / "legacy_fragment_callgraph.md"
report = OUT / "report.md"
if legacy.exists() and report.exists():
    rpt = report.read_text(encoding="utf-8")
    if "## Legacy Fragment Callgraph" not in rpt:
        body = legacy.read_text(encoding="utf-8")
        # strip title
        if body.startswith("# "):
            body = "\n".join(body.splitlines()[1:]).lstrip()
        report.write_text(
            rpt.rstrip()
            + "\n\n---\n\n## Legacy Fragment Callgraph\n\n"
            + body
            + "\n",
            encoding="utf-8",
        )

# Delete obsolete files
keep = set(summary["packFiles"])
deleted = []
for p in OUT.iterdir():
    if not p.is_file():
        continue
    if p.name not in keep:
        p.unlink()
        deleted.append(p.name)
print("deleted", deleted)
print("remaining", sorted(x.name for x in OUT.iterdir() if x.is_file()))
