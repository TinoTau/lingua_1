"""Learned ConditionCompatibilityScorer — per-candidate delta_condition."""

from __future__ import annotations

import torch
import torch.nn as nn

from training.model2.contract import PHONETIC_DIM


class ConditionCompatibilityScorer(nn.Module):
    """
    interaction[B,P,16] (+ optional base score [B,P,1]) → delta [B,P]
    Bounded via tanh * delta_cap so condition remains an auxiliary prior.
    """

    def __init__(self, hidden: int = 32, delta_cap: float = 0.35, use_base_feat: bool = True):
        super().__init__()
        self.delta_cap = float(delta_cap)
        self.use_base_feat = use_base_feat
        in_dim = PHONETIC_DIM + (1 if use_base_feat else 0)
        self.mlp = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 1),
        )
        # Small init so unavailable (active=0) still gives exact 0 via gate,
        # but active profiles produce nonzero grads from epoch 0.
        for m in self.mlp.modules():
            if isinstance(m, nn.Linear):
                nn.init.normal_(m.weight, std=0.02)
                nn.init.zeros_(m.bias)

    def forward(
        self,
        interaction: torch.Tensor,
        base_scores: torch.Tensor | None = None,
        *,
        profile_active: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """
        interaction: [B,P,16]
        base_scores: [B,P]
        profile_active: [B] float/bool — 0 → delta forced 0
        returns delta: [B,P]
        """
        x = interaction
        if self.use_base_feat:
            if base_scores is None:
                b = torch.zeros(*interaction.shape[:2], 1, device=interaction.device, dtype=interaction.dtype)
            else:
                b = base_scores.unsqueeze(-1)
            x = torch.cat([interaction, b], dim=-1)
        raw = self.mlp(x).squeeze(-1)
        delta = torch.tanh(raw) * self.delta_cap
        if profile_active is not None:
            delta = delta * profile_active.view(-1, 1).to(delta.dtype)
        return delta


def build_interaction(
    phonetic_condition: torch.Tensor,
    phonetic_mask: torch.Tensor,
    relation_features: torch.Tensor,
    realized: torch.Tensor,
) -> tuple[torch.Tensor, torch.Tensor]:
    """
    interaction = user * relation * mask * realized
    profile_active = 1 if any masked slot available after realized gate
    """
    # [B,16]
    user = phonetic_condition * phonetic_mask.float() * realized.float().unsqueeze(-1)
    # [B,P,16]
    inter = user.unsqueeze(1) * relation_features
    active = (phonetic_mask.float() * realized.float().unsqueeze(-1)).sum(dim=-1) > 0
    # also inactive if all user values zero under mask
    active = active & (user.abs().sum(dim=-1) > 0)
    return inter, active.float()
