"""Minimal Stage A trainer (probe only)."""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
from torch.utils.data import DataLoader

from training.model2.model.model_v1 import Model2Config, Model2StageAV1, count_parameters
from training.model2.training.config import StageATrainConfig
from training.model2.training.dataset import StageADataset, collate_stage_a
from training.model2.training.losses import compose_loss


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def build_model(cfg: StageATrainConfig, variant: str, syl_vocab: int) -> Model2StageAV1:
    mcfg = Model2Config(
        variant=variant,
        embed_dim=cfg.embed_dim,
        char_dim=cfg.char_dim,
        syl_dim=cfg.syl_dim,
        hidden=cfg.hidden,
        syl_vocab=syl_vocab,
        use_weak_prior=(variant == "M1"),
        use_condition_in_score=False,
        # Skeleton matches frozen Stage B (Scorer V2); unused while use_condition_in_score=False.
        use_relation_condition=True,
        use_condition_scorer_v2=True,
    )
    return Model2StageAV1(mcfg)


def _mixed_loader(
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    *,
    split: Optional[str] = "train",
    shuffle: bool = True,
) -> DataLoader:
    """Mix TERM_POSITIVE + NEGATIVE + injected HN for one epoch stream."""
    pos = StageADataset(rows, cand_cache, mode="term_positive", max_pool=cfg.max_pool)
    neg = StageADataset(rows, cand_cache, mode="negative", max_pool=cfg.max_pool)
    hn = StageADataset(rows, cand_cache, mode="hard_negative", max_pool=cfg.max_pool)
    mixed = []
    for ds in (pos, neg, hn):
        for r in ds.rows:
            if split is None or r.get("split") == split:
                mixed.append(r)
    ds_all = StageADataset(mixed, cand_cache, mode="all", max_pool=cfg.max_pool)
    # Override rows to mixed filtered
    ds_all.rows = mixed
    return DataLoader(
        ds_all,
        batch_size=cfg.batch_size,
        shuffle=shuffle,
        collate_fn=collate_stage_a,
    )


def train_one(
    model: Model2StageAV1,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    *,
    epochs: Optional[int] = None,
    lr: Optional[float] = None,
    split_train: str = "train",
    log_path: Optional[Path] = None,
) -> dict[str, Any]:
    device = torch.device(cfg.device)
    model = model.to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr or cfg.lr, weight_decay=cfg.weight_decay)
    n_epochs = epochs or cfg.epochs
    history = []
    log_f = log_path.open("a", encoding="utf-8") if log_path else None

    for epoch in range(1, n_epochs + 1):
        model.train()
        loader = _mixed_loader(rows, cand_cache, cfg, split=split_train, shuffle=True)
        totals = {"loss": 0.0, "l_pos": 0.0, "l_neg": 0.0, "l_hn": 0.0, "n": 0, "n_pos": 0, "n_neg": 0, "n_hn": 0}
        nan = False
        for batch in loader:
            batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
            out = model(batch_t)
            parts = compose_loss(
                out,
                batch_t,
                lambda_neg=cfg.lambda_neg,
                lambda_hn=cfg.lambda_hn,
                hn_margin=cfg.hn_margin,
            )
            loss = parts["loss"]
            if not torch.isfinite(loss):
                nan = True
                break
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            bs = batch_t["span_char_ids"].size(0)
            totals["loss"] += float(loss.item()) * bs
            totals["l_pos"] += float(parts["l_pos"].item()) * bs
            totals["l_neg"] += float(parts["l_neg"].item()) * bs
            totals["l_hn"] += float(parts["l_hn"].item()) * bs
            totals["n"] += bs
            totals["n_neg"] = totals.get("n_neg", 0) + int(parts["n_neg"].item())
            totals["n_pos"] = totals.get("n_pos", 0) + int(parts["n_pos"].item())
            totals["n_hn"] = totals.get("n_hn", 0) + int(parts["n_hn"].item())
        if nan:
            return {"ok": False, "error": "NaN/Inf", "history": history}
        n = max(1, totals["n"])
        row = {
            "epoch": epoch,
            "train_loss": totals["loss"] / n,
            "l_pos": totals["l_pos"] / n,
            "l_neg": totals["l_neg"] / n,
            "l_hn": totals["l_hn"] / n,
            "n": totals["n"],
            "n_pos": totals["n_pos"],
            "n_neg": totals["n_neg"],
            "n_hn": totals["n_hn"],
        }
        # light val
        val_loss = eval_loss(model, rows, cand_cache, cfg, split="validation")
        row["val_loss"] = val_loss
        history.append(row)
        if log_f:
            log_f.write(json.dumps(row, ensure_ascii=False) + "\n")
            log_f.flush()

    if log_f:
        log_f.close()
    return {
        "ok": True,
        "history": history,
        "final_train_loss": history[-1]["train_loss"] if history else None,
        "final_val_loss": history[-1]["val_loss"] if history else None,
        "param_count": count_parameters(model),
    }


@torch.no_grad()
def eval_loss(
    model: Model2StageAV1,
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    *,
    split: str,
) -> float:
    device = next(model.parameters()).device
    model.eval()
    loader = _mixed_loader(rows, cand_cache, cfg, split=split, shuffle=False)
    if len(loader.dataset) == 0:
        return float("nan")
    total = 0.0
    n = 0
    for batch in loader:
        batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
        out = model(batch_t)
        parts = compose_loss(
            out,
            batch_t,
            lambda_neg=cfg.lambda_neg,
            lambda_hn=cfg.lambda_hn,
            hn_margin=cfg.hn_margin,
        )
        bs = batch_t["span_char_ids"].size(0)
        total += float(parts["loss"].item()) * bs
        n += bs
    return total / max(1, n)


def tiny_overfit_test(
    rows: list[dict[str, Any]],
    cand_cache: dict,
    cfg: StageATrainConfig,
    syl_vocab: int,
) -> tuple[Model2StageAV1, dict[str, Any]]:
    set_seed(cfg.seed)
    pos_rows = [
        r
        for r in rows
        if r.get("is_term_positive")
        and r.get("target_in_pool")
        and r.get("source_type") == "TTS_ASR_SYNTHETIC"
        and r.get("split") == "train"
    ]
    tiny = pos_rows[: cfg.tiny_n]
    model = build_model(cfg, "M0", syl_vocab)
    # train only on tiny positives (still allow empty neg/hn → zero loss)
    device = torch.device(cfg.device)
    model = model.to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.tiny_lr, weight_decay=0.0)
    ds = StageADataset(tiny, cand_cache, mode="term_positive", max_pool=cfg.max_pool)
    loader = DataLoader(ds, batch_size=min(8, len(ds)), shuffle=True, collate_fn=collate_stage_a)

    history = []
    for epoch in range(1, cfg.tiny_epochs + 1):
        model.train()
        total = 0.0
        n = 0
        for batch in loader:
            batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
            # force kind POSITIVE
            batch_t["sample_kind"] = ["POSITIVE"] * batch_t["span_char_ids"].size(0)
            out = model(batch_t)
            parts = compose_loss(out, batch_t, lambda_neg=0.0, lambda_hn=0.0, hn_margin=cfg.hn_margin)
            loss = parts["loss"]
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += float(loss.item()) * batch_t["span_char_ids"].size(0)
            n += batch_t["span_char_ids"].size(0)
        # recall@1 on tiny
        r1 = _recall_at1(model, tiny, cand_cache, cfg)
        history.append({"epoch": epoch, "loss": total / max(1, n), "recall_at_1": r1})

    ok = history[-1]["recall_at_1"] >= 0.85 and history[-1]["loss"] < history[0]["loss"]
    return model, {
        "ok": ok,
        "n": len(tiny),
        "history": history[:: max(1, len(history) // 10)] + [history[-1]],
        "final_loss": history[-1]["loss"],
        "final_recall_at_1": history[-1]["recall_at_1"],
        "initial_loss": history[0]["loss"],
        "gate": "PASS" if ok else "FAIL",
    }


@torch.no_grad()
def _recall_at1(model, rows, cand_cache, cfg) -> float:
    device = next(model.parameters()).device
    model.eval()
    ds = StageADataset(rows, cand_cache, mode="term_positive", max_pool=cfg.max_pool)
    if len(ds) == 0:
        return 0.0
    loader = DataLoader(ds, batch_size=32, shuffle=False, collate_fn=collate_stage_a)
    hit = 0
    n = 0
    for batch in loader:
        batch_t = {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}
        out = model(batch_t)
        # exclude NO_MATCH slot for positive recall
        pool_len = batch_t["pool_len"]
        scores = out["scores"]
        for i in range(scores.size(0)):
            p = int(pool_len[i].item())
            pred = int(scores[i, :p].argmax().item())
            tgt = int(batch_t["positive_pool_index"][i].item())
            if pred == tgt:
                hit += 1
            n += 1
    return hit / max(1, n)


def save_checkpoint(model: Model2StageAV1, path: Path, meta: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "state_dict": model.state_dict(),
            "config": model.cfg.to_dict(),
            "meta": meta,
            "markers": list(Model2StageAV1.ARTIFACT_MARKERS),
        },
        path,
    )
