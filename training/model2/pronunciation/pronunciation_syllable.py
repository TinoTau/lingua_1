"""Canonical pronunciation syllable — acoustic evidence, not lexical gate."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Optional

# Frozen principle:
# Observed or synthetic pronunciation represents acoustic evidence and does not
# need to correspond to a lexical Mandarin entry.
# Lexical syllable validity MUST NOT be used as a hard gate before realization.

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

LEXICAL_STATUS_LEXICAL = "LEXICAL"
LEXICAL_STATUS_NON_LEXICAL = "NON_LEXICAL"
LEXICAL_STATUS_UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class PronunciationSyllable:
    initial: str
    final: str
    tone: int  # 0..5; 0/5 = light/neutral when observed
    lexical_status: str = LEXICAL_STATUS_UNKNOWN

    @property
    def base(self) -> str:
        return f"{self.initial}{self.final}"

    @property
    def compact(self) -> str:
        return f"{self.base}{self.tone}"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_compact(cls, s: str, *, lexical_status: str = LEXICAL_STATUS_UNKNOWN) -> Optional["PronunciationSyllable"]:
        raw = re.sub(r"[^a-z0-9]", "", (s or "").strip().lower())
        if not raw:
            return None
        m = _TONE_RE.match(raw)
        if not m:
            return None
        body, tone_s = m.group(1), m.group(2)
        initial = ""
        final = body
        for ini in _INITIALS:
            if body.startswith(ini) and len(body) > len(ini):
                initial = ini
                final = body[len(ini) :]
                break
            if body == ini:
                initial = ""
                final = body
                break
        tone = int(tone_s) if tone_s else 0
        return cls(initial=initial, final=final, tone=tone, lexical_status=lexical_status)


def parse_syllable_parts(s: str):
    """Backward-compatible alias returning PronunciationSyllable."""
    return PronunciationSyllable.from_compact(s)
