"""Phase 6C listwise counterfactual condition losses."""

from __future__ import annotations

from typing import Any, Optional

import torch
import torch.nn.functional as F


def _pool_log_softmax(scores: torch.Tensor, pool_len: torch.Tensor, temperature: float = 1.0) -> torch.Tensor:
    """Masked log-softmax over pool slots (exclude NO_MATCH / pad)."""
    bsz, pfull = scores.shape
    # use only first max_pool columns that are in pool_len; scores may include NO_MATCH
    out = scores.new_full((bsz, pfull), float("-inf"))
    t = max(1e-6, float(temperature))
    for i in range(bsz):
        plen = int(pool_len[i].item())
        if plen <= 0:
            continue
        out[i, :plen] = scores[i, :plen] / t
    return F.log_softmax(out, dim=-1)


def target_prob_from_scores(
    scores: torch.Tensor,
    pos_idx: torch.Tensor,
    pool_len: torch.Tensor,
    temperature: float = 1.0,
) -> torch.Tensor:
    logp = _pool_log_softmax(scores, pool_len, temperature=temperature)
    b = torch.arange(scores.size(0), device=scores.device)
    pi = pos_idx.clamp(min=0)
    return logp[b, pi].exp()


def compose_listwise_cf_loss(
    out_correct: dict[str, torch.Tensor],
    out_empty: dict[str, torch.Tensor],
    out_wrong: Optional[dict[str, torch.Tensor]],
    batch: dict[str, Any],
    *,
    lambda_list: float = 1.0,
    lambda_cf_empty: float = 1.0,
    lambda_cf_wrong: float = 0.75,
    lambda_nochange: float = 0.5,
    prob_margin: float = 0.02,
    temperature: float = 1.0,
) -> dict[str, torch.Tensor]:
    device = out_correct["scores"].device
    pos_idx = batch["positive_pool_index"]
    pool_len = batch["pool_len"]
    is_pron = batch["is_pronunciation_positive"].bool()
    is_nc = batch["is_no_change"].bool() if "is_no_change" in batch else torch.zeros_like(is_pron)
    valid = is_pron & (pos_idx >= 0) & (pool_len > 1)
    valid_nc = is_nc & (pos_idx >= 0) & (pool_len > 1)
    w = batch.get("condition_supervision_weight")
    if w is None:
        w = torch.ones(pos_idx.size(0), device=device, dtype=torch.float)
    else:
        w = w.float()

    logp_c = _pool_log_softmax(out_correct["scores"], pool_len, temperature)
    b = torch.arange(pos_idx.size(0), device=device)
    pi = pos_idx.clamp(min=0)
    # listwise CE on correct profile
    nll = -logp_c[b, pi]
    l_list = ((nll * valid.float() * w).sum() / (valid.float() * w).sum().clamp(min=1e-6)) if valid.any() else nll.new_zeros(())

    p_c = logp_c[b, pi].exp()
    p_e = target_prob_from_scores(out_empty["scores"], pos_idx, pool_len, temperature)
    l_cf_e = (
        (torch.relu(prob_margin - p_c + p_e) * valid.float() * w).sum()
        / (valid.float() * w).sum().clamp(min=1e-6)
        if valid.any()
        else p_c.new_zeros(())
    )

    l_cf_w = p_c.new_zeros(())
    p_w = None
    if out_wrong is not None:
        p_w = target_prob_from_scores(out_wrong["scores"], pos_idx, pool_len, temperature)
        l_cf_w = (
            (torch.relu(prob_margin - p_c + p_w) * valid.float() * w).sum()
            / (valid.float() * w).sum().clamp(min=1e-6)
            if valid.any()
            else p_c.new_zeros(())
        )

    # NO_CHANGE: correct must not raise non-target mass much vs empty
    l_nc = p_c.new_zeros(())
    if valid_nc.any():
        # probability of target under correct should not fall much below empty
        p_e_nc = p_e
        l_nc = (
            torch.relu(p_e_nc - p_c - 0.02) * valid_nc.float()
        ).sum() / valid_nc.float().sum().clamp(min=1e-6)

    total = lambda_list * l_list + lambda_cf_empty * l_cf_e + lambda_cf_wrong * l_cf_w + lambda_nochange * l_nc
    if not total.requires_grad:
        total = total + out_correct["scores"].sum() * 0.0
    return {
        "loss": total,
        "l_list": l_list.detach(),
        "l_cf_empty": l_cf_e.detach(),
        "l_cf_wrong": l_cf_w.detach(),
        "l_nochange": l_nc.detach(),
        "p_correct_mean": (p_c[valid].mean().detach() if valid.any() else p_c.new_zeros(())),
        "p_empty_mean": (p_e[valid].mean().detach() if valid.any() else p_e.new_zeros(())),
        "n_pron": valid.sum().detach(),
    }
