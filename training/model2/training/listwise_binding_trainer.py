"""Phase 6C listwise counterfactual trainer (base frozen, BOUND-only)."""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Optional

import torch
from torch.utils.data import DataLoader

from training.model2.model.model_v1 import Model2Config, Model2StageAV1, count_parameters
from training.model2.stage_b.active_feature_mask import BOUND_FEATURES_V1
from training.model2.training.condition_ranking_trainer import freeze_base_path
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import StageADataset, collate_stage_a
from training.model2.training.listwise_cf_losses import compose_listwise_cf_loss, target_prob_from_scores
from training.model2.training.stage_b_trainer import _batch_with_profile


def load_stage_a_for_6c(path: Path, syl_vocab: int, *, delta_cap: float = 0.5) -> Model2StageAV1:
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    raw = ckpt.get("config") or {}
    fields = set(Model2Config.__dataclass_fields__.keys())
    cfg = Model2Config(**{k: v for k, v in raw.items() if k in fields})
    cfg.syl_vocab = syl_vocab
    cfg.use_condition_in_score = False
    cfg.use_relation_condition = True
    cfg.use_condition_scorer_v2 = True
    cfg.condition_delta_cap = delta_cap
    cfg.variant = "B1_LISTWISE"
    model = Model2StageAV1(cfg)
    # Stage A may ship V1 condition_compat (17-in); Scorer V2 needs 18-in.
    # Keep overlapping base weights; re-init mismatched condition modules (same as 6C probe path).
    src = ckpt["state_dict"]
    dst = model.state_dict()
    filtered = {
        k: v
        for k, v in src.items()
        if k in dst and getattr(v, "shape", None) == getattr(dst[k], "shape", None)
    }
    model.load_state_dict(filtered, strict=False)
    return model


def apply_active_mask_to_batch(batch: dict, active_mask: list[int]) -> dict:
    b = batch
    am = torch.tensor(active_mask, dtype=b["phonetic_mask"].dtype, device=b["phonetic_mask"].device)
    b["phonetic_mask"] = b["phonetic_mask"] * am.view(1, -1)
    return b


def filter_bound_rows(rows: list[dict[str, Any]], *, split: Optional[str] = None) -> list[dict[str, Any]]:
    out = []
    for r in rows:
        if split and r.get("split") != split:
            continue
        if not r.get("is_pronunciation_positive"):
            # keep no-change for safety loss
            if r.get("is_no_change") or r.get("eligibility_class") == "ELIGIBLE_NO_CHANGE":
                if r.get("target_in_pool") and r.get("positive_pool_index") is not None:
                    out.append(r)
            continue
        fam = r.get("corruption_family")
        if fam in BOUND_FEATURES_V1 and r.get("target_in_pool") and r.get("positive_pool_index") is not None:
            out.append(r)
    return out


def train_listwise_bound(
    model: Model2StageAV1,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    active_mask: list[int],
    *,
    epochs: int = 30,
    lr: float = 1e-3,
    log_path: Optional[Path] = None,
) -> dict[str, Any]:
    device = torch.device(cfg.device)
    model = model.to(device)
    freeze_base_path(model)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=cfg.weight_decay)
    rng = random.Random(cfg.seed + 31)
    train_rows = filter_bound_rows(rows, split="train")
    # also include no-change from train for safety
    by_id = {r["trainrow_id"]: r for r in train_rows}
    ds = StageADataset(train_rows, cand_cache, mode="all", max_pool=cfg.max_pool)
    ds.rows = train_rows
    history = []
    log_f = log_path.open("a", encoding="utf-8") if log_path else None

    for epoch in range(1, epochs + 1):
        model.train()
        model.query_encoder.eval()
        model.candidate_encoder.eval()
        loader = DataLoader(ds, batch_size=cfg.batch_size, shuffle=True, collate_fn=collate_stage_a)
        totals = {"loss": 0.0, "l_list": 0.0, "l_cf_empty": 0.0, "l_cf_wrong": 0.0, "n": 0}
        for batch in loader:
            metas = [by_id[tid] for tid in batch["trainrow_id"]]
            b_c = apply_active_mask_to_batch(_batch_with_profile(batch, metas, "correct", active_mask, rng), active_mask)
            b_e = apply_active_mask_to_batch(
                _batch_with_profile(batch, metas, "unavailable", active_mask, rng), active_mask
            )
            b_w = apply_active_mask_to_batch(_batch_with_profile(batch, metas, "wrong", active_mask, rng), active_mask)
            for bb in (b_c, b_e, b_w):
                bb["cand_relation_features"] = batch["cand_relation_features"]
                bb["is_no_change"] = batch.get("is_no_change", torch.zeros_like(batch["is_pronunciation_positive"]))
                bb["is_pronunciation_positive"] = batch["is_pronunciation_positive"]
                bb["condition_supervision_weight"] = batch["condition_supervision_weight"]
            bt_c = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_c.items()}
            bt_e = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_e.items()}
            bt_w = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_w.items()}
            parts = compose_listwise_cf_loss(model(bt_c), model(bt_e), model(bt_w), bt_c)
            loss = parts["loss"]
            if not torch.isfinite(loss):
                continue
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            opt.step()
            totals["loss"] += float(loss.item())
            totals["l_list"] += float(parts["l_list"].item())
            totals["l_cf_empty"] += float(parts["l_cf_empty"].item())
            totals["l_cf_wrong"] += float(parts["l_cf_wrong"].item())
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


@torch.no_grad()
def tiny_interaction_ablation(
    model: Model2StageAV1,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    active_mask: list[int],
    *,
    n: int = 64,
) -> dict[str, Any]:
    from training.model2.evaluation.condition_ranking_metrics import relation_ablation

    use = filter_bound_rows(rows)
    use = [r for r in use if r.get("is_pronunciation_positive") and r.get("split") in ("validation", "test", "train")]
    return relation_ablation(model, use[:n], cand_cache, active_mask, max_n=n, max_pool=cfg.max_pool)


@torch.no_grad()
def tiny_swap_gate(
    model: Model2StageAV1,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    active_mask: list[int],
    *,
    n: int = 64,
) -> dict[str, Any]:
    from training.model2.evaluation.condition_ranking_metrics import profile_swap_ranking

    use = [
        r
        for r in filter_bound_rows(rows)
        if r.get("is_pronunciation_positive") and r.get("split") in ("validation", "test", "train")
    ]
    return profile_swap_ranking(model, use, cand_cache, active_mask, max_pool=cfg.max_pool, n=n)


def tiny_listwise_overfit(
    model: Model2StageAV1,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    active_mask: list[int],
    *,
    n: int = 96,
    epochs: int = 100,
    lr: float = 2e-3,
) -> dict[str, Any]:
    device = torch.device(cfg.device)
    model = model.to(device)
    freeze_base_path(model)
    rng = random.Random(cfg.seed)
    candidates = [
        r
        for r in filter_bound_rows(rows, split="train")
        if r.get("is_pronunciation_positive")
        and len(r.get("fuzzy_pool_term_ids") or []) >= 3
    ]
    rng.shuffle(candidates)
    # Prefer non-rank1 under empty
    hard = []
    probe = StageADataset(candidates[: min(400, len(candidates))], cand_cache, mode="all", max_pool=cfg.max_pool)
    probe.rows = candidates[: min(400, len(candidates))]
    by_p = {r["trainrow_id"]: r for r in probe.rows}
    with torch.no_grad():
        for batch in DataLoader(probe, batch_size=32, shuffle=False, collate_fn=collate_stage_a):
            metas = [by_p[tid] for tid in batch["trainrow_id"]]
            b_e = apply_active_mask_to_batch(
                _batch_with_profile(batch, metas, "unavailable", active_mask, rng), active_mask
            )
            b_e["cand_relation_features"] = batch["cand_relation_features"]
            se = model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_e.items()})["scores"]
            for i, meta in enumerate(metas):
                tgt = int(batch["positive_pool_index"][i].item())
                plen = int(batch["pool_len"][i].item())
                # require family-related mass on target (after observed-syllable repair)
                fam = meta.get("corruption_family")
                from training.model2.contract import PHONETIC_FEATURE_INDEX_V1

                fi = PHONETIC_FEATURE_INDEX_V1.get(fam) if fam else None
                if fi is None:
                    rel = batch["cand_relation_features"][i, tgt].abs().sum().item()
                else:
                    rel = float(batch["cand_relation_features"][i, tgt, fi].abs().item())
                re = int(se[i, :plen].argsort(descending=True).tolist().index(tgt))
                if re > 0 and rel > 1e-6:
                    hard.append(meta)
    tiny = hard[:n] if len(hard) >= 16 else (hard + candidates)[:n]
    if len(tiny) < 16:
        return {"pass": False, "reason": "too_few_hard_bound", "n": len(tiny), "n_hard": len(hard)}

    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr)
    by_id = {r["trainrow_id"]: r for r in tiny}
    ds = StageADataset(tiny, cand_cache, mode="all", max_pool=cfg.max_pool)
    ds.rows = tiny
    for _ in range(epochs):
        model.train()
        model.query_encoder.eval()
        model.candidate_encoder.eval()
        for batch in DataLoader(ds, batch_size=min(16, len(tiny)), shuffle=True, collate_fn=collate_stage_a):
            metas = [by_id[tid] for tid in batch["trainrow_id"]]
            b_c = apply_active_mask_to_batch(_batch_with_profile(batch, metas, "correct", active_mask, rng), active_mask)
            b_e = apply_active_mask_to_batch(
                _batch_with_profile(batch, metas, "unavailable", active_mask, rng), active_mask
            )
            b_w = apply_active_mask_to_batch(_batch_with_profile(batch, metas, "wrong", active_mask, rng), active_mask)
            for bb in (b_c, b_e, b_w):
                bb["cand_relation_features"] = batch["cand_relation_features"]
                bb["is_no_change"] = torch.zeros_like(batch["is_pronunciation_positive"])
                bb["is_pronunciation_positive"] = batch["is_pronunciation_positive"]
                bb["condition_supervision_weight"] = batch["condition_supervision_weight"]
            bt_c = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_c.items()}
            parts = compose_listwise_cf_loss(
                model(bt_c),
                model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_e.items()}),
                model({k: v.to(device) if torch.is_tensor(v) else v for k, v in b_w.items()}),
                bt_c,
                prob_margin=0.03,
            )
            opt.zero_grad()
            parts["loss"].backward()
            opt.step()

    model.eval()
    rank_deltas, prob_gains, improved = [], [], 0
    with torch.no_grad():
        for batch in DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a):
            metas = [by_id[tid] for tid in batch["trainrow_id"]]
            b_c = apply_active_mask_to_batch(_batch_with_profile(batch, metas, "correct", active_mask, rng), active_mask)
            b_e = apply_active_mask_to_batch(
                _batch_with_profile(batch, metas, "unavailable", active_mask, rng), active_mask
            )
            b_c["cand_relation_features"] = batch["cand_relation_features"]
            b_e["cand_relation_features"] = batch["cand_relation_features"]
            bt_c = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_c.items()}
            bt_e = {k: v.to(device) if torch.is_tensor(v) else v for k, v in b_e.items()}
            oc, oe = model(bt_c), model(bt_e)
            pc = target_prob_from_scores(oc["scores"], batch["positive_pool_index"].to(device), batch["pool_len"].to(device))
            pe = target_prob_from_scores(oe["scores"], batch["positive_pool_index"].to(device), batch["pool_len"].to(device))
            for i in range(oc["scores"].size(0)):
                tgt = int(batch["positive_pool_index"][i].item())
                plen = int(batch["pool_len"][i].item())
                rc = int(oc["scores"][i, :plen].argsort(descending=True).tolist().index(tgt))
                re = int(oe["scores"][i, :plen].argsort(descending=True).tolist().index(tgt))
                d = re - rc
                rank_deltas.append(d)
                prob_gains.append(float(pc[i] - pe[i]))
                if d > 0:
                    improved += 1
    n_all = max(1, len(rank_deltas))
    mean_rd = sum(rank_deltas) / n_all
    mean_pg = sum(prob_gains) / n_all
    frac = improved / n_all
    # Tiny gate: mean rank improves; probability gain positive; some samples improve
    ok = mean_rd > 0.05 and mean_pg > 0.005 and frac >= 0.15 and len(hard) >= 8
    return {
        "pass": ok,
        "n": len(tiny),
        "n_hard_available": len(hard),
        "mean_target_rank_delta": mean_rd,
        "mean_target_probability_gain": mean_pg,
        "frac_rank_improved": frac,
        "epochs": epochs,
    }
