"""Stage A losses: positive CE, NO_MATCH negative, hard-negative margin."""

from __future__ import annotations

from typing import Any, Optional

import torch
import torch.nn.functional as F


def positive_ce_loss(scores: torch.Tensor, target_idx: torch.Tensor, valid: torch.Tensor) -> torch.Tensor:
    """L_pos = -CE(scores over pool+NO_MATCH, target_pool_index)."""
    if valid.sum() == 0:
        return scores.new_zeros(())
    s = scores[valid]
    t = target_idx[valid]
    return F.cross_entropy(s, t)


def negative_nomatch_loss(scores: torch.Tensor, no_match_index: torch.Tensor, valid: torch.Tensor) -> torch.Tensor:
    """NEGATIVE: teach NO_MATCH to win over pool candidates."""
    if valid.sum() == 0:
        return scores.new_zeros(())
    s = scores[valid]
    t = no_match_index[valid]
    return F.cross_entropy(s, t)


def hard_negative_margin_loss(
    scores: torch.Tensor,
    hn_index: torch.Tensor,
    no_match_index: torch.Tensor,
    valid: torch.Tensor,
    margin: float = 0.2,
) -> torch.Tensor:
    """Push injected HN below NO_MATCH by margin (identity via is_injected flag, not distance)."""
    if valid.sum() == 0:
        return scores.new_zeros(())
    s = scores[valid]
    hn = hn_index[valid]
    nm = no_match_index[valid]
    # gather
    b = torch.arange(s.size(0), device=s.device)
    hn_ok = hn >= 0
    if hn_ok.sum() == 0:
        return scores.new_zeros(())
    score_hn = s[b, hn.clamp(min=0)]
    score_nm = s[b, nm]
    # only where hn valid
    score_hn = score_hn[hn_ok]
    score_nm = score_nm[hn_ok]
    return F.relu(score_hn - score_nm + margin).mean()


def compose_loss(
    out: dict[str, torch.Tensor],
    batch: dict[str, Any],
    *,
    lambda_neg: float,
    lambda_hn: float,
    hn_margin: float,
) -> dict[str, torch.Tensor]:
    scores = out["scores"]
    kinds = batch["sample_kind"]
    device = scores.device

    is_pos = torch.tensor([k == "POSITIVE" for k in kinds], device=device)
    # Only TERM_POSITIVE rows should be in the positive dataloader; still guard index
    pos_idx = batch["positive_pool_index"]
    pos_valid = is_pos & (pos_idx >= 0)

    is_neg = torch.tensor([k == "NEGATIVE" for k in kinds], device=device)
    is_hn = torch.tensor([k == "HARD_NEGATIVE" for k in kinds], device=device)
    inj = batch["is_injected_hard_negative"].bool()
    hn_valid = is_hn & inj & (batch["hard_negative_index"] >= 0)

    l_pos = positive_ce_loss(scores, pos_idx, pos_valid)
    l_neg = negative_nomatch_loss(scores, out["no_match_index"], is_neg)
    l_hn = hard_negative_margin_loss(
        scores, batch["hard_negative_index"], out["no_match_index"], hn_valid, margin=hn_margin
    )
    total = l_pos + lambda_neg * l_neg + lambda_hn * l_hn
    return {
        "loss": total,
        "l_pos": l_pos.detach(),
        "l_neg": l_neg.detach(),
        "l_hn": l_hn.detach(),
        "n_pos": pos_valid.sum().detach(),
        "n_neg": is_neg.sum().detach(),
        "n_hn": hn_valid.sum().detach(),
    }


def condition_margin_loss(
    score_correct: torch.Tensor,
    score_empty: torch.Tensor,
    score_wrong: Optional[torch.Tensor],
    valid: torch.Tensor,
    weights: torch.Tensor,
    *,
    margin: float = 0.05,
) -> torch.Tensor:
    """Encourage score_target(correct) > score_target(empty/wrong) by margin."""
    if valid.sum() == 0:
        return score_correct.new_zeros(())
    sc = score_correct[valid]
    se = score_empty[valid]
    w = weights[valid]
    loss_e = torch.relu(margin - sc + se) * w
    loss = loss_e
    if score_wrong is not None:
        sw = score_wrong[valid]
        loss = loss + torch.relu(margin - sc + sw) * w
    denom = w.sum().clamp(min=1e-6)
    return loss.sum() / denom


def compose_loss_stage_b(
    out_correct: dict[str, torch.Tensor],
    out_empty: dict[str, torch.Tensor],
    out_wrong: Optional[dict[str, torch.Tensor]],
    batch: dict[str, Any],
    *,
    lambda_neg: float,
    lambda_hn: float,
    lambda_cond: float,
    hn_margin: float,
    cond_margin: float = 0.05,
) -> dict[str, torch.Tensor]:
    base = compose_loss(
        out_correct,
        batch,
        lambda_neg=lambda_neg,
        lambda_hn=lambda_hn,
        hn_margin=hn_margin,
    )
    scores_c = out_correct["scores"]
    scores_e = out_empty["scores"]
    scores_w = out_wrong["scores"] if out_wrong is not None else None
    device = scores_c.device
    kinds = batch["sample_kind"]
    is_pos = torch.tensor([k == "POSITIVE" for k in kinds], device=device)
    pos_idx = batch["positive_pool_index"]
    # Prefer explicit pronunciation-positive flag when present
    if "is_pronunciation_positive" in batch:
        is_pron = batch["is_pronunciation_positive"].bool()
    else:
        is_pron = is_pos
    valid = is_pron & (pos_idx >= 0)
    b = torch.arange(scores_c.size(0), device=device)
    sc = scores_c[b, pos_idx.clamp(min=0)]
    se = scores_e[b, pos_idx.clamp(min=0)]
    sw = scores_w[b, pos_idx.clamp(min=0)] if scores_w is not None else None
    if "condition_supervision_weight" in batch:
        w = batch["condition_supervision_weight"].float()
    else:
        w = torch.ones(scores_c.size(0), device=device)
    l_cond = condition_margin_loss(sc, se, sw, valid, w, margin=cond_margin)
    total = base["loss"] + lambda_cond * l_cond
    out = dict(base)
    out["loss"] = total
    out["l_cond"] = l_cond.detach()
    out["n_cond"] = valid.sum().detach()
    return out
