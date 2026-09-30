"""Deterministic baselines: Exact visibility + FuzzyPool distance rank."""

from __future__ import annotations

from typing import Any, Optional

from training.model2.evaluation.metrics import summarize_ranking


def exact_recall_visibility(rows: list[dict[str, Any]], index_surfaces: set[str]) -> dict[str, Any]:
    """B_exact: whether span_text itself is an exact lexicon hit (visibility, not Model2)."""
    term_rows = [
        r
        for r in rows
        if r.get("is_term_positive")
        and r.get("source_type") == "TTS_ASR_SYNTHETIC"
        and r.get("target_in_pool")
    ]
    hits = 0
    for r in term_rows:
        if r["span_text"] in index_surfaces:
            hits += 1
    n = len(term_rows)
    return {
        "name": "B_exact",
        "n": n,
        "exact_span_in_lexicon_rate": hits / max(1, n),
        "note": "Exact Recall visibility on source span; not a Model2 score baseline.",
    }


def fuzzy_distance_ranks(row: dict[str, Any]) -> Optional[int]:
    """Rank target by (distance asc, -prior). Returns 0-based rank or None if missing."""
    tgt = row.get("positive_pool_index")
    if tgt is None or not row.get("target_in_pool"):
        return None
    dists = row.get("fuzzy_pool_distances") or []
    priors = row.get("fuzzy_pool_priors") or []
    n = len(row.get("fuzzy_pool_term_ids") or [])
    order = list(range(n))

    def key(i: int):
        d = dists[i] if i < len(dists) and dists[i] is not None else 10**9
        pr = priors[i] if i < len(priors) else 0.0
        return (d, -pr)

    order.sort(key=key)
    try:
        return order.index(int(tgt))
    except ValueError:
        return None


def fuzzy_prior_ranks(row: dict[str, Any]) -> Optional[int]:
    """Rank target by (-prior, distance). Strongest simple prior-aware heuristic."""
    tgt = row.get("positive_pool_index")
    if tgt is None or not row.get("target_in_pool"):
        return None
    dists = row.get("fuzzy_pool_distances") or []
    priors = row.get("fuzzy_pool_priors") or []
    n = len(row.get("fuzzy_pool_term_ids") or [])
    order = list(range(n))

    def key(i: int):
        d = dists[i] if i < len(dists) and dists[i] is not None else 10**9
        pr = priors[i] if i < len(priors) else 0.0
        return (-pr, d)

    order.sort(key=key)
    try:
        return order.index(int(tgt))
    except ValueError:
        return None


def evaluate_fuzzy_prior_baseline(rows: list[dict[str, Any]]) -> dict[str, Any]:
    term_rows = [
        r
        for r in rows
        if r.get("is_term_positive")
        and r.get("source_type") == "TTS_ASR_SYNTHETIC"
        and r.get("target_in_pool")
        and r.get("positive_pool_index") is not None
        and not r.get("context_target_leak")
    ]
    ranks = []
    pools = []
    for r in term_rows:
        rk = fuzzy_prior_ranks(r)
        ranks.append(-1 if rk is None else rk)
        pools.append(len(r.get("fuzzy_pool_term_ids") or []))
    metrics = summarize_ranking(ranks, pools)
    metrics["name"] = "B_pool_prior"
    return metrics


def evaluate_fuzzy_distance_baseline(rows: list[dict[str, Any]]) -> dict[str, Any]:
    term_rows = [
        r
        for r in rows
        if r.get("is_term_positive")
        and r.get("source_type") == "TTS_ASR_SYNTHETIC"
        and r.get("target_in_pool")
        and r.get("positive_pool_index") is not None
        and not r.get("context_target_leak")
    ]
    ranks = []
    pools = []
    for r in term_rows:
        rk = fuzzy_distance_ranks(r)
        ranks.append(-1 if rk is None else rk)
        pools.append(len(r.get("fuzzy_pool_term_ids") or []))
    metrics = summarize_ranking(ranks, pools)
    metrics["name"] = "B_pool_distance"
    return metrics
