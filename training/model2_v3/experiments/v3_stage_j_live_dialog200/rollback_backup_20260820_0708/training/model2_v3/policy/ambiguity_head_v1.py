"""AmbiguityHeadV1 skeleton — candidate-relative select/abstain.

NOT used for production SELECT this round. Frozen P/D load must keep
with_ambiguity_head=False so Stage-J checkpoint loads strictly at 47210 params.

Output classes: ABSTAIN + CANDIDATE_0..CANDIDATE_{K-1} (K=8). Never hanzi ids.
"""

from __future__ import annotations

import torch
import torch.nn as nn

AMBIGUITY_HEAD_VERSION = "AmbiguityHeadV1"
SINGLE_CHAR_CANDIDATE_CAP = 8
N_AMBIGUITY_LOGITS = SINGLE_CHAR_CANDIDATE_CAP + 1
CANDIDATE_FEAT_DIM = 16
CTX_FEAT_DIM = 64
HIDDEN = 128


class AmbiguityHeadV1(nn.Module):
    """Scores (frozen trunk h, hashed local context, candidate features) → abstain + indices.

    ctx_feat is owned by this head (trainable). Trunk is not updated here.
    Untrained weights must never be argmax'd in production without accepted checkpoint.
    """

    def __init__(self) -> None:
        super().__init__()
        self.cand_mlp = nn.Sequential(
            nn.Linear(CANDIDATE_FEAT_DIM, HIDDEN),
            nn.ReLU(),
            nn.Linear(HIDDEN, HIDDEN),
        )
        self.ctx_mlp = nn.Sequential(
            nn.Linear(CTX_FEAT_DIM, HIDDEN),
            nn.ReLU(),
            nn.Linear(HIDDEN, HIDDEN),
        )
        self.score = nn.Linear(HIDDEN, 1)
        self.abstain = nn.Linear(HIDDEN, 1)

    def forward(
        self,
        context_h: torch.Tensor,
        cand_feat: torch.Tensor,
        cand_mask: torch.Tensor,
        ctx_feat: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """Logits [B, 1+K] = abstain + K candidate slots. Invalid slots masked."""
        b, k, _ = cand_feat.shape
        if ctx_feat is None:
            ctx_feat = torch.zeros(b, CTX_FEAT_DIM, device=context_h.device, dtype=context_h.dtype)
        ctx_h = self.ctx_mlp(ctx_feat)
        fused_h = torch.relu(context_h + ctx_h)
        emb = self.cand_mlp(cand_feat.reshape(b * k, -1)).reshape(b, k, HIDDEN)
        fused = torch.relu(emb + fused_h.unsqueeze(1).expand(-1, k, -1))
        cand_logits = self.score(fused).squeeze(-1)
        cand_logits = cand_logits.masked_fill(cand_mask <= 0, -1e9)
        abstain_logit = self.abstain(fused_h)
        return torch.cat([abstain_logit, cand_logits], dim=-1)
