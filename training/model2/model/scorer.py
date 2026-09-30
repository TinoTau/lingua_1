"""Scoring heads for Stage A M0 / M1."""

from __future__ import annotations

import torch
import torch.nn as nn


class BaseDotScorer(nn.Module):
    """score = dot(Qbase, C)."""

    def forward(self, q: torch.Tensor, c: torch.Tensor) -> torch.Tensor:
        # q: [B, D], c: [B, P, D] → [B, P]
        return torch.einsum("bd,bpd->bp", q, c)


class WeakPriorScorer(nn.Module):
    """M1: base dot + learned personal/domain candidate feature weights."""

    def __init__(self, personal_dim: int = 3, domain_dim: int = 2):
        super().__init__()
        self.personal_w = nn.Linear(personal_dim, 1, bias=False)
        self.domain_w = nn.Linear(domain_dim, 1, bias=False)
        nn.init.zeros_(self.personal_w.weight)
        nn.init.zeros_(self.domain_w.weight)

    def forward(
        self,
        q: torch.Tensor,
        c: torch.Tensor,
        personal_feats: torch.Tensor,
        domain_feats: torch.Tensor,
    ) -> torch.Tensor:
        base = torch.einsum("bd,bpd->bp", q, c)
        pers = self.personal_w(personal_feats).squeeze(-1)
        dom = self.domain_w(domain_feats).squeeze(-1)
        return base + pers + dom
