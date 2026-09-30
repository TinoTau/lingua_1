"""Syllable initial/final/tone parsing + UserFeatureSchema V1 substitutions."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from training.model2.contract import PHONETIC_FEATURE_KEYS

# Longest-first initials (Putonghua)
_INITIALS = (
    "zh",
    "ch",
    "sh",
    "b",
    "p",
    "m",
    "f",
    "d",
    "t",
    "n",
    "l",
    "g",
    "k",
    "h",
    "j",
    "q",
    "x",
    "r",
    "z",
    "c",
    "s",
    "y",
    "w",
)

_TONE_RE = re.compile(r"^([a-z]+)([0-5]?)$")


@dataclass(frozen=True)
class SyllableParts:
    raw: str  # e.g. nai3
    initial: str
    final: str
    tone: str  # "", "0".."5"
    base: str  # initial+final without tone

    def with_tone(self) -> str:
        return f"{self.base}{self.tone}" if self.tone else self.base


def parse_syllable(syl: str) -> Optional[SyllableParts]:
    s = re.sub(r"[^a-z0-9]", "", (syl or "").strip().lower())
    if not s:
        return None
    m = _TONE_RE.match(s)
    if not m:
        return None
    body, tone = m.group(1), m.group(2)
    if not body:
        return None
    initial = ""
    final = body
    for ini in _INITIALS:
        if body.startswith(ini) and len(body) > len(ini):
            initial = ini
            final = body[len(ini) :]
            break
        if body == ini:
            # rare: syllable is just initial-like — treat whole as final
            initial = ""
            final = body
            break
    return SyllableParts(raw=s, initial=initial, final=final, tone=tone or "", base=body)


def apply_family_to_parts(parts: SyllableParts, family: str) -> Optional[SyllableParts]:
    """Apply one directional confusion; preserve tone. Return None if not applicable."""
    if family not in PHONETIC_FEATURE_KEYS:
        return None
    src, dst = family.split("_", 1)
    # initial families
    if src in ("n", "l", "zh", "z", "ch", "c", "sh", "s", "f", "h") and dst in (
        "n",
        "l",
        "zh",
        "z",
        "ch",
        "c",
        "sh",
        "s",
        "f",
        "h",
    ):
        if parts.initial != src:
            return None
        new_base = dst + parts.final
        return SyllableParts(
            raw=f"{new_base}{parts.tone}",
            initial=dst,
            final=parts.final,
            tone=parts.tone,
            base=new_base,
        )
    # final families
    if src in ("an", "ang", "en", "eng", "in", "ing") and dst in (
        "an",
        "ang",
        "en",
        "eng",
        "in",
        "ing",
    ):
        if parts.final != src:
            return None
        new_base = parts.initial + dst
        return SyllableParts(
            raw=f"{new_base}{parts.tone}",
            initial=parts.initial,
            final=dst,
            tone=parts.tone,
            base=new_base,
        )
    return None


def apply_family_to_syllable(syl: str, family: str) -> Optional[str]:
    parts = parse_syllable(syl)
    if not parts:
        return None
    out = apply_family_to_parts(parts, family)
    return out.with_tone() if out else None


def corrupt_syllable_sequence(
    syllables: list[str],
    family: str,
    *,
    max_positions: int = 2,
) -> tuple[list[str], list[int]]:
    """Corrupt up to max_positions applicable syllables; tone preserved."""
    out = list(syllables)
    idxs: list[int] = []
    for i, syl in enumerate(syllables):
        if len(idxs) >= max_positions:
            break
        neu = apply_family_to_syllable(syl, family)
        if neu is not None and neu != syl:
            out[i] = neu
            idxs.append(i)
    return out, idxs


def families_applicable_to_term(syllables: list[str]) -> list[str]:
    hit: list[str] = []
    for fam in PHONETIC_FEATURE_KEYS:
        _, idxs = corrupt_syllable_sequence(syllables, fam, max_positions=1)
        if idxs:
            hit.append(fam)
    return hit
