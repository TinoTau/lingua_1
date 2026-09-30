"""Phase2 full REAL_ASR teacher dataset with yield attribution."""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from typing import Any, Optional

from training.model2.contract import FUZZY_DISTANCE_THRESHOLD
from training.model2.fuzzy.pool import levenshtein_syllables
from training.model2.retrieval.finespan import FineSpanView
from training.model2.retrieval.finespan_retrieval import base_retrieve_span
from training.model2.retrieval.profile_query import hypothesize_intended_syllables
from training.model2.retrieval.spike_retriever import ProfileRetrievalConfig
from training.model2.stage_b.condition import OPPOSITE_DIRECTION, STRENGTH_TO_PROB
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1, DEFAULT_ACTIVE_SET
from training.model2_v3.dataset.build_policy_dataset import (
    bias_from_res,
    inflate_profile,
    phonetic_only,
    resolve_tid,
    spans_cached,
    teacher_spans_for_labeling,
)
from training.model2_v3.policy.actions import ACTION_INDEX, teacher_search
from training.model2_v3.policy.model import N_ACTIONS, QB_CLASSES


def attribute_non_recovery(
    index,
    spans: list[FineSpanView],
    tid: str,
    fam: str,
    bias: dict[str, float],
    ts,
    anchor: Optional[FineSpanView],
) -> str:
    if tid not in index.by_term_id:
        return "LEXICON_MISS"
    if not spans:
        return "NO_RELEVANT_FINE_SPAN"
    tgt = index.by_term_id[tid]
    tl = len(tgt.syllables)
    length_ok = [s for s in spans if abs(len(s.span_syllables) - tl) <= 1]
    if not length_ok:
        return "SPAN_BOUNDARY_MISS"
    # already in base on some span?
    for sp in length_ok[:6]:
        if tid in set(base_retrieve_span(index, sp)):
            return "TARGET_ALREADY_IN_BASE"
    if fam not in ACTIVE_SET_V1:
        return "PROFILE_ACTIVE_SET_MISS"
    if not bias or float(bias.get(fam) or 0) <= 0:
        return "PROFILE_NOT_APPLICABLE"
    appl = False
    for sp in length_ok:
        _, n = hypothesize_intended_syllables(sp.span_syllables, fam)
        if n > 0:
            appl = True
            break
    if not appl:
        return "PROFILE_NOT_APPLICABLE"
    if anchor is None:
        return "NO_RELEVANT_FINE_SPAN"
    # distance after reverse
    hyp, _ = hypothesize_intended_syllables(anchor.span_syllables, fam)
    d = levenshtein_syllables(hyp, list(tgt.syllables))
    if d > FUZZY_DISTANCE_THRESHOLD:
        return "DISTANCE_REJECT"
        if ts and not ts.any_recover:
            if len(ts.evaluated) <= 1:
                return "NO_USEFUL_SINGLE_ACTION"
            return "UNRECOVERABLE_WITH_CURRENT_PRIMITIVES"
    return "OTHER"


def qb_class_from_n(n: int) -> int:
    # map needed recovering singles → QB_CLASSES index
    for i, b in enumerate(QB_CLASSES):
        if n <= b:
            return i
    return len(QB_CLASSES) - 1


def build_phase2_rows(
    index,
    results: list[dict],
    rng: random.Random,
    *,
    max_base: int = 0,
) -> tuple[list[dict], dict[str, Any]]:
    cfg = ProfileRetrievalConfig()
    funnel = Counter()
    yield_attr = Counter()
    examples: dict[str, list] = defaultdict(list)

    candidates = []
    for res in results:
        funnel["raw_REAL_ASR"] += 1
        fam = res.get("family")
        st = str(res.get("intended_strength") or "").upper()
        asr = (res.get("asr_hypothesis") or "").strip()
        target = (res.get("target_term") or "").strip()
        if not asr or not target:
            continue
        if fam not in ACTIVE_SET_V1:
            funnel["not_active_set"] += 1
            continue
        if st == "NONE":
            funnel["strength_none"] += 1
            continue
        tid = resolve_tid(index, target)
        if not tid:
            funnel["lexicon_miss"] += 1
            yield_attr["LEXICON_MISS"] += 1
            continue
        funnel["lexicon_covered"] += 1
        candidates.append(res)

    rng.shuffle(candidates)
    if max_base and max_base < len(candidates):
        candidates = candidates[:max_base]
    funnel["active_set_pool"] = len(candidates)
    print(f"[phase2] ACTIVE_SET REAL_ASR pool={len(candidates)}", flush=True)

    rows: list[dict] = []
    card_hist = Counter()
    hard_multi_ids = []
    high_card_ids = []

    for res in candidates:
        asr = (res.get("asr_hypothesis") or "").strip()
        target = (res.get("target_term") or "").strip()
        fam = str(res.get("family"))
        tid = resolve_tid(index, target)
        assert tid
        _, spans = spans_cached(asr)
        if not spans:
            funnel["no_finespan"] += 1
            yield_attr["NO_RELEVANT_FINE_SPAN"] += 1
            continue
        funnel["finespan_exists"] += 1
        base_bias = bias_from_res(res)
        if not base_bias:
            funnel["no_bias"] += 1
            continue

        # Anchor with Correct + composed search
        cands = teacher_spans_for_labeling(index, spans, tid, fam)
        best_ts = None
        best_span = None
        best_score = -1e18
        for sp in cands:
            # Anchor search: singles only (fast). Composed searched later on anchor span.
            ts = teacher_search(
                index, sp, base_bias, tid, include_pairs=False, cfg=cfg, label_mode="recall_prefer"
            )
            score = (1000.0 if ts.any_recover else 0.0) + ts.best_utility
            if score > best_score:
                best_score, best_ts, best_span = score, ts, sp
        if best_span is None or best_ts is None:
            continue

        if best_ts.any_recover:
            funnel["teacher_recoverable"] += 1
        else:
            funnel["teacher_non_recoverable"] += 1
            reason = attribute_non_recovery(index, spans, tid, fam, base_bias, best_ts, best_span)
            yield_attr[reason] += 1
            if len(examples[reason]) < 8:
                examples[reason].append(
                    {
                        "asr": asr[:60],
                        "target": target,
                        "fam": fam,
                        "span": best_span.span_syllables,
                    }
                )

        # Check base visibility on anchor
        in_base = tid in set(base_retrieve_span(index, best_span, cfg=cfg))
        funnel["anchor_in_base" if in_base else "anchor_target_absent"] += 1

        variants = [
            ("CORRECT", "S1_SINGLE", "PROFILE_SIZE_1"),
            ("CORRECT_MULTI", "S2_MULTI", "HARD_MULTI_CAND"),
            ("EMPTY", "EMPTY", "CF_EMPTY"),
            ("WRONG", "WRONG", "CF_WRONG"),
            ("SWAPPED", "WRONG", "CF_SWAPPED"),
            ("WEAK_STRONG", "S5_WEAK_STRONG", "PROFILE_SIZE_2"),
            ("NOT_APPLICABLE", "S6_NOT_APPLICABLE", "PROFILE_NOT_APPLICABLE"),
        ]
        # High-cardinality only when Correct teacher can recover (avoids useless expensive composed search)
        if best_ts.any_recover:
            variants.extend(
                [
                    ("HIGH_CARD_10", "S8_HIGH_CARD", "PROFILE_SIZE_10"),
                    ("HIGH_CARD_20", "S8_HIGH_CARD", "PROFILE_SIZE_20"),
                    ("HIGH_CARD_50", "S8_HIGH_CARD", "PROFILE_SIZE_50"),
                ]
            )
        group_key = f"{asr}||{best_span.window_pinyin_key}||{tid}"

        for vname, mode, slice_tag in variants:
            if mode == "S8_HIGH_CARD":
                # force exact cardinality
                n_want = 10 if "10" in vname else 20 if "20" in vname else 50
                prof_raw = {ACTIVE_SET_V1[i % len(ACTIVE_SET_V1)]: rng.choice([0.2, 0.5, 0.8]) for i in range(min(n_want, len(ACTIVE_SET_V1)))}
                prof_raw[fam] = float(base_bias.get(fam, 0.8))
                for i in range(len(ACTIVE_SET_V1), n_want):
                    prof_raw[f"synth_item_{i}"] = 0.3
                slice_name = mode
            elif vname == "SWAPPED":
                # different wrong profile from another family's bias
                others = [r for r in ACTIVE_SET_V1 if r != fam]
                rng.shuffle(others)
                prof_raw = {others[0]: 0.8, others[1]: 0.5}
                slice_name = "SWAPPED"
            else:
                prof_raw, slice_name = inflate_profile(base_bias, mode, rng)

            if mode == "EMPTY" or vname == "EMPTY":
                teach_prof, prof = {}, {}
            else:
                teach_prof = phonetic_only(prof_raw)
                prof = dict(prof_raw)

            use_pairs = best_ts.any_recover and vname in (
                "CORRECT",
                "CORRECT_MULTI",
                "HIGH_CARD_10",
                "HIGH_CARD_20",
                "HIGH_CARD_50",
                "WEAK_STRONG",
            )
            ts = teacher_search(
                index,
                best_span,
                teach_prof,
                tid,
                include_pairs=use_pairs,
                cfg=cfg,
                label_mode="recall_prefer",
            )

            # applicability mask on span
            appl_mask = []
            for r in ACTIVE_SET_V1:
                if float(teach_prof.get(r) or 0) <= 0:
                    appl_mask.append(0.0)
                    continue
                _, n = hypothesize_intended_syllables(best_span.span_syllables, r)
                appl_mask.append(1.0 if n > 0 else 0.0)
            n_applicable = sum(1 for a in appl_mask if a > 0)

            label = [0.0] * N_ACTIONS
            for aid in ts.best_actions:
                if aid in ACTION_INDEX:
                    label[ACTION_INDEX[aid]] = 1.0

            n_rec_singles = ts.n_singles_recover
            qb_idx = qb_class_from_n(max(1, n_rec_singles) if ts.any_recover else 1)

            # HARD_MULTI: >=2 applicable in profile AND B1 recovers
            is_hard_multi = (
                n_applicable >= 2
                and len(teach_prof) >= 2
                and ts.exhaustive_recover
                and vname in ("CORRECT_MULTI", "HIGH_CARD_10", "HIGH_CARD_20", "WEAK_STRONG")
            )

            n_items = len(prof)
            card_hist[min(50, n_items if n_items else 0)] += 1

            row = {
                "row_id": f"{res.get('sample_plan_id')}-{vname}-{len(rows)}",
                "provenance": "REAL_ASR",
                "variant": vname,
                "slice": slice_tag,
                "group_key": group_key,
                "asr_hypothesis": asr,
                "target_term": target,
                "target_term_id": tid,
                "gold_family": fam,
                "pseudo_user_id": f"{res.get('pseudo_user_id')}:{vname}",
                "base_user_id": res.get("pseudo_user_id"),
                "span": best_span.to_dict(),
                "profile": prof,
                "profile_phonetic": teach_prof,
                "profile_size": n_items,
                "n_applicable": n_applicable,
                "applicability": appl_mask,
                "teacher": {
                    "best_actions": ts.best_actions,
                    "best_utility_actions": ts.best_utility_actions,
                    "best_recall_actions": ts.best_recall_actions,
                    "best_utility": ts.best_utility,
                    "any_recover": ts.any_recover,
                    "exhaustive_recover": ts.exhaustive_recover,
                    "exhaustive_queries": ts.exhaustive_queries,
                    "exhaustive_candidates": ts.exhaustive_candidates,
                    "n_evaluated": len(ts.evaluated),
                    "n_singles_recover": ts.n_singles_recover,
                    "n_composed_recover": ts.n_composed_recover,
                },
                "label_actions": label,
                "label_query_budget_class": qb_idx,
                "base_pool": len(base_retrieve_span(index, best_span, cfg=cfg)),
                "anchor_in_base": in_base,
                "is_hard_multi": is_hard_multi,
                "is_high_card": vname.startswith("HIGH_CARD"),
            }
            rows.append(row)
            if is_hard_multi:
                hard_multi_ids.append(row["row_id"])
            if row["is_high_card"]:
                high_card_ids.append(row["row_id"])
            if len(rows) % 200 == 0:
                print(
                    f"[phase2] rows={len(rows)} recoverable_anchor={funnel['teacher_recoverable']}",
                    flush=True,
                )

    natural_yield = funnel["teacher_recoverable"] / max(1, funnel["teacher_recoverable"] + funnel["teacher_non_recoverable"])
    audit = {
        "markers": ["MODEL2_V3_PHASE2", "FULL_ACTIVE_SET_REAL_ASR", "RECALL_PREFER_TEACHER"],
        "funnel": dict(funnel),
        "natural_recovery_yield": natural_yield,
        "yield_attribution": dict(yield_attr),
        "n_rows": len(rows),
        "n_hard_multi": len(hard_multi_ids),
        "n_high_card": len(high_card_ids),
        "active_set": DEFAULT_ACTIVE_SET.to_dict(),
        "phase1_baseline_note": "~400 ASR / ~840 rows / Correct recover ~29/120 / RecallRetained~0.71",
    }
    return rows, {
        "audit": audit,
        "card_hist": dict(card_hist),
        "examples": {k: v for k, v in examples.items()},
        "hard_multi_ids": hard_multi_ids,
        "high_card_ids": high_card_ids,
    }
