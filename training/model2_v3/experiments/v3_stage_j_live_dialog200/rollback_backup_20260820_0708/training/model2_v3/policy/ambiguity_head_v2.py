"""AmbiguityHeadV2 — candidate-relative SELECT/ABSTAIN using MinimalContextEncoderV1.

Does not read frozen trunk h. Does not emit hanzi classes.
Output: ABSTAIN + C0..C7. Shared char embedding with the context encoder.
"""

from __future__ import annotations

import torch
import torch.nn as nn

from training.model2_v3.policy.minimal_context_encoder_v1 import (
    CHAR_BUCKETS,
    CTX_OUT,
    MinimalContextEncoderV1,
    char_bucket_id,
)

AMBIGUITY_HEAD_V2_VERSION = "AmbiguityHeadV2"
SINGLE_CHAR_CANDIDATE_CAP = 8
N_AMBIGUITY_LOGITS = SINGLE_CHAR_CANDIDATE_CAP + 1
HIDDEN = 64
PY_BUCKETS = 256
PY_EMB = 8


class AmbiguityHeadV2(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.encoder = MinimalContextEncoderV1()
        self.py_emb = nn.Embedding(PY_BUCKETS, PY_EMB)
        cand_in = self.encoder.emb.embedding_dim + 1 + PY_EMB
        self.cand_mlp = nn.Sequential(nn.Linear(cand_in, HIDDEN), nn.ReLU(), nn.Linear(HIDDEN, HIDDEN))
        self.ctx_mlp = nn.Sequential(nn.Linear(CTX_OUT, HIDDEN), nn.ReLU())
        self.score = nn.Linear(HIDDEN, 1)
        self.abstain = nn.Linear(HIDDEN, 1)

    def forward(
        self,
        left_ids: torch.Tensor,
        right_ids: torch.Tensor,
        cand_char_ids: torch.Tensor,
        cand_tone: torch.Tensor,
        cand_py_ids: torch.Tensor,
        cand_mask: torch.Tensor,
    ) -> torch.Tensor:
        """Logits [B, 1+K]. Invalid slots masked. Supports batch dimension."""
        b, k = cand_char_ids.shape
        ctx = self.ctx_mlp(self.encoder(left_ids, right_ids))
        cemb = self.encoder.embed_ids(cand_char_ids)
        pemb = self.py_emb(cand_py_ids.clamp(0, PY_BUCKETS - 1))
        feat = torch.cat([cemb, cand_tone.unsqueeze(-1), pemb], dim=-1)
        cvec = self.cand_mlp(feat.reshape(b * k, -1)).reshape(b, k, HIDDEN)
        fused = torch.relu(cvec + ctx.unsqueeze(1))
        cand_logits = self.score(fused).squeeze(-1)
        cand_logits = cand_logits.masked_fill(cand_mask <= 0, -1e9)
        abstain_logit = self.abstain(ctx)
        return torch.cat([abstain_logit, cand_logits], dim=-1)


def pinyin_bucket_id(pinyin: str, tone: int) -> int:
    from training.model2_v3.policy.feature_hash_v1 import stable_bucket

    return stable_bucket(f"{pinyin}{tone}", PY_BUCKETS)
