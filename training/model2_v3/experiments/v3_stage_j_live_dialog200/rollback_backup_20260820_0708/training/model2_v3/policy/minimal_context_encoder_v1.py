"""MinimalContextEncoderV1 — isolated single-char local text branch.

Learnable char-bucket embeddings (not raw hash floats). Does not feed P/D trunk.
UNK/new Operations characters hash into existing buckets — output dim unchanged.
"""

from __future__ import annotations

import torch
import torch.nn as nn

from training.model2_v3.policy.feature_hash_v1 import stable_bucket

CONTEXT_ENCODER_VERSION = "MinimalContextEncoderV1"
CTX_WIN = 4
CHAR_BUCKETS = 2048
CHAR_EMB = 24
CTX_OUT = 64
PAD_ID = 0


def char_bucket_id(ch: str) -> int:
    if not ch:
        return PAD_ID
    return 1 + stable_bucket(ch, CHAR_BUCKETS)


def encode_window(text: str, side: str, win: int = CTX_WIN) -> list[int]:
    chars = [c for c in text if c.strip()]
    if side == "left":
        take = chars[-win:]
        ids = [char_bucket_id(c) for c in take]
        return [PAD_ID] * (win - len(ids)) + ids
    take = chars[:win]
    ids = [char_bucket_id(c) for c in take]
    return ids + [PAD_ID] * (win - len(ids))


class MinimalContextEncoderV1(nn.Module):
    """left/right windows → pooled local context vector. Batch-first."""

    def __init__(self) -> None:
        super().__init__()
        self.emb = nn.Embedding(CHAR_BUCKETS + 1, CHAR_EMB, padding_idx=PAD_ID)
        self.proj = nn.Linear(CHAR_EMB * 2, CTX_OUT)

    def embed_ids(self, ids: torch.Tensor) -> torch.Tensor:
        return self.emb(ids)

    def pool(self, ids: torch.Tensor) -> torch.Tensor:
        """ids [B, W] → [B, CHAR_EMB] masked mean."""
        mask = (ids != PAD_ID).float().unsqueeze(-1)
        emb = self.emb(ids)
        denom = mask.sum(dim=1).clamp(min=1.0)
        return (emb * mask).sum(dim=1) / denom

    def forward(self, left_ids: torch.Tensor, right_ids: torch.Tensor) -> torch.Tensor:
        """[B, WIN], [B, WIN] → [B, CTX_OUT]."""
        left = self.pool(left_ids)
        right = self.pool(right_ids)
        return torch.relu(self.proj(torch.cat([left, right], dim=-1)))
