"""Candidate-level personal / domain features for Model2 scoring (Stage A/B)."""

from __future__ import annotations

import time
from typing import Optional, Sequence

from training.model2.candidates.index import CandidateRecord
from training.model2.contract import PERSONAL_SIM_TOP_N, PERSONAL_TERMS_MAX
from training.model2.phonetic.syllables import (
    levenshtein_syllables,
    syllables_key,
    text_to_syllables,
)


def syllable_similarity(a: list[str], b: list[str]) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    dist = levenshtein_syllables(a, b)
    return 1.0 - dist / max(len(a), len(b))


def personal_features_for_candidate(
    candidate: CandidateRecord,
    personal_terms: Sequence[str],
    personal_term_syllables: Optional[dict[str, list[str]]] = None,
    *,
    top_n: int = PERSONAL_SIM_TOP_N,
) -> list[float]:
    """Return [exact_match, syllable_sim_max, evidence_rank_proxy].

    evidence_rank_proxy: 1 - rank/100 if in list else 0 (list order = evidence order).
    """
    terms = list(personal_terms)[:PERSONAL_TERMS_MAX]
    exact = 1.0 if candidate.surface in terms else 0.0
    rank_proxy = 0.0
    if exact:
        rank = terms.index(candidate.surface)
        rank_proxy = 1.0 - rank / float(PERSONAL_TERMS_MAX)

    sim_max = 0.0
    cand_syl = candidate.syllables
    for t in terms[:top_n]:
        if personal_term_syllables and t in personal_term_syllables:
            ts = personal_term_syllables[t]
        else:
            ts = text_to_syllables(t)
        sim_max = max(sim_max, syllable_similarity(cand_syl, ts))
    return [exact, sim_max, rank_proxy]


def domain_features_for_candidate(
    candidate: CandidateRecord,
    active_domain: Optional[str],
) -> list[float]:
    """Return [domain_match, domain_tag_weight_proxy]."""
    if not candidate.domain_ids:
        return [0.0, 0.0]
    match = 1.0 if active_domain and active_domain in candidate.domain_ids else 0.0
    # prior_score already in [0,1]-ish; clamp
    weight = max(0.0, min(1.0, float(candidate.prior_score)))
    return [match, weight]


def benchmark_personal_sim(
    candidates: Sequence[CandidateRecord],
    personal_terms: Sequence[str],
    top_ns: Sequence[int] = (20, 50, 100),
) -> dict:
    """Micro-benchmark Top-N personal syllable_sim_max."""
    # Precompute syllables via lexicon-like path
    pt_syl = {t: text_to_syllables(t) for t in personal_terms}
    results = {}
    for n in top_ns:
        t0 = time.perf_counter()
        calls = 0
        feats = []
        for c in candidates:
            terms = list(personal_terms)[:n]
            calls += len(terms)
            feats.append(
                personal_features_for_candidate(c, personal_terms, pt_syl, top_n=n)
            )
        elapsed = (time.perf_counter() - t0) * 1000.0
        results[n] = {
            "top_n": n,
            "candidates": len(candidates),
            "personal_terms_used": min(n, len(personal_terms)),
            "similarity_calls": calls,
            "wall_ms": elapsed,
            "features_sample": feats[:3],
        }
    # Difference: how many candidates change sim when going 20→100
    if 20 in results and 100 in results:
        f20 = [
            personal_features_for_candidate(c, personal_terms, pt_syl, top_n=20)[1]
            for c in candidates
        ]
        f100 = [
            personal_features_for_candidate(c, personal_terms, pt_syl, top_n=100)[1]
            for c in candidates
        ]
        changed = sum(1 for a, b in zip(f20, f100) if abs(a - b) > 1e-9)
        results["changed_sim_20_to_100"] = changed
        results["changed_rate"] = changed / max(1, len(candidates))
    return results
