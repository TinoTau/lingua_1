"""Phase 6B/6C ranking / binding / delta-spread / listwise metrics."""

from __future__ import annotations

import random
from collections import defaultdict
from typing import Any

import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader

from training.model2.contract import PHONETIC_FEATURE_INDEX_V1, PHONETIC_FEATURE_KEYS
from training.model2.stage_b.condition import OPPOSITE_DIRECTION, make_wrong_profiles, profile_vectors_from_bias
from training.model2.training.condition_losses_v2 import margin_from_scores
from training.model2.training.dataset import StageADataset, collate_stage_a
from training.model2.training.stage_b_trainer import _batch_with_profile


def _rank(scores: torch.Tensor, tgt: int, plen: int) -> int:
    order = scores[:plen].argsort(descending=True).tolist()
    return order.index(tgt)


def _target_prob(scores: torch.Tensor, tgt: int, plen: int, temperature: float = 1.0) -> float:
    if plen <= 0:
        return 0.0
    t = max(1e-6, float(temperature))
    logp = F.log_softmax(scores[:plen] / t, dim=-1)
    return float(logp[tgt].exp().item())


def compare_correct_vs_other_score(*, correct: float, other: float, eps: float = 1e-6) -> str:
    """Unit-testable score comparison: better / worse / tie."""
    if correct > other + eps:
        return "better"
    if other > correct + eps:
        return "worse"
    return "tie"


@torch.no_grad()
def base_preservation_test(
    model_b0,
    model_b,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    trainable_mask: list[int],
    *,
    max_pool: int = 16,
    n: int = 128,
    score_tol: float = 1e-5,
) -> dict[str, Any]:
    device = next(model_b.parameters()).device
    model_b0 = model_b0.to(device).eval()
    model_b = model_b.to(device).eval()
    rng = random.Random(0)
    use = [r for r in rows if r.get("target_in_pool") and r.get("positive_pool_index") is not None][:n]
    if not use:
        return {"pass": False, "n": 0}
    by_id = {r["trainrow_id"]: r for r in use}
    ds = StageADataset(use, cand_cache, mode="all", max_pool=max_pool)
    ds.rows = use
    loader = DataLoader(ds, batch_size=16, shuffle=False, collate_fn=collate_stage_a)
    max_abs = 0.0
    rank_mismatch = 0
    n_scored = 0
    for batch in loader:
        metas = [by_id[tid] for tid in batch["trainrow_id"]]
        b_empty = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
        b_empty["cand_relation_features"] = batch["cand_relation_features"]
        bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_empty.items()}
        # B0 may not use relation path
        s0 = model_b0(bt)["scores"]
        sb = model_b(bt)["scores"]
        # compare pool slots only
        for i in range(s0.size(0)):
            plen = int(batch["pool_len"][i].item())
            d = (s0[i, :plen] - sb[i, :plen]).abs().max().item()
            max_abs = max(max_abs, float(d))
            r0 = s0[i, :plen].argsort(descending=True).tolist()
            rb = sb[i, :plen].argsort(descending=True).tolist()
            if r0 != rb:
                rank_mismatch += 1
            n_scored += 1
    return {
        "n": n_scored,
        "max_abs_score_delta": max_abs,
        "rank_mismatch": rank_mismatch,
        "score_tol": score_tol,
        "pass": max_abs <= score_tol and rank_mismatch == 0,
        "ranking_identical": rank_mismatch == 0,
    }


@torch.no_grad()
def score_ranking_quartet(
    model,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    trainable_mask: list[int],
    *,
    max_pool: int = 16,
    seed: int = 0,
    splits: tuple[str, ...] = ("validation", "test"),
) -> list[dict[str, Any]]:
    device = next(model.parameters()).device
    model.eval()
    rng = random.Random(seed)
    use = [
        r
        for r in rows
        if r.get("split") in splits
        and r.get("is_term_positive")
        and r.get("target_in_pool")
        and r.get("positive_pool_index") is not None
    ]
    if not use:
        return []
    by_id = {r["trainrow_id"]: r for r in use}
    ds = StageADataset(use, cand_cache, mode="all", max_pool=max_pool)
    ds.rows = use
    loader = DataLoader(ds, batch_size=24, shuffle=False, collate_fn=collate_stage_a)
    out = []
    modes = ("unavailable", "neutral", "correct", "wrong")
    for batch in loader:
        metas = [by_id[tid] for tid in batch["trainrow_id"]]
        scored = {}
        deltas = {}
        for mode in modes:
            b = _batch_with_profile(batch, metas, mode, trainable_mask, rng)
            b["cand_relation_features"] = batch["cand_relation_features"]
            bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b.items()}
            o = model(bt)
            scored[mode] = o["scores"]
            deltas[mode] = o.get("delta_condition")
        for i, meta in enumerate(metas):
            tgt = int(batch["positive_pool_index"][i].item())
            plen = int(batch["pool_len"][i].item())
            entry: dict[str, Any] = {
                "trainrow_id": meta["trainrow_id"],
                "corruption_family": meta.get("corruption_family"),
                "intended_strength": meta.get("intended_strength"),
                "user_kind": meta.get("user_kind"),
                "pseudo_user_id": meta.get("pseudo_user_id"),
                "combination_key": meta.get("combination_key"),
                "unseen_feature_combo": bool(meta.get("unseen_feature_combo")),
                "is_pronunciation_positive": bool(meta.get("is_pronunciation_positive")),
                "is_no_change": bool(meta.get("is_no_change")),
                "backend": meta.get("backend"),
                "target_term_id": meta.get("target_term_id"),
                "split": meta.get("split"),
            }
            rel = batch["cand_relation_features"][i, :plen]  # [P,16]
            fam = meta.get("corruption_family")
            fam_i = PHONETIC_FEATURE_INDEX_V1.get(fam) if fam else None
            for mode in modes:
                sc = scored[mode][i]
                entry[f"rank_{mode}"] = _rank(sc, tgt, plen)
                entry[f"score_target_{mode}"] = float(sc[tgt].item())
                entry[f"prob_target_{mode}"] = _target_prob(sc, tgt, plen)
                # margin
                others = [float(sc[j]) for j in range(plen) if j != tgt]
                best = max(others) if others else float(sc[tgt])
                entry[f"margin_{mode}"] = float(sc[tgt].item()) - best
                if deltas[mode] is not None:
                    d = deltas[mode][i, :plen]
                    entry[f"delta_spread_{mode}"] = float((d.max() - d.min()).item()) if plen else 0.0
                    entry[f"delta_std_{mode}"] = float(d.std().item()) if plen > 1 else 0.0
                    entry[f"delta_target_{mode}"] = float(d[tgt].item()) if tgt < plen else 0.0
                    # selectivity: relevant = |relation on family dim| > 0
                    if fam_i is not None and plen > 0:
                        rel_mass = rel[:, fam_i].abs()
                        relevant = rel_mass > 1e-6
                        if relevant.any():
                            entry[f"RelevantDeltaMean_{mode}"] = float(d[relevant].mean().item())
                        else:
                            entry[f"RelevantDeltaMean_{mode}"] = 0.0
                        if (~relevant).any():
                            entry[f"IrrelevantDeltaMean_{mode}"] = float(d[~relevant].mean().item())
                        else:
                            entry[f"IrrelevantDeltaMean_{mode}"] = 0.0
                        entry[f"ConditionSelectivity_{mode}"] = (
                            entry[f"RelevantDeltaMean_{mode}"] - entry[f"IrrelevantDeltaMean_{mode}"]
                        )
                # delta needed from empty/base scores (unavailable ≈ base when frozen)
                sc_u = scored["unavailable"][i]
                order = sc_u[:plen].argsort(descending=True).tolist()
                s_tgt = float(sc_u[tgt].item())
                # to become rank1: need to beat current top if not already
                top = float(sc_u[order[0]].item()) if plen else s_tgt
                entry["delta_needed_for_rank1"] = 0.0 if order[0] == tgt else max(0.0, top - s_tgt + 1e-4)
                if plen >= 3:
                    # boundary into top-3: beat the 3rd ranked (index 2) if currently worse
                    third = float(sc_u[order[2]].item())
                    entry["delta_needed_for_rank3"] = 0.0 if tgt in order[:3] else max(0.0, third - s_tgt + 1e-4)
                else:
                    entry["delta_needed_for_rank3"] = entry["delta_needed_for_rank1"]
            entry["TargetRankDelta"] = entry["rank_unavailable"] - entry["rank_correct"]
            entry["MarginGain"] = entry["margin_correct"] - entry["margin_unavailable"]
            entry["TargetProbabilityGain"] = entry["prob_target_correct"] - entry["prob_target_unavailable"]
            out.append(entry)
    return out


def summarize_ranking(entries: list[dict[str, Any]]) -> dict[str, Any]:
    if not entries:
        return {"n": 0}

    def recall(ranks, k):
        ok = [r for r in ranks if r >= 0]
        return sum(1 for r in ok if r < k) / max(1, len(ok))

    def mrr(ranks):
        ok = [r for r in ranks if r >= 0]
        return sum(1.0 / (r + 1) for r in ok) / max(1, len(ok))

    out: dict[str, Any] = {"n": len(entries)}
    for mode in ("unavailable", "neutral", "correct", "wrong"):
        ranks = [e[f"rank_{mode}"] for e in entries]
        out[f"Recall@1_{mode}"] = recall(ranks, 1)
        out[f"Recall@3_{mode}"] = recall(ranks, 3)
        out[f"Recall@4_{mode}"] = recall(ranks, 4)
        out[f"MRR_{mode}"] = mrr(ranks)
        out[f"mean_margin_{mode}"] = sum(e[f"margin_{mode}"] for e in entries) / len(entries)
        if f"delta_spread_{mode}" in entries[0]:
            out[f"mean_delta_spread_{mode}"] = sum(e.get(f"delta_spread_{mode}", 0) for e in entries) / len(entries)
        if f"prob_target_{mode}" in entries[0]:
            out[f"mean_prob_target_{mode}"] = sum(e.get(f"prob_target_{mode}", 0) for e in entries) / len(entries)
        if f"ConditionSelectivity_{mode}" in entries[0]:
            out[f"ConditionSelectivity_mean_{mode}"] = sum(
                e.get(f"ConditionSelectivity_{mode}", 0) for e in entries
            ) / len(entries)
    out["ConditionGain@1"] = out["Recall@1_correct"] - out["Recall@1_unavailable"]
    out["ConditionGain@3"] = out["Recall@3_correct"] - out["Recall@3_unavailable"]
    out["ConditionGain_MRR"] = out["MRR_correct"] - out["MRR_unavailable"]
    out["TargetRankDelta_mean"] = sum(e["TargetRankDelta"] for e in entries) / len(entries)
    out["MarginGain_mean"] = sum(e["MarginGain"] for e in entries) / len(entries)
    out["TargetProbabilityGain_mean"] = sum(e.get("TargetProbabilityGain", 0) for e in entries) / len(entries)
    out["frac_rank_improved"] = sum(1 for e in entries if e["TargetRankDelta"] > 0) / len(entries)
    out["WrongProfileDamage@3"] = out["Recall@3_unavailable"] - out["Recall@3_wrong"]
    out["SwapProxy_WrongDamage_MRR"] = out["MRR_correct"] - out["MRR_wrong"]
    out["CandidateDeltaSpread_mean"] = out.get("mean_delta_spread_correct", 0.0)
    out["ConditionSelectivity_mean"] = out.get("ConditionSelectivity_mean_correct", 0.0)
    return out


@torch.no_grad()
def profile_swap_ranking(
    model,
    rows,
    cand_cache,
    trainable_mask,
    *,
    max_pool=16,
    n=128,
) -> dict[str, Any]:
    device = next(model.parameters()).device
    model.eval()
    rng = random.Random(2)
    use = [
        r
        for r in rows
        if r.get("is_pronunciation_positive")
        and r.get("target_in_pool")
        and r.get("split") in ("validation", "test")
    ][:n]
    if len(use) < 8:
        return {"pass": False, "n": len(use)}
    by_id = {r["trainrow_id"]: r for r in use}
    ds = StageADataset(use, cand_cache, mode="all", max_pool=max_pool)
    ds.rows = use
    loader = DataLoader(ds, batch_size=16, shuffle=False, collate_fn=collate_stage_a)
    mrr_c, mrr_s, r3_c, r3_s = [], [], [], []
    for batch in loader:
        metas = [by_id[tid] for tid in batch["trainrow_id"]]
        b_c = _batch_with_profile(batch, metas, "correct", trainable_mask, rng)
        b_c["cand_relation_features"] = batch["cand_relation_features"]
        b_s = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in b_c.items()}
        if b_s["phonetic_condition"].size(0) > 1:
            b_s["phonetic_condition"] = torch.roll(b_s["phonetic_condition"], 1, 0)
            b_s["phonetic_mask"] = torch.roll(b_s["phonetic_mask"], 1, 0)
        sc = model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_c.items()})["scores"]
        ss = model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_s.items()})["scores"]
        for i in range(sc.size(0)):
            tgt = int(batch["positive_pool_index"][i].item())
            plen = int(batch["pool_len"][i].item())
            rc = _rank(sc[i], tgt, plen)
            rs = _rank(ss[i], tgt, plen)
            mrr_c.append(1.0 / (rc + 1))
            mrr_s.append(1.0 / (rs + 1))
            r3_c.append(1.0 if rc < 3 else 0.0)
            r3_s.append(1.0 if rs < 3 else 0.0)
    mc, ms = sum(mrr_c) / len(mrr_c), sum(mrr_s) / len(mrr_s)
    rc, rs = sum(r3_c) / len(r3_c), sum(r3_s) / len(r3_s)
    return {
        "n": len(use),
        "MRR_correct": mc,
        "MRR_swapped": ms,
        "MRRSwapDamage": mc - ms,
        "Recall@3_correct": rc,
        "Recall@3_swapped": rs,
        "SwapDamage@3": rc - rs,
        "pass": (mc - ms) > 0.005 or (rc - rs) > 0.01,
        "ignored_profile": abs(mc - ms) < 1e-9 and abs(rc - rs) < 1e-9,
    }


@torch.no_grad()
def wrong_direction_metrics(
    model,
    rows,
    cand_cache,
    trainable_mask,
    *,
    max_pool=16,
    max_n=120,
) -> dict[str, Any]:
    """
    Compare Correct vs Opposite vs Irrelevant single-feature profiles.
    Lower rank index is better. STRICT improvement required for 'better' rates
    (ties do not count as success).
    """
    device = next(model.parameters()).device
    model.eval()
    pron = [
        r
        for r in rows
        if r.get("is_pronunciation_positive")
        and r.get("corruption_family") in OPPOSITE_DIRECTION
        and r.get("target_in_pool")
        and r.get("split") in ("validation", "test")
    ][:max_n]
    if not pron:
        return {"n": 0}
    ds = StageADataset(pron, cand_cache, mode="all", max_pool=max_pool)
    ds.rows = pron
    loader = DataLoader(ds, batch_size=16, shuffle=False, collate_fn=collate_stage_a)
    better_opp = better_irr = 0
    tie_opp = tie_irr = 0
    worse_opp = worse_irr = 0
    n = 0
    offset = 0
    for batch in loader:
        metas = pron[offset : offset + batch["phonetic_condition"].size(0)]
        offset += batch["phonetic_condition"].size(0)
        b_ok = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in batch.items()}
        b_opp = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in batch.items()}
        b_irr = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in batch.items()}
        for i, meta in enumerate(metas):
            fam = meta["corruption_family"]
            opp = OPPOSITE_DIRECTION[fam]
            irr = "zh_z" if fam != "zh_z" else "n_l"
            for bb, key in ((b_ok, fam), (b_opp, opp), (b_irr, irr)):
                bb["phonetic_condition"][i].zero_()
                bb["phonetic_mask"][i] = torch.tensor(trainable_mask, dtype=torch.long)
                bb["phonetic_condition"][i, PHONETIC_FEATURE_INDEX_V1[key]] = 0.8
                bb["phonetic_profile_acoustically_realized"][i] = 1
            b_ok["cand_relation_features"] = batch["cand_relation_features"]
            b_opp["cand_relation_features"] = batch["cand_relation_features"]
            b_irr["cand_relation_features"] = batch["cand_relation_features"]
        sc_ok = model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_ok.items()})["scores"]
        sc_opp = model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_opp.items()})["scores"]
        sc_irr = model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_irr.items()})["scores"]
        for i in range(sc_ok.size(0)):
            tgt = int(batch["positive_pool_index"][i].item())
            plen = int(batch["pool_len"][i].item())
            rok = _rank(sc_ok[i], tgt, plen)
            ropp = _rank(sc_opp[i], tgt, plen)
            rirr = _rank(sc_irr[i], tgt, plen)
            sok = float(sc_ok[i, tgt])
            sopp = float(sc_opp[i, tgt])
            sirr = float(sc_irr[i, tgt])

            def _cmp(r_c, r_o, s_c, s_o):
                if r_c < r_o or (r_c == r_o and s_c > s_o + 1e-6):
                    return "better"
                if r_c == r_o and abs(s_c - s_o) <= 1e-6:
                    return "tie"
                return "worse"

            c_opp = _cmp(rok, ropp, sok, sopp)
            c_irr = _cmp(rok, rirr, sok, sirr)
            if c_opp == "better":
                better_opp += 1
            elif c_opp == "tie":
                tie_opp += 1
            else:
                worse_opp += 1
            if c_irr == "better":
                better_irr += 1
            elif c_irr == "tie":
                tie_irr += 1
            else:
                worse_irr += 1
            n += 1
    rate_opp = better_opp / max(1, n)
    rate_irr = better_irr / max(1, n)
    return {
        "n": n,
        # Clear names (Phase 6C metric contract)
        "CorrectProfileBetterThanOppositeRate": rate_opp,
        "CorrectProfileBetterThanIrrelevantRate": rate_irr,
        "tie_opposite_rate": tie_opp / max(1, n),
        "tie_irrelevant_rate": tie_irr / max(1, n),
        "worse_opposite_rate": worse_opp / max(1, n),
        "worse_irrelevant_rate": worse_irr / max(1, n),
        # Legacy aliases removed from PASS logic; kept only for audit
        "legacy_correct_leq_opposite_rate_was_non_strict_rank": "renamed_and_strictified",
        "pass": rate_opp >= 0.55 and rate_irr >= 0.55,
        "metric_semantics": {
            "better": "rank_correct < rank_other OR (same rank AND score_correct > score_other)",
            "ties_do_not_count_as_pass": True,
        },
    }


def binding_quality_from_entries(entries: list[dict[str, Any]], *, min_n: int = 8) -> dict[str, Any]:
    """Phase 6C: classify primarily by ranking/probability direction (not absolute score)."""
    by_fam: dict[str, list] = defaultdict(list)
    for e in entries:
        if e.get("is_pronunciation_positive") and e.get("corruption_family"):
            by_fam[str(e["corruption_family"])].append(e)
    out = {}
    for fam in PHONETIC_FEATURE_KEYS:
        sub = by_fam.get(fam) or []
        if not sub:
            out[fam] = {"label": "IGNORED", "n": 0}
            continue
        if len(sub) < min_n:
            out[fam] = {"label": "INSUFFICIENT_EVAL", "n": len(sub)}
            continue
        rd = sum(e["TargetRankDelta"] for e in sub) / len(sub)
        pg = sum(e.get("TargetProbabilityGain", 0.0) for e in sub) / len(sub)
        mg = sum(e["MarginGain"] for e in sub) / len(sub)
        sel = sum(e.get("ConditionSelectivity_correct", 0.0) for e in sub) / len(sub)
        # Ranking-first labels
        if rd < -0.05 or pg < -0.01:
            label = "REVERSED"
        elif rd > 0.05 and pg > 0.005:
            label = "BOUND"
        elif rd > 0.0 or pg > 0.002:
            label = "WEAK"
        else:
            label = "IGNORED"
        out[fam] = {
            "label": label,
            "n": len(sub),
            "TargetRankDelta_mean": rd,
            "TargetProbabilityGain_mean": pg,
            "MarginGain_mean": mg,
            "ConditionSelectivity_mean": sel,
        }
    return out


@torch.no_grad()
def relation_ablation(
    model,
    rows,
    cand_cache,
    trainable_mask,
    *,
    max_n=160,
    max_pool=16,
) -> dict[str, Any]:
    """A user+relation / B user-only / C relation-only / D neither."""
    device = next(model.parameters()).device
    model.eval()
    rng = random.Random(3)
    pron = [
        r
        for r in rows
        if r.get("is_pronunciation_positive")
        and r.get("target_in_pool")
        and r.get("split") in ("validation", "test")
    ][:max_n]
    if not pron:
        return {"n": 0}
    by_id = {r["trainrow_id"]: r for r in pron}
    ds = StageADataset(pron, cand_cache, mode="all", max_pool=max_pool)
    ds.rows = pron
    loader = DataLoader(ds, batch_size=16, shuffle=False, collate_fn=collate_stage_a)
    buckets = defaultdict(list)
    for batch in loader:
        metas = [by_id[tid] for tid in batch["trainrow_id"]]
        variants = {}
        # A correct
        a = _batch_with_profile(batch, metas, "correct", trainable_mask, rng)
        a["cand_relation_features"] = batch["cand_relation_features"]
        variants["A_user_relation"] = a
        # B user only (zero relations)
        b = _batch_with_profile(batch, metas, "correct", trainable_mask, rng)
        b["cand_relation_features"] = torch.zeros_like(batch["cand_relation_features"])
        variants["B_user_only"] = b
        # C relation only (unavailable user but keep relations — should be ~base)
        c = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
        c["cand_relation_features"] = batch["cand_relation_features"]
        variants["C_relation_only"] = c
        # D neither
        d = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
        d["cand_relation_features"] = torch.zeros_like(batch["cand_relation_features"])
        variants["D_neither"] = d
        scored = {}
        for name, bb in variants.items():
            bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in bb.items()}
            scored[name] = model(bt)["scores"]
        for i in range(batch["positive_pool_index"].size(0)):
            tgt = int(batch["positive_pool_index"][i].item())
            plen = int(batch["pool_len"][i].item())
            for name, sc in scored.items():
                buckets[name].append(_rank(sc[i], tgt, plen))
    summary = {}
    for name, ranks in buckets.items():
        summary[name] = {
            "mean_rank": sum(ranks) / max(1, len(ranks)),
            "Recall@3": sum(1 for r in ranks if r < 3) / max(1, len(ranks)),
            "n": len(ranks),
        }
    summary["n"] = len(pron)
    # interaction better than user-only if lower mean rank (strict-ish gap)
    if "A_user_relation" in summary and "B_user_only" in summary:
        a = summary["A_user_relation"]["mean_rank"]
        b = summary["B_user_only"]["mean_rank"]
        c = summary.get("C_relation_only", {}).get("mean_rank", a)
        d = summary.get("D_neither", {}).get("mean_rank", a)
        summary["interaction_gap_vs_user_only"] = b - a
        summary["interaction_better_than_user_only"] = a < b - 0.02
        summary["interaction_better_than_relation_only"] = a < c - 0.02
        summary["interaction_better_than_neither"] = a < d - 0.02
        summary["interaction_pass"] = bool(
            summary["interaction_better_than_user_only"]
            and summary["interaction_better_than_relation_only"]
            and summary["interaction_better_than_neither"]
        )
    return summary
