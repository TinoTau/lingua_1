"""Model2 Stage A V1 — Dual-Encoder Fuzzy Retrieval Scorer (probe)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Optional

import torch
import torch.nn as nn

from training.model2.contract import (
    CHAR_HASH_BUCKETS,
    DOMAIN_DIM,
    PHONETIC_DIM,
    QUERY_EMBED_DIM,
    TONE_DIM,
)
from training.model2.model.condition_scorer import ConditionCompatibilityScorer, build_interaction
from training.model2.model.condition_scorer_v2 import ConditionCompatibilityScorerV2, build_interaction_v2
from training.model2.model.encoders import (
    CandidateEncoder,
    ConditionEncoder,
    QueryEncoder,
    SharedTokenTables,
)
from training.model2.model.scorer import BaseDotScorer, WeakPriorScorer


@dataclass
class Model2Config:
    variant: str = "M0"  # M0 | M1 | B1
    embed_dim: int = QUERY_EMBED_DIM
    char_dim: int = 24
    syl_dim: int = 24
    hidden: int = 96
    char_buckets: int = CHAR_HASH_BUCKETS
    syl_vocab: int = 377
    personal_dim: int = 3
    domain_feat_dim: int = 2
    use_weak_prior: bool = False
    use_condition_in_score: bool = False  # Stage A: always False
    use_relation_condition: bool = False  # Phase 6B/6C: User×Relation delta
    use_condition_scorer_v2: bool = False  # Phase 6C
    condition_delta_cap: float = 0.35
    condition_hidden: int = 32
    mark: str = "PROBE_ONLY"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def count_parameters(model: nn.Module) -> dict[str, int]:
    """Unique trainable counts; shared tables attributed once under `shared`."""
    total = sum(p.numel() for p in model.parameters() if p.requires_grad)
    seen: set[int] = set()
    by_mod: dict[str, int] = {}
    for name, mod in model.named_children():
        n = 0
        for p in mod.parameters():
            if not p.requires_grad:
                continue
            pid = id(p)
            if pid in seen:
                continue
            seen.add(pid)
            n += p.numel()
        by_mod[name] = n
    leftover = 0
    leftover_names = []
    for name, p in model.named_parameters():
        if not p.requires_grad or id(p) in seen:
            continue
        leftover += p.numel()
        leftover_names.append(name)
        seen.add(id(p))
    by_mod["no_match_anchor_and_gates"] = leftover
    return {
        "trainable_total": total,
        "by_module": by_mod,
        "root_params": leftover_names,
    }


class Model2StageAV1(nn.Module):
    """
    Stage A:
      score_base = dot(Qbase, C)
      optional weak personal/domain (M1)
      phonetic/tone condition MASKED (must not affect score)
      NO_MATCH learnable anchor

    Phase 6B (use_relation_condition=True):
      score_final = score_base + gate * delta_condition(user × relation)
      PROFILE_UNAVAILABLE → delta=0 → score_final == score_base
    """

    ARTIFACT_MARKERS = ("PROBE_ONLY", "NOT_FOR_RUNTIME", "NOT_FROZEN")

    def __init__(self, cfg: Model2Config):
        super().__init__()
        self.cfg = cfg
        self.shared = SharedTokenTables(cfg.char_buckets, cfg.syl_vocab, cfg.char_dim, cfg.syl_dim)
        self.query_encoder = QueryEncoder(self.shared, cfg.char_dim, cfg.syl_dim, cfg.embed_dim, cfg.hidden)
        self.candidate_encoder = CandidateEncoder(
            self.shared, cfg.char_dim, cfg.syl_dim, cfg.embed_dim, cfg.hidden
        )
        self.condition_encoder = ConditionEncoder(PHONETIC_DIM, TONE_DIM, DOMAIN_DIM, cfg.embed_dim)
        self.base_scorer = BaseDotScorer()
        self.weak_scorer = WeakPriorScorer(cfg.personal_dim, cfg.domain_feat_dim)
        self.no_match_embed = nn.Parameter(torch.randn(cfg.embed_dim) * 0.02)
        self.condition_gate = nn.Parameter(torch.zeros(1))
        if cfg.use_condition_scorer_v2:
            self.condition_compat = ConditionCompatibilityScorerV2(
                hidden=cfg.condition_hidden,
                delta_cap=cfg.condition_delta_cap,
                use_base_feat=True,
                use_base_margin=True,
            )
        else:
            self.condition_compat = ConditionCompatibilityScorer(
                hidden=cfg.condition_hidden,
                delta_cap=cfg.condition_delta_cap,
                use_base_feat=True,
            )
        self.relation_gate = nn.Parameter(torch.tensor([0.5]))

    def encode_query(self, batch: dict[str, torch.Tensor]) -> torch.Tensor:
        return self.query_encoder(
            batch["span_char_ids"],
            batch["left_char_ids"],
            batch["right_char_ids"],
            batch["syllable_ids"],
            batch["syllable_count"],
            batch["relative_position"],
        )

    def encode_candidates(self, batch: dict[str, torch.Tensor]) -> torch.Tensor:
        return self.candidate_encoder(
            batch["cand_char_ids"],
            batch["cand_syl_ids"],
            batch["cand_syl_count"],
            batch["cand_term_type_oh"],
        )

    def condition_vector(self, batch: dict[str, torch.Tensor]) -> torch.Tensor:
        return self.condition_encoder(
            batch["phonetic_condition"],
            batch["phonetic_mask"],
            batch["tone_condition"],
            batch["tone_mask"],
            batch["domain_prior"],
            batch["domain_mask"],
            batch["phonetic_profile_acoustically_realized"],
        )

    def score_base(
        self,
        q: torch.Tensor,
        c: torch.Tensor,
        personal_feats: Optional[torch.Tensor] = None,
        domain_feats: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        if self.cfg.use_weak_prior and personal_feats is not None and domain_feats is not None:
            return self.weak_scorer(q, c, personal_feats, domain_feats)
        return self.base_scorer(q, c)

    def score(
        self,
        q: torch.Tensor,
        c: torch.Tensor,
        personal_feats: Optional[torch.Tensor] = None,
        domain_feats: Optional[torch.Tensor] = None,
        condition_vec: Optional[torch.Tensor] = None,
        *,
        relation_features: Optional[torch.Tensor] = None,
        phonetic_condition: Optional[torch.Tensor] = None,
        phonetic_mask: Optional[torch.Tensor] = None,
        realized: Optional[torch.Tensor] = None,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Returns (score_final, score_base, delta_condition)."""
        base = self.score_base(q, c, personal_feats, domain_feats)
        delta = torch.zeros_like(base)
        if self.cfg.use_relation_condition and relation_features is not None:
            p = relation_features.size(1)
            base_pool = base[:, :p]
            pool_mask = None
            # optional pool_mask not passed here; scorer handles without it
            if self.cfg.use_condition_scorer_v2:
                inter, active = build_interaction_v2(
                    phonetic_condition,
                    phonetic_mask,
                    relation_features,
                    realized if realized is not None else torch.ones(base.size(0), device=base.device),
                )
                delta_pool = self.condition_compat(inter, base_pool, profile_active=active, pool_mask=pool_mask)
            else:
                inter, active = build_interaction(
                    phonetic_condition,
                    phonetic_mask,
                    relation_features,
                    realized if realized is not None else torch.ones(base.size(0), device=base.device),
                )
                delta_pool = self.condition_compat(inter, base_pool, profile_active=active)
            gate = torch.nn.functional.softplus(self.relation_gate)
            delta_pool = gate * delta_pool
            if base.size(1) > p:
                z = torch.zeros(base.size(0), base.size(1) - p, device=base.device, dtype=base.dtype)
                delta = torch.cat([delta_pool, z], dim=1)
            else:
                delta = delta_pool
            return base + delta, base, delta
        scores = base
        if (
            not self.cfg.use_relation_condition
            and self.cfg.use_condition_in_score
            and condition_vec is not None
        ):
            scores = scores + self.condition_gate * torch.einsum("bd,bpd->bp", condition_vec, c)
        return scores, base, delta

    def forward(self, batch: dict[str, torch.Tensor]) -> dict[str, torch.Tensor]:
        q = self.encode_query(batch)
        c = self.encode_candidates(batch)
        cond = self.condition_vector(batch)
        nm = F_normalize(self.no_match_embed).unsqueeze(0).unsqueeze(0).expand(q.size(0), 1, -1)
        c_full = torch.cat([c, nm], dim=1)

        pers = batch.get("cand_personal")
        dom = batch.get("cand_domain")
        if pers is not None:
            z = torch.zeros(pers.size(0), 1, pers.size(2), device=pers.device, dtype=pers.dtype)
            pers_full = torch.cat([pers, z], dim=1)
            zd = torch.zeros(dom.size(0), 1, dom.size(2), device=dom.device, dtype=dom.dtype)
            dom_full = torch.cat([dom, zd], dim=1)
        else:
            pers_full = dom_full = None

        pool_mask = batch["pool_mask"]
        nm_mask = torch.ones(q.size(0), 1, dtype=torch.bool, device=q.device)
        full_mask = torch.cat([pool_mask, nm_mask], dim=1)

        rel = batch.get("cand_relation_features")
        scores, base, delta = self.score(
            q,
            c_full,
            pers_full,
            dom_full,
            cond,
            relation_features=rel,
            phonetic_condition=batch.get("phonetic_condition"),
            phonetic_mask=batch.get("phonetic_mask"),
            realized=batch.get("phonetic_profile_acoustically_realized"),
        )
        scores = scores.masked_fill(~full_mask, -1e9)
        base_m = base.masked_fill(~full_mask, -1e9)
        return {
            "scores": scores,
            "score_base": base_m,
            "delta_condition": delta,
            "q": q,
            "c": c,
            "condition": cond,
            "pool_size": pool_mask.sum(dim=1),
            "no_match_index": torch.full((q.size(0),), c.size(1), device=q.device, dtype=torch.long),
        }


def F_normalize(x: torch.Tensor) -> torch.Tensor:
    return torch.nn.functional.normalize(x, dim=-1)
