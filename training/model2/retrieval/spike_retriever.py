"""Phase 7E — R1 deterministic profile-conditioned lexicon retrieval.

Markers: PHASE7E_RECALL_SPIKE / NOT_FOR_RUNTIME / NOT_FROZEN / SPIKE_ONLY
"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from training.model2.candidates.index import CandidateIndexMetaV1
from training.model2.contract import FUZZY_DISTANCE_THRESHOLD, FUZZY_LEN_DELTA_MAX
from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool
from training.model2.retrieval.profile_query import ExpandedQuery, generate_profile_queries


@dataclass
class ProfileRetrievalConfig:
    max_active_profile_relations_per_span: int = 2
    max_generated_phonetic_queries: int = 8
    max_new_candidates_per_query: int = 8
    max_total_profile_candidates: int = 8
    distance_threshold: int = FUZZY_DISTANCE_THRESHOLD
    len_delta_max: int = FUZZY_LEN_DELTA_MAX
    # SPIKE_ONLY strength: lower retrieval cost priority for higher strength
    strength_priority: bool = True


@dataclass
class ProfileRetrievalHit:
    term_id: str
    surface: str
    syllables: list[str]
    distance: int
    prior_score: float
    provenance: str = "PROFILE_RETRIEVAL"
    retrieval_query: list[str] = field(default_factory=list)
    profile_relation_used: str = ""
    reverse_family_applied: str = ""
    strength: float = 0.0
    retrieval_score: float = 0.0  # lower better

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ProfileRetrievalResult:
    queries: list[ExpandedQuery]
    hits: list[ProfileRetrievalHit]
    n_queries: int
    n_new_candidates: int
    latency_ms: float
    index_calls: int

    def term_ids(self) -> list[str]:
        return [h.term_id for h in self.hits]


def _hit_score(distance: int, strength: float, prior: float, *, strength_priority: bool) -> float:
    # retrieval cost: distance primary; higher strength slightly preferred
    s_pen = (1.0 - min(1.0, max(0.0, strength))) * 0.1 if strength_priority else 0.0
    return float(distance) + s_pen - 1e-4 * float(prior)


def retrieve_profile_candidates(
    index: CandidateIndexMetaV1,
    observed_syllables: list[str],
    phonetic_bias: Optional[dict[str, float]],
    *,
    base_term_ids: Optional[set[str]] = None,
    cfg: Optional[ProfileRetrievalConfig] = None,
) -> ProfileRetrievalResult:
    """R1: profile reverse-map → FuzzyPool-style lexicon queries → new candidates only."""
    cfg = cfg or ProfileRetrievalConfig()
    base = set(base_term_ids or ())
    t0 = time.perf_counter()
    queries = generate_profile_queries(
        observed_syllables,
        phonetic_bias,
        max_active_relations=cfg.max_active_profile_relations_per_span,
        max_queries=cfg.max_generated_phonetic_queries,
        include_identity_query=False,
    )
    scored: list[ProfileRetrievalHit] = []
    index_calls = 0
    for q in queries:
        if not q.syllables:
            continue
        req = FuzzyPoolRequestV1(
            span_text="",
            span_syllables=list(q.syllables),
            span_syllable_count=len(q.syllables),
            max_pool_size=cfg.max_new_candidates_per_query,
            distance_threshold=cfg.distance_threshold,
            len_delta_max=cfg.len_delta_max,
        )
        pool = build_fuzzy_pool(index, req)
        index_calls += 1
        for h in pool.hits:
            if h.term_id in base:
                continue
            scored.append(
                ProfileRetrievalHit(
                    term_id=h.term_id,
                    surface=h.surface,
                    syllables=list(h.syllables),
                    distance=int(h.distance),
                    prior_score=float(h.prior_score),
                    retrieval_query=list(q.syllables),
                    profile_relation_used=q.relation_used,
                    reverse_family_applied=q.reverse_family_applied,
                    strength=float(q.strength),
                    retrieval_score=_hit_score(
                        int(h.distance),
                        float(q.strength),
                        float(h.prior_score),
                        strength_priority=cfg.strength_priority,
                    ),
                )
            )

    # Dedup by term_id keeping best retrieval_score
    best: dict[str, ProfileRetrievalHit] = {}
    for h in scored:
        prev = best.get(h.term_id)
        if prev is None or h.retrieval_score < prev.retrieval_score:
            best[h.term_id] = h
    uniq = sorted(best.values(), key=lambda x: (x.retrieval_score, x.term_id))
    uniq = uniq[: cfg.max_total_profile_candidates]
    latency_ms = (time.perf_counter() - t0) * 1000.0
    return ProfileRetrievalResult(
        queries=queries,
        hits=uniq,
        n_queries=len(queries),
        n_new_candidates=len(uniq),
        latency_ms=latency_ms,
        index_calls=index_calls,
    )


@dataclass
class MergedCandidate:
    term_id: str
    surface: str
    syllables: list[str]
    provenances: list[str]
    base_distance: Optional[int] = None
    profile_retrieval_score: Optional[float] = None
    profile_relation_used: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def merge_pools(
    base_hits: list[Any],
    profile_hits: list[ProfileRetrievalHit],
) -> list[MergedCandidate]:
    """term_id-authoritative merge; provenance list may contain BASE_FUZZY + PROFILE_RETRIEVAL."""
    by_id: dict[str, MergedCandidate] = {}
    for h in base_hits:
        tid = h.term_id if hasattr(h, "term_id") else h["term_id"]
        surface = h.surface if hasattr(h, "surface") else h.get("surface", "")
        syls = list(h.syllables if hasattr(h, "syllables") else h.get("syllables") or [])
        dist = int(h.distance) if hasattr(h, "distance") else h.get("distance")
        by_id[tid] = MergedCandidate(
            term_id=tid,
            surface=surface,
            syllables=syls,
            provenances=["BASE_FUZZY"],
            base_distance=dist,
        )
    for h in profile_hits:
        if h.term_id in by_id:
            m = by_id[h.term_id]
            if "PROFILE_RETRIEVAL" not in m.provenances:
                m.provenances.append("PROFILE_RETRIEVAL")
            m.profile_retrieval_score = h.retrieval_score
            m.profile_relation_used = h.profile_relation_used
        else:
            by_id[h.term_id] = MergedCandidate(
                term_id=h.term_id,
                surface=h.surface,
                syllables=list(h.syllables),
                provenances=["PROFILE_RETRIEVAL"],
                profile_retrieval_score=h.retrieval_score,
                profile_relation_used=h.profile_relation_used,
            )
    return list(by_id.values())
