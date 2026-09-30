"""Authoritative pronunciation normalization for Model2 lexicon retrieval.

Markers: PHASE7F_AUDIT / NOT_FOR_RUNTIME / NOT_FROZEN

All retrieval paths that query CandidateIndex / FuzzyPool MUST call
`normalize_for_lexicon_lookup` (or `normalize_syllable_sequence_for_lookup`).
Do not duplicate tone-stripping / ü-v logic elsewhere.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Iterable

# CandidateIndex / FuzzyPool store toneless lowercase a-z syllables.
_TONE_TRAIL = re.compile(r"[0-5]+$")
_NON_ALNUM = re.compile(r"[^a-z0-9]")
_APOSTROPHE = re.compile(r"['’ʻʹ]")
_WHITESPACE = re.compile(r"\s+")


def unicode_normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text or "")


def normalize_for_lexicon_lookup(syl: str) -> str:
    """Normalize one syllable token for toneless CandidateIndex lookup.

    Contract (see pronunciation_normalization_contract.json):
    - Unicode NFKC
    - lower case
    - strip whitespace / apostrophes
    - ü / u: / v → v (pinyin-pro-ish; index uses v for ü in some keys) then keep a-z0-9
    - strip trailing tone digits 0-5
    - drop remaining non [a-z0-9]
    - erhua: keep 'er' as final if present (no special expand)
    """
    s = unicode_normalize(syl).strip().lower()
    s = _WHITESPACE.sub("", s)
    s = _APOSTROPHE.sub("", s)
    # ü variants → v (lexicon pinyin_key convention often uses v)
    s = s.replace("ü", "v").replace("u:", "v").replace("uu", "v")
    s = _NON_ALNUM.sub("", s)
    s = _TONE_TRAIL.sub("", s)
    return s


def normalize_syllable_sequence_for_lookup(syllables: Iterable[str]) -> list[str]:
    out = [normalize_for_lexicon_lookup(s) for s in syllables]
    return [s for s in out if s]


# Back-compat alias used by Phase 7E spike
def strip_tone(syl: str) -> str:
    return normalize_for_lexicon_lookup(syl)
