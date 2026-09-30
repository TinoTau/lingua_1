"""Stage D domain / lexical retrieval actions — soft prior only (not hard gate).

Authoritative executor (StageDDomainConditionedRetrievalContractV1):
  FineSpan syllables + selected domain_ids
    → same FuzzyPool phonetic gates over records matching ANY selected tag
    → UNION unchanged base recall
    → identity dedup (StageDRetrievalTargetIdentityV1)
    → ONE per-FineSpan candidate budget

Lexicon domain facts come from CandidateRecord.domain_ids (term_domain_tags SSOT).
UserProfile stores personal_terms + strengths; domain evidence is derived, never
duplicated as SSOT. Evidence does NOT open a retrieval universe; Model2 must
select domain_soft:{slot} or domain_none.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Sequence

from training.model2.candidates.index import CandidateIndexMetaV1
from training.model2.contract import DOMAIN_SLOT_IDS
from training.model2.fuzzy.pool import FuzzyPoolHit, FuzzyPoolRequestV1, build_fuzzy_pool
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.normalize import normalize_syllable_sequence_for_lookup
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2_v3.policy.stage_d_target_identity_v1 import lexical_identity_key

STAGE_D_DOMAIN_RETRIEVAL_CONTRACT = "StageDDomainConditionedRetrievalContractV1"
PROVENANCE_BASE = "BASE_FUZZY"
PROVENANCE_DOMAIN = "PROFILE_DOMAIN_RETRIEVAL"
# Non-business safety cap on domain-universe FuzzyPool. Not a nested 32→8 cut.
DOMAIN_FUZZY_IMPLEMENTATION_SAFETY_CAP = 256
BASE_FUZZY_POOL_SIZE = 16
# Applied once after UNION for the single budget. Not a second retrieval path.
DOMAIN_UNION_SOFT_BOOST = 2.5


@dataclass(frozen=True)
class DomainRetrievalAction:
    action_id: str
    domain_id: str
    kind: str = "domain_soft"
    action_type: str = "DOMAIN_SOFT"


def build_domain_action_catalog() -> list[DomainRetrievalAction]:
    acts = [DomainRetrievalAction("domain_none", "", kind="domain_none", action_type="NO_DOMAIN_ACTION")]
    acts.extend(DomainRetrievalAction(f"domain_soft:{d}", d) for d in DOMAIN_SLOT_IDS)
    return acts


DOMAIN_ACTION_CATALOG = build_domain_action_catalog()
DOMAIN_ACTION_INDEX = {a.action_id: i for i, a in enumerate(DOMAIN_ACTION_CATALOG)}
N_DOMAIN_ACTIONS = len(DOMAIN_ACTION_CATALOG)


def derive_domain_evidence(
    personal_terms: list[str],
    index: CandidateIndexMetaV1,
    *,
    term_evidence: Optional[dict[str, float]] = None,
) -> dict[str, float]:
    """User common terms → Lexicon domain tags → sparse weighted domain evidence.

    Uses normalized weighted multi-tag aggregation (Stage D2).
    Does NOT copy term→domain into UserProfile; resolves via Lexicon at use time.
    """
    from training.model2_v3.policy.multitag import aggregate_domain_evidence

    return aggregate_domain_evidence(
        personal_terms,
        index,
        term_evidence=term_evidence,
        mode="normalized_weighted_multitag",
    )


def _empty_expansion(base: set[str], *, n_queries: int = 0) -> dict[str, Any]:
    return {
        "n_queries": n_queries,
        "n_new": 0,
        "term_ids": [],
        "base_ids": list(base),
        "soft": True,
        "hard_filter": False,
        "contract": STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
        "nested_32_8": False,
        "implementation_safety_cap": DOMAIN_FUZZY_IMPLEMENTATION_SAFETY_CAP,
        "implementation_safety_cap_kind": "IMPLEMENTATION_SAFETY_CAP",
        "domain_raw_term_ids": [],
        "candidate_provenances": {},
    }


def _base_fuzzy_hits(
    index: CandidateIndexMetaV1,
    span: FineSpanView,
    cfg: ProfileRetrievalConfig,
) -> list[FuzzyPoolHit]:
    syls = normalize_syllable_sequence_for_lookup(span.span_syllables)
    if not syls:
        return []
    req = FuzzyPoolRequestV1(
        span_text=span.window_text or "",
        span_syllables=syls,
        span_syllable_count=len(syls),
        max_pool_size=BASE_FUZZY_POOL_SIZE,
        distance_threshold=cfg.distance_threshold,
        len_delta_max=cfg.len_delta_max,
    )
    return list(build_fuzzy_pool(index, req).hits)


def _resolve_allowed_domain_ids(
    *,
    allowed_domain_ids: Optional[Sequence[str]],
    domain_weights: Optional[dict[str, float]],
) -> list[str]:
    if allowed_domain_ids is not None:
        return [d for d in allowed_domain_ids if d]
    # Legacy caller passed weights only. Positive weights select slots; zeros
    # must NOT open the mixed universe (old shared-pool rerank is retired).
    return [d for d, v in (domain_weights or {}).items() if d and float(v or 0.0) > 0.0]


def soft_domain_retrieve(
    index: CandidateIndexMetaV1,
    span: FineSpanView,
    domain_weights: Optional[dict[str, float]] = None,
    *,
    base_ids: Optional[set[str]] = None,
    cfg: Optional[ProfileRetrievalConfig] = None,
    max_cands: int = 8,
    pool_size: int = 32,
    soft_boost: float = DOMAIN_UNION_SOFT_BOOST,
    allowed_domain_ids: Optional[Sequence[str]] = None,
) -> dict[str, Any]:
    """Domain-conditioned FuzzyPool expansion, then UNION base, then one budget.

    RETIRED (deleted, not a fallback):
      mixed build_fuzzy_pool(k=32) → domain-match rerank → top-8

    pool_size is ignored (IMPLEMENTATION_SAFETY_CAP owns the domain query cap).
    soft_boost is applied once after UNION for the single business budget.
    """
    del pool_size  # RETIRED nested 32; not a config switch
    cfg = cfg or ProfileRetrievalConfig(
        max_total_profile_candidates=max_cands,
        max_new_candidates_per_query=max_cands,
        max_generated_phonetic_queries=1,
    )
    base = base_ids if base_ids is not None else set(base_retrieve_span(index, span, cfg=cfg))
    allowed = _resolve_allowed_domain_ids(
        allowed_domain_ids=allowed_domain_ids,
        domain_weights=domain_weights,
    )
    if not allowed:
        return _empty_expansion(base, n_queries=0)

    syls = normalize_syllable_sequence_for_lookup(span.span_syllables)
    if not syls:
        return _empty_expansion(base, n_queries=0)

    domain_pool = build_fuzzy_pool(
        index,
        FuzzyPoolRequestV1(
            span_text=span.window_text or "",
            span_syllables=syls,
            span_syllable_count=len(syls),
            max_pool_size=DOMAIN_FUZZY_IMPLEMENTATION_SAFETY_CAP,
            distance_threshold=cfg.distance_threshold,
            len_delta_max=cfg.len_delta_max,
            allowed_domain_ids=tuple(sorted(set(allowed))),
        ),
    )
    allowed_set = set(allowed)
    merged: dict[tuple[str, str], dict[str, Any]] = {}

    def _ingest(hit: FuzzyPoolHit, provenance: str) -> None:
        rec = index.by_term_id.get(hit.term_id)
        if rec is None:
            return
        ident = lexical_identity_key(rec)
        match = 1.0 if any(d in allowed_set for d in (rec.domain_ids or [])) else 0.0
        cur = merged.get(ident)
        if cur is None:
            merged[ident] = {
                "term_id": hit.term_id,
                "distance": int(hit.distance),
                "prior": float(hit.prior_score),
                "provenances": [provenance],
                "match": match,
            }
            return
        if provenance not in cur["provenances"]:
            cur["provenances"].append(provenance)
        cur["distance"] = min(int(cur["distance"]), int(hit.distance))
        cur["prior"] = max(float(cur["prior"]), float(hit.prior_score))
        cur["match"] = max(float(cur["match"]), match)
        # NON_BLOCKING_UNJUSTIFIED_BEHAVIOR: prefer existing base term_id, else term_id ASC.
        if provenance == PROVENANCE_BASE or (
            hit.term_id in base and cur["term_id"] not in base
        ):
            cur["term_id"] = hit.term_id
        elif hit.term_id not in base and cur["term_id"] not in base:
            cur["term_id"] = min(cur["term_id"], hit.term_id)

    for h in _base_fuzzy_hits(index, span, cfg):
        _ingest(h, PROVENANCE_BASE)
    # Caller-supplied base ids may include identities not in the 16-hit list.
    for tid in base:
        rec = index.by_term_id.get(tid)
        if rec is None:
            continue
        ident = lexical_identity_key(rec)
        if ident in merged:
            continue
        match = 1.0 if any(d in allowed_set for d in (rec.domain_ids or [])) else 0.0
        merged[ident] = {
            "term_id": tid,
            "distance": 0,
            "prior": float(rec.prior_score),
            "provenances": [PROVENANCE_BASE],
            "match": match,
        }
    for h in domain_pool.hits:
        _ingest(h, PROVENANCE_DOMAIN)

    ranked = sorted(
        merged.values(),
        key=lambda x: (
            float(x["distance"]) - float(soft_boost) * float(x["match"]) - 1e-4 * float(x["prior"]),
            x["term_id"],
        ),
    )
    budgeted = ranked[: max(0, int(max_cands))]
    term_ids = [x["term_id"] for x in budgeted]
    new_ids = [t for t in term_ids if t not in base]
    provenances = {x["term_id"]: list(x["provenances"]) for x in budgeted}
    domain_raw_ids = [h.term_id for h in domain_pool.hits]
    return {
        "n_queries": 1,
        "n_new": len(new_ids),
        "term_ids": term_ids,
        "base_ids": list(base),
        "soft": True,
        "hard_filter": False,
        "contract": STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
        "nested_32_8": False,
        "implementation_safety_cap": DOMAIN_FUZZY_IMPLEMENTATION_SAFETY_CAP,
        "implementation_safety_cap_kind": "IMPLEMENTATION_SAFETY_CAP",
        "implementation_safety_cap_hit": int(domain_pool.pool_size) >= DOMAIN_FUZZY_IMPLEMENTATION_SAFETY_CAP,
        "domain_raw_term_ids": domain_raw_ids,
        "domain_raw_n": int(domain_pool.pool_size),
        "union_n_before_budget": len(merged),
        "candidate_provenances": provenances,
        "allowed_domain_ids": list(sorted(set(allowed))),
        "single_budget_owner": "execute_domain_action.max_cands",
        "final_candidate_cap": int(max_cands),
    }


def execute_domain_action(
    index: CandidateIndexMetaV1,
    span: FineSpanView,
    action: DomainRetrievalAction,
    user_domain_evidence: dict[str, float],
    *,
    base_ids: Optional[set[str]] = None,
    cfg: Optional[ProfileRetrievalConfig] = None,
    max_cands: int = 8,
) -> dict[str, Any]:
    """Apply ONE selected domain_soft slot as a domain-conditioned FuzzyPool query.

    user_domain_evidence is Model2 input / teacher eligibility, NOT an executor
    default. Empty evidence does not open a domain universe and does not apply
    the retired selected-domain floor. domain_none is a no-op expansion.
    """
    del user_domain_evidence  # not used to open or weight the retrieval universe
    cfg = cfg or ProfileRetrievalConfig(
        max_total_profile_candidates=max_cands,
        max_new_candidates_per_query=max_cands,
        max_generated_phonetic_queries=1,
    )
    if action.kind == "domain_none" or not action.domain_id:
        base = base_ids if base_ids is not None else set(base_retrieve_span(index, span, cfg=cfg))
        res = _empty_expansion(base, n_queries=0)
        res["action"] = {
            "action_id": action.action_id,
            "kind": action.kind,
            "domain_id": action.domain_id,
            "action_type": action.action_type,
        }
        return res
    res = soft_domain_retrieve(
        index,
        span,
        None,
        base_ids=base_ids,
        cfg=cfg,
        max_cands=max_cands,
        allowed_domain_ids=(action.domain_id,),
    )
    res["action"] = {
        "action_id": action.action_id,
        "kind": action.kind,
        "domain_id": action.domain_id,
        "action_type": action.action_type,
    }
    return res


def domain_teacher_search(
    index: CandidateIndexMetaV1,
    span: FineSpanView,
    target_id: str,
    user_domain_evidence: dict[str, float],
    *,
    max_cands: int = 8,
    cfg: Optional[ProfileRetrievalConfig] = None,
) -> dict[str, Any]:
    """Exhaustive offline teacher over domain soft actions (bounded catalog).

    Hit test uses StageDRetrievalTargetIdentityV1, not raw term_id equality.
    domain_none is the empty-expansion negative; mixed-pool zero-weight retrieve
    is retired and is not consulted.
    """
    from training.model2_v3.policy.stage_d_target_identity_v1 import target_hit

    cfg = cfg or ProfileRetrievalConfig(
        max_total_profile_candidates=max_cands,
        max_new_candidates_per_query=max_cands,
        max_generated_phonetic_queries=1,
    )
    base = set(base_retrieve_span(index, span, cfg=cfg))
    evaluated = []
    best_actions: list[str] = []
    any_hit = False
    none_action = DOMAIN_ACTION_CATALOG[DOMAIN_ACTION_INDEX["domain_none"]]
    none_res = execute_domain_action(
        index, span, none_action, user_domain_evidence, base_ids=base, cfg=cfg, max_cands=max_cands
    )
    none_hit = bool(target_hit(index, target_id, none_res.get("term_ids") or [])["identity_hit"])
    ordered = sorted(
        DOMAIN_ACTION_CATALOG, key=lambda a: -float(user_domain_evidence.get(a.domain_id) or 0.0)
    )
    for action in ordered:
        res = execute_domain_action(
            index, span, action, user_domain_evidence, base_ids=base, cfg=cfg, max_cands=max_cands
        )
        hit = bool(target_hit(index, target_id, res.get("term_ids") or [])["identity_hit"])
        evaluated.append(
            {
                "action_id": action.action_id,
                "domain_id": action.domain_id,
                "recovered": hit,
                "n_queries": res.get("n_queries"),
                "n_new": res.get("n_new"),
                "term_ids": res.get("term_ids"),
            }
        )
        if hit and action.kind != "domain_none":
            any_hit = True
            best_actions.append(action.action_id)
    return {
        "best_actions": best_actions or ["domain_none"],
        "any_recover": any_hit,
        "none_prior_recover": none_hit,
        "all_prior_recover": any_hit,
        "exhaustive_recover": any_hit,
        "evaluated": evaluated,
        "n_evaluated": len(evaluated),
        "contract": STAGE_D_DOMAIN_RETRIEVAL_CONTRACT,
        "old_mixed_pool_none_prior": "RETIRED",
    }
