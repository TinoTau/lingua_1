"""ACTIVE_SET_V1 — staged relation coverage (not silent delete of WEAK/REVERSED)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from training.model2.stage_b.active_feature_mask import (
    BOUND_FEATURES_V1,
    REVERSED_FEATURES_V1,
    WEAK_FEATURES_V1,
)

# V2 Core = currently validated relations (Phase 7E/E2E). Deferred = requalify later.
ACTIVE_SET_V1: tuple[str, ...] = BOUND_FEATURES_V1
DEFERRED_RELATIONS: dict[str, tuple[str, ...]] = {
    "WEAK_FEATURES_V1": WEAK_FEATURES_V1,
    "REVERSED_FEATURES_V1": REVERSED_FEATURES_V1,
}

STRENGTH_CONTRACT = "V2_INITIAL_CONTRACT"  # ACTIVE/INACTIVE or bucket; not continuous regression


@dataclass
class ActiveSetPolicyV1:
    name: str = "ACTIVE_SET_V1"
    active_relations: tuple[str, ...] = ACTIVE_SET_V1
    deferred: dict[str, tuple[str, ...]] = field(
        default_factory=lambda: dict(DEFERRED_RELATIONS)
    )
    strength_contract: str = STRENGTH_CONTRACT
    note: str = (
        "BOUND-validated relations only for V2 Core. "
        "WEAK/REVERSED deferred — not deleted from UserProfile schema."
    )

    def filter_bias(self, phonetic_bias: dict[str, float] | None) -> dict[str, float]:
        out: dict[str, float] = {}
        for k, v in dict(phonetic_bias or {}).items():
            if k in self.active_relations and float(v) > 0:
                out[k] = float(v)
        return out

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["active_relations"] = list(self.active_relations)
        d["deferred"] = {k: list(v) for k, v in self.deferred.items()}
        return d


DEFAULT_ACTIVE_SET = ActiveSetPolicyV1()
