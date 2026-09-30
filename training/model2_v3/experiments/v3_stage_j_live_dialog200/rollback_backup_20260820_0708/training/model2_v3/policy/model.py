"""V3 retrieval-policy model: FineSpan + profile-set → action scores + budget.

Stage P: pronunciation retrieval actions (action_head).
Stage D: same shared trunk + domain_action_head (TRAINING ARTIFACT staging OK;
runtime remains ONE Model2 — never separate ONNX runtimes).
"""

from __future__ import annotations

from typing import Optional

import torch
import torch.nn as nn

from training.model2.contract import DOMAIN_SLOT_IDS, DOMAIN_DIM, PHONETIC_DIM, PHONETIC_FEATURE_INDEX_V1
from training.model2_v2.runtime.active_set import ACTIVE_SET_V1
from training.model2_v3.policy.actions import ACTION_CATALOG
from training.model2_v3.policy.domain_actions import N_DOMAIN_ACTIONS

SPAN_DIM = 64
ITEM_DIM = 32
PROFILE_POOL_DIM = 64
STATE_DIM = 12
HIDDEN = 128
N_ACTIONS = len(ACTION_CATALOG)
N_REL = len(ACTIVE_SET_V1)
MAX_PROFILE_ITEMS = 64

# profile item type_id: 0=phonetic, 1=lexical_term, 2=domain_evidence_slot
TYPE_PHONETIC = 0
TYPE_LEXICAL = 1
TYPE_DOMAIN = 2

QB_CLASSES = (1, 2, 3, 4, 6, 8)
DOMAIN_SLOT_INDEX = {d: i for i, d in enumerate(DOMAIN_SLOT_IDS)}


def hash_span(syllables: list[str], dim: int = SPAN_DIM) -> torch.Tensor:
    v = torch.zeros(dim)
    for s in syllables:
        t = (s or "").lower()
        v[hash(t) % dim] += 1.0
        if len(t) >= 2:
            v[hash(t[:2]) % dim] += 0.5
    return v / float(len(syllables) or 1)


def profile_items_from_bias(
    phonetic_bias: dict[str, float] | None,
    *,
    feature_hash: str = "legacy",
) -> list[dict]:
    items = []
    for k, v in sorted((phonetic_bias or {}).items()):
        if float(v) <= 0:
            continue
        if k in PHONETIC_FEATURE_INDEX_V1:
            key_id = PHONETIC_FEATURE_INDEX_V1[k]
        elif feature_hash == "v1":
            from training.model2_v3.policy.feature_hash_v1 import stable_bucket

            key_id = stable_bucket(k, PHONETIC_DIM)
        else:
            key_id = hash(k) % PHONETIC_DIM
        items.append(
            {
                "type_id": TYPE_PHONETIC,
                "key_id": key_id,
                "strength": float(min(1.0, abs(float(v)))),
                "confidence": 1.0 if k in ACTIVE_SET_V1 else 0.4,
            }
        )
    return items[:MAX_PROFILE_ITEMS]


def profile_items_from_lexical(
    personal_terms: list[str] | None,
    domain_evidence: dict[str, float] | None,
    *,
    term_evidence: dict[str, float] | None = None,
    max_lexical_items: int = 32,
    feature_hash: str = "legacy",
) -> list[dict]:
    """Compact UserProfile lexical encoding — O(1) domain slots + capped term hashes.

    Scalability: never traverse 500 terms inside the forward pass beyond the cap;
    overflow is folded into domain_evidence (caller-derived).
    """
    items: list[dict] = []
    evid = term_evidence or {}
    for t in (personal_terms or [])[:max_lexical_items]:
        if feature_hash == "v1":
            from training.model2_v3.policy.feature_hash_v1 import stable_bucket

            kid = stable_bucket(t, max(1, PHONETIC_DIM))
        else:
            kid = abs(hash(t)) % max(1, PHONETIC_DIM)
        items.append(
            {
                "type_id": TYPE_LEXICAL,
                "key_id": kid,
                "strength": float(min(1.0, abs(float(evid.get(t, 1.0))))),
                "confidence": 0.8,
            }
        )
    for d, w in sorted((domain_evidence or {}).items()):
        if float(w) <= 0:
            continue
        if d in DOMAIN_SLOT_INDEX:
            kid = DOMAIN_SLOT_INDEX[d]
        elif feature_hash == "v1":
            from training.model2_v3.policy.feature_hash_v1 import stable_bucket

            kid = stable_bucket(d, DOMAIN_DIM)
        else:
            kid = abs(hash(d)) % DOMAIN_DIM
        items.append(
            {
                "type_id": TYPE_DOMAIN,
                "key_id": kid,
                "strength": float(min(1.0, abs(float(w)))),
                "confidence": 0.9,
            }
        )
    return items


def merge_profile_items(*groups: list[dict]) -> list[dict]:
    out: list[dict] = []
    for g in groups:
        out.extend(g)
    return out[:MAX_PROFILE_ITEMS]


def encode_profile_items(items: list[dict]) -> torch.Tensor:
    mat = torch.zeros(MAX_PROFILE_ITEMS, ITEM_DIM)
    for i, it in enumerate(items[:MAX_PROFILE_ITEMS]):
        mat[i, 0] = float(it.get("type_id", 0))
        mat[i, 1] = float(it.get("key_id", 0)) / max(1, PHONETIC_DIM - 1)
        mat[i, 2] = float(it.get("strength", 0))
        mat[i, 3] = float(it.get("confidence", 0))
        kid = int(it.get("key_id", 0))
        if 4 + kid < ITEM_DIM:
            mat[i, 4 + kid] = 1.0
        # type one-hot in leftover dims when available
        tid = int(it.get("type_id", 0))
        if 28 + tid < ITEM_DIM:
            mat[i, 28 + tid] = 1.0
    return mat


def encode_state(
    *,
    base_pool: int,
    n_items: int,
    query_budget: int,
    cand_budget: int,
    applicability: list[float],
    n_applicable: int = 0,
) -> torch.Tensor:
    v = torch.zeros(STATE_DIM)
    v[0] = min(1.0, base_pool / 16.0)
    v[1] = min(1.0, n_items / 50.0)
    v[2] = query_budget / 8.0
    v[3] = cand_budget / 16.0
    v[4] = min(1.0, n_applicable / 7.0)
    for i, a in enumerate(applicability[:7]):
        v[5 + i] = float(a)
    return v


class RetrievalPolicyV3(nn.Module):
    """Span ⊕ attention-pooled profile-set ⊕ state → action logits + budgets.

    Optional domain_action_head shares the same trunk (Stage D).
    """

    def __init__(
        self,
        *,
        with_domain_head: bool = False,
        with_ambiguity_head: bool = False,
        ambiguity_version: str = "v1",
    ) -> None:
        super().__init__()
        self.with_domain_head = with_domain_head
        self.with_ambiguity_head = with_ambiguity_head
        self.ambiguity_version = ambiguity_version
        self.item_mlp = nn.Sequential(
            nn.Linear(ITEM_DIM, ITEM_DIM),
            nn.ReLU(),
            nn.Linear(ITEM_DIM, PROFILE_POOL_DIM),
        )
        self.attn = nn.Linear(PROFILE_POOL_DIM, 1)
        in_dim = SPAN_DIM + PROFILE_POOL_DIM + STATE_DIM
        self.trunk = nn.Sequential(
            nn.Linear(in_dim, HIDDEN),
            nn.ReLU(),
            nn.Linear(HIDDEN, HIDDEN),
            nn.ReLU(),
        )
        self.action_head = nn.Linear(HIDDEN, N_ACTIONS)
        self.query_budget_head = nn.Linear(HIDDEN, len(QB_CLASSES))
        self.cand_budget_head = nn.Linear(HIDDEN, 4)
        if with_domain_head:
            self.domain_action_head = nn.Linear(HIDDEN, N_DOMAIN_ACTIONS)
        else:
            self.domain_action_head = None  # type: ignore
        # Optional skeleton. Frozen Stage-J load MUST pass with_ambiguity_head=False
        # so param_count stays 47210 and strict state_dict matches.
        if with_ambiguity_head:
            if ambiguity_version == "v2":
                from training.model2_v3.policy.ambiguity_head_v2 import AmbiguityHeadV2

                self.ambiguity_head = AmbiguityHeadV2()
                self.single_char_context_encoder = None  # encoder lives on ambiguity_head.encoder
            else:
                from training.model2_v3.policy.ambiguity_head_v1 import AmbiguityHeadV1

                self.single_char_context_encoder = None  # type: ignore
                self.ambiguity_head = AmbiguityHeadV1()
        else:
            self.single_char_context_encoder = None  # type: ignore
            self.ambiguity_head = None  # type: ignore

    def encode(
        self,
        span_feat: torch.Tensor,
        profile_items: torch.Tensor,
        item_mask: torch.Tensor,
        state_feat: torch.Tensor,
    ) -> torch.Tensor:
        b, m, _ = profile_items.shape
        emb = self.item_mlp(profile_items.reshape(b * m, -1)).reshape(b, m, PROFILE_POOL_DIM)
        scores = self.attn(emb).squeeze(-1)
        scores = scores.masked_fill(item_mask <= 0, -1e9)
        w = torch.softmax(scores, dim=-1).unsqueeze(-1)
        empty = (item_mask.sum(dim=-1, keepdim=True) <= 0).float()
        pooled = (emb * w * item_mask.unsqueeze(-1)).sum(dim=1) * (1.0 - empty)
        return self.trunk(torch.cat([span_feat, pooled, state_feat], dim=-1))

    def forward(
        self,
        span_feat: torch.Tensor,
        profile_items: torch.Tensor,
        item_mask: torch.Tensor,
        state_feat: torch.Tensor,
    ) -> dict[str, torch.Tensor]:
        h = self.encode(span_feat, profile_items, item_mask, state_feat)
        out = {
            "action_logits": self.action_head(h),
            "query_budget_logits": self.query_budget_head(h),
            "cand_budget_logits": self.cand_budget_head(h),
        }
        if self.domain_action_head is not None:
            out["domain_action_logits"] = self.domain_action_head(h)
        return out

    def param_count(self) -> int:
        return sum(p.numel() for p in self.parameters())

    def freeze_shared(self) -> None:
        for mod in (self.item_mlp, self.attn, self.trunk, self.action_head, self.query_budget_head, self.cand_budget_head):
            for p in mod.parameters():
                p.requires_grad = False


def pack_batch_inputs(
    spans: list[list[str]],
    profiles: list[dict[str, float]],
    states: list[dict],
    device: Optional[torch.device] = None,
    *,
    feature_hash: str = "legacy",
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """Pack model inputs.

    feature_hash:
      - \"legacy\": Python hash() (Stage P checkpoint compatibility)
      - \"v1\": MODEL2_FEATURE_HASH_V1 (required for Stage J)
    """
    sf, pi, mk, st = [], [], [], []
    for syls, prof, state in zip(spans, profiles, states):
        items = profile_items_from_bias(prof, feature_hash=feature_hash)
        if state.get("personal_terms") is not None or state.get("domain_evidence") is not None:
            items = merge_profile_items(
                items,
                profile_items_from_lexical(
                    state.get("personal_terms") or [],
                    state.get("domain_evidence") or {},
                    term_evidence=state.get("term_evidence") or {},
                    max_lexical_items=int(state.get("max_lexical_items") or 32),
                    feature_hash=feature_hash,
                ),
            )
        mat = encode_profile_items(items)
        mask = torch.zeros(MAX_PROFILE_ITEMS)
        mask[: len(items)] = 1.0
        appl = [1.0 if float(prof.get(r) or 0) > 0 else 0.0 for r in ACTIVE_SET_V1]
        n_app = int(state.get("n_applicable", sum(1 for a in appl if a > 0)))
        if "applicability" in state:
            appl = (list(state["applicability"]) + [0.0] * 7)[:7]
        if feature_hash == "v1":
            from training.model2_v3.policy.feature_hash_v1 import hash_span_v1

            sf.append(torch.tensor(hash_span_v1(syls), dtype=torch.float32))
        else:
            sf.append(hash_span(syls))
        pi.append(mat)
        mk.append(mask)
        st.append(
            encode_state(
                base_pool=int(state.get("base_pool", 0)),
                n_items=len(items),
                query_budget=int(state.get("query_budget", 8)),
                cand_budget=int(state.get("cand_budget", 8)),
                applicability=appl,
                n_applicable=n_app,
            )
        )
    out = (torch.stack(sf), torch.stack(pi), torch.stack(mk), torch.stack(st))
    if device is not None:
        out = tuple(t.to(device) for t in out)  # type: ignore
    return out  # type: ignore
