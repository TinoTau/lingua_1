"""Pseudo-user construction for grouping / hard-negatives (not acoustic truth)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional


@dataclass
class PseudoUserProfileV1:
    pseudo_user_group_id: str
    profile_version: int = 1
    personal_terms: list[str] = field(default_factory=list)
    domain_bias: dict[str, float] = field(default_factory=dict)
    # Present in schema but explicitly NOT acoustically realized in Phase4 V1
    phonetic_bias: dict[str, float] = field(default_factory=dict)
    tone_bias: dict[str, float] = field(default_factory=dict)
    confusion_bias: dict[str, float] = field(default_factory=dict)
    phonetic_profile_not_acoustically_realized: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_pseudo_users(
    *,
    n_groups: int,
    personal_term_pool: list[str],
    domains: list[str],
    seed: int,
) -> list[PseudoUserProfileV1]:
    import hashlib

    users: list[PseudoUserProfileV1] = []
    for i in range(n_groups):
        ug = f"pseudo-g{i:02d}"
        # Deterministic pick of personal terms
        picks: list[str] = []
        for k in range(min(3, len(personal_term_pool))):
            h = int(hashlib.sha256(f"{seed}|{ug}|pt|{k}".encode()).hexdigest()[:8], 16)
            picks.append(personal_term_pool[h % len(personal_term_pool)])
        # unique preserve order
        seen = set()
        personal = []
        for t in picks:
            if t not in seen:
                seen.add(t)
                personal.append(t)
        domain = domains[i % len(domains)] if domains else "general"
        users.append(
            PseudoUserProfileV1(
                pseudo_user_group_id=ug,
                profile_version=1,
                personal_terms=personal,
                domain_bias={domain: 0.8},
                phonetic_bias={},
                tone_bias={},
                confusion_bias={},
                phonetic_profile_not_acoustically_realized=True,
            )
        )
    return users
