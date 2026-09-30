"""Small multi-label relation / expansion activator (<500k params).

Predicts which ACTIVE_SET_V1 relations should fire given FineSpan + UserProfile.
Does NOT emit term_id.
"""

from __future__ import annotations

from typing import Optional

import torch
import torch.nn as nn

from training.model2.contract import PHONETIC_DIM, PHONETIC_FEATURE_INDEX_V1
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1

SPAN_HASH_DIM = 64
SPAN_HASH_BUCKETS = 1024


def hash_syllable_bag(syllables: list[str], dim: int = SPAN_HASH_DIM) -> torch.Tensor:
    """Deterministic hashed bag-of-syllables (toneless tokens preferred)."""
    v = torch.zeros(dim, dtype=torch.float32)
    for s in syllables:
        token = (s or "").lower()
        h = hash(token) % SPAN_HASH_BUCKETS
        v[h % dim] += 1.0
        if len(token) >= 2:
            h2 = hash(token[:2]) % SPAN_HASH_BUCKETS
            v[h2 % dim] += 0.5
    n = float(len(syllables) or 1)
    return v / n


def profile_vector(phonetic_bias: dict[str, float] | None) -> torch.Tensor:
    v = torch.zeros(PHONETIC_DIM, dtype=torch.float32)
    for k, val in dict(phonetic_bias or {}).items():
        if k in PHONETIC_FEATURE_INDEX_V1 and float(val) > 0:
            v[PHONETIC_FEATURE_INDEX_V1[k]] = float(val)
    return v


def encode_inputs(
    span_syllables: list[str],
    phonetic_bias: dict[str, float] | None,
    *,
    device: Optional[torch.device] = None,
) -> tuple[torch.Tensor, torch.Tensor]:
    xs = hash_syllable_bag(span_syllables).unsqueeze(0)
    xp = profile_vector(phonetic_bias).unsqueeze(0)
    if device is not None:
        xs = xs.to(device)
        xp = xp.to(device)
    return xs, xp


class RelationActivatorV1(nn.Module):
    """Tiny MLP: span_hash ⊕ profile → |ACTIVE_SET_V1| logits."""

    def __init__(
        self,
        span_dim: int = SPAN_HASH_DIM,
        profile_dim: int = PHONETIC_DIM,
        hidden: int = 64,
        n_relations: int | None = None,
    ) -> None:
        super().__init__()
        n_out = n_relations if n_relations is not None else len(ACTIVE_SET_V1)
        self.n_relations = n_out
        self.active_relations = ACTIVE_SET_V1
        self.net = nn.Sequential(
            nn.Linear(span_dim + profile_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.ReLU(),
            nn.Linear(hidden, n_out),
        )

    def forward(self, span_feat: torch.Tensor, profile_feat: torch.Tensor) -> torch.Tensor:
        x = torch.cat([span_feat, profile_feat], dim=-1)
        return self.net(x)

    def param_count(self) -> int:
        return sum(p.numel() for p in self.parameters())


def build_label(
    gold_family: str | None,
    phonetic_bias: dict[str, float] | None,
    *,
    activate: bool,
) -> torch.Tensor:
    """Multi-label over ACTIVE_SET_V1. Gold family used as TRAINING LABEL only."""
    y = torch.zeros(len(ACTIVE_SET_V1), dtype=torch.float32)
    if not activate:
        return y
    bias = dict(phonetic_bias or {})
    for i, rel in enumerate(ACTIVE_SET_V1):
        if rel in bias and float(bias[rel]) > 0:
            # Prefer gold family if present; else all profile-active in set
            if gold_family and gold_family in ACTIVE_SET_V1:
                y[i] = 1.0 if rel == gold_family else 0.0
            else:
                y[i] = 1.0
    return y
