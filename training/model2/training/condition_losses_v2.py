"""Phase 6B ranking-aware condition losses."""

from __future__ import annotations

from typing import Any, Optional

import torch
import torch.nn.functional as F


def _target_and_competitor_scores(
    scores: torch.Tensor,
    pos_idx: torch.Tensor,
    pool_len: torch.Tensor,
) -> tuple[torch.Tensor, torch.Tensor]:
    """C0: highest scoring non-target in pool."""
    bsz, pmax = scores.size(0), scores.size(1) - 1  # exclude NO_MATCH last if present
    # scores may include NO_MATCH; use pool_len
    tgt = []
    comp = []
    for i in range(bsz):
        plen = int(pool_len[i].item())
        pi = int(pos_idx[i].item())
        s = scores[i, :plen]
        if pi < 0 or pi >= plen or plen <= 1:
            tgt.append(scores.new_zeros(()))
            comp.append(scores.new_zeros(()))
            continue
        tgt.append(s[pi])
        mask = torch.ones(plen, dtype=torch.bool, device=scores.device)
        mask[pi] = False
        comp.append(s[mask].max())
    return torch.stack(tgt), torch.stack(comp)


def margin_from_scores(
    scores: torch.Tensor,
    pos_idx: torch.Tensor,
    pool_len: torch.Tensor,
) -> torch.Tensor:
    tgt, comp = _target_and_competitor_scores(scores, pos_idx, pool_len)
    return tgt - comp


def ranking_condition_loss(
    margin_correct: torch.Tensor,
    margin_ref: torch.Tensor,
    valid: torch.Tensor,
    weights: torch.Tensor,
    *,
    delta: float = 0.05,
) -> torch.Tensor:
    """Push margin(correct) above margin(empty/wrong) by delta."""
    if valid.sum() == 0:
        return margin_correct.new_zeros(())
    w = weights[valid]
    loss = torch.relu(delta - margin_correct[valid] + margin_ref[valid]) * w
    return loss.sum() / w.sum().clamp(min=1e-6)


def profile_nochange_loss(
    scores_correct: torch.Tensor,
    scores_empty: torch.Tensor,
    pos_idx: torch.Tensor,
    pool_len: torch.Tensor,
    valid_nochange: torch.Tensor,
    *,
    max_boost: float = 0.08,
) -> torch.Tensor:
    """
    For NO_CHANGE: Correct profile must not boost a distractor past target
    more than Empty did by more than max_boost.
    Approximated via: margin_correct >= margin_empty - max_boost
    (don't let high bias collapse margin).
    """
    if valid_nochange.sum() == 0:
        return scores_correct.new_zeros(())
    m_c = margin_from_scores(scores_correct, pos_idx, pool_len)
    m_e = margin_from_scores(scores_empty, pos_idx, pool_len)
    # Penalize if correct margin much worse than empty (over-correction toward distractor)
    loss = torch.relu((m_e - max_boost) - m_c)
    return loss[valid_nochange].mean()


def compose_loss_condition_ranking(
    out_correct: dict[str, torch.Tensor],
    out_empty: dict[str, torch.Tensor],
    out_wrong: Optional[dict[str, torch.Tensor]],
    batch: dict[str, Any],
    *,
    lambda_rank_cond: float = 1.0,
    lambda_wrong: float = 0.5,
    lambda_nochange: float = 0.5,
    margin_delta: float = 0.05,
) -> dict[str, torch.Tensor]:
    device = out_correct["scores"].device
    pos_idx = batch["positive_pool_index"]
    pool_len = batch["pool_len"]
    kinds = batch["sample_kind"]
    is_pos = torch.tensor([k == "POSITIVE" for k in kinds], device=device)
    is_pron = batch["is_pronunciation_positive"].bool() if "is_pronunciation_positive" in batch else is_pos
    is_nc = batch["is_no_change"].bool() if "is_no_change" in batch else torch.zeros_like(is_pos)
    valid_pron = is_pron & (pos_idx >= 0) & (pool_len > 1)
    valid_nc = is_nc & (pos_idx >= 0) & (pool_len > 1)
    w = batch.get("condition_supervision_weight")
    if w is None:
        w = torch.ones(pos_idx.size(0), device=device)
    else:
        w = w.float()

    m_c = margin_from_scores(out_correct["scores"], pos_idx, pool_len)
    m_e = margin_from_scores(out_empty["scores"], pos_idx, pool_len)
    l_rank = ranking_condition_loss(m_c, m_e, valid_pron, w, delta=margin_delta)
    l_wrong = out_correct["scores"].new_zeros(())
    if out_wrong is not None:
        m_w = margin_from_scores(out_wrong["scores"], pos_idx, pool_len)
        l_wrong = ranking_condition_loss(m_c, m_w, valid_pron, w, delta=margin_delta)
    l_nc = profile_nochange_loss(
        out_correct["scores"], out_empty["scores"], pos_idx, pool_len, valid_nc
    )
    # Soft encourage target > competitor under correct profile
    tgt_c, comp_c = _target_and_competitor_scores(out_correct["scores"], pos_idx, pool_len)
    l_pair = (torch.relu(0.02 - tgt_c + comp_c) * valid_pron.float() * w).sum() / (
        (valid_pron.float() * w).sum().clamp(min=1e-6)
    )

    total = (
        lambda_rank_cond * l_rank
        + lambda_wrong * l_wrong
        + lambda_nochange * l_nc
        + 1.0 * l_pair
    )
    # Ensure graph exists even if all terms are constant zeros
    if not total.requires_grad:
        gate = out_correct["scores"].sum() * 0.0
        total = total + gate
    return {
        "loss": total,
        "l_rank_cond": l_rank.detach(),
        "l_wrong": l_wrong.detach(),
        "l_nochange": l_nc.detach(),
        "l_pair": l_pair.detach(),
        "n_pron": valid_pron.sum().detach(),
        "n_nochange": valid_nc.sum().detach(),
        "margin_correct_mean": (m_c[valid_pron].mean().detach() if valid_pron.any() else total.new_zeros(())),
        "margin_empty_mean": (m_e[valid_pron].mean().detach() if valid_pron.any() else total.new_zeros(())),
    }
