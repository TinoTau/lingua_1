"""FineSpan contract for Model2 retrieval (production-equivalent windows).

Markers: PHASE7G / AUTHORITATIVE_PATH

Lattice FineSpan windows are 1..5 syllables
(`LATTICE_WINDOW_MIN_SYLLABLES` / `LATTICE_WINDOW_MAX_SYLLABLES` in
electron_node/.../window-construction-core.ts).

Model2 does NOT redesign FineSpan. This module materializes the minimal
fields required for profile-conditioned lexicon expansion from ASR text
when full Node PathFineSpan DTOs are unavailable offline.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from training.model2.phonetic.syllables import text_to_syllables
from training.model2.retrieval.normalize import normalize_syllable_sequence_for_lookup

LATTICE_WINDOW_MIN_SYLLABLES = 1
LATTICE_WINDOW_MAX_SYLLABLES = 5


@dataclass
class FineSpanView:
    """Minimal FineSpan view for Model2 retrieval (authoritative unit)."""

    span_id: str
    syllable_start: int
    syllable_end: int  # exclusive
    span_syllables: list[str]
    window_text: str
    window_pinyin_key: str
    raw_start: int = 0
    raw_end: int = 0
    source: str = "lattice_window_equivalent_v1"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _chars_for_alignment(text: str) -> list[str]:
    # Prefer CJK chars; keep others as single tokens when needed
    return [c for c in text if not c.isspace()]


def materialize_finespans_from_asr(
    asr_text: str,
    *,
    syllables: Optional[list[str]] = None,
    min_n: int = LATTICE_WINDOW_MIN_SYLLABLES,
    max_n: int = LATTICE_WINDOW_MAX_SYLLABLES,
) -> tuple[list[str], list[FineSpanView]]:
    """Build 1..5 syllable FineSpan windows from ASR (production-equivalent lengths)."""
    text = (asr_text or "").strip()
    syls_raw = syllables if syllables is not None else text_to_syllables(text)
    syls = normalize_syllable_sequence_for_lookup(syls_raw)
    chars = _chars_for_alignment(text)
    spans: list[FineSpanView] = []
    n = len(syls)
    if n == 0:
        return syls, spans
    align_ok = len(chars) == n
    for L in range(min_n, min(max_n, n) + 1):
        for i in range(0, n - L + 1):
            win = syls[i : i + L]
            if align_ok:
                wtext = "".join(chars[i : i + L])
                raw_s, raw_e = i, i + L
            else:
                # PARTIAL contract: syllables authoritative; text best-effort slice
                wtext = "".join(chars[i : i + L]) if i + L <= len(chars) else ""
                raw_s, raw_e = i, min(i + L, len(chars))
            spans.append(
                FineSpanView(
                    span_id=f"fs-{i}-{i+L}",
                    syllable_start=i,
                    syllable_end=i + L,
                    span_syllables=list(win),
                    window_text=wtext,
                    window_pinyin_key="|".join(win),
                    raw_start=raw_s,
                    raw_end=raw_e,
                )
            )
    return syls, spans


def finespan_contract_audit() -> dict[str, Any]:
    return {
        "markers": ["PHASE7G", "AUTHORITATIVE_PATH"],
        "production_entry": "runLatticeFineSpanGeneration / buildLexicalWindowQueries",
        "production_types": ["PathFineSpan", "GlobalWindowDescriptor"],
        "window_length": {
            "min": LATTICE_WINDOW_MIN_SYLLABLES,
            "max": LATTICE_WINDOW_MAX_SYLLABLES,
            "mismatch_with_report": False,
        },
        "fields_for_model2": {
            "span_syllables": "REQUIRED — from window / GlobalSyllables slice",
            "window_text": "USEFUL — alignment when char≈syl",
            "window_pinyin_key": "USEFUL — already toneless key form",
            "boundaries": "USEFUL — diagnostics / funnel",
        },
        "Can_existing_FineSpan_provide_everything": "PARTIAL",
        "note": (
            "Offline Phase7G uses lattice-equivalent 1..5 windows from ASR syllables. "
            "Full PathFineSpan candidate lists / coarse refs not required for profile expansion. "
            "No new span representation invented beyond missing offline materialization."
        ),
        "prohibited": "whole utterance as Model2 retrieval unit",
    }
