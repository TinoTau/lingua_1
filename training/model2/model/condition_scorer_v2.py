"""Phase 6C ConditionCompatibilityScorer V2 — interaction-gated deltas."""

from __future__ import annotations

import torch
import torch.nn as nn

from training.model2.contract import PHONETIC_DIM


class ConditionCompatibilityScorerV2(nn.Module):
    """
    Primary input: interaction[B,P,16] = user * relation * mask
    Optional: base_score, base_margin_to_top
    Hard gates:
      - profile inactive → delta row = 0
      - per-candidate interaction ≈ 0 → delta[j] = 0  (blocks user-only / relation-only shortcuts)
    """

    def __init__(
        self,
        hidden: int = 32,
        delta_cap: float = 0.5,
        use_base_feat: bool = True,
        use_base_margin: bool = True,
    ):
        super().__init__()
        self.delta_cap = float(delta_cap)
        self.use_base_feat = use_base_feat
        self.use_base_margin = use_base_margin
        in_dim = PHONETIC_DIM + int(use_base_feat) + int(use_base_margin)
        self.mlp = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, 1),
        )
        for m in self.mlp.modules():
            if isinstance(m, nn.Linear):
                nn.init.normal_(m.weight, std=0.03)
                nn.init.zeros_(m.bias)

    def forward(
        self,
        interaction: torch.Tensor,
        base_scores: torch.Tensor | None = None,
        *,
        profile_active: torch.Tensor | None = None,
        pool_mask: torch.Tensor | None = None,
    ) -> torch.Tensor:
        bsz, p, _ = interaction.shape
        feats = [interaction]
        if self.use_base_feat:
            if base_scores is None:
                b = torch.zeros(bsz, p, 1, device=interaction.device, dtype=interaction.dtype)
            else:
                b = base_scores.unsqueeze(-1)
            feats.append(b)
        if self.use_base_margin:
            if base_scores is None:
                m = torch.zeros(bsz, p, 1, device=interaction.device, dtype=interaction.dtype)
            else:
                # base_score - max_other_base (pool-relative)
                neg_inf = torch.finfo(base_scores.dtype).min
                filled = base_scores.clone()
                if pool_mask is not None:
                    filled = filled.masked_fill(~pool_mask, neg_inf)
                # max other: for each j, max over k!=j
                # approximate: max_all, then if argmax==j use second max
                max_all, argmax = filled.max(dim=1)
                # second max via masking argmax
                filled2 = filled.clone()
                b_idx = torch.arange(bsz, device=filled.device)
                filled2[b_idx, argmax] = neg_inf
                second, _ = filled2.max(dim=1)
                top_other = max_all.unsqueeze(1).expand_as(base_scores).clone()
                # where j is the unique max, use second
                is_max = torch.zeros_like(base_scores, dtype=torch.bool)
                is_max[b_idx, argmax] = True
                top_other = torch.where(is_max, second.unsqueeze(1).expand_as(base_scores), top_other)
                m = (base_scores - top_other).unsqueeze(-1)
            feats.append(m)
        x = torch.cat(feats, dim=-1)
        raw = self.mlp(x).squeeze(-1)
        delta = torch.tanh(raw) * self.delta_cap
        # candidate-specific: no interaction → no delta (blocks shortcuts)
        cand_gate = (interaction.abs().sum(dim=-1) > 1e-8).to(delta.dtype)
        delta = delta * cand_gate
        if profile_active is not None:
            delta = delta * profile_active.view(-1, 1).to(delta.dtype)
        if pool_mask is not None:
            delta = delta.masked_fill(~pool_mask, 0.0)
        return delta


def build_interaction_v2(
    phonetic_condition: torch.Tensor,
    phonetic_mask: torch.Tensor,
    relation_features: torch.Tensor,
    realized: torch.Tensor,
) -> tuple[torch.Tensor, torch.Tensor]:
    user = phonetic_condition * phonetic_mask.float() * realized.float().unsqueeze(-1)
    inter = user.unsqueeze(1) * relation_features
    active = (user.abs().sum(dim=-1) > 0).float()
    return inter, active
