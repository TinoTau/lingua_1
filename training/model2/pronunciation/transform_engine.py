"""PronunciationTransformEngine V1 — unified initial/final transforms (tone preserve)."""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from training.model2.contract import PHONETIC_FEATURE_KEYS
from training.model2.pronunciation.pronunciation_syllable import (
    LEXICAL_STATUS_NON_LEXICAL,
    LEXICAL_STATUS_UNKNOWN,
    PronunciationSyllable,
)

TRANSFORM_ENGINE_VERSION = "pronunciation-transform-engine-v1"
TONE_POLICY_PRESERVE = "PRESERVE"

_INITIAL_FAMS = {
    "n_l",
    "l_n",
    "zh_z",
    "z_zh",
    "ch_c",
    "c_ch",
    "sh_s",
    "s_sh",
    "f_h",
    "h_f",
}
_FINAL_FAMS = {
    "an_ang",
    "ang_an",
    "en_eng",
    "eng_en",
    "in_ing",
    "ing_in",
}


@dataclass
class TransformResult:
    canonical: PronunciationSyllable
    corrupted: PronunciationSyllable
    family: str
    applied: bool
    tone_policy: str = TONE_POLICY_PRESERVE
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "canonical": self.canonical.to_dict(),
            "corrupted": self.corrupted.to_dict(),
            "family": self.family,
            "applied": self.applied,
            "tone_policy": self.tone_policy,
            "notes": self.notes,
            "engine_version": TRANSFORM_ENGINE_VERSION,
        }


class PronunciationTransformEngineV1:
    """canonical syllable + family → corrupted syllable (may be NON_LEXICAL)."""

    version = TRANSFORM_ENGINE_VERSION

    def applicable(self, syl: PronunciationSyllable, family: str) -> bool:
        if family not in PHONETIC_FEATURE_KEYS:
            return False
        src, _dst = family.split("_", 1)
        if family in _INITIAL_FAMS:
            return syl.initial == src
        if family in _FINAL_FAMS:
            return syl.final == src
        return False

    def transform(
        self,
        syl: PronunciationSyllable,
        family: str,
        *,
        tone_policy: str = TONE_POLICY_PRESERVE,
        mark_non_lexical: bool = True,
    ) -> TransformResult:
        if family not in PHONETIC_FEATURE_KEYS:
            return TransformResult(
                canonical=syl,
                corrupted=syl,
                family=family,
                applied=False,
                tone_policy=tone_policy,
                notes="UNSUPPORTED_FOR_PROFILE_V1",
            )
        if not self.applicable(syl, family):
            return TransformResult(
                canonical=syl,
                corrupted=syl,
                family=family,
                applied=False,
                tone_policy=tone_policy,
                notes="NOT_APPLICABLE",
            )
        src, dst = family.split("_", 1)
        tone = syl.tone if tone_policy == TONE_POLICY_PRESERVE else syl.tone
        if family in _INITIAL_FAMS:
            out = PronunciationSyllable(
                initial=dst,
                final=syl.final,
                tone=tone,
                lexical_status=(
                    LEXICAL_STATUS_NON_LEXICAL if mark_non_lexical else LEXICAL_STATUS_UNKNOWN
                ),
            )
        else:
            out = PronunciationSyllable(
                initial=syl.initial,
                final=dst,
                tone=tone,
                lexical_status=(
                    LEXICAL_STATUS_NON_LEXICAL if mark_non_lexical else LEXICAL_STATUS_UNKNOWN
                ),
            )
        # lexical_status refined later by surface/realizer lookup; keep NON_LEXICAL default
        # until SurfaceRealizer confirms a surface.
        return TransformResult(
            canonical=syl,
            corrupted=out,
            family=family,
            applied=True,
            tone_policy=tone_policy,
            notes="OK",
        )

    def transform_sequence(
        self,
        syllables: list[PronunciationSyllable],
        family: str,
        *,
        apply_mask: list[bool] | None = None,
        max_positions: int | None = None,
        tone_policy: str = TONE_POLICY_PRESERVE,
    ) -> tuple[list[PronunciationSyllable], list[int], list[TransformResult]]:
        out = list(syllables)
        idxs: list[int] = []
        details: list[TransformResult] = []
        for i, syl in enumerate(syllables):
            if apply_mask is not None and not apply_mask[i]:
                continue
            if max_positions is not None and len(idxs) >= max_positions:
                break
            tr = self.transform(syl, family, tone_policy=tone_policy)
            details.append(tr)
            if tr.applied:
                out[i] = tr.corrupted
                idxs.append(i)
        return out, idxs, details


def decide_positions(
    *,
    n: int,
    applicable_idxs: list[int],
    probability: float,
    seed: int,
    user_id: str,
    plan_id: str,
    family: str,
) -> list[bool]:
    """Per-position Bernoulli; does not force all applicable slots."""
    mask = [False] * n
    for i in applicable_idxs:
        material = f"{seed}|{user_id}|{family}|{plan_id}|pos|{i}"
        u = int(hashlib.sha256(material.encode()).hexdigest()[:8], 16) / 10_000.0
        # map to [0,1)
        u = (int(hashlib.sha256(material.encode()).hexdigest()[:8], 16) % 10_000) / 10_000.0
        if u < probability:
            mask[i] = True
    return mask
