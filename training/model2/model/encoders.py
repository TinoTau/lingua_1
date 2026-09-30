"""Shared char/syllable tables + separate query/candidate projection heads."""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


def masked_mean(emb: torch.Tensor, ids: torch.Tensor, pad_id: int = 0) -> torch.Tensor:
    """emb: [B, L, D], ids: [B, L] → [B, D]."""
    mask = (ids != pad_id).unsqueeze(-1).float()  # [B,L,1]
    summed = (emb * mask).sum(dim=1)
    denom = mask.sum(dim=1).clamp(min=1.0)
    return summed / denom


class SharedTokenTables(nn.Module):
    """Shared bottom representations — not per-term-id memorization tables."""

    def __init__(self, char_buckets: int, syl_vocab: int, char_dim: int, syl_dim: int):
        super().__init__()
        self.char_emb = nn.Embedding(char_buckets, char_dim, padding_idx=0)
        self.syl_emb = nn.Embedding(syl_vocab, syl_dim, padding_idx=0)
        nn.init.normal_(self.char_emb.weight, std=0.02)
        nn.init.normal_(self.syl_emb.weight, std=0.02)
        with torch.no_grad():
            self.char_emb.weight[0].zero_()
            self.syl_emb.weight[0].zero_()


class QueryEncoder(nn.Module):
    def __init__(self, shared: SharedTokenTables, char_dim: int, syl_dim: int, out_dim: int, hidden: int):
        super().__init__()
        self.shared = shared
        # span + left + right + syl + syl_count + relative_position
        in_dim = char_dim * 3 + syl_dim + 2
        self.proj = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, out_dim),
        )

    def forward(
        self,
        span_char_ids: torch.Tensor,
        left_char_ids: torch.Tensor,
        right_char_ids: torch.Tensor,
        syllable_ids: torch.Tensor,
        syllable_count: torch.Tensor,
        relative_position: torch.Tensor,
    ) -> torch.Tensor:
        span = masked_mean(self.shared.char_emb(span_char_ids), span_char_ids)
        left = masked_mean(self.shared.char_emb(left_char_ids), left_char_ids)
        right = masked_mean(self.shared.char_emb(right_char_ids), right_char_ids)
        syl = masked_mean(self.shared.syl_emb(syllable_ids), syllable_ids)
        sc = syllable_count.unsqueeze(-1).float() / 8.0
        rp = relative_position.unsqueeze(-1).float()
        x = torch.cat([span, left, right, syl, sc, rp], dim=-1)
        return F.normalize(self.proj(x), dim=-1)


class CandidateEncoder(nn.Module):
    """Surface + pinyin (+ small metadata). NEVER a trainable term_id table."""

    def __init__(self, shared: SharedTokenTables, char_dim: int, syl_dim: int, out_dim: int, hidden: int):
        super().__init__()
        self.shared = shared
        # char + syl + syl_count + term_type(2)
        in_dim = char_dim + syl_dim + 1 + 2
        self.proj = nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(),
            nn.Linear(hidden, out_dim),
        )

    def forward(
        self,
        cand_char_ids: torch.Tensor,
        cand_syl_ids: torch.Tensor,
        syllable_count: torch.Tensor,
        term_type_oh: torch.Tensor,
    ) -> torch.Tensor:
        # cand_*: [B, P, L] or [N, L]
        squeeze = False
        if cand_char_ids.dim() == 2:
            cand_char_ids = cand_char_ids.unsqueeze(1)
            cand_syl_ids = cand_syl_ids.unsqueeze(1)
            syllable_count = syllable_count.unsqueeze(1)
            term_type_oh = term_type_oh.unsqueeze(1)
            squeeze = True
        b, p, lc = cand_char_ids.shape
        ls = cand_syl_ids.shape[-1]
        flat_c = cand_char_ids.reshape(b * p, lc)
        flat_s = cand_syl_ids.reshape(b * p, ls)
        ch = masked_mean(self.shared.char_emb(flat_c), flat_c).view(b, p, -1)
        sy = masked_mean(self.shared.syl_emb(flat_s), flat_s).view(b, p, -1)
        sc = syllable_count.unsqueeze(-1).float() / 8.0
        x = torch.cat([ch, sy, sc, term_type_oh.float()], dim=-1)
        out = F.normalize(self.proj(x), dim=-1)
        if squeeze:
            out = out.squeeze(1)
        return out


class ConditionEncoder(nn.Module):
    """Present for architecture completeness; Stage A must mask before use."""

    def __init__(self, phonetic_dim: int, tone_dim: int, domain_dim: int, out_dim: int):
        super().__init__()
        self.mlp = nn.Sequential(
            nn.Linear(phonetic_dim + tone_dim + domain_dim, out_dim),
            nn.ReLU(),
            nn.Linear(out_dim, out_dim),
        )

    def forward(
        self,
        phonetic_condition: torch.Tensor,
        phonetic_mask: torch.Tensor,
        tone_condition: torch.Tensor,
        tone_mask: torch.Tensor,
        domain_prior: torch.Tensor,
        domain_mask: torch.Tensor,
        phonetic_profile_acoustically_realized: torch.Tensor,
    ) -> torch.Tensor:
        # Contract: masked slots contribute zero regardless of stored values.
        ph = phonetic_condition * phonetic_mask.float()
        tn = tone_condition * tone_mask.float()
        dm = domain_prior * domain_mask.float()
        realized = phonetic_profile_acoustically_realized.float().unsqueeze(-1)
        # Stage A realized=0 → zero out phonetic path entirely
        ph = ph * realized
        x = torch.cat([ph, tn, dm], dim=-1)
        return self.mlp(x)
