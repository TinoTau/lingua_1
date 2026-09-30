"""FuzzyPool V1 — deterministic phonetic candidate generation independent of Exact Recall."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from training.model2.candidates.index import CandidateIndexMetaV1, CandidateRecord
from training.model2.contract import (
    FUZZY_DISTANCE_THRESHOLD,
    FUZZY_LEN_DELTA_MAX,
    FUZZY_POOL_MAX_CANDIDATES,
    FUZZY_POOL_VERSION,
)
from training.model2.phonetic.syllables import (
    levenshtein_syllables,
    normalize_syllable,
    parse_raw_pinyin,
    text_to_syllables,
)


@dataclass
class FuzzyPoolRequestV1:
    span_text: str
    span_syllables: list[str]
    span_syllable_count: int
    max_pool_size: int = FUZZY_POOL_MAX_CANDIDATES
    lexicon_snapshot_id: str = ""
    distance_threshold: int = FUZZY_DISTANCE_THRESHOLD
    len_delta_max: int = FUZZY_LEN_DELTA_MAX
    # Optional search-universe predicate. None = mixed index (base path).
    # When set, a record enters the pool iff ANY selected id is in domain_ids
    # (multi-tag; not first-tag-only). Empty tuple = empty universe.
    # This is NOT a UserProfile prior and does not change phonetic gates.
    allowed_domain_ids: Optional[tuple[str, ...]] = None


@dataclass
class FuzzyPoolHit:
    term_id: str
    surface: str
    pinyin_key: str
    syllables: list[str]
    distance: int
    syllable_count: int
    term_type: str
    prior_score: float


@dataclass
class FuzzyPoolResultV1:
    version: str
    request: dict[str, Any]
    hits: list[FuzzyPoolHit] = field(default_factory=list)
    pool_size: int = 0
    latency_ms: float = 0.0

    def term_ids(self) -> list[str]:
        return [h.term_id for h in self.hits]

    def contains_term_id(self, term_id: Optional[str]) -> bool:
        if not term_id:
            return False
        return term_id in set(self.term_ids())

    def contains_surface(self, surface: Optional[str]) -> bool:
        if not surface:
            return False
        return any(h.surface == surface for h in self.hits)


def syllables_from_span(
    span_text: str,
    span_pinyin: Optional[str] = None,
) -> list[str]:
    raw = parse_raw_pinyin(span_pinyin)
    if raw:
        return raw
    return text_to_syllables(span_text)


def build_fuzzy_pool(
    index: CandidateIndexMetaV1,
    req: FuzzyPoolRequestV1,
) -> FuzzyPoolResultV1:
    """Generate deterministic fuzzy pool from Lexicon candidate index.

    Does NOT use Exact Recall results. UserProfile does NOT affect generation.
    allowed_domain_ids only restricts the searchable universe; phonetic gates
    (distance, length, normalization, surface dedup) stay identical.
    """
    import time

    t0 = time.perf_counter()
    q = [normalize_syllable(s) for s in req.span_syllables if normalize_syllable(s)]
    qn = len(q)
    allowed = set(req.allowed_domain_ids) if req.allowed_domain_ids is not None else None
    if qn == 0 or allowed == set():
        return FuzzyPoolResultV1(
            version=FUZZY_POOL_VERSION,
            request=asdict(req),
            hits=[],
            pool_size=0,
            latency_ms=(time.perf_counter() - t0) * 1000.0,
        )

    # Length-compatible buckets
    candidates: list[CandidateRecord] = []
    for delta in range(-req.len_delta_max, req.len_delta_max + 1):
        candidates.extend(index.by_syllable_count.get(qn + delta, []))

    scored: list[FuzzyPoolHit] = []
    for c in candidates:
        if allowed is not None:
            rec_doms = c.domain_ids or []
            if not any(d in allowed for d in rec_doms):
                continue
        dist = levenshtein_syllables(q, c.syllables)
        if dist > req.distance_threshold:
            continue
        # Prefer exact surface match distance 0 always included
        scored.append(
            FuzzyPoolHit(
                term_id=c.term_id,
                surface=c.surface,
                pinyin_key=c.pinyin_key,
                syllables=c.syllables,
                distance=dist,
                syllable_count=c.syllable_count,
                term_type=c.term_type,
                prior_score=c.prior_score,
            )
        )

    # Deterministic sort: distance ASC, prior DESC, term_id ASC
    scored.sort(key=lambda h: (h.distance, -h.prior_score, h.term_id))
    # Deduplicate by surface keeping best
    seen_surface: set[str] = set()
    uniq: list[FuzzyPoolHit] = []
    for h in scored:
        if h.surface in seen_surface:
            continue
        seen_surface.add(h.surface)
        uniq.append(h)
        if len(uniq) >= req.max_pool_size:
            break

    latency_ms = (time.perf_counter() - t0) * 1000.0
    return FuzzyPoolResultV1(
        version=FUZZY_POOL_VERSION,
        request={
            **asdict(req),
            "span_syllables": q,
        },
        hits=uniq,
        pool_size=len(uniq),
        latency_ms=latency_ms,
    )


def exact_surface_in_index(index: CandidateIndexMetaV1, surface: str) -> bool:
    return bool(index.by_surface.get(surface))


def exact_hit_for_span(
    index: CandidateIndexMetaV1,
    span_text: str,
    span_syllables: list[str],
) -> Optional[CandidateRecord]:
    """Simulate Exact Recall visibility: same surface OR distance-0 pinyin match.

    Conservative proxy for Exact Recall hit (SQL exact). Not Exact Recall itself.
    """
    if span_text in index.by_surface:
        return index.resolve_surface(span_text)
    q = [normalize_syllable(s) for s in span_syllables]
    if not q:
        return None
    for c in index.by_syllable_count.get(len(q), []):
        if c.syllables == q and c.surface == span_text:
            return c
    return None
