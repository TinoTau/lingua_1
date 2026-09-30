"""Authoritative FineSpan Model2 retrieval path (Phase 7G).

Markers: PHASE7G / AUTHORITATIVE_PATH / NO_WHOLE_UTTERANCE

Single path:
  FineSpan → normalize → base FuzzyPool
           → profile-expanded queries (span-local) → same FuzzyPool
           → PROFILE_RETRIEVAL candidates → merge by term_id
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from training.model2.candidates.index import CandidateIndexMetaV1
from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.normalize import normalize_syllable_sequence_for_lookup
from training.model2.retrieval.profile_query import generate_profile_queries
from training.model2.retrieval.spike_retriever import (
    ProfileRetrievalConfig,
    ProfileRetrievalHit,
    merge_pools,
    retrieve_profile_candidates,
)
from training.model2.stage_b.active_feature_mask import (
    BOUND_FEATURES_V1,
    REVERSED_FEATURES_V1,
    WEAK_FEATURES_V1,
)


@dataclass
class RelationCoveragePolicy:
    """Stagewise active set — NOT the full UserProfile contract."""

    active_set: str = "BOUND_FEATURES_V1"
    active_relations: tuple[str, ...] = BOUND_FEATURES_V1
    deferred: dict[str, tuple[str, ...]] = field(
        default_factory=lambda: {
            "WEAK_FEATURES_V1": WEAK_FEATURES_V1,
            "REVERSED_FEATURES_V1": REVERSED_FEATURES_V1,
        }
    )
    note: str = (
        "BOUND-only is PHASE7G staged active set (SPIKE_ONLY_LIMIT inherited). "
        "WEAK/REVERSED remain schema-eligible; not deleted."
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "active_set": self.active_set,
            "active_relations": list(self.active_relations),
            "deferred": {k: list(v) for k, v in self.deferred.items()},
            "note": self.note,
        }


DEFAULT_RELATION_POLICY = RelationCoveragePolicy()


@dataclass
class FineSpanRetrievalResult:
    span: FineSpanView
    base_term_ids: list[str]
    profile_hits: list[ProfileRetrievalHit]
    merged_term_ids: list[str]
    base_only_ids: list[str]
    profile_only_ids: list[str]
    n_queries: int
    relations_used: list[str]
    queries: list[list[str]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "span": self.span.to_dict(),
            "base_term_ids": self.base_term_ids,
            "profile_hits": [h.to_dict() for h in self.profile_hits],
            "merged_term_ids": self.merged_term_ids,
            "base_only_ids": self.base_only_ids,
            "profile_only_ids": self.profile_only_ids,
            "n_queries": self.n_queries,
            "relations_used": self.relations_used,
            "queries": self.queries,
        }


def base_retrieve_span(
    index: CandidateIndexMetaV1,
    span: FineSpanView,
    *,
    cfg: Optional[ProfileRetrievalConfig] = None,
) -> list[str]:
    cfg = cfg or ProfileRetrievalConfig()
    syls = normalize_syllable_sequence_for_lookup(span.span_syllables)
    if not syls:
        return []
    req = FuzzyPoolRequestV1(
        span_text=span.window_text or "",
        span_syllables=syls,
        span_syllable_count=len(syls),
        max_pool_size=16,
        distance_threshold=cfg.distance_threshold,
        len_delta_max=cfg.len_delta_max,
    )
    return [h.term_id for h in build_fuzzy_pool(index, req).hits]


def retrieve_for_finespan(
    index: CandidateIndexMetaV1,
    span: FineSpanView,
    phonetic_bias: Optional[dict[str, float]],
    *,
    cfg: Optional[ProfileRetrievalConfig] = None,
    relation_policy: Optional[RelationCoveragePolicy] = None,
) -> FineSpanRetrievalResult:
    """Authoritative per-FineSpan Model2 retrieval (local expansion only)."""
    cfg = cfg or ProfileRetrievalConfig()
    policy = relation_policy or DEFAULT_RELATION_POLICY
    # Filter bias to active staged set
    bias = {
        k: float(v)
        for k, v in dict(phonetic_bias or {}).items()
        if k in policy.active_relations and float(v) > 0
    }
    base_ids = base_retrieve_span(index, span, cfg=cfg)
    pr = retrieve_profile_candidates(
        index,
        span.span_syllables,
        bias,
        base_term_ids=set(base_ids),
        cfg=cfg,
    )
    # Ensure generate_profile_queries used BOUND via active_relations_from_bias default —
    # retrieve_profile_candidates already uses BOUND_FEATURES_V1 in generate_profile_queries.
    merged = merge_pools(
        [
            type("H", (), {"term_id": tid, "surface": "", "syllables": [], "distance": 0})()
            for tid in base_ids
        ],
        pr.hits,
    )
    merged_ids = [m.term_id for m in merged]
    prof_ids = set(pr.term_ids())
    base_set = set(base_ids)
    return FineSpanRetrievalResult(
        span=span,
        base_term_ids=base_ids,
        profile_hits=pr.hits,
        merged_term_ids=merged_ids,
        base_only_ids=[t for t in base_ids if t not in prof_ids],
        profile_only_ids=[t for t in pr.term_ids() if t not in base_set],
        n_queries=pr.n_queries,
        relations_used=[q.relation_used for q in pr.queries if q.relation_used],
        queries=[list(q.syllables) for q in pr.queries],
    )


def retrieve_utterance_via_finespans(
    index: CandidateIndexMetaV1,
    spans: list[FineSpanView],
    phonetic_bias: Optional[dict[str, float]],
    target_term_id: str,
    *,
    cfg: Optional[ProfileRetrievalConfig] = None,
    max_spans_scan: int = 12,
) -> dict[str, Any]:
    """Run authoritative path over FineSpans.

    Span ordering uses only profile applicability + span length — NOT target identity.
    `target_term_id` is evaluation/label only (hit check).
    """
    from training.model2.retrieval.profile_query import hypothesize_intended_syllables
    from training.model2.stage_b.active_feature_mask import BOUND_FEATURES_V1

    cfg = cfg or ProfileRetrievalConfig()
    bias = {
        k: float(v)
        for k, v in dict(phonetic_bias or {}).items()
        if k in BOUND_FEATURES_V1 and float(v) > 0
    }

    def _applicable(sp: FineSpanView) -> bool:
        for fam in bias:
            _, n = hypothesize_intended_syllables(sp.span_syllables, fam)
            if n > 0:
                return True
        return False

    # Runtime-safe order: applicable first, then shorter windows (cheaper / more precise)
    ordered = sorted(
        spans,
        key=lambda s: (
            0 if _applicable(s) else 1,
            len(s.span_syllables),
            s.syllable_start,
        ),
    )
    # Cap: prefer applicable subset when available
    applicable = [s for s in ordered if _applicable(s)]
    scan_list = (applicable or ordered)[:max_spans_scan]

    target_in_any_base = False
    target_in_any_profile_new = False
    winning = None
    all_profile_new: set[str] = set()
    n_queries = 0
    traces = []
    for sp in scan_list:
        r = retrieve_for_finespan(index, sp, phonetic_bias, cfg=cfg)
        n_queries += r.n_queries
        all_profile_new |= set(r.profile_only_ids)
        in_base = target_term_id in set(r.base_term_ids)
        if in_base:
            target_in_any_base = True
        if target_term_id in set(r.profile_only_ids):
            target_in_any_profile_new = True
            winning = r
            traces.append(
                {
                    "span_id": sp.span_id,
                    "window_text": sp.window_text,
                    "span_syllables": sp.span_syllables,
                    "in_base": in_base,
                    "in_profile_hits": True,
                    "profile_only": True,
                    "n_queries": r.n_queries,
                    "queries": r.queries,
                    "relations": r.relations_used,
                }
            )
            break
        traces.append(
            {
                "span_id": sp.span_id,
                "window_text": sp.window_text,
                "span_syllables": sp.span_syllables,
                "in_base": in_base,
                "in_profile_hits": target_term_id in {h.term_id for h in r.profile_hits},
                "profile_only": False,
                "n_queries": r.n_queries,
                "queries": r.queries,
                "relations": r.relations_used,
            }
        )
        if len(traces) >= max_spans_scan:
            break
    return {
        "target_in_any_base": target_in_any_base,
        "target_introduced_profile_only": target_in_any_profile_new,
        "target_visible_after_model2": target_in_any_base or target_in_any_profile_new,
        "n_spans": len(spans),
        "n_spans_scanned": len(traces),
        "n_queries_total": n_queries,
        "n_profile_new_union": len(all_profile_new),
        "winning_span": winning.to_dict() if winning else None,
        "span_traces_head": traces[:12],
    }
