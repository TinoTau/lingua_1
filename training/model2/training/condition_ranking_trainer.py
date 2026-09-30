"""Phase 6B condition-only ranking trainer (base frozen)."""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Optional

import torch
from torch.utils.data import DataLoader

from training.model2.model.model_v1 import Model2Config, Model2StageAV1, count_parameters
from training.model2.stage_b.condition import profile_vectors_from_bias
from training.model2.training.condition_losses_v2 import compose_loss_condition_ranking
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import StageADataset, collate_stage_a
from training.model2.training.stage_b_trainer import _batch_with_profile


def load_stage_a_for_6b(path: Path, syl_vocab: int, *, delta_cap: float = 0.35) -> Model2StageAV1:
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    raw = ckpt.get("config") or {}
    fields = set(Model2Config.__dataclass_fields__.keys())
    cfg = Model2Config(**{k: v for k, v in raw.items() if k in fields})
    cfg.syl_vocab = syl_vocab
    cfg.use_condition_in_score = False
    cfg.use_relation_condition = True
    cfg.condition_delta_cap = delta_cap
    cfg.variant = "B1"
    model = Model2StageAV1(cfg)
    # Load overlapping weights; new modules randomly/zero-init
    model.load_state_dict(ckpt["state_dict"], strict=False)
    return model


def freeze_base_path(model: Model2StageAV1) -> None:
    for mod in (
        model.shared,
        model.query_encoder,
        model.candidate_encoder,
        model.condition_encoder,
        model.base_scorer,
        model.weak_scorer,
    ):
        for p in mod.parameters():
            p.requires_grad = False
    model.no_match_embed.requires_grad = False
    model.condition_gate.requires_grad = False
    for p in model.condition_compat.parameters():
        p.requires_grad = True
    model.relation_gate.requires_grad = True


def train_condition_only(
    model: Model2StageAV1,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    trainable_mask: list[int],
    *,
    equal_weight: bool,
    epochs: int = 25,
    lr: float = 1e-3,
    lambda_rank_cond: float = 1.0,
    lambda_wrong: float = 0.5,
    lambda_nochange: float = 0.5,
    log_path: Optional[Path] = None,
) -> dict[str, Any]:
    device = torch.device(cfg.device)
    model = model.to(device)
    freeze_base_path(model)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=cfg.weight_decay)
    rng = random.Random(cfg.seed + 21)
    history = []
    log_f = log_path.open("a", encoding="utf-8") if log_path else None

    train_rows = [
        r
        for r in rows
        if r.get("split") == "train"
        and r.get("sample_kind") == "POSITIVE"
        and (
            r.get("is_pronunciation_positive")
            or r.get("is_no_change")
            or r.get("eligibility_class") in ("ELIGIBLE_PRONUNCIATION_POSITIVE", "ELIGIBLE_NO_CHANGE")
        )
        and r.get("target_in_pool")
        and r.get("positive_pool_index") is not None
    ]
    by_id = {r["trainrow_id"]: r for r in train_rows}
    ds = StageADataset(train_rows, cand_cache, mode="all", max_pool=cfg.max_pool)
    ds.rows = train_rows

    for epoch in range(1, epochs + 1):
        model.train()
        # Keep base modules in eval for BatchNorm-free but consistent dropout-free path
        model.query_encoder.eval()
        model.candidate_encoder.eval()
        loader = DataLoader(ds, batch_size=cfg.batch_size, shuffle=True, collate_fn=collate_stage_a)
        totals = {"loss": 0.0, "l_rank_cond": 0.0, "l_wrong": 0.0, "l_nochange": 0.0, "n": 0}
        for batch in loader:
            metas = [by_id[tid] for tid in batch["trainrow_id"]]
            if equal_weight:
                batch["condition_supervision_weight"] = torch.ones_like(batch["condition_supervision_weight"])
            b_c = _batch_with_profile(batch, metas, "correct", trainable_mask, rng)
            b_e = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
            b_w = _batch_with_profile(batch, metas, "wrong", trainable_mask, rng)
            # relation features stay identical across profile variants
            for bb in (b_c, b_e, b_w):
                bb["cand_relation_features"] = batch["cand_relation_features"]
                bb["is_no_change"] = batch["is_no_change"]
                bb["is_pronunciation_positive"] = batch["is_pronunciation_positive"]
                bb["condition_supervision_weight"] = batch["condition_supervision_weight"]
            bt_c = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_c.items()}
            bt_e = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_e.items()}
            bt_w = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_w.items()}
            out_c = model(bt_c)
            out_e = model(bt_e)
            out_w = model(bt_w)
            parts = compose_loss_condition_ranking(
                out_c,
                out_e,
                out_w,
                bt_c,
                lambda_rank_cond=lambda_rank_cond,
                lambda_wrong=lambda_wrong,
                lambda_nochange=lambda_nochange,
            )
            loss = parts["loss"]
            if not torch.isfinite(loss):
                continue
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            opt.step()
            totals["loss"] += float(loss.item())
            totals["l_rank_cond"] += float(parts["l_rank_cond"].item())
            totals["l_wrong"] += float(parts["l_wrong"].item())
            totals["l_nochange"] += float(parts["l_nochange"].item())
            totals["n"] += 1
        n = max(1, totals["n"])
        rec = {k: (totals[k] / n if k != "n" else totals[k]) for k in totals}
        rec["epoch"] = epoch
        history.append(rec)
        if log_f:
            log_f.write(json.dumps(rec) + "\n")
            log_f.flush()
    if log_f:
        log_f.close()
    return {"history": history, "params": count_parameters(model), "n_train": len(train_rows)}


def tiny_ranking_overfit(
    model: Model2StageAV1,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    trainable_mask: list[int],
    *,
    n: int = 96,
    epochs: int = 80,
    lr: float = 2e-3,
) -> dict[str, Any]:
    device = torch.device(cfg.device)
    model = model.to(device)
    freeze_base_path(model)
    rng = random.Random(cfg.seed)
    pron = [
        r
        for r in rows
        if r.get("is_pronunciation_positive")
        and r.get("target_in_pool")
        and r.get("positive_pool_index") is not None
        and r.get("split") == "train"
        and len(r.get("fuzzy_pool_term_ids") or []) > 1
    ]
    rng.shuffle(pron)
    # Prefer samples where empty/base does not already put target at rank0
    model.eval()
    hard: list[dict[str, Any]] = []
    easy: list[dict[str, Any]] = []
    probe = StageADataset(pron[: min(300, len(pron))], cand_cache, mode="all", max_pool=cfg.max_pool)
    probe.rows = pron[: min(300, len(pron))]
    by_probe = {r["trainrow_id"]: r for r in probe.rows}
    with torch.no_grad():
        loader_p = DataLoader(probe, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
        for batch in loader_p:
            metas = [by_probe[tid] for tid in batch["trainrow_id"]]
            b_e = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
            b_e["cand_relation_features"] = batch["cand_relation_features"]
            bt = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_e.items()}
            se = model(bt)["scores"]
            for i, meta in enumerate(metas):
                tgt = int(batch["positive_pool_index"][i].item())
                plen = int(batch["pool_len"][i].item())
                re = int(se[i, :plen].argsort(descending=True).tolist().index(tgt))
                if re > 0:
                    hard.append(meta)
                else:
                    easy.append(meta)
    tiny = (hard + easy)[:n]
    if len(tiny) < 16:
        return {"pass": False, "reason": "too_few", "n": len(tiny)}
    hard_ids = {h["trainrow_id"] for h in hard}
    n_hard = sum(1 for r in tiny if r["trainrow_id"] in hard_ids)

    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr)
    by_id = {r["trainrow_id"]: r for r in tiny}
    ds = StageADataset(tiny, cand_cache, mode="all", max_pool=cfg.max_pool)
    ds.rows = tiny

    for _ in range(epochs):
        model.train()
        model.query_encoder.eval()
        model.candidate_encoder.eval()
        loader = DataLoader(ds, batch_size=min(16, len(tiny)), shuffle=True, collate_fn=collate_stage_a)
        for batch in loader:
            metas = [by_id[tid] for tid in batch["trainrow_id"]]
            b_c = _batch_with_profile(batch, metas, "correct", trainable_mask, rng)
            b_e = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
            b_w = _batch_with_profile(batch, metas, "wrong", trainable_mask, rng)
            for bb in (b_c, b_e, b_w):
                bb["cand_relation_features"] = batch["cand_relation_features"]
                bb["is_no_change"] = batch.get("is_no_change", torch.zeros_like(batch["is_pronunciation_positive"]))
                bb["is_pronunciation_positive"] = batch["is_pronunciation_positive"]
                bb["condition_supervision_weight"] = batch["condition_supervision_weight"]
            bt_c = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_c.items()}
            bt_e = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_e.items()}
            bt_w = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_w.items()}
            parts = compose_loss_condition_ranking(
                model(bt_c),
                model(bt_e),
                model(bt_w),
                bt_c,
                lambda_rank_cond=1.5,
                lambda_wrong=0.75,
                lambda_nochange=0.25,
                margin_delta=0.1,
            )
            opt.zero_grad()
            parts["loss"].backward()
            opt.step()

    # Eval ranks
    model.eval()
    improved = 0
    tied = 0
    worse = 0
    rank_deltas = []
    margin_gains = []
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
    with torch.no_grad():
        for batch in loader:
            metas = [by_id[tid] for tid in batch["trainrow_id"]]
            b_c = _batch_with_profile(batch, metas, "correct", trainable_mask, rng)
            b_e = _batch_with_profile(batch, metas, "unavailable", trainable_mask, rng)
            b_c["cand_relation_features"] = batch["cand_relation_features"]
            b_e["cand_relation_features"] = batch["cand_relation_features"]
            bt_c = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_c.items()}
            bt_e = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_e.items()}
            sc = model(bt_c)["scores"]
            se = model(bt_e)["scores"]
            for i in range(sc.size(0)):
                tgt = int(batch["positive_pool_index"][i].item())
                plen = int(batch["pool_len"][i].item())
                rc = int(sc[i, :plen].argsort(descending=True).tolist().index(tgt))
                re = int(se[i, :plen].argsort(descending=True).tolist().index(tgt))
                d = re - rc  # positive => correct improved rank
                rank_deltas.append(d)

                def _m(s):
                    t = float(s[tgt])
                    mask = [j for j in range(plen) if j != tgt]
                    c = max(float(s[j]) for j in mask) if mask else t
                    return t - c

                margin_gains.append(_m(sc[i]) - _m(se[i]))
                if d > 0:
                    improved += 1
                elif d == 0:
                    tied += 1
                else:
                    worse += 1
    n_all = max(1, len(rank_deltas))
    mean_delta = sum(rank_deltas) / n_all
    mean_mg = sum(margin_gains) / n_all
    frac_impr = improved / n_all
    # Margin gain is primary evidence of ranking-aware learning; rank flips on hard slice
    ok = mean_mg > 0.05 and (mean_delta >= 0.05 or frac_impr >= 0.20)
    return {
        "pass": ok,
        "n": len(tiny),
        "n_hard_non_rank0_empty": n_hard,
        "mean_target_rank_delta": mean_delta,
        "frac_rank_improved": frac_impr,
        "frac_tied": tied / n_all,
        "frac_worse": worse / n_all,
        "mean_margin_gain": mean_mg,
        "epochs": epochs,
    }
