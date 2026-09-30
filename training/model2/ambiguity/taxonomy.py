"""AmbiguityClass V1 — derived dataset labels, not Model2 input features."""

from __future__ import annotations

from typing import Any, Optional


AMBIGUITY_CLASSES = (
    "EQUAL_DISTANCE",
    "NEAR_TIE",
    "SAME_SIMILAR_PINYIN",
    "CONTEXT_DISAMBIGUATED",
    "NON_AMBIGUOUS",
)


def fuzzy_ambiguity_score(
    *,
    target_distance: Optional[int],
    distances: list[Optional[int]],
    target_index: Optional[int],
) -> dict[str, Any]:
    """Simple derived score: is target uniquely owned by deterministic distance?"""
    numeric = [d for d in distances if d is not None]
    if target_distance is None or not numeric:
        return {
            "num_candidates_at_best_distance": 0,
            "score_gap_target_vs_best_other": None,
            "num_candidates_within_margin": 0,
            "pool_entropy_proxy": 0.0,
            "target_is_unique_nearest": False,
        }
    best = min(numeric)
    at_best = sum(1 for d in numeric if d == best)
    others = [
        d
        for i, d in enumerate(distances)
        if d is not None and i != target_index
    ]
    best_other = min(others) if others else None
    gap = None if best_other is None else (best_other - target_distance)
    within = sum(1 for d in others if d is not None and abs(d - target_distance) <= 1)
    # crude entropy proxy: share of pool at best distance
    entropy_proxy = at_best / max(1, len(numeric))
    unique = target_distance == best and at_best == 1
    return {
        "num_candidates_at_best_distance": at_best,
        "score_gap_target_vs_best_other": gap,
        "num_candidates_within_margin": within,
        "pool_entropy_proxy": entropy_proxy,
        "target_is_unique_nearest": unique,
        "target_distance": target_distance,
        "best_distance": best,
        "best_other_distance": best_other,
    }


def classify_ambiguity(
    *,
    target_distance: Optional[int],
    distances: list[Optional[int]],
    target_index: Optional[int],
    span_syllables: list[str],
    candidate_pinyins: list[list[str]],
) -> str:
    """Assign AmbiguityClass V1. CONTEXT_DISAMBIGUATED is a subset of near/equal."""
    score = fuzzy_ambiguity_score(
        target_distance=target_distance,
        distances=distances,
        target_index=target_index,
    )
    if target_distance is None:
        return "NON_AMBIGUOUS"
    gap = score["score_gap_target_vs_best_other"]
    at_best = score["num_candidates_at_best_distance"]
    unique = score["target_is_unique_nearest"]

    similar_pinyin = False
    if span_syllables and candidate_pinyins:
        q = tuple(span_syllables)
        n_sim = 0
        for pys in candidate_pinyins:
            if not pys:
                continue
            # high similarity: same length and <=1 subst
            if len(pys) == len(q):
                diff = sum(a != b for a, b in zip(q, tuple(pys)))
                if diff <= 1:
                    n_sim += 1
        similar_pinyin = n_sim >= 2

    # Unique nearest (even if runner-up is distance+1) is NOT ranking-ambiguous
    # for beating B_pool_distance.
    if unique:
        return "NON_AMBIGUOUS"
    if gap == 0 or at_best >= 2:
        return "EQUAL_DISTANCE"
    if gap is not None and gap <= 1:
        return "NEAR_TIE"
    if similar_pinyin:
        return "SAME_SIMILAR_PINYIN"
    return "NEAR_TIE"


def is_ambiguous_class(cls: str) -> bool:
    return cls in ("EQUAL_DISTANCE", "NEAR_TIE", "SAME_SIMILAR_PINYIN", "CONTEXT_DISAMBIGUATED")
