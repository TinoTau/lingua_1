"""Stage B training helpers: freeze/unfreeze, condition variants, init from Stage A."""

from __future__ import annotations

import copy
import random
from pathlib import Path
from typing import Any, Optional

import torch
from torch.utils.data import DataLoader

from training.model2.contract import PHONETIC_DIM, PHONETIC_FEATURE_KEYS
from training.model2.model.model_v1 import Model2Config, Model2StageAV1, count_parameters
from training.model2.stage_b.condition import (
    OPPOSITE_DIRECTION,
    apply_profile_to_row,
    load_trainable_mask,
    make_wrong_profiles,
    profile_vectors_from_bias,
)
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import StageADataset, collate_stage_a
from training.model2.training.losses import compose_loss, compose_loss_stage_b


def load_stage_a_checkpoint(
    path: Path,
    *,
    use_condition_in_score: bool,
    syl_vocab: int,
) -> Model2StageAV1:
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    raw = ckpt.get("config") or {}
    fields = set(Model2Config.__dataclass_fields__.keys())
    cfg = Model2Config(**{k: v for k, v in raw.items() if k in fields})
    cfg.syl_vocab = syl_vocab
    cfg.use_condition_in_score = use_condition_in_score
    cfg.use_weak_prior = False
    cfg.variant = "B0" if not use_condition_in_score else "B1"
    model = Model2StageAV1(cfg)
    missing, unexpected = model.load_state_dict(ckpt["state_dict"], strict=False)
    return model


def set_trainable(model: Model2StageAV1, mode: str) -> None:
    """S0: condition-only; S1: joint low-LR capable (all requires_grad True)."""
    for p in model.parameters():
        p.requires_grad = True
    if mode == "S0":
        for p in model.shared.parameters():
            p.requires_grad = False
        for p in model.query_encoder.parameters():
            p.requires_grad = False
        for p in model.candidate_encoder.parameters():
            p.requires_grad = False
        # train condition_encoder + condition_gate (+ optionally no_match stays frozen)
        model.no_match_embed.requires_grad = False
        for p in model.weak_scorer.parameters():
            p.requires_grad = False
    elif mode == "S1":
        pass  # all trainable
    else:
        raise ValueError(mode)


def _mixed_rows(rows: list[dict[str, Any]], split: str) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        if r.get("split") != split:
            continue
        if r.get("sample_kind") in ("POSITIVE", "NEGATIVE", "HARD_NEGATIVE"):
            # Skip ineligible leftovers
            if r.get("eligibility_class") in (
                "INELIGIBLE_ALIGNMENT",
                "INELIGIBLE_NON_TERM",
                "INELIGIBLE_REALIZATION",
            ):
                continue
            out.append(r)
    return out


def _batch_with_profile(
    batch: dict[str, Any],
    rows_meta: list[dict[str, Any]],
    mode: str,
    trainable_mask: list[int],
    rng: random.Random,
) -> dict[str, Any]:
    """Replace phonetic tensors in a collated batch according to profile mode."""
    b = {k: (v.clone() if torch.is_tensor(v) else v) for k, v in batch.items()}
    n = b["phonetic_condition"].size(0)
    for i in range(n):
        meta = rows_meta[i]
        bias = dict(meta.get("phonetic_bias_snapshot") or (meta.get("provenance") or {}).get("phonetic_bias_snapshot") or {})
        fam = meta.get("corruption_family") or (meta.get("provenance") or {}).get("corruption_family")
        if mode == "correct":
            prof = profile_vectors_from_bias(bias, trainable_mask=trainable_mask, mode="correct")
            if meta.get("user_kind") == "neutral":
                prof = profile_vectors_from_bias({}, trainable_mask=trainable_mask, mode="neutral")
        elif mode == "empty" or mode == "unavailable":
            prof = profile_vectors_from_bias({}, trainable_mask=trainable_mask, mode="unavailable")
        elif mode == "neutral":
            prof = profile_vectors_from_bias({}, trainable_mask=trainable_mask, mode="neutral")
        elif mode == "wrong":
            others = make_wrong_profiles(bias, family=fam, trainable_mask=trainable_mask)
            # rotate among wrong types
            key = rng.choice(["wp_irrelevant", "wp_opposite", "wp_other_user"])
            prof = others[key]
        else:
            raise ValueError(mode)
        b["phonetic_condition"][i] = torch.tensor(prof["phonetic_condition"], dtype=torch.float)
        b["phonetic_mask"][i] = torch.tensor(prof["phonetic_mask"], dtype=torch.long)
        b["phonetic_profile_acoustically_realized"][i] = int(prof["phonetic_profile_acoustically_realized"])
        b["tone_mask"][i] = torch.tensor(prof["tone_mask"], dtype=torch.long)
        b["domain_mask"][i] = torch.tensor(prof["domain_mask"], dtype=torch.long)
    return b


def train_stage_b(
    model: Model2StageAV1,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    *,
    trainable_mask: list[int],
    equal_weight: bool,
    epochs_s0: int = 8,
    epochs_s1: int = 12,
    lr_s0: float = 1e-3,
    lr_s1: float = 2e-4,
    lambda_cond: float = 0.5,
    log_path: Optional[Path] = None,
) -> dict[str, Any]:
    device = torch.device(cfg.device)
    model = model.to(device)
    rng = random.Random(cfg.seed + 17)
    history: list[dict[str, Any]] = []
    log_f = log_path.open("a", encoding="utf-8") if log_path else None

    def _run_phase(phase: str, n_epochs: int, lr: float) -> None:
        set_trainable(model, phase)
        params = [p for p in model.parameters() if p.requires_grad]
        opt = torch.optim.AdamW(params, lr=lr, weight_decay=cfg.weight_decay)
        for epoch in range(1, n_epochs + 1):
            model.train()
            mixed = _mixed_rows(rows, "train")
            # Optional equal-weight: override supervision weights to 1 for trainable fams
            if equal_weight:
                for r in mixed:
                    r = r  # noqa — weights read from row; clone on the fly in batch
            ds = StageADataset(mixed, cand_cache, mode="all", max_pool=cfg.max_pool)
            ds.rows = mixed
            loader = DataLoader(ds, batch_size=cfg.batch_size, shuffle=True, collate_fn=collate_stage_a)
            # Keep parallel meta list: DataLoader shuffle breaks alignment — rebuild each batch from ids
            by_id = {r["trainrow_id"]: r for r in mixed}
            totals = {
                "loss": 0.0,
                "l_pos": 0.0,
                "l_neg": 0.0,
                "l_hn": 0.0,
                "l_cond": 0.0,
                "n": 0,
            }
            for batch in loader:
                metas = [by_id[tid] for tid in batch["trainrow_id"]]
                if equal_weight:
                    batch["condition_supervision_weight"] = torch.ones_like(
                        batch["condition_supervision_weight"]
                    )
                else:
                    # already in batch from rows
                    pass
                batch_c = _batch_with_profile(batch, metas, "correct", trainable_mask, rng)
                batch_e = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
                batch_w = _batch_with_profile(batch, metas, "wrong", trainable_mask, rng)
                batch_c_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch_c.items()}
                batch_e_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch_e.items()}
                batch_w_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch_w.items()}
                out_c = model(batch_c_t)
                out_e = model(batch_e_t)
                out_w = model(batch_w_t)
                parts = compose_loss_stage_b(
                    out_c,
                    out_e,
                    out_w,
                    batch_c_t,
                    lambda_neg=cfg.lambda_neg,
                    lambda_hn=cfg.lambda_hn,
                    lambda_cond=lambda_cond,
                    hn_margin=cfg.hn_margin,
                )
                loss = parts["loss"]
                if not torch.isfinite(loss):
                    continue
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                opt.step()
                totals["loss"] += float(loss.item())
                totals["l_pos"] += float(parts["l_pos"].item())
                totals["l_neg"] += float(parts["l_neg"].item())
                totals["l_hn"] += float(parts["l_hn"].item())
                totals["l_cond"] += float(parts["l_cond"].item())
                totals["n"] += 1
            n = max(1, totals["n"])
            rec = {
                "phase": phase,
                "epoch": epoch,
                "loss": totals["loss"] / n,
                "l_pos": totals["l_pos"] / n,
                "l_neg": totals["l_neg"] / n,
                "l_hn": totals["l_hn"] / n,
                "l_cond": totals["l_cond"] / n,
            }
            history.append(rec)
            if log_f:
                import json

                log_f.write(json.dumps(rec) + "\n")
                log_f.flush()

    if epochs_s0 > 0:
        _run_phase("S0", epochs_s0, lr_s0)
    if epochs_s1 > 0:
        _run_phase("S1", epochs_s1, lr_s1)
    if log_f:
        log_f.close()
    return {"history": history, "params": count_parameters(model)}


def tiny_condition_overfit(
    model: Model2StageAV1,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    trainable_mask: list[int],
    *,
    n: int = 96,
    epochs: int = 60,
    lr: float = 2e-3,
    lambda_cond: float = 1.0,
) -> dict[str, Any]:
    """Must learn Correct > Empty/Wrong on tiny pronunciation positives."""
    device = torch.device(cfg.device)
    model = model.to(device)
    rng = random.Random(cfg.seed)
    pron = [
        r
        for r in rows
        if r.get("is_pronunciation_positive")
        and r.get("target_in_pool")
        and r.get("positive_pool_index") is not None
        and r.get("split") == "train"
    ]
    rng.shuffle(pron)
    tiny = pron[:n]
    if len(tiny) < 16:
        return {"pass": False, "reason": "too_few_pronunciation_positives", "n": len(tiny)}

    set_trainable(model, "S0")
    # Also allow gate
    model.condition_gate.requires_grad = True
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr)

    by_id = {r["trainrow_id"]: r for r in tiny}
    ds = StageADataset(tiny, cand_cache, mode="all", max_pool=cfg.max_pool)
    ds.rows = tiny

    for _ in range(epochs):
        model.train()
        loader = DataLoader(ds, batch_size=min(16, len(tiny)), shuffle=True, collate_fn=collate_stage_a)
        for batch in loader:
            metas = [by_id[tid] for tid in batch["trainrow_id"]]
            batch_c = _batch_with_profile(batch, metas, "correct", trainable_mask, rng)
            batch_e = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
            batch_w = _batch_with_profile(batch, metas, "wrong", trainable_mask, rng)
            batch_c_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch_c.items()}
            batch_e_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch_e.items()}
            batch_w_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch_w.items()}
            out_c = model(batch_c_t)
            out_e = model(batch_e_t)
            out_w = model(batch_w_t)
            parts = compose_loss_stage_b(
                out_c,
                out_e,
                out_w,
                batch_c_t,
                lambda_neg=0.25,
                lambda_hn=0.25,
                lambda_cond=lambda_cond,
                hn_margin=cfg.hn_margin,
            )
            opt.zero_grad()
            parts["loss"].backward()
            opt.step()

    # Eval Correct vs Empty target scores
    model.eval()
    gains = []
    with torch.no_grad():
        loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
        for batch in loader:
            metas = [by_id[tid] for tid in batch["trainrow_id"]]
            batch_c = _batch_with_profile(batch, metas, "correct", trainable_mask, rng)
            batch_e = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
            batch_c_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch_c.items()}
            batch_e_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch_e.items()}
            sc = model(batch_c_t)["scores"]
            se = model(batch_e_t)["scores"]
            idx = batch_c_t["positive_pool_index"]
            b = torch.arange(sc.size(0), device=device)
            gains.extend((sc[b, idx] - se[b, idx]).cpu().tolist())
    mean_gain = sum(gains) / max(1, len(gains))
    frac_pos = sum(1 for g in gains if g > 0.01) / max(1, len(gains))
    ok = mean_gain > 0.02 and frac_pos >= 0.55
    return {
        "pass": ok,
        "n": len(tiny),
        "mean_target_score_gain": mean_gain,
        "frac_positive_gain": frac_pos,
        "epochs": epochs,
    }
