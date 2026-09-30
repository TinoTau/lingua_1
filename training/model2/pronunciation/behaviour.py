"""Pseudo-user pronunciation behaviour profiles (offline probe only)."""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from typing import Any

from training.model2.contract import PHONETIC_FEATURE_KEYS
from training.model2.pseudo_user.factory import PseudoUserProfileV1

# Probe-only strength → application probability (not frozen production values)
STRENGTH_TO_PROB = {
    "NONE": 0.0,
    "LOW": 0.20,
    "MEDIUM": 0.50,
    "HIGH": 0.80,
}


@dataclass
class PronunciationBehaviourProfile:
    pseudo_user_id: str
    # family → strength label
    family_strength: dict[str, str] = field(default_factory=dict)
    # family → apply probability
    family_prob: dict[str, float] = field(default_factory=dict)
    is_neutral: bool = False
    personal_terms: list[str] = field(default_factory=list)
    domain_bias: dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_user_profile(self) -> PseudoUserProfileV1:
        """Map to frozen UserProfile schema; phonetic_bias uses numeric probs."""
        phonetic_bias = {
            fam: float(self.family_prob.get(fam, 0.0))
            for fam in PHONETIC_FEATURE_KEYS
            if self.family_prob.get(fam, 0.0) > 0
        }
        # Acoustically realized is set later after successful validation — default false here
        return PseudoUserProfileV1(
            pseudo_user_group_id=self.pseudo_user_id,
            profile_version=1,
            personal_terms=list(self.personal_terms),
            domain_bias=dict(self.domain_bias),
            phonetic_bias=phonetic_bias,
            tone_bias={},
            confusion_bias={},
            phonetic_profile_not_acoustically_realized=True,
        )


def _h(seed: int, *parts: str) -> int:
    material = "|".join([str(seed), *parts])
    return int(hashlib.sha256(material.encode()).hexdigest()[:8], 16)


def build_pronunciation_users(
    *,
    n_users: int = 30,
    n_neutral: int = 5,
    seed: int = 20260813,
    families: tuple[str, ...] | None = None,
    domains: list[str] | None = None,
) -> list[PronunciationBehaviourProfile]:
    """User-first: behaviour profile BEFORE utterances."""
    fams = list(families or PHONETIC_FEATURE_KEYS)
    domains = domains or ["general"]
    strengths = ["LOW", "MEDIUM", "HIGH"]
    users: list[PronunciationBehaviourProfile] = []

    for i in range(n_neutral):
        uid = f"pron-u-neutral-{i:02d}"
        users.append(
            PronunciationBehaviourProfile(
                pseudo_user_id=uid,
                family_strength={},
                family_prob={},
                is_neutral=True,
                personal_terms=[],
                domain_bias={domains[i % len(domains)]: 0.5},
            )
        )

    for i in range(n_users):
        uid = f"pron-u-{i:02d}"
        # 1–2 active families per user for clean causal signal
        n_fam = 1 + (_h(seed, uid, "nf") % 2)
        picked: list[str] = []
        for k in range(n_fam):
            fam = fams[_h(seed, uid, "fam", str(k)) % len(fams)]
            if fam not in picked:
                picked.append(fam)
        family_strength: dict[str, str] = {}
        family_prob: dict[str, float] = {}
        for fam in picked:
            st = strengths[_h(seed, uid, fam, "st") % len(strengths)]
            family_strength[fam] = st
            family_prob[fam] = STRENGTH_TO_PROB[st]
        users.append(
            PronunciationBehaviourProfile(
                pseudo_user_id=uid,
                family_strength=family_strength,
                family_prob=family_prob,
                is_neutral=False,
                personal_terms=[],
                domain_bias={domains[_h(seed, uid, "dom") % len(domains)]: 0.5},
            )
        )
    return users


def should_apply_corruption(
    *,
    user: PronunciationBehaviourProfile,
    family: str,
    sample_plan_id: str,
    seed: int,
) -> bool:
    p = float(user.family_prob.get(family, 0.0))
    if p <= 0:
        return False
    # deterministic Bernoulli
    u = (_h(seed, user.pseudo_user_id, family, sample_plan_id, "bern") % 10_000) / 10_000.0
    return u < p
