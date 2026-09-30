# -*- coding: utf-8 -*-
"""Deterministic group split — no random row split."""

from __future__ import annotations

import hashlib
from typing import Iterable


def stable_bucket(key: str, seed: int) -> float:
    h = hashlib.sha256(f"{seed}|{key}".encode("utf-8")).hexdigest()
    return int(h[:12], 16) / float(16**12)


def assign_split(split_group_key: str, seed: int, ratios=(0.8, 0.1, 0.1)) -> str:
    r = stable_bucket(split_group_key, seed)
    t, d = ratios[0], ratios[0] + ratios[1]
    if r < t:
        return "train"
    if r < d:
        return "dev"
    return "test"


def leakage_report(samples: Iterable[dict]) -> dict:
    by_split: dict[str, list[dict]] = {"train": [], "dev": [], "test": []}
    for s in samples:
        by_split.setdefault(s["split"], []).append(s)

    def ids(split: str, field: str) -> set[str]:
        return {x[field] for x in by_split.get(split, []) if x.get(field)}

    pairs = [("train", "dev"), ("train", "test"), ("dev", "test")]
    src_leak = {f"{a}_{b}": sorted(ids(a, "sourceSentenceId") & ids(b, "sourceSentenceId")) for a, b in pairs}
    cg_leak = {f"{a}_{b}": sorted(ids(a, "contrastGroupId") & ids(b, "contrastGroupId")) for a, b in pairs}

    # surface pair leakage (report only)
    def surface_pairs(split: str) -> set[tuple[str, str]]:
        out: set[tuple[str, str]] = set()
        for s in by_split.get(split, []):
            for c in s.get("corruptions") or []:
                out.add((c["referenceSurface"], c["errorSurface"]))
        return out

    sp = {f"{a}_{b}": len(surface_pairs(a) & surface_pairs(b)) for a, b in pairs}
    return {
        "sourceSentenceId_leakage": {k: len(v) for k, v in src_leak.items()},
        "sourceSentenceId_leakage_ids_sample": {k: v[:5] for k, v in src_leak.items()},
        "contrastGroupId_leakage": {k: len(v) for k, v in cg_leak.items()},
        "surface_pair_cross_split_counts": sp,
        "source_sentence_leakage_total": sum(len(v) for v in src_leak.values()),
        "contrast_group_leakage_total": sum(len(v) for v in cg_leak.values()),
    }
