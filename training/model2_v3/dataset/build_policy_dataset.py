"""V3 dataset builder: teacher action labels on REAL_ASR FineSpans."""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from typing import Any, Optional

from training.model2.retrieval.finespan import FineSpanView, materialize_finespans_from_asr
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.profile_query import hypothesize_intended_syllables
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.stage_b.condition import OPPOSITE_DIRECTION, STRENGTH_TO_PROB
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1, DEFAULT_ACTIVE_SET
from training.model2_v3.policy.actions import (
    ACTION_INDEX,
    TeacherSearchResult,
    teacher_search,
)
from training.model2_v3.policy.model import N_ACTIONS

_SPAN_CACHE: dict[str, tuple] = {}


def spans_cached(asr: str):
    k = asr.strip()
    if k not in _SPAN_CACHE:
        _SPAN_CACHE[k] = materialize_finespans_from_asr(k)
    return _SPAN_CACHE[k]


def resolve_tid(index, surface: str) -> Optional[str]:
    hits = index.by_surface.get(surface) or []
    if not hits:
        return None
    return sorted(hits, key=lambda h: -h.prior_score)[0].term_id


def bias_from_res(res: dict) -> dict[str, float]:
    fam = res.get("family")
    st = str(res.get("intended_strength") or "MEDIUM").upper()
    if not fam or st == "NONE":
        return {}
    return {str(fam): float(STRENGTH_TO_PROB.get(st, 0.5))}


def phonetic_only(profile: dict[str, float]) -> dict[str, float]:
    return {k: float(v) for k, v in profile.items() if k in ACTIVE_SET_V1 and float(v) > 0}


def inflate_profile(base: dict[str, float], mode: str, rng: random.Random) -> tuple[dict[str, float], str]:
    fam = max(base, key=base.get) if base else ACTIVE_SET_V1[0]
    strength = float(base.get(fam, 0.8)) if base else 0.8
    if mode == "S1_SINGLE":
        return {fam: strength}, mode
    if mode == "S2_MULTI":
        n = rng.choice([2, 3, 5])
        others = [r for r in ACTIVE_SET_V1 if r != fam]
        rng.shuffle(others)
        out = {fam: strength}
        for r in others[: n - 1]:
            out[r] = rng.choice([0.2, 0.5, 0.8])
        return out, mode
    if mode == "S5_WEAK_STRONG":
        others = [r for r in ACTIVE_SET_V1 if r != fam]
        return {fam: 0.8, rng.choice(others): 0.2}, mode
    if mode == "S6_NOT_APPLICABLE":
        others = [r for r in ACTIVE_SET_V1 if r != fam]
        rng.shuffle(others)
        return {r: 0.8 for r in others[:3]}, mode
    if mode == "S8_HIGH_CARD":
        n = rng.choice([10, 20, 50])
        out: dict[str, float] = {}
        for i in range(min(n, len(ACTIVE_SET_V1))):
            out[ACTIVE_SET_V1[i]] = rng.choice([0.2, 0.5, 0.8])
        out[fam] = strength
        for i in range(len(ACTIVE_SET_V1), n):
            out[f"synth_item_{i}"] = 0.3
        return out, mode
    if mode == "EMPTY":
        return {}, "EMPTY"
    if mode == "WRONG":
        return {OPPOSITE_DIRECTION.get(fam, ACTIVE_SET_V1[0]): strength}, "WRONG"
    return dict(base), "CORRECT"


def teacher_spans_for_labeling(index, spans: list[FineSpanView], tid: str, fam: str) -> list[FineSpanView]:
    """Offline label construction may use target length; runtime model must not."""
    tgt = index.by_term_id.get(tid)
    if not tgt:
        return spans[:8]
    tl = len(tgt.syllables)
    length_ok = [s for s in spans if abs(len(s.span_syllables) - tl) <= 1]
    applicable = []
    for sp in length_ok:
        _, n = hypothesize_intended_syllables(sp.span_syllables, fam)
        if n > 0:
            applicable.append(sp)
    return (applicable or length_ok or spans)[:6]


def find_best_span_and_teacher(index, spans, tid, fam, teach_prof, cfg):
    cands = teacher_spans_for_labeling(index, spans, tid, fam)
    best: Optional[TeacherSearchResult] = None
    best_span = None
    best_score = -1e18
    for sp in cands:
        ts = teacher_search(index, sp, teach_prof, tid, include_pairs=False, cfg=cfg)
        score = (1000.0 if ts.any_recover else 0.0) + ts.best_utility
        if score > best_score:
            best_score = score
            best = ts
            best_span = sp
    if best is None:
        best = TeacherSearchResult(best_actions=["identity"])
        best_span = spans[0] if spans else None
    return best_span, best


def build_rows(index, results: list[dict], rng: random.Random, *, max_base: int, max_teacher: int) -> tuple[list[dict], dict]:
    cfg = ProfileRetrievalConfig()
    candidates = []
    for res in results:
        fam = res.get("family")
        st = str(res.get("intended_strength") or "").upper()
        asr = (res.get("asr_hypothesis") or "").strip()
        target = (res.get("target_term") or "").strip()
        if fam not in ACTIVE_SET_V1 or st == "NONE" or not asr or not target:
            continue
        if not resolve_tid(index, target):
            continue
        candidates.append(res)
    rng.shuffle(candidates)
    candidates = candidates[:max_base]
    print(f"[v3] base REAL_ASR pool={len(candidates)}", flush=True)

    rows: list[dict] = []
    quality: Counter = Counter()
    same_span_groups: dict[str, list[str]] = defaultdict(list)
    card_hist: Counter = Counter()

    for res in candidates:
        if len(rows) >= max_teacher * 7:
            break
        asr = (res.get("asr_hypothesis") or "").strip()
        target = (res.get("target_term") or "").strip()
        fam = str(res.get("family"))
        tid = resolve_tid(index, target)
        assert tid
        _, spans = spans_cached(asr)
        if not spans:
            quality["no_span"] += 1
            continue
        base_bias = bias_from_res(res)
        if not base_bias:
            quality["no_bias"] += 1
            continue

        anchor_span, anchor_ts = find_best_span_and_teacher(index, spans, tid, fam, base_bias, cfg)
        if anchor_span is None:
            continue
        quality["anchor_recover" if anchor_ts.any_recover else "anchor_no_recover"] += 1

        variants = [
            ("CORRECT", "S1_SINGLE"),
            ("CORRECT_MULTI", "S2_MULTI"),
            ("EMPTY", "EMPTY"),
            ("WRONG", "WRONG"),
            ("HIGH_CARD", "S8_HIGH_CARD"),
            ("NOT_APPLICABLE", "S6_NOT_APPLICABLE"),
            ("WEAK_STRONG", "S5_WEAK_STRONG"),
        ]
        group_key = f"{asr}||{anchor_span.window_pinyin_key}||{tid}"

        for vname, mode in variants:
            prof_raw, slice_name = inflate_profile(base_bias, mode, rng)
            if mode == "EMPTY":
                teach_prof, prof = {}, {}
            elif mode == "S8_HIGH_CARD":
                teach_prof = phonetic_only(prof_raw)
                prof = dict(prof_raw)
            else:
                teach_prof = phonetic_only(prof_raw)
                prof = dict(prof_raw)

            ts = teacher_search(index, anchor_span, teach_prof, tid, include_pairs=False, cfg=cfg)
            quality["teacher_rows"] += 1
            if ts.any_recover:
                quality["teacher_recover"] += 1
            n_items = len(prof)
            card_hist[min(50, n_items)] += 1

            label = [0.0] * N_ACTIONS
            for aid in ts.best_actions:
                if aid in ACTION_INDEX:
                    label[ACTION_INDEX[aid]] = 1.0
            n_rec_q = sum(1 for e in ts.evaluated if e.get("recovered") and e["action"]["kind"] != "identity")
            qb_class = 0 if n_rec_q <= 1 else 1 if n_rec_q == 2 else 2 if n_rec_q <= 4 else 3

            row = {
                "row_id": f"{res.get('sample_plan_id')}-{vname}-{len(rows)}",
                "provenance": "REAL_ASR",
                "slice": slice_name if vname.startswith("CORRECT") or vname in ("HIGH_CARD", "NOT_APPLICABLE", "WEAK_STRONG") else vname,
                "variant": vname,
                "group_key": group_key,
                "asr_hypothesis": asr,
                "target_term": target,
                "target_term_id": tid,
                "gold_family": fam,
                "pseudo_user_id": f"{res.get('pseudo_user_id')}:{vname}",
                "base_user_id": res.get("pseudo_user_id"),
                "span": anchor_span.to_dict(),
                "profile": prof,
                "profile_phonetic": teach_prof,
                "profile_size": n_items,
                "teacher": {
                    "best_actions": ts.best_actions,
                    "best_utility": ts.best_utility,
                    "any_recover": ts.any_recover,
                    "exhaustive_recover": ts.exhaustive_recover,
                    "exhaustive_queries": ts.exhaustive_queries,
                    "exhaustive_candidates": ts.exhaustive_candidates,
                    "n_evaluated": len(ts.evaluated),
                    "anchor_recover": anchor_ts.any_recover,
                },
                "label_actions": label,
                "label_query_budget_class": qb_class,
                "base_pool": len(base_retrieve_span(index, anchor_span, cfg=cfg)),
            }
            rows.append(row)
            same_span_groups[group_key].append(row["row_id"])
            if len(rows) % 70 == 0:
                print(f"[v3] rows={len(rows)} teacher_recover={quality['teacher_recover']}", flush=True)

    audit = {
        "markers": ["MODEL2_V3", "FULL_POOL_NOT_VERIFIED_FILTER", "TEACHER_ACTION_LABELS", "SPAN_SEARCH_TEACHER"],
        "n_base_pool": len(candidates),
        "n_rows": len(rows),
        "quality": dict(quality),
        "n_same_span_groups": len(same_span_groups),
        "groups_with_ge2": sum(1 for g in same_span_groups.values() if len(g) >= 2),
        "active_set": DEFAULT_ACTIVE_SET.to_dict(),
        "note": "Pool not prefiltered on recover; offline span search may use target length for labeling only",
    }
    return rows, {"audit": audit, "same_span_groups": dict(list(same_span_groups.items())[:200]), "card_hist": dict(card_hist)}
