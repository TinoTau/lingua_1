"""Phase 7E — Profile-conditioned phonetic query expansion (deterministic).

Markers: PHASE7E_RECALL_SPIKE / NOT_FOR_RUNTIME / NOT_FROZEN / SPIKE_ONLY
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from training.model2.pronunciation.syllable_substitution import apply_family_to_syllable
from training.model2.retrieval.normalize import normalize_for_lexicon_lookup, strip_tone
from training.model2.stage_b.active_feature_mask import BOUND_FEATURES_V1
from training.model2.stage_b.condition import OPPOSITE_DIRECTION

_CONTRACT_PATH = Path(__file__).resolve().parents[1] / "stage_b" / "phonetic_relation_direction_contract_v1.json"


@dataclass
class ExpandedQuery:
    syllables: list[str]
    relation_used: str
    reverse_family_applied: str
    strength: float
    n_positions_changed: int


def load_direction_contract() -> dict[str, Any]:
    return json.loads(_CONTRACT_PATH.read_text(encoding="utf-8"))


def active_relations_from_bias(
    phonetic_bias: Optional[dict[str, float]],
    *,
    allowed: tuple[str, ...] = BOUND_FEATURES_V1,
    max_active: int = 2,
    min_strength: float = 1e-6,
) -> list[tuple[str, float]]:
    """SPIKE_ONLY: ACTIVE if strength > 0. NOT_FINAL_STRENGTH_CONTRACT."""
    bias = dict(phonetic_bias or {})
    scored: list[tuple[str, float]] = []
    for fam in allowed:
        v = float(bias.get(fam) or 0.0)
        if v > min_strength:
            scored.append((fam, v))
    scored.sort(key=lambda x: (-x[1], x[0]))
    return scored[:max_active]


def hypothesize_intended_syllables(
    observed: list[str],
    user_feature_x_y: str,
) -> tuple[list[str], int]:
    """Map observed → intended using reverse of X_Y.

    Contract: X_Y means canonical/intended=X, observed=Y.
    Retrieval reverse: apply OPPOSITE_DIRECTION[X_Y] (= Y_X) on observed syllables.
    Output syllables are tone-stripped for lexicon index lookup.
    """
    rev = OPPOSITE_DIRECTION.get(user_feature_x_y)
    if not rev:
        return [normalize_for_lexicon_lookup(s) for s in observed], 0
    out: list[str] = []
    changed = 0
    for syl in observed:
        neu = apply_family_to_syllable(syl, rev)
        if neu is not None and neu != syl:
            out.append(normalize_for_lexicon_lookup(neu))
            changed += 1
        else:
            out.append(normalize_for_lexicon_lookup(syl))
    return out, changed


def generate_profile_queries(
    observed_syllables: list[str],
    phonetic_bias: Optional[dict[str, float]],
    *,
    max_active_relations: int = 2,
    max_queries: int = 8,
    include_identity_query: bool = False,
) -> list[ExpandedQuery]:
    """Generate bounded hypothesized syllable queries from profile.

    Does NOT include ground-truth / canonical syllables as oracle input.
    """
    queries: list[ExpandedQuery] = []
    if include_identity_query and observed_syllables:
        queries.append(
            ExpandedQuery(
                syllables=[normalize_for_lexicon_lookup(s) for s in observed_syllables],
                relation_used="",
                reverse_family_applied="",
                strength=0.0,
                n_positions_changed=0,
            )
        )
    for fam, strength in active_relations_from_bias(
        phonetic_bias, max_active=max_active_relations
    ):
        if len(queries) >= max_queries:
            break
        hyp, nchg = hypothesize_intended_syllables(observed_syllables, fam)
        if nchg <= 0:
            continue
        if any(q.syllables == hyp for q in queries):
            continue
        queries.append(
            ExpandedQuery(
                syllables=hyp,
                relation_used=fam,
                reverse_family_applied=OPPOSITE_DIRECTION[fam],
                strength=strength,
                n_positions_changed=nchg,
            )
        )
    return queries[:max_queries]
