"""Model2TrainRowV1 — offline derived rows for future PyTorch DataLoader (not SSOT)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from training.model2.contract import (
    CANDIDATE_INDEX_VERSION,
    CONTEXT_CHAR_MAX,
    DOMAIN_DIM,
    DOMAIN_SLOT_IDS,
    FUZZY_POOL_VERSION,
    INPUT_CONTRACT_VERSION,
    PHONETIC_DIM,
    SPAN_CHAR_MAX,
    SYLLABLE_MAX,
    TONE_DIM,
    TRAINROW_SCHEMA_VERSION,
)


@dataclass
class Model2TrainRowV1:
    sample_id: str
    trainrow_id: str
    sample_kind: str
    source_type: str
    split: str

    span_text: str
    span_char_ids: list[int]
    span_len: int

    syllable_ids: list[int]
    syllable_count: int
    span_syllables: list[str]

    left_context: str
    right_context: str
    left_char_ids: list[int]
    right_char_ids: list[int]
    relative_position: float

    phonetic_condition: list[float]
    phonetic_mask: list[int]
    tone_condition: list[float]
    tone_mask: list[int]
    domain_prior: list[float]  # float32 continuous bias — NOT uint8 IDs
    domain_mask: list[int]

    profile_available: int
    personal_term_count: int
    phonetic_profile_acoustically_realized: int

    fuzzy_pool_term_ids: list[str]
    target_term_id: Optional[str]
    target_in_pool: bool
    target_oov: bool

    # Parallel arrays over fuzzy_pool_term_ids
    candidate_personal_features: list[list[float]]
    candidate_domain_features: list[list[float]]

    # Loss helpers
    positive_pool_index: Optional[int] = None  # index of target in pool if present
    self_span_as_negative_anchor: bool = False  # NEGATIVE: treat span surface as no-change
    hard_negative_term_id: Optional[str] = None
    hard_negative_in_pool: bool = False
    # Derived (Phase 5B): HN identity must not equal phonetic distance magic
    is_injected_hard_negative: bool = False
    positive_bucket: Optional[str] = None  # TERM_POSITIVE | NON_TERM_POSITIVE | RULE_POSITIVE
    is_term_positive: bool = False
    ignored_for_model2_recall: bool = False
    is_rule_positive: bool = False
    ambiguity_class: Optional[str] = None
    fuzzy_ambiguity_score: Optional[dict[str, Any]] = None
    context_target_leak: bool = False
    negative_type: Optional[str] = None  # N1 | N2
    hn_native: bool = False

    provenance: dict[str, Any] = field(default_factory=dict)
    contract_versions: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def validate_shapes(self) -> list[str]:
        errs: list[str] = []
        if len(self.phonetic_condition) != PHONETIC_DIM:
            errs.append(f"phonetic_condition len={len(self.phonetic_condition)}")
        if len(self.phonetic_mask) != PHONETIC_DIM:
            errs.append(f"phonetic_mask len={len(self.phonetic_mask)}")
        if len(self.tone_condition) != TONE_DIM:
            errs.append(f"tone_condition len={len(self.tone_condition)}")
        if len(self.tone_mask) != TONE_DIM:
            errs.append(f"tone_mask len={len(self.tone_mask)}")
        if len(self.domain_prior) != DOMAIN_DIM:
            errs.append(f"domain_prior len={len(self.domain_prior)}")
        if len(self.domain_mask) != DOMAIN_DIM:
            errs.append(f"domain_mask len={len(self.domain_mask)}")
        if len(self.span_char_ids) != SPAN_CHAR_MAX:
            errs.append(f"span_char_ids len={len(self.span_char_ids)}")
        if len(self.syllable_ids) != SYLLABLE_MAX:
            errs.append(f"syllable_ids len={len(self.syllable_ids)}")
        if len(self.left_char_ids) != CONTEXT_CHAR_MAX:
            errs.append(f"left_char_ids len={len(self.left_char_ids)}")
        if len(self.right_char_ids) != CONTEXT_CHAR_MAX:
            errs.append(f"right_char_ids len={len(self.right_char_ids)}")
        if len(self.candidate_personal_features) != len(self.fuzzy_pool_term_ids):
            errs.append("personal_features length mismatch")
        if len(self.candidate_domain_features) != len(self.fuzzy_pool_term_ids):
            errs.append("domain_features length mismatch")
        # dtype semantic: domain_prior must be floats
        if self.domain_prior and not isinstance(self.domain_prior[0], float):
            errs.append("domain_prior must be float")
        return errs


def make_trainrow_id(
    sample_id: str,
    fuzzy_pool_version: str = FUZZY_POOL_VERSION,
    input_contract_version: str = INPUT_CONTRACT_VERSION,
    candidate_index_version: str = CANDIDATE_INDEX_VERSION,
) -> str:
    raw = "|".join(
        [sample_id, fuzzy_pool_version, input_contract_version, candidate_index_version]
    )
    h = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
    return f"tr-{h}"


def empty_condition_vectors() -> dict[str, Any]:
    return {
        "phonetic_condition": [0.0] * PHONETIC_DIM,
        "phonetic_mask": [0] * PHONETIC_DIM,
        "tone_condition": [0.0] * TONE_DIM,
        "tone_mask": [0] * TONE_DIM,
        "domain_prior": [0.0] * DOMAIN_DIM,  # float32
        "domain_mask": [0] * DOMAIN_DIM,
    }


def encode_domain_prior(
    domain_bias: Optional[dict[str, float]],
    *,
    stage_a_mask: bool = True,
) -> tuple[list[float], list[int]]:
    prior = [0.0] * DOMAIN_DIM
    mask = [0] * DOMAIN_DIM
    if stage_a_mask or not domain_bias:
        return prior, mask
    for i, dom in enumerate(DOMAIN_SLOT_IDS):
        if dom in domain_bias:
            v = float(domain_bias[dom])
            prior[i] = max(-1.0, min(1.0, v / 5.0))
            mask[i] = 1
    return prior, mask


def dumps_trainrows(rows: list[Model2TrainRowV1]) -> str:
    return "\n".join(json.dumps(r.to_dict(), ensure_ascii=False) for r in rows) + (
        "\n" if rows else ""
    )


def default_contract_versions() -> dict[str, str]:
    return {
        "trainrow_schema_version": str(TRAINROW_SCHEMA_VERSION),
        "input_contract_version": INPUT_CONTRACT_VERSION,
        "fuzzy_pool_version": FUZZY_POOL_VERSION,
        "candidate_index_version": CANDIDATE_INDEX_VERSION,
    }
