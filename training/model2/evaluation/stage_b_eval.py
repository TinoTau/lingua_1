"""Stage B condition-gain evaluation suite."""

from __future__ import annotations

import random
from collections import defaultdict
from typing import Any, Optional

import torch
from torch.utils.data import DataLoader

from training.model2.contract import PHONETIC_FEATURE_INDEX_V1, PHONETIC_FEATURE_KEYS
from training.model2.evaluation.metrics import summarize_ranking
from training.model2.stage_b.condition import (
    OPPOSITE_DIRECTION,
    make_wrong_profiles,
    profile_vectors_from_bias,
    relevant_only_profile,
)
from training.model2.training.dataset import StageADataset, collate_stage_a
from training.model2.training.stage_b_trainer import _batch_with_profile


def _rank_of_target(scores: torch.Tensor, tgt: int, pool_len: int) -> int:
    order = scores[:pool_len].argsort(descending=True).tolist()
    try:
        return order.index(tgt)
    except ValueError:
        return -1


@torch.no_grad()
def score_profile_quartet(
    model,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    *,
    trainable_mask: list[int],
    max_pool: int = 16,
    seed: int = 0,
) -> list[dict[str, Any]]:
    """Per-row metrics under unavailable/neutral/correct/wrong profiles."""
    device = next(model.parameters()).device
    model.eval()
    rng = random.Random(seed)
    use = [
        r
        for r in rows
        if r.get("is_term_positive")
        and r.get("target_in_pool")
        and r.get("positive_pool_index") is not None
    ]
    if not use:
        return []
    by_id = {r["trainrow_id"]: r for r in use}
    ds = StageADataset(use, cand_cache, mode="all", max_pool=max_pool)
    ds.rows = use
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
    out_rows: list[dict[str, Any]] = []
    modes = ("unavailable", "neutral", "correct", "wrong")
    for batch in loader:
        metas = [by_id[tid] for tid in batch["trainrow_id"]]
        scored = {}
        for mode in modes:
            b = _batch_with_profile(batch, metas, mode, trainable_mask, rng)
            bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b.items()}
            scored[mode] = model(bt)["scores"]
        for i, meta in enumerate(metas):
            tgt = int(batch["positive_pool_index"][i].item())
            plen = int(batch["pool_len"][i].item())
            entry: dict[str, Any] = {
                "trainrow_id": meta["trainrow_id"],
                "sample_id": meta.get("sample_id"),
                "split": meta.get("split"),
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
            }
            for mode in modes:
                sc = scored[mode][i]
                entry[f"rank_{mode}"] = _rank_of_target(sc, tgt, plen)
                entry[f"score_target_{mode}"] = float(sc[tgt].item())
                entry[f"pred_{mode}"] = int(sc[: plen + 1].argmax().item())  # include NO_MATCH
                entry[f"nomatch_wins_{mode}"] = int(sc.argmax().item() == plen)
            entry["condition_gain_score"] = entry["score_target_correct"] - entry["score_target_unavailable"]
            entry["wrong_damage_score"] = entry["score_target_unavailable"] - entry["score_target_wrong"]
            out_rows.append(entry)
    return out_rows


def _recall_at(ranks: list[int], k: int) -> float:
    ok = [r for r in ranks if r >= 0]
    if not ok:
        return 0.0
    return sum(1 for r in ok if r < k) / len(ok)


def _mrr(ranks: list[int]) -> float:
    ok = [r for r in ranks if r >= 0]
    if not ok:
        return 0.0
    return sum(1.0 / (r + 1) for r in ok) / len(ok)


def summarize_quartet(entries: list[dict[str, Any]]) -> dict[str, Any]:
    if not entries:
        return {"n": 0}
    modes = ("unavailable", "neutral", "correct", "wrong")
    out: dict[str, Any] = {"n": len(entries)}
    for mode in modes:
        ranks = [e[f"rank_{mode}"] for e in entries]
        out[f"Recall@1_{mode}"] = _recall_at(ranks, 1)
        out[f"Recall@3_{mode}"] = _recall_at(ranks, 3)
        out[f"Recall@4_{mode}"] = _recall_at(ranks, 4)
        out[f"MRR_{mode}"] = _mrr(ranks)
        scores = [e[f"score_target_{mode}"] for e in entries]
        out[f"mean_target_score_{mode}"] = sum(scores) / len(scores)
    out["ConditionGain@1"] = out["Recall@1_correct"] - out["Recall@1_unavailable"]
    out["ConditionGain@3"] = out["Recall@3_correct"] - out["Recall@3_unavailable"]
    out["ConditionGain_MRR"] = out["MRR_correct"] - out["MRR_unavailable"]
    gains = [e["condition_gain_score"] for e in entries]
    gains_s = sorted(gains)
    out["TargetScoreGain_mean"] = sum(gains) / len(gains)
    out["TargetScoreGain_median"] = gains_s[len(gains_s) // 2]
    out["TargetScoreGain_p25"] = gains_s[max(0, len(gains_s) // 4)]
    out["TargetScoreGain_p75"] = gains_s[min(len(gains_s) - 1, (3 * len(gains_s)) // 4)]
    out["WrongProfileDamage@1"] = out["Recall@1_unavailable"] - out["Recall@1_wrong"]
    out["WrongProfileDamage@3"] = out["Recall@3_unavailable"] - out["Recall@3_wrong"]
    out["WrongProfileDamage_score_mean"] = sum(e["wrong_damage_score"] for e in entries) / len(entries)
    return out


def slice_entries(entries: list[dict[str, Any]], pred) -> list[dict[str, Any]]:
    return [e for e in entries if pred(e)]


@torch.no_grad()
def condition_ablation(
    model,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    trainable_mask: list[int],
    *,
    max_n: int = 200,
    max_pool: int = 16,
    seed: int = 0,
) -> dict[str, Any]:
    device = next(model.parameters()).device
    model.eval()
    rng = random.Random(seed)
    pron = [
        r
        for r in rows
        if r.get("is_pronunciation_positive")
        and r.get("target_in_pool")
        and r.get("positive_pool_index") is not None
        and r.get("split") in ("validation", "test")
    ]
    rng.shuffle(pron)
    pron = pron[:max_n]
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
        # A correct full
        variants["A_full_correct"] = _batch_with_profile(batch, metas, "correct", trainable_mask, rng)
        # E empty
        variants["E_empty"] = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
        # B relevant only / C relevant masked / D wrong feature high
        b_rel = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in batch.items()}
        b_mask = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in batch.items()}
        b_wrong = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in batch.items()}
        for i, meta in enumerate(metas):
            bias = dict(meta.get("phonetic_bias_snapshot") or {})
            fam = meta.get("corruption_family") or "n_l"
            rel = relevant_only_profile(bias, fam, trainable_mask)
            masked = profile_vectors_from_bias(bias, trainable_mask=trainable_mask, mode="correct")
            # C: zero mask on relevant feature
            m = list(masked["phonetic_mask"])
            if fam in PHONETIC_FEATURE_INDEX_V1:
                m[PHONETIC_FEATURE_INDEX_V1[fam]] = 0
            masked["phonetic_mask"] = m
            wps = make_wrong_profiles(bias, family=fam, trainable_mask=trainable_mask)
            wrong = wps["wp_irrelevant"]
            for name, prof, bb in (
                ("B", rel, b_rel),
                ("C", masked, b_mask),
                ("D", wrong, b_wrong),
            ):
                bb["phonetic_condition"][i] = torch.tensor(prof["phonetic_condition"], dtype=torch.float)
                bb["phonetic_mask"][i] = torch.tensor(prof["phonetic_mask"], dtype=torch.long)
                bb["phonetic_profile_acoustically_realized"][i] = int(
                    prof["phonetic_profile_acoustically_realized"]
                )
        variants["B_relevant_only"] = b_rel
        variants["C_relevant_masked"] = b_mask
        variants["D_wrong_feature"] = b_wrong

        scored = {}
        for name, b in variants.items():
            bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b.items()}
            scored[name] = model(bt)["scores"]
        for i, meta in enumerate(metas):
            tgt = int(batch["positive_pool_index"][i].item())
            for name, sc in scored.items():
                buckets[name].append(float(sc[i, tgt].item()))
    summary = {}
    for name, vals in buckets.items():
        summary[name] = {
            "mean_target_score": sum(vals) / max(1, len(vals)),
            "n": len(vals),
        }
    summary["n"] = len(pron)
    return summary


@torch.no_grad()
def strength_monotonicity_probe(
    model,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    trainable_mask: list[int],
    *,
    max_n: int = 80,
    max_pool: int = 16,
) -> dict[str, Any]:
    """For each family, sweep condition 0/0.2/0.5/0.8 with identical inputs."""
    device = next(model.parameters()).device
    model.eval()
    pron = [
        r
        for r in rows
        if r.get("is_pronunciation_positive")
        and r.get("corruption_family")
        and r.get("target_in_pool")
        and r.get("positive_pool_index") is not None
        and r.get("split") in ("validation", "test")
    ]
    by_fam: dict[str, list] = defaultdict(list)
    for r in pron:
        by_fam[str(r["corruption_family"])].append(r)
    out = {}
    for fam, lst in by_fam.items():
        use = lst[: max(1, max_n // max(1, len(by_fam)))]
        if fam not in PHONETIC_FEATURE_INDEX_V1 or not use:
            continue
        idx = PHONETIC_FEATURE_INDEX_V1[fam]
        ds = StageADataset(use, cand_cache, mode="all", max_pool=max_pool)
        ds.rows = use
        loader = DataLoader(ds, batch_size=16, shuffle=False, collate_fn=collate_stage_a)
        curve = {v: [] for v in (0.0, 0.2, 0.5, 0.8)}
        for batch in loader:
            for val in curve:
                b = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in batch.items()}
                b["phonetic_condition"].zero_()
                b["phonetic_mask"] = torch.tensor(
                    [list(trainable_mask) for _ in range(b["phonetic_mask"].size(0))],
                    dtype=torch.long,
                )
                b["phonetic_condition"][:, idx] = float(val)
                b["phonetic_profile_acoustically_realized"].fill_(1)
                bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b.items()}
                sc = model(bt)["scores"]
                for i in range(sc.size(0)):
                    tgt = int(batch["positive_pool_index"][i].item())
                    curve[val].append(float(sc[i, tgt].item()))
        means = {str(v): (sum(xs) / max(1, len(xs))) for v, xs in curve.items()}
        seq = [means["0.0"], means["0.2"], means["0.5"], means["0.8"]]
        mono = all(seq[i] <= seq[i + 1] + 0.02 for i in range(3))
        out[fam] = {"means": means, "monotonic_soft": mono, "n": len(use)}
    return out


@torch.no_grad()
def opposite_direction_test(
    model,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    trainable_mask: list[int],
    *,
    max_n: int = 120,
    max_pool: int = 16,
) -> dict[str, Any]:
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
    better = 0
    n = 0
    for batch, start in _iter_batches_with_meta(loader, pron):
        metas = pron[start : start + batch["phonetic_condition"].size(0)]
        # build correct-dir vs opposite-dir HIGH
        b_ok = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in batch.items()}
        b_opp = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in batch.items()}
        for i, meta in enumerate(metas):
            fam = meta["corruption_family"]
            opp = OPPOSITE_DIRECTION[fam]
            for bb, key in ((b_ok, fam), (b_opp, opp)):
                bb["phonetic_condition"][i].zero_()
                bb["phonetic_mask"][i] = torch.tensor(trainable_mask, dtype=torch.long)
                bb["phonetic_condition"][i, PHONETIC_FEATURE_INDEX_V1[key]] = 0.8
                bb["phonetic_profile_acoustically_realized"][i] = 1
        sc_ok = model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_ok.items()})["scores"]
        sc_opp = model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_opp.items()})["scores"]
        for i in range(sc_ok.size(0)):
            tgt = int(batch["positive_pool_index"][i].item())
            if float(sc_ok[i, tgt]) > float(sc_opp[i, tgt]) + 1e-4:
                better += 1
            n += 1
    return {
        "n": n,
        "correct_dir_higher_rate": better / max(1, n),
        "pass": (better / max(1, n)) >= 0.55,
    }


def _iter_batches_with_meta(loader, rows):
    # approximate: DataLoader order == rows order when shuffle=False
    offset = 0
    for batch in loader:
        yield batch, offset
        offset += batch["phonetic_condition"].size(0)


@torch.no_grad()
def mask_invariance_stage_b(model, rows, cand_cache, *, max_pool=16, n=64) -> dict[str, Any]:
    device = next(model.parameters()).device
    model.eval()
    use = [r for r in rows if r.get("target_in_pool") and r.get("positive_pool_index") is not None][:n]
    if not use:
        return {"pass": False, "n": 0}
    ds = StageADataset(use, cand_cache, mode="all", max_pool=max_pool)
    ds.rows = use
    loader = DataLoader(ds, batch_size=16, shuffle=False, collate_fn=collate_stage_a)
    max_delta = 0.0
    for batch in loader:
        bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
        # force mask 0 on slot 0, randomize value
        b1 = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in bt.items()}
        b2 = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in bt.items()}
        b1["phonetic_mask"][:, 0] = 0
        b2["phonetic_mask"][:, 0] = 0
        b1["phonetic_condition"][:, 0] = 0.1
        b2["phonetic_condition"][:, 0] = 0.9
        b1["phonetic_profile_acoustically_realized"].fill_(1)
        b2["phonetic_profile_acoustically_realized"].fill_(1)
        s1 = model(b1)["scores"]
        s2 = model(b2)["scores"]
        max_delta = max(max_delta, float((s1 - s2).abs().max().item()))
    return {"pass": max_delta < 1e-5, "max_abs_delta": max_delta, "n": len(use)}


@torch.no_grad()
def profile_swap_stress(model, rows, cand_cache, trainable_mask, *, max_pool=16, n=128) -> dict[str, Any]:
    device = next(model.parameters()).device
    model.eval()
    rng = random.Random(0)
    use = [
        r
        for r in rows
        if r.get("is_pronunciation_positive")
        and r.get("target_in_pool")
        and r.get("split") in ("validation", "test")
    ][:n]
    if len(use) < 8:
        return {"n": len(use), "pass": False}
    by_id = {r["trainrow_id"]: r for r in use}
    ds = StageADataset(use, cand_cache, mode="all", max_pool=max_pool)
    ds.rows = use
    loader = DataLoader(ds, batch_size=16, shuffle=False, collate_fn=collate_stage_a)
    mrr_correct = []
    mrr_swapped = []
    for batch in loader:
        metas = [by_id[tid] for tid in batch["trainrow_id"]]
        b_c = _batch_with_profile(batch, metas, "correct", trainable_mask, rng)
        # swap profiles cyclically
        b_s = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in b_c.items()}
        if b_s["phonetic_condition"].size(0) > 1:
            b_s["phonetic_condition"] = torch.roll(b_s["phonetic_condition"], 1, dims=0)
            b_s["phonetic_mask"] = torch.roll(b_s["phonetic_mask"], 1, dims=0)
        sc = model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_c.items()})["scores"]
        ss = model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_s.items()})["scores"]
        for i in range(sc.size(0)):
            tgt = int(batch["positive_pool_index"][i].item())
            plen = int(batch["pool_len"][i].item())
            rc = _rank_of_target(sc[i], tgt, plen)
            rs = _rank_of_target(ss[i], tgt, plen)
            if rc >= 0:
                mrr_correct.append(1.0 / (rc + 1))
            if rs >= 0:
                mrr_swapped.append(1.0 / (rs + 1))
    mc = sum(mrr_correct) / max(1, len(mrr_correct))
    ms = sum(mrr_swapped) / max(1, len(mrr_swapped))
    delta = mc - ms
    return {
        "n": len(use),
        "MRR_correct": mc,
        "MRR_swapped": ms,
        "delta": delta,
        "pass": delta > 0.005,  # interpretable drop
        "ignored_profile": abs(delta) < 1e-6,
        "collapsed": ms < 0.05 and mc > 0.2,
    }


@torch.no_grad()
def profile_zeroing_vs_base(
    model_b,
    model_b0,
    rows,
    cand_cache,
    trainable_mask,
    *,
    max_pool=16,
    n=128,
) -> dict[str, Any]:
    """Zeroing Stage B profile should approach B0 (unavailable path)."""
    device = next(model_b.parameters()).device
    model_b.eval()
    model_b0.eval()
    rng = random.Random(1)
    use = [r for r in rows if r.get("target_in_pool") and r.get("positive_pool_index") is not None][:n]
    by_id = {r["trainrow_id"]: r for r in use}
    ds = StageADataset(use, cand_cache, mode="all", max_pool=max_pool)
    ds.rows = use
    loader = DataLoader(ds, batch_size=16, shuffle=False, collate_fn=collate_stage_a)
    deltas = []
    for batch in loader:
        metas = [by_id[tid] for tid in batch["trainrow_id"]]
        b_empty = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
        bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_empty.items()}
        sb = model_b(bt)["scores"]
        s0 = model_b0(bt)["scores"]
        deltas.append(float((sb - s0).abs().mean().item()))
    mean_d = sum(deltas) / max(1, len(deltas))
    return {"mean_abs_score_delta_vs_b0": mean_d, "n": len(use), "pass": mean_d < 0.35}
