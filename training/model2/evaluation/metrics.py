"""Evaluation metrics for Stage A probe."""

from __future__ import annotations

from typing import Any, Sequence


def recall_at_k(ranks: Sequence[int], k: int) -> float:
    if not ranks:
        return 0.0
    return sum(1 for r in ranks if 0 <= r < k) / len(ranks)


def mrr(ranks: Sequence[int]) -> float:
    if not ranks:
        return 0.0
    s = 0.0
    for r in ranks:
        if r >= 0:
            s += 1.0 / (r + 1)
    return s / len(ranks)


def summarize_ranking(ranks: Sequence[int], pool_sizes: Sequence[int]) -> dict[str, Any]:
    return {
        "n": len(ranks),
        "Recall@1": recall_at_k(ranks, 1),
        "Recall@3": recall_at_k(ranks, 3),
        "Recall@4": recall_at_k(ranks, 4),
        "MRR": mrr(ranks),
        "Positive_average_pool_size": sum(pool_sizes) / max(1, len(pool_sizes)),
        "FuzzyPool_Recall@16_ceiling": sum(1 for r in ranks if r >= 0) / max(1, len(ranks)),
    }


def percentile(xs: Sequence[float], p: float) -> float:
    if not xs:
        return float("nan")
    ys = sorted(xs)
    if len(ys) == 1:
        return ys[0]
    idx = int(round((p / 100.0) * (len(ys) - 1)))
    return ys[max(0, min(len(ys) - 1, idx))]
