"""Offline evaluation + stress tests for Stage A probe."""

from __future__ import annotations

import time
from typing import Any, Optional

import torch
from torch.utils.data import DataLoader

from training.model2.evaluation.metrics import percentile, summarize_ranking
from training.model2.training.dataset import StageADataset, collate_stage_a
from training.model2.training.config import StageATrainConfig


@torch.no_grad()
def evaluate_model_on_rows(
    model,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
) -> dict[str, Any]:
    device = next(model.parameters()).device
    model.eval()
    ds = StageADataset(rows, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    if len(ds) == 0:
        return summarize_ranking([], []) | {"n": 0}
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
    ranks = []
    pools = []
    for batch in loader:
        batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
        out = model(batch_t)
        scores = out["scores"]
        for i in range(scores.size(0)):
            p = int(batch_t["pool_len"][i].item())
            order = scores[i, :p].argsort(descending=True).tolist()
            tgt = int(batch_t["positive_pool_index"][i].item())
            try:
                ranks.append(order.index(tgt))
            except ValueError:
                ranks.append(-1)
            pools.append(p)
    return summarize_ranking(ranks, pools)


@torch.no_grad()
def evaluate_nomatch_on_negatives(
    model,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    *,
    negative_type: str | None = None,
) -> dict[str, Any]:
    """NO_MATCH hit rate on NEGATIVE rows (optionally N1/N2)."""
    device = next(model.parameters()).device
    model.eval()
    neg_rows = [r for r in rows if r.get("sample_kind") == "NEGATIVE"]
    if negative_type:
        neg_rows = [r for r in neg_rows if r.get("negative_type") == negative_type]
    ds = StageADataset(neg_rows, cand_cache, mode="negative", max_pool=cfg.max_pool)
    if len(ds) == 0:
        return {"NO_MATCH_hit_rate_on_negative": 0.0, "n": 0, "negative_type": negative_type}
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
    hit = 0
    n = 0
    fp_expand = 0
    for batch in loader:
        batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
        out = model(batch_t)
        scores = out["scores"]
        nm = out["no_match_index"]
        for i in range(scores.size(0)):
            pred = int(scores[i].argmax().item())
            if pred == int(nm[i].item()):
                hit += 1
            else:
                fp_expand += 1
            n += 1
    return {
        "NO_MATCH_hit_rate_on_negative": hit / max(1, n),
        "non_empty_negative_FP": fp_expand / max(1, n) if negative_type == "N2" else None,
        "n": n,
        "hit": hit,
        "negative_type": negative_type,
    }


@torch.no_grad()
def evaluate_nomatch_fp(
    model,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
) -> dict[str, Any]:
    """NO_MATCH FP: on TERM_POSITIVE, NO_MATCH ranked above true target."""
    device = next(model.parameters()).device
    model.eval()
    term = [
        r
        for r in rows
        if r.get("is_term_positive") and r.get("target_in_pool") and r.get("source_type") == "TTS_ASR_SYNTHETIC"
    ]
    ds = StageADataset(term, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
    fp = 0
    n = 0
    for batch in loader:
        batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
        out = model(batch_t)
        scores = out["scores"]
        nm = out["no_match_index"]
        for i in range(scores.size(0)):
            tgt = int(batch_t["positive_pool_index"][i].item())
            if scores[i, int(nm[i])] > scores[i, tgt]:
                fp += 1
            n += 1
    return {"NO_MATCH_FP_rate": fp / max(1, n), "n": n, "fp": fp}


@torch.no_grad()
def evaluate_hn_fp(
    model,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    *,
    native: bool | None = None,
) -> dict[str, Any]:
    """HardNegative FP: HN scores above NO_MATCH. native=True/False filters HN_NATIVE vs injected."""
    device = next(model.parameters()).device
    model.eval()
    if native is True:
        hn_rows = [r for r in rows if r.get("sample_kind") == "HARD_NEGATIVE" and r.get("hn_native")]
        mode = "all"
    elif native is False:
        hn_rows = [r for r in rows if r.get("is_injected_hard_negative")]
        mode = "hard_negative"
    else:
        hn_rows = [r for r in rows if r.get("sample_kind") == "HARD_NEGATIVE"]
        mode = "all"
    ds = StageADataset(hn_rows, cand_cache, mode=mode, max_pool=cfg.max_pool)
    ds.rows = hn_rows
    label = "Native-HN_FP_rate" if native is True else ("Injected-HN_FP_rate" if native is False else "HardNegative_FP_rate")
    if len(ds) == 0:
        return {label: 0.0, "n": 0, "fp": 0}
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
    fp = 0
    n = 0
    for batch in loader:
        batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
        out = model(batch_t)
        scores = out["scores"]
        nm = out["no_match_index"]
        for i in range(scores.size(0)):
            hni = int(batch_t["hard_negative_index"][i].item())
            if hni < 0:
                continue
            if scores[i, hni] > scores[i, int(nm[i])]:
                fp += 1
            n += 1
    return {label: fp / max(1, n), "n": n, "fp": fp}


@torch.no_grad()
def mask_invariance_test(model, rows, cand_cache, cfg, n: int = 32) -> dict[str, Any]:
    device = next(model.parameters()).device
    model.eval()
    term = [
        r
        for r in rows
        if r.get("is_term_positive") and r.get("target_in_pool") and r.get("split") == "train"
    ][:n]
    ds = StageADataset(term, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    loader = DataLoader(ds, batch_size=len(ds) or 1, shuffle=False, collate_fn=collate_stage_a)
    batch = next(iter(loader))
    batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
    # ensure masks are zero
    batch_t["phonetic_mask"] = torch.zeros_like(batch_t["phonetic_mask"])
    batch_t["tone_mask"] = torch.zeros_like(batch_t["tone_mask"])
    out0 = model(batch_t)
    s0 = out0["scores"].clone()

    # randomize condition values under mask=0
    batch_t["phonetic_condition"] = torch.randn_like(batch_t["phonetic_condition"])
    batch_t["tone_condition"] = torch.randn_like(batch_t["tone_condition"])
    out1 = model(batch_t)
    s1 = out1["scores"]
    max_abs = float((s0 - s1).abs().max().item())
    mean_abs = float((s0 - s1).abs().mean().item())
    passed = max_abs < 1e-5
    return {
        "pass": passed,
        "max_abs_diff": max_abs,
        "mean_abs_diff": mean_abs,
        "n": int(s0.size(0)),
        "gate": "PASS" if passed else "FAIL",
    }


@torch.no_grad()
def term_id_stress_test(model, rows, cand_cache, cfg, n: int = 64) -> dict[str, Any]:
    """Shuffle term_id labels in pool identity list; features unchanged → scores unchanged."""
    device = next(model.parameters()).device
    model.eval()
    term = [
        r
        for r in rows
        if r.get("is_term_positive") and r.get("target_in_pool") and r.get("split") == "train"
    ][:n]
    ds = StageADataset(term, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    loader = DataLoader(ds, batch_size=len(ds) or 1, shuffle=False, collate_fn=collate_stage_a)
    batch = next(iter(loader))
    batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
    out0 = model(batch_t)
    s0 = out0["scores"][:, : cfg.max_pool].clone()

    # Permute fuzzy_pool_term_ids metadata only — tensors already feature-based.
    # Simulate "term_id shuffle" by asserting model never reads term_id tensors.
    # Additional check: permute candidate feature rows vs keep mapping — if we only
    # shuffle IDs in python list, scores must match.
    shuffled_ids = []
    for ids in batch["fuzzy_pool_term_ids"]:
        shuffled_ids.append(list(reversed(ids)))
    batch_t["fuzzy_pool_term_ids"] = shuffled_ids
    out1 = model(batch_t)
    s1 = out1["scores"][:, : cfg.max_pool]
    max_abs = float((s0 - s1).abs().max().item())
    passed = max_abs < 1e-6
    return {
        "pass": passed,
        "max_abs_diff": max_abs,
        "note": "Model scores depend on surface/pinyin tensors only; term_id list is identity metadata.",
        "gate": "PASS" if passed else "FAIL",
    }


@torch.no_grad()
def wrong_profile_stress(model, rows, cand_cache, cfg, n: int = 64) -> dict[str, Any]:
    """M1: swap personal/domain features across batch — FP should not explode vs base evidence."""
    if not model.cfg.use_weak_prior:
        return {"skipped": True, "reason": "M0 has no weak prior"}
    device = next(model.parameters()).device
    model.eval()
    term = [
        r
        for r in rows
        if r.get("is_term_positive") and r.get("target_in_pool") and r.get("split") == "train"
    ][:n]
    ds = StageADataset(term, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    loader = DataLoader(ds, batch_size=len(ds) or 1, shuffle=False, collate_fn=collate_stage_a)
    batch = next(iter(loader))
    batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
    out0 = model(batch_t)
    # correct profile top1
    correct_top = 0
    for i in range(out0["scores"].size(0)):
        p = int(batch_t["pool_len"][i])
        pred = int(out0["scores"][i, :p].argmax())
        if pred == int(batch_t["positive_pool_index"][i]):
            correct_top += 1
    # wrong profile: roll personal/domain features
    batch_w = dict(batch_t)
    batch_w["cand_personal"] = torch.roll(batch_t["cand_personal"], shifts=1, dims=0)
    batch_w["cand_domain"] = torch.roll(batch_t["cand_domain"], shifts=1, dims=0)
    out1 = model(batch_w)
    wrong_top = 0
    for i in range(out1["scores"].size(0)):
        p = int(batch_w["pool_len"][i])
        pred = int(out1["scores"][i, :p].argmax())
        if pred == int(batch_w["positive_pool_index"][i]):
            wrong_top += 1
    n_b = out0["scores"].size(0)
    correct_r1 = correct_top / max(1, n_b)
    wrong_r1 = wrong_top / max(1, n_b)
    # Wrong prior must not crush base evidence completely
    passed = wrong_r1 >= correct_r1 * 0.5
    return {
        "correct_profile_recall_at_1": correct_r1,
        "wrong_profile_recall_at_1": wrong_r1,
        "delta": wrong_r1 - correct_r1,
        "pass": passed,
        "gate": "PASS" if passed else "FAIL",
        "n": n_b,
        "note": "Stage A does not require Correct>Empty; requires wrong weak prior not dominate base evidence.",
    }


@torch.no_grad()
def cpu_latency_benchmark(model, rows, cand_cache, cfg, pool_size: int = 16) -> dict[str, Any]:
    """Pure Model2 forward on CPU for B=1,5,10."""
    model_cpu = model.to("cpu")
    model_cpu.eval()
    term = [
        r
        for r in rows
        if r.get("is_term_positive") and r.get("target_in_pool")
    ]
    ds = StageADataset(term, cand_cache, mode="eval_term_positive", max_pool=cfg.max_pool)
    results = {}
    for b in (1, 5, 10):
        if len(ds) < b:
            continue
        loader = DataLoader(ds, batch_size=b, shuffle=False, collate_fn=collate_stage_a)
        batch = next(iter(loader))
        batch_t = {k: v if not torch.is_tensor(v) else v for k, v in batch.items()}
        # warmup
        for _ in range(5):
            _ = model_cpu(batch_t)
        times = []
        for _ in range(50):
            t0 = time.perf_counter()
            _ = model_cpu(batch_t)
            times.append((time.perf_counter() - t0) * 1000.0)
        results[f"B{b}"] = {
            "P50_ms": percentile(times, 50),
            "P95_ms": percentile(times, 95),
            "mean_ms": sum(times) / len(times),
            "pool_size": pool_size,
        }
    return {
        "device": "cpu",
        "note": "Pure Model2 score forward; excludes FuzzyPool generation.",
        "batches": results,
    }
