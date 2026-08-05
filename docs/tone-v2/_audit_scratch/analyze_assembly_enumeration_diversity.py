#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""READ ONLY — Sentence Assembly Enumeration & Diversity statistics from dialog_200 traces."""
from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(r"d:/Programs/github/lingua_1")
TRACE = ROOT / "docs/tone-v2/_audit_scratch/dialog200_sentence_assembly_trace"
BENCH = ROOT / "docs/acceptance/Benchmark/2026-08-04_KenLM_Human_Validated_Benchmark/kenlm_benchmark.csv"
OUT = ROOT / "docs/acceptance/Audit/2026-08-05_Sentence_Assembly_Enumeration_Audit"
CAP = 16


def levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            ins = cur[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (0 if ca == cb else 1)
            cur.append(min(ins, delete, sub))
        prev = cur
    return prev[-1]


def token_edit(a: str, b: str) -> int:
    """Char-level Levenshtein as proxy for token difference on CJK."""
    return levenshtein(a, b)


def pairwise_min_diffs(texts: list[str]) -> list[dict]:
    rows = []
    for i in range(len(texts)):
        for j in range(i + 1, len(texts)):
            d = token_edit(texts[i], texts[j])
            rows.append({"i": i, "j": j, "edit": d, "a": texts[i], "b": texts[j]})
    return rows


def cluster_by_edit(texts: list[str], threshold: int) -> list[list[int]]:
    """Union-find clusters where edge exists if edit distance <= threshold."""
    n = len(texts)
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i in range(n):
        for j in range(i + 1, n):
            if token_edit(texts[i], texts[j]) <= threshold:
                union(i, j)
    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        groups[find(i)].append(i)
    return list(groups.values())


def load_competition_case_ids() -> set[str]:
    if not BENCH.exists():
        return set()
    with BENCH.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return {r["caseId"] for r in rows}


def analyze_case(path: Path) -> dict | None:
    data = json.loads(path.read_text(encoding="utf-8"))
    case_id = data.get("caseId") or f"d{path.stem}"
    kenlm = list(dict.fromkeys(data.get("kenlmInputTexts") or data.get("kenlm", {}).get("inputOnly") or []))
    assembly = list(dict.fromkeys(data.get("assemblyTexts") or []))
    unique_before = data.get("uniqueBeforeCap") or []
    unique_texts = []
    for c in unique_before:
        t = c.get("text") if isinstance(c, dict) else None
        if t and t not in unique_texts:
            unique_texts.append(t)
    if not kenlm and unique_texts:
        kenlm = unique_texts[:CAP]
    if not kenlm and assembly:
        kenlm = assembly[:CAP]

    buckets = data.get("buckets") or []
    domains = []
    for b in buckets:
        d = b.get("domainId") or b.get("domain")
        if d:
            domains.append(d)
    retained = data.get("retainedDomains") or []

    pairs = pairwise_min_diffs(kenlm) if len(kenlm) >= 2 else []
    edit_hist = Counter(p["edit"] for p in pairs)
    clusters1 = cluster_by_edit(kenlm, 1) if kenlm else []
    clusters2 = cluster_by_edit(kenlm, 2) if kenlm else []

    # Slots consumed by near-duplicates: size of largest edit<=1 cluster
    largest_near = max((len(c) for c in clusters1), default=0)
    near_dup_slots = sum(len(c) for c in clusters1 if len(c) > 1)
    singleton_slots = sum(1 for c in clusters1 if len(c) == 1)

    # Replacement diversity proxy: count distinct repair words across uniqueBeforeCap
    repair_surfaces = set()
    for c in unique_before:
        if not isinstance(c, dict):
            continue
        for r in c.get("replacements") or []:
            span = r.get("span") or {}
            word = r.get("word")
            src_text = span.get("text")
            if word and src_text and word != src_text:
                repair_surfaces.add(f"{span.get('start')}:{span.get('end')}:{word}")

    return {
        "caseId": case_id,
        "file": path.name,
        "kenlmCount": len(kenlm),
        "assemblyUniqueCount": len(assembly),
        "uniqueBeforeCapCount": len(unique_texts),
        "top16Fill": min(len(kenlm), CAP),
        "top16Unused": max(0, CAP - len(kenlm)),
        "distinctDomainsInBuckets": len(set(domains)),
        "retainedDomainCount": len(retained) if isinstance(retained, list) else 0,
        "retainedDomains": "|".join(retained) if isinstance(retained, list) else "",
        "pairCount": len(pairs),
        "pairsEdit0": edit_hist.get(0, 0),
        "pairsEdit1": edit_hist.get(1, 0),
        "pairsEdit2": edit_hist.get(2, 0),
        "pairsEdit3plus": sum(v for k, v in edit_hist.items() if k >= 3),
        "clusterCount_editLe1": len(clusters1),
        "largestNearDupCluster_editLe1": largest_near,
        "slotsInNearDupClusters_editLe1": near_dup_slots,
        "singletonSlots_editLe1": singleton_slots,
        "clusterCount_editLe2": len(clusters2),
        "largestCluster_editLe2": max((len(c) for c in clusters2), default=0),
        "distinctRepairSurfaces": len(repair_surfaces),
        "kenlmTexts": kenlm,
        "edit_hist": dict(edit_hist),
        "clusters1_sizes": sorted((len(c) for c in clusters1), reverse=True),
    }


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    competition = load_competition_case_ids()
    cases = []
    for p in sorted(TRACE.glob("*.json")):
        if p.name.startswith("_"):
            continue
        row = analyze_case(p)
        if row:
            cases.append(row)

    # --- candidate_slot_utilization.csv ---
    util_rows = []
    for c in cases:
        util_rows.append(
            {
                "caseId": c["caseId"],
                "isCompetitionCase": c["caseId"] in competition,
                "kenlmPoolSize": c["kenlmCount"],
                "top16Fill": c["top16Fill"],
                "top16UnusedSlots": c["top16Unused"],
                "fillRate": round(c["top16Fill"] / CAP, 4),
                "slotsInNearDupClusters_editLe1": c["slotsInNearDupClusters_editLe1"],
                "nearDupSlotShareOfPool": round(
                    c["slotsInNearDupClusters_editLe1"] / c["kenlmCount"], 4
                )
                if c["kenlmCount"]
                else 0,
                "largestNearDupCluster": c["largestNearDupCluster_editLe1"],
                "singletonSlots": c["singletonSlots_editLe1"],
                "distinctDomainsInBuckets": c["distinctDomainsInBuckets"],
                "retainedDomainCount": c["retainedDomainCount"],
                "distinctRepairSurfaces": c["distinctRepairSurfaces"],
            }
        )
    write_csv(
        OUT / "candidate_slot_utilization.csv",
        util_rows,
        list(util_rows[0].keys()) if util_rows else ["caseId"],
    )

    # --- candidate_similarity_analysis.csv (pairwise for competition cases with >=2) ---
    sim_rows = []
    for c in cases:
        if c["caseId"] not in competition and c["kenlmCount"] < 2:
            continue
        if c["kenlmCount"] < 2:
            continue
        texts = c["kenlmTexts"]
        for p in pairwise_min_diffs(texts):
            sim_rows.append(
                {
                    "caseId": c["caseId"],
                    "isCompetitionCase": c["caseId"] in competition,
                    "candidateIndexA": p["i"],
                    "candidateIndexB": p["j"],
                    "charEditDistance": p["edit"],
                    "diffBucket": (
                        "identical"
                        if p["edit"] == 0
                        else "1_char"
                        if p["edit"] == 1
                        else "2_char"
                        if p["edit"] == 2
                        else "3plus_char"
                    ),
                    "textA": p["a"],
                    "textB": p["b"],
                    "sameDomainPool": c["retainedDomainCount"] <= 1,
                    "retainedDomains": c["retainedDomains"],
                }
            )
    write_csv(
        OUT / "candidate_similarity_analysis.csv",
        sim_rows,
        [
            "caseId",
            "isCompetitionCase",
            "candidateIndexA",
            "candidateIndexB",
            "charEditDistance",
            "diffBucket",
            "textA",
            "textB",
            "sameDomainPool",
            "retainedDomains",
        ],
    )

    # --- candidate_cluster_statistics.csv ---
    cluster_rows = []
    for c in cases:
        cluster_rows.append(
            {
                "caseId": c["caseId"],
                "isCompetitionCase": c["caseId"] in competition,
                "poolSize": c["kenlmCount"],
                "clusterCount_editLe1": c["clusterCount_editLe1"],
                "largestCluster_editLe1": c["largestNearDupCluster_editLe1"],
                "clusterSizes_editLe1": "|".join(map(str, c["clusters1_sizes"])),
                "clusterCount_editLe2": c["clusterCount_editLe2"],
                "largestCluster_editLe2": c["largestCluster_editLe2"],
                "pairsEdit1": c["pairsEdit1"],
                "pairsEdit2": c["pairsEdit2"],
                "pairsEdit3plus": c["pairsEdit3plus"],
                "effectiveDiversity_editLe1_clusters": c["clusterCount_editLe1"],
                "replacementSurfaceCount": c["distinctRepairSurfaces"],
            }
        )
    write_csv(
        OUT / "candidate_cluster_statistics.csv",
        cluster_rows,
        list(cluster_rows[0].keys()) if cluster_rows else ["caseId"],
    )

    # --- candidate_duplication_matrix.csv ---
    # Aggregate duplication sources (contract-level + observed)
    dup_rows = [
        {
            "duplicationSource": "repair_subset_enumeration",
            "layer": "Assembly_buildSentenceCandidates",
            "mechanism": "All non-overlapping repair subsets of slot repairs → multiple paths can apply to same surface spans",
            "producesExactTextDup": "YES_possible",
            "removedBy": "Assembly_exact_text_Map_first_wins",
            "observedInDialog200": "YES",
        },
        {
            "duplicationSource": "multi_bucket_same_path",
            "layer": "Path_Assembly_per_bucket",
            "mechanism": "Each retained domain bucket calls buildSentenceCandidates independently; identical text can appear in multiple buckets",
            "producesExactTextDup": "YES_possible",
            "removedBy": "CrossPath_exact_text_first_wins",
            "observedInDialog200": "YES",
        },
        {
            "duplicationSource": "multi_path_same_text",
            "layer": "CrossPath_merge",
            "mechanism": "Different SegmentationPaths may produce identical sentence text",
            "producesExactTextDup": "YES_possible",
            "removedBy": "CrossPath_exact_text_first_wins",
            "observedInDialog200": "YES",
        },
        {
            "duplicationSource": "near_duplicate_one_token",
            "layer": "Assembly_enumeration",
            "mechanism": "Different repair picks yield sentences differing by 1–2 chars; exact-text dedup does NOT remove them",
            "producesExactTextDup": "NO",
            "removedBy": "NONE_retained_as_separate_slots",
            "observedInDialog200": "YES",
        },
        {
            "duplicationSource": "canonical_gap_fill_provenance",
            "layer": "Assembly_buildPathFromRepairs",
            "mechanism": "Gap canonical picks differ by path but final text may still collide after apply",
            "producesExactTextDup": "YES_possible",
            "removedBy": "Assembly_exact_text_Map_first_wins",
            "observedInDialog200": "YES",
        },
        {
            "duplicationSource": "KenLM_input",
            "layer": "KenLM",
            "mechanism": "KenLM does not generate or dedupe candidates",
            "producesExactTextDup": "N_A",
            "removedBy": "N_A_consume_only",
            "observedInDialog200": "N_A",
        },
    ]
    write_csv(
        OUT / "candidate_duplication_matrix.csv",
        dup_rows,
        list(dup_rows[0].keys()),
    )

    # Summary stats for report
    n = len(cases)
    comp = [c for c in cases if c["caseId"] in competition]
    pools = [c["kenlmCount"] for c in cases]
    comp_pools = [c["kenlmCount"] for c in comp]
    near_shares = [
        c["slotsInNearDupClusters_editLe1"] / c["kenlmCount"]
        for c in comp
        if c["kenlmCount"] >= 2
    ]
    fill_rates = [c["top16Fill"] / CAP for c in cases]

    # Competition pairwise buckets
    comp_sim = [r for r in sim_rows if r["isCompetitionCase"] is True or r["isCompetitionCase"] == True]
    # fix: isCompetitionCase is bool
    comp_sim = [r for r in sim_rows if r["caseId"] in competition]
    bucket_counts = Counter(r["diffBucket"] for r in comp_sim)

    multi_domain_comp = [c for c in comp if c["retainedDomainCount"] > 1]
    single_domain_comp = [c for c in comp if c["retainedDomainCount"] <= 1]

    summary = {
        "casesAnalyzed": n,
        "competitionCases": len(comp),
        "cap": CAP,
        "poolSize": {
            "all_mean": round(sum(pools) / n, 3) if n else 0,
            "all_median": sorted(pools)[n // 2] if n else 0,
            "all_max": max(pools) if pools else 0,
            "competition_mean": round(sum(comp_pools) / len(comp_pools), 3) if comp_pools else 0,
            "competition_median": sorted(comp_pools)[len(comp_pools) // 2] if comp_pools else 0,
            "competition_max": max(comp_pools) if comp_pools else 0,
            "competition_ge2": sum(1 for x in comp_pools if x >= 2),
            "all_eq1": sum(1 for x in pools if x == 1),
            "all_ge2": sum(1 for x in pools if x >= 2),
        },
        "top16Utilization": {
            "meanFillRate": round(sum(fill_rates) / len(fill_rates), 4) if fill_rates else 0,
            "casesWithUnusedSlots": sum(1 for c in cases if c["top16Unused"] > 0),
            "casesFull16": sum(1 for c in cases if c["top16Fill"] >= CAP),
            "meanUnusedSlots": round(sum(c["top16Unused"] for c in cases) / n, 3) if n else 0,
        },
        "nearDuplicateCompetition": {
            "meanNearDupSlotShare": round(sum(near_shares) / len(near_shares), 4) if near_shares else 0,
            "casesWithNearDupClusterGe2": sum(
                1 for c in comp if c["largestNearDupCluster_editLe1"] >= 2
            ),
            "meanLargestNearDupCluster": round(
                sum(c["largestNearDupCluster_editLe1"] for c in comp) / len(comp), 3
            )
            if comp
            else 0,
        },
        "competitionPairwiseDiffBuckets": dict(bucket_counts),
        "domainDiversity": {
            "competitionMultiRetainedDomain": len(multi_domain_comp),
            "competitionSingleRetainedDomain": len(single_domain_comp),
            "competitionMeanRetainedDomains": round(
                sum(c["retainedDomainCount"] for c in comp) / len(comp), 3
            )
            if comp
            else 0,
        },
        "verdictHint": "ASSEMBLY_CONTRACT_INCOMPLETE"
        if (
            (near_shares and sum(near_shares) / len(near_shares) > 0.3)
            or sum(1 for c in cases if c["top16Fill"] >= CAP) == 0
        )
        else "ASSEMBLY_READY_FOR_FREEZE",
    }

    (OUT / "_analysis_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
