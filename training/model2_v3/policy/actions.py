"""Bounded retrieval action space + deterministic primitive execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from training.model2.candidates.index import CandidateIndexMetaV1
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.normalize import normalize_syllable_sequence_for_lookup
from training.model2.retrieval.profile_query import hypothesize_intended_syllables
from training.model2.retrieval.spike_retriever import (
    ProfileRetrievalConfig,
    retrieve_profile_candidates,
)
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1

# Utility weights — Phase2 calibrated (less aggressive cost vs Phase1) for recall retention
REWARD_RECOVER = 10.0
COST_QUERY = 0.5
COST_CAND = 0.08
COST_FALSE = 0.2
COST_COMPOSED = 0.35

# Action kinds: SINGLE | COMPOSED_PAIR | identity
# PARALLEL_PAIR is policy-level (select multiple SINGLEs), not one catalog id.


@dataclass(frozen=True)
class RetrievalAction:
    action_id: str
    kind: str  # single | composed_pair | identity
    relations: tuple[str, ...] = ()
    action_type: str = "SINGLE"  # SINGLE | COMPOSED_PAIR | IDENTITY

    def to_dict(self) -> dict[str, Any]:
        return {
            "action_id": self.action_id,
            "kind": self.kind,
            "action_type": self.action_type,
            "relations": list(self.relations),
        }


def build_action_catalog() -> list[RetrievalAction]:
    acts: list[RetrievalAction] = [
        RetrievalAction("identity", "identity", (), "IDENTITY")
    ]
    for r in ACTIVE_SET_V1:
        acts.append(RetrievalAction(f"single:{r}", "single", (r,), "SINGLE"))
    # COMPOSED_PAIR: observed → transform A → transform B → one lexicon query
    for i, a in enumerate(ACTIVE_SET_V1):
        for b in ACTIVE_SET_V1[i + 1 :]:
            acts.append(
                RetrievalAction(f"composed:{a}>{b}", "composed_pair", (a, b), "COMPOSED_PAIR")
            )
            acts.append(
                RetrievalAction(f"composed:{b}>{a}", "composed_pair", (b, a), "COMPOSED_PAIR")
            )
    return acts


ACTION_CATALOG = build_action_catalog()
ACTION_INDEX = {a.action_id: i for i, a in enumerate(ACTION_CATALOG)}

_POOL_CACHE: dict[tuple, list[str]] = {}


def _pool_ids(index, syllables: list[str], max_cands: int) -> list[str]:
    key = (tuple(syllables), max_cands)
    hit = _POOL_CACHE.get(key)
    if hit is not None:
        return hit
    from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool

    if not syllables:
        _POOL_CACHE[key] = []
        return []
    pool = build_fuzzy_pool(
        index,
        FuzzyPoolRequestV1("", list(syllables), len(syllables), max_pool_size=max_cands),
    )
    ids = [h.term_id for h in pool.hits]
    _POOL_CACHE[key] = ids
    return ids


def apply_relations_chain(syllables: list[str], relations: tuple[str, ...]) -> list[str]:
    cur = list(syllables)
    for rel in relations:
        cur, _ = hypothesize_intended_syllables(cur, rel)
    return normalize_syllable_sequence_for_lookup(cur)


def action_applicable(span: FineSpanView, action: RetrievalAction, profile: dict[str, float]) -> bool:
    if action.kind == "identity":
        return True
    for rel in action.relations:
        if float(profile.get(rel) or 0.0) <= 0:
            return False
        _, n = hypothesize_intended_syllables(span.span_syllables, rel)
        if n <= 0 and action.kind == "single":
            return False
    if action.kind == "composed_pair":
        out = apply_relations_chain(span.span_syllables, action.relations)
        return out != normalize_syllable_sequence_for_lookup(span.span_syllables)
    return True


def execute_action(
    index: CandidateIndexMetaV1,
    span: FineSpanView,
    action: RetrievalAction,
    *,
    base_ids: Optional[set[str]] = None,
    cfg: Optional[ProfileRetrievalConfig] = None,
    max_cands: int = 8,
) -> dict[str, Any]:
    cfg = cfg or ProfileRetrievalConfig(
        max_total_profile_candidates=max_cands,
        max_new_candidates_per_query=max_cands,
        max_generated_phonetic_queries=1,
    )
    base = base_ids if base_ids is not None else set(base_retrieve_span(index, span, cfg=cfg))
    if action.kind == "identity":
        return {
            "action": action.to_dict(),
            "n_queries": 0,
            "n_new": 0,
            "term_ids": [],
            "base_ids": list(base),
        }
    # Build synthetic bias containing only action relations (primitive call, not full profile dump)
    bias = {r: 1.0 for r in action.relations}
    if action.kind == "composed_pair":
        # COMPOSED: chain transforms then one FuzzyPool query
        hyp = apply_relations_chain(span.span_syllables, action.relations)
        from training.model2.fuzzy.pool import FuzzyPoolRequestV1, build_fuzzy_pool

        if not hyp or hyp == normalize_syllable_sequence_for_lookup(span.span_syllables):
            return {
                "action": action.to_dict(),
                "n_queries": 0,
                "n_new": 0,
                "term_ids": [],
                "base_ids": list(base),
            }
        pool = build_fuzzy_pool(
            index,
            FuzzyPoolRequestV1("", hyp, len(hyp), max_pool_size=max_cands),
        )
        new_ids = [h.term_id for h in pool.hits if h.term_id not in base][:max_cands]
        return {
            "action": action.to_dict(),
            "n_queries": 1,
            "n_new": len(new_ids),
            "term_ids": new_ids,
            "base_ids": list(base),
            "query": hyp,
        }
    # single: use existing profile retrieval primitive with 1-relation bias
    pr = retrieve_profile_candidates(
        index,
        span.span_syllables,
        bias,
        base_term_ids=base,
        cfg=cfg,
    )
    return {
        "action": action.to_dict(),
        "n_queries": pr.n_queries,
        "n_new": pr.n_new_candidates,
        "term_ids": pr.term_ids(),
        "base_ids": list(base),
    }


def utility_of_result(result: dict[str, Any], target_id: str, action: RetrievalAction) -> float:
    recovered = 1.0 if target_id in set(result.get("term_ids") or []) else 0.0
    n_q = float(result.get("n_queries") or 0)
    n_new = float(result.get("n_new") or 0)
    false = n_new if recovered < 1.0 else max(0.0, n_new - 1.0)
    u = (
        REWARD_RECOVER * recovered
        - COST_QUERY * n_q
        - COST_CAND * n_new
        - COST_FALSE * false
        - (COST_COMPOSED if action.kind == "composed_pair" else 0.0)
    )
    return float(u)


@dataclass
class TeacherSearchResult:
    evaluated: list[dict[str, Any]] = field(default_factory=list)
    best_actions: list[str] = field(default_factory=list)
    best_utility_actions: list[str] = field(default_factory=list)
    best_recall_actions: list[str] = field(default_factory=list)
    best_utility: float = 0.0
    any_recover: bool = False
    exhaustive_recover: bool = False
    exhaustive_queries: int = 0
    exhaustive_candidates: int = 0
    n_singles_recover: int = 0
    n_composed_recover: int = 0


def teacher_search(
    index: CandidateIndexMetaV1,
    span: FineSpanView,
    profile: dict[str, float],
    target_id: str,
    *,
    include_pairs: bool = True,
    max_cands: int = 8,
    cfg: Optional[ProfileRetrievalConfig] = None,
    label_mode: str = "recall_prefer",  # recall_prefer | utility_only
) -> TeacherSearchResult:
    """Offline teacher search.

    label_mode=recall_prefer: supervise ALL recovering singles (+ high-utility composed),
    so multi-relation policies learn the full useful set (PARALLEL selection).
    """
    base = set(base_retrieve_span(index, span, cfg=cfg))
    out = TeacherSearchResult()
    best_u = -1e9
    recovering: list[tuple[str, float, str]] = []  # id, util, kind
    ex_q = 0
    ex_c: set[str] = set()
    ex_hit = False

    for action in ACTION_CATALOG:
        if action.kind == "composed_pair" and not include_pairs:
            continue
        if action.kind != "identity" and not action_applicable(span, action, profile):
            continue
        res = execute_action(index, span, action, base_ids=base, cfg=cfg, max_cands=max_cands)
        u = utility_of_result(res, target_id, action)
        hit = target_id in set(res.get("term_ids") or [])
        row = {**res, "utility": u, "recovered": hit}
        out.evaluated.append(row)
        if action.kind != "identity":
            ex_q += int(res.get("n_queries") or 0)
            ex_c |= set(res.get("term_ids") or [])
            if hit:
                ex_hit = True
        if hit:
            recovering.append((action.action_id, u, action.kind))
            out.any_recover = True
            if action.kind == "single":
                out.n_singles_recover += 1
            elif action.kind == "composed_pair":
                out.n_composed_recover += 1
        if u > best_u:
            best_u = u

    out.best_utility = best_u if best_u > -1e8 else 0.0
    out.exhaustive_queries = ex_q
    out.exhaustive_candidates = len(ex_c)
    out.exhaustive_recover = ex_hit
    if recovering:
        out.best_recall_actions = [aid for aid, _, _ in recovering]
        thr = 0.5 * max(u for _, u, _ in recovering)
        out.best_utility_actions = [aid for aid, u, _ in recovering if u >= thr]
        if label_mode == "utility_only":
            out.best_actions = list(out.best_utility_actions)
        else:
            # Prefer all recovering singles for PARALLEL supervision; keep utility-composed if unique
            singles = [aid for aid, _, k in recovering if k == "single"]
            composed_u = [aid for aid, u, k in recovering if k == "composed_pair" and u >= thr]
            out.best_actions = singles or out.best_utility_actions
            for aid in composed_u:
                if aid not in out.best_actions:
                    out.best_actions.append(aid)
    else:
        out.best_actions = ["identity"]
        out.best_utility_actions = ["identity"]
        out.best_recall_actions = []
    return out
