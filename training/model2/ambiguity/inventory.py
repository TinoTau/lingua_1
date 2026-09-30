"""Offline ambiguous-term inventory from CandidateIndex (FuzzyPool V1 frozen)."""

from __future__ import annotations

from typing import Any

from training.model2.candidates.index import CandidateIndexMetaV1, CandidateRecord
from training.model2.contract import FUZZY_DISTANCE_THRESHOLD, FUZZY_POOL_MAX_CANDIDATES
from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool


def _pool_for(index: CandidateIndexMetaV1, rec: CandidateRecord):
    req = FuzzyPoolRequestV1(
        span_text=rec.surface,
        span_syllables=rec.syllables,
        span_syllable_count=rec.syllable_count,
        max_pool_size=FUZZY_POOL_MAX_CANDIDATES,
        distance_threshold=FUZZY_DISTANCE_THRESHOLD,
        lexicon_snapshot_id=index.lexicon_snapshot_id,
    )
    return build_fuzzy_pool(index, req)


def inventory_record(index: CandidateIndexMetaV1, rec: CandidateRecord) -> dict[str, Any]:
    pool = _pool_for(index, rec)
    neighbors = [h for h in pool.hits if h.surface != rec.surface]
    d1 = [h for h in neighbors if h.distance == 1]
    d2 = [h for h in neighbors if h.distance == 2]
    higher_prior = [h for h in neighbors if h.prior_score > rec.prior_score]
    equal_d0 = [h for h in pool.hits if h.distance == 0]
    # Truncated query proxy (common ASR 1-char / drop-last errors)
    trunc_unique = True
    if rec.syllables:
        q = rec.syllables[: max(1, len(rec.syllables) - 1)] if len(rec.syllables) > 1 else rec.syllables
        treq = FuzzyPoolRequestV1(
            span_text=rec.surface[:1],
            span_syllables=q,
            span_syllable_count=len(q),
            max_pool_size=FUZZY_POOL_MAX_CANDIDATES,
            distance_threshold=FUZZY_DISTANCE_THRESHOLD,
            lexicon_snapshot_id=index.lexicon_snapshot_id,
        )
        tpool = build_fuzzy_pool(index, treq)
        if tpool.hits:
            best = tpool.hits[0]
            # unique nearest if only one at best distance and it is this term
            best_d = best.distance
            at = [h for h in tpool.hits if h.distance == best_d]
            trunc_unique = len(at) == 1 and at[0].surface == rec.surface

    n_comp = len(neighbors)
    # Truncated queries are almost never unique; do not use that as the sole flag.
    # Prefer terms with several d=1 competitors (true ranking ambiguity).
    ambiguous = (
        len(d1) >= 4
        or len(equal_d0) >= 2
        or len(higher_prior) >= 3
    )
    return {
        "term": rec.surface,
        "term_id": rec.term_id,
        "pinyin_key": rec.pinyin_key,
        "syllable_count": rec.syllable_count,
        "term_type": rec.term_type,
        "domain_ids": rec.domain_ids,
        "prior_score": rec.prior_score,
        "n_fuzzy_neighbors": n_comp,
        "n_equal_distance_d0": max(0, len(equal_d0) - 1),
        "n_near_d1": len(d1),
        "n_near_d2": len(d2),
        "n_higher_prior_neighbors": len(higher_prior),
        "trunc_query_unique_nearest": trunc_unique,
        "competitors": [
            {
                "surface": h.surface,
                "term_id": h.term_id,
                "distance": h.distance,
                "prior_score": h.prior_score,
                "pinyin_key": h.pinyin_key,
                "domain_overlap": bool(set(rec.domain_ids) & set(
                    index.by_term_id.get(h.term_id).domain_ids
                    if index.by_term_id.get(h.term_id)
                    else []
                )),
                "same_syllable_count": h.syllable_count == rec.syllable_count,
            }
            for h in neighbors[:12]
        ],
        "prefer_ambiguous": ambiguous,
        "ambiguity_rank_key": (
            0 if not trunc_unique else 1,
            -len(d1),
            -len(higher_prior),
            -n_comp,
            rec.prior_score,
        ),
    }


def build_ambiguous_inventory(
    index: CandidateIndexMetaV1,
    *,
    records: list[CandidateRecord] | None = None,
) -> list[dict[str, Any]]:
    recs = records if records is not None else [
        r for r in index.records if r.term_type == "domain" and 2 <= len(r.surface) <= 5
    ]
    out = [inventory_record(index, r) for r in recs]
    out.sort(key=lambda x: x["ambiguity_rank_key"])
    return out
