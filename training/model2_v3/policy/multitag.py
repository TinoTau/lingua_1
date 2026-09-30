"""Stage D2: preserve multi-tag domain evidence without inventing SSOT mappings."""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Optional

from training.model2.candidates.index import CandidateIndexMetaV1, CandidateRecord
from training.model2.contract import DOMAIN_SLOT_IDS
from training.model2.training.dataset import load_candidate_index


def load_ssot_word_domains(csv_path: Path) -> dict[str, set[str]]:
    by: dict[str, set[str]] = defaultdict(set)
    if not csv_path.exists():
        return {}
    for r in csv.DictReader(csv_path.open(encoding="utf-8")):
        w = (r.get("word") or "").strip()
        d = (r.get("domain_id") or "").strip()
        if w and d and d in DOMAIN_SLOT_IDS:
            by[w].add(d)
    return dict(by)


def enrich_index_multitag(
    index: CandidateIndexMetaV1,
    *,
    ssot_csv: Optional[Path] = None,
) -> dict[str, Any]:
    """Re-aggregate domain tags onto CandidateRecords.

    Does NOT create a new domain mapping SSOT.
    Sources of truth for tags:
      1) sibling domain_lexicon flatten rows (same surface+pinyin)
      2) optional term_domain_tags CSV (authoritative multi-tag facts)
    """
    before_multi = sum(1 for r in index.records if len(r.domain_ids or []) > 1)

    # Group domain-type by surface|pinyin
    groups: dict[str, list[CandidateRecord]] = defaultdict(list)
    for r in index.records:
        if r.term_type != "domain":
            continue
        key = f"{r.surface}\t{r.pinyin_key}"
        groups[key].append(r)

    sibling_merged = 0
    for key, recs in groups.items():
        tags: list[str] = []
        seen: set[str] = set()
        for r in recs:
            for d in r.domain_ids or []:
                if d not in seen:
                    seen.add(d)
                    tags.append(d)
        if len(tags) > 1:
            sibling_merged += 1
            for r in recs:
                r.domain_ids = list(tags)

    ssot_applied = 0
    if ssot_csv is not None:
        word_doms = load_ssot_word_domains(ssot_csv)
        for r in index.records:
            extra = word_doms.get(r.surface) or set()
            if not extra:
                continue
            merged = list(r.domain_ids or [])
            seen = set(merged)
            changed = False
            for d in sorted(extra):
                if d not in seen:
                    merged.append(d)
                    seen.add(d)
                    changed = True
            if changed or len(merged) > len(r.domain_ids or []):
                if len(merged) > 1 or (r.term_type == "domain" and merged):
                    r.domain_ids = merged
                    if len(merged) > 1:
                        ssot_applied += 1

    index.rebuild_indexes()
    after_multi = sum(1 for r in index.records if len(r.domain_ids or []) > 1)
    tag_lens = [len(r.domain_ids or []) for r in index.records if r.term_type == "domain"]
    tag_lens_sorted = sorted(tag_lens) or [0]

    def pct(p: float) -> float:
        if not tag_lens_sorted:
            return 0.0
        i = min(len(tag_lens_sorted) - 1, int(round((p / 100) * (len(tag_lens_sorted) - 1))))
        return float(tag_lens_sorted[i])

    stats = {
        "total_terms": len(index.records),
        "domain_type_terms": sum(1 for r in index.records if r.term_type == "domain"),
        "single_tag_terms": sum(1 for r in index.records if len(r.domain_ids or []) == 1),
        "multi_tag_terms": after_multi,
        "multi_tag_ratio": after_multi / max(1, len(index.records)),
        "multi_tag_ratio_among_domain_type": after_multi
        / max(1, sum(1 for r in index.records if r.term_type == "domain")),
        "tags_per_domain_term_mean": sum(tag_lens) / max(1, len(tag_lens)),
        "tags_per_domain_term_P50": pct(50),
        "tags_per_domain_term_P95": pct(95),
        "tags_per_domain_term_max": max(tag_lens) if tag_lens else 0,
        "before_multi_tag_records": before_multi,
        "sibling_groups_merged": sibling_merged,
        "ssot_csv_applied_touches": ssot_applied,
        "PASS": after_multi > 0,
    }
    return stats


def domains_for_surface(index: CandidateIndexMetaV1, surface: str) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for h in index.by_surface.get(surface) or []:
        for d in h.domain_ids or []:
            if d not in seen:
                seen.add(d)
                tags.append(d)
    return tags


def aggregate_domain_evidence(
    personal_terms: list[str],
    index: CandidateIndexMetaV1,
    *,
    term_evidence: Optional[dict[str, float]] = None,
    mode: str = "normalized_weighted_multitag",
) -> dict[str, float]:
    """Compare aggregation modes for Stage D2.

    A. first_tag_only
    B. uniform_multitag
    C. normalized_weighted_multitag (preferred)
    """
    scores = {d: 0.0 for d in DOMAIN_SLOT_IDS}
    evid = term_evidence or {}
    for t in personal_terms:
        hits = index.by_surface.get(t) or []
        if not hits:
            continue
        w = float(evid.get(t, 1.0))
        w = max(0.05, min(1.0, w))
        # union tags across sibling records (post-enrich)
        tags: list[str] = []
        seen: set[str] = set()
        for h in hits:
            for d in h.domain_ids or []:
                if d in scores and d not in seen:
                    seen.add(d)
                    tags.append(d)
        if not tags:
            continue
        if mode == "first_tag_only":
            scores[tags[0]] += w
        elif mode == "uniform_multitag":
            share = w / float(len(tags))
            for d in tags:
                scores[d] += share
        else:  # normalized_weighted_multitag
            share = w / float(len(tags))
            for d in tags:
                scores[d] += share
    s = sum(scores.values())
    if s > 0:
        scores = {k: v / s for k, v in scores.items()}
    return scores


def top_domain_concentration(evidence: dict[str, float]) -> dict[str, float]:
    vals = sorted((float(v) for v in evidence.values() if float(v) > 0), reverse=True)
    if not vals:
        return {"top1": 0.0, "top2": 0.0, "entropy": 0.0, "n_nonzero": 0}
    import math

    s = sum(vals)
    probs = [v / s for v in vals]
    ent = -sum(p * math.log(p + 1e-12) for p in probs)
    return {
        "top1": probs[0],
        "top2": probs[1] if len(probs) > 1 else 0.0,
        "entropy": ent,
        "n_nonzero": len(probs),
        "SINGLE_TERM_DOMINANCE_RISK": probs[0] >= 0.85 and len(probs) >= 1,
    }
