"""Chinese surface realizer — Backend A (KEEP Phase 5D SurfaceMap)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from training.model2.pronunciation.pronunciation_syllable import (
    LEXICAL_STATUS_LEXICAL,
    LEXICAL_STATUS_NON_LEXICAL,
    PronunciationSyllable,
)
from training.model2.pronunciation.tts_surface_resolver import (
    TtsPronunciationSurfaceMapV1,
    build_reverse_pinyin_index,
    candidates_for_syllable,
    pick_deterministic,
)

SURFACE_REALIZER_VERSION = "chinese-surface-realizer-v1"


@dataclass
class SurfaceRealization:
    ok: bool
    surface: str
    method: str
    frequency_class: str  # COMMON | RARE | UNKNOWN
    status: str  # SURFACE_VALIDATED | SURFACE_REJECTED | PHONEME_REQUIRED | UNREALIZABLE
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "surface": self.surface,
            "method": self.method,
            "frequency_class": self.frequency_class,
            "status": self.status,
            "notes": self.notes,
            "backend": "CHINESE_SURFACE",
            "version": SURFACE_REALIZER_VERSION,
        }


_COMMON_CHARS = set(
    "的一是不了人我在有他这为之大来以个中上们到说国和地也子时道出而要于就下得可你年生"
    "自会那后能对着事其里所去行过家十用发天如然作方成者多日都三小门见问力里南兰灵奶老李"
    "之资张中宗陈师司上分金京拼乒班帮根庚番憨宁"
)


class ChineseSurfaceRealizer:
    def __init__(self, surface_map: TtsPronunciationSurfaceMapV1 | None = None):
        self.surface_map = surface_map or TtsPronunciationSurfaceMapV1()
        self._rev: dict[str, list[str]] | None = None

    @property
    def rev(self) -> dict[str, list[str]]:
        if self._rev is None:
            self._rev = build_reverse_pinyin_index()
        return self._rev

    def realize(self, syl: PronunciationSyllable) -> SurfaceRealization:
        key = syl.compact
        entry = self.surface_map.get(key)
        if entry and entry.validation_status == "VALIDATED" and entry.surface_char:
            freq = "COMMON" if entry.surface_char in _COMMON_CHARS else "RARE"
            if freq == "RARE":
                return SurfaceRealization(
                    False,
                    entry.surface_char,
                    "validated_but_rare",
                    freq,
                    "PHONEME_REQUIRED",
                    "cold/rare surface — prefer phoneme",
                )
            return SurfaceRealization(True, entry.surface_char, "validated_map", freq, "SURFACE_VALIDATED")
        if entry and entry.validation_status == "REJECTED":
            return SurfaceRealization(
                False, entry.surface_char or "", "rejected_map", "UNKNOWN", "SURFACE_REJECTED", entry.notes
            )
        cands = candidates_for_syllable(key, self.rev)
        if not cands:
            return SurfaceRealization(
                False,
                "",
                "no_cjk_candidate",
                "UNKNOWN",
                "PHONEME_REQUIRED",
                "LEXICALLY_UNREALIZABLE — try phoneme backend",
            )
        ch = pick_deterministic(key, cands)
        freq = "COMMON" if ch in _COMMON_CHARS else "RARE"
        if freq == "RARE":
            return SurfaceRealization(
                False, ch or "", "rare_candidate", freq, "PHONEME_REQUIRED", "rare candidate"
            )
        # unvalidated common candidate — usable but mark
        return SurfaceRealization(
            True, ch or "", "candidate_unvalidated", freq, "SURFACE_VALIDATED", "unvalidated common"
        )


def build_surface_map_v2(
    v1_path: Path,
    out_path: Path,
) -> dict[str, Any]:
    """Reclassify Phase 5D map into SurfaceMap V2 statuses."""
    v1 = TtsPronunciationSurfaceMapV1.load(v1_path) if v1_path.exists() else TtsPronunciationSurfaceMapV1()
    realizer = ChineseSurfaceRealizer(v1)
    entries: dict[str, Any] = {}
    stats = {"SURFACE_VALIDATED": 0, "SURFACE_REJECTED": 0, "PHONEME_REQUIRED": 0, "UNREALIZABLE": 0}
    for syl, ent in v1.entries.items():
        ps = PronunciationSyllable.from_compact(syl) or PronunciationSyllable(
            initial="", final=syl, tone=0
        )
        # Force classification from stored status first
        if ent.validation_status == "VALIDATED":
            freq = "COMMON" if ent.surface_char in _COMMON_CHARS else "RARE"
            if freq == "RARE":
                status = "PHONEME_REQUIRED"
            else:
                status = "SURFACE_VALIDATED"
        elif ent.validation_status == "REJECTED":
            status = "SURFACE_REJECTED"
        elif ent.validation_status == "UNREALIZABLE":
            status = "PHONEME_REQUIRED"  # no char ≠ acoustic invalid
        else:
            rr = realizer.realize(ps)
            status = rr.status
        stats[status] = stats.get(status, 0) + 1
        entries[syl] = {
            **ent.to_dict(),
            "surface_map_v2_status": status,
            "surface_frequency_class": "COMMON" if ent.surface_char in _COMMON_CHARS else "RARE",
            "lexical_note": "LEXICALLY_UNREALIZABLE≠ACOUSTICALLY_INVALID",
        }
    doc = {
        "version": "surface-map-v2",
        "note": "ChineseSurface backend artifact; PHONEME_REQUIRED is not UNREALIZABLE.",
        "stats": stats,
        "entries": entries,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return doc
