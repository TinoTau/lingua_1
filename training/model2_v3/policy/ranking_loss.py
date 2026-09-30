"""Retrieval-ACTION ranking objectives (not lexical-candidate ranking).

A = independent BCE (Phase2 baseline)
B = BCE + pairwise action-ranking
C = listwise action-ranking (ListNet-style)
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


def pairwise_action_ranking_loss(
    logits: torch.Tensor,
    labels: torch.Tensor,
    *,
    margin: float = 0.5,
) -> torch.Tensor:
    """Encourage positive actions to outrank negatives (Top-1 aligned).

    logits/labels: [B, A]
    """
    # Sample pairwise: for each row, max-margin between pos and neg
    pos_mask = labels > 0.5
    neg_mask = labels <= 0.5
    # softplus(margin - (pos - neg)) averaged
    losses = []
    bsz = logits.size(0)
    for i in range(bsz):
        pos = logits[i][pos_mask[i]]
        neg = logits[i][neg_mask[i]]
        if pos.numel() == 0 or neg.numel() == 0:
            continue
        # all pairs can be large; take top-k negs vs all pos
        neg_k = neg
        if neg.numel() > 16:
            neg_k = torch.topk(neg, k=16).values
        diff = pos.unsqueeze(1) - neg_k.unsqueeze(0)
        losses.append(F.relu(margin - diff).mean())
    if not losses:
        return logits.new_zeros(())
    return torch.stack(losses).mean()


def listwise_action_ranking_loss(
    logits: torch.Tensor,
    labels: torch.Tensor,
    *,
    temperature: float = 1.0,
) -> torch.Tensor:
    """ListNet-style: match softmax over labels with softmax over logits.

    Positive labels become a soft target distribution (uniform over positives).
    """
    # Target: normalize positive mass; if none, identity-like uniform tiny
    target = labels.clamp(min=0.0)
    row_sum = target.sum(dim=-1, keepdim=True)
    empty = (row_sum <= 0).float()
    # avoid empty: put mass on first action (identity often index 0)
    fallback = torch.zeros_like(target)
    fallback[:, 0] = 1.0
    target = target / row_sum.clamp(min=1e-6) * (1.0 - empty) + fallback * empty
    log_p = F.log_softmax(logits / temperature, dim=-1)
    return -(target * log_p).sum(dim=-1).mean()


def action_objective(
    logits: torch.Tensor,
    labels: torch.Tensor,
    *,
    mode: str,
    bce: nn.Module,
    pairwise_weight: float = 0.5,
    listwise_weight: float = 1.0,
) -> torch.Tensor:
    """mode in {bce, bce_pairwise, listwise, bce_listwise}."""
    if mode == "bce":
        return bce(logits, labels)
    if mode == "bce_pairwise":
        return bce(logits, labels) + pairwise_weight * pairwise_action_ranking_loss(logits, labels)
    if mode == "listwise":
        return listwise_weight * listwise_action_ranking_loss(logits, labels)
    if mode == "bce_listwise":
        return bce(logits, labels) + listwise_weight * listwise_action_ranking_loss(logits, labels)
    raise ValueError(f"unknown ranking mode: {mode}")
