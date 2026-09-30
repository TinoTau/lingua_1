"""Deterministic TTS surface resolver: syllable+tone → Chinese char (validated offline)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from pypinyin import Style, lazy_pinyin

RESOLVER_VERSION = "tts-surface-resolver-v1"


@dataclass
class SurfaceMapEntry:
    syllable: str
    tone: str
    surface_char: str
    piper_voice: str
    validation_status: str  # VALIDATED | CANDIDATE | REJECTED | UNREALIZABLE
    validation_method: str
    resolver_version: str = RESOLVER_VERSION
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def build_reverse_pinyin_index() -> dict[str, list[str]]:
    """CJK → primary TONE3 reading reverse map (derived, not language SSOT)."""
    rev: dict[str, list[str]] = {}
    for code in range(0x4E00, 0x9FA6):
        ch = chr(code)
        pys = lazy_pinyin(ch, style=Style.TONE3, neutral_tone_with_five=True)
        if not pys:
            continue
        key = pys[0].lower()
        rev.setdefault(key, []).append(ch)
    return rev


# Preference: common/simple characters first when present
_PREFERRED = {
    "nan2": "南",
    "lan2": "兰",
    "ning2": "宁",
    "ling2": "灵",
    "nai3": "奶",
    "zhi1": "之",
    "zi1": "资",
    "zhang1": "张",
    "zang1": "赃",
    "chen2": "陈",
    "cen2": "岑",
    "shi1": "师",
    "si1": "司",
    "fan1": "番",
    "han1": "憨",
    "jin1": "金",
    "jing1": "京",
    "pin1": "拼",
    "ping1": "乒",
    "ban1": "班",
    "bang1": "帮",
    "gen1": "根",
    "geng1": "庚",
    "lao3": "老",
    "li3": "李",
    "ni3": "你",
    "zhong1": "中",
    "zong1": "宗",
    "chang2": "长",
    "cang2": "藏",
    "shang4": "上",
    "sang4": "丧",
    "fen1": "分",
    "hen2": "痕",  # hen1 rare
}


def candidates_for_syllable(syllable: str, rev: dict[str, list[str]]) -> list[str]:
    syl = syllable.lower()
    out: list[str] = []
    pref = _PREFERRED.get(syl)
    if pref:
        out.append(pref)
    for ch in rev.get(syl, []):
        if ch not in out:
            out.append(ch)
    return out


def pick_deterministic(syllable: str, candidates: list[str], *, seed: int = 0) -> Optional[str]:
    if not candidates:
        return None
    if candidates[0] in _PREFERRED.values() or syllable in _PREFERRED:
        # prefer curated head
        pref = _PREFERRED.get(syllable)
        if pref and pref in candidates:
            return pref
    # stable hash pick among top-N frequent-ish (first 8 from reverse index order)
    pool = candidates[:8]
    h = int(hashlib.sha256(f"{seed}|{RESOLVER_VERSION}|{syllable}".encode()).hexdigest()[:8], 16)
    return pool[h % len(pool)]


def resolve_sequence(
    syllables: list[str],
    rev: dict[str, list[str]],
    surface_map: dict[str, SurfaceMapEntry],
) -> tuple[Optional[str], str, list[str]]:
    """Return (surface, method, missing_syllables)."""
    chars: list[str] = []
    missing: list[str] = []
    methods: list[str] = []
    for syl in syllables:
        # light tone 0/5: try citation without remapping if mapped; else try as-is key
        entry = surface_map.get(syl)
        if entry and entry.validation_status == "VALIDATED":
            chars.append(entry.surface_char)
            methods.append("validated_map")
            continue
        cands = candidates_for_syllable(syl, rev)
        if not cands:
            # try dropping light tone → tone 3/1 fallback? No — mark missing
            missing.append(syl)
            continue
        ch = pick_deterministic(syl, cands)
        if not ch:
            missing.append(syl)
            continue
        chars.append(ch)
        methods.append("candidate_unvalidated" if not entry else entry.validation_status.lower())
    if missing:
        return None, "UNREALIZABLE", missing
    method = "exact_char" if all(m in ("validated_map", "candidate_unvalidated", "validated") for m in methods) else "mixed"
    if all(m == "validated_map" for m in methods):
        method = "validated_map"
    return "".join(chars), method, []


class TtsPronunciationSurfaceMapV1:
    def __init__(self, entries: dict[str, SurfaceMapEntry] | None = None):
        self.entries = entries or {}
        self.version = RESOLVER_VERSION

    def get(self, syllable: str) -> Optional[SurfaceMapEntry]:
        return self.entries.get(syllable.lower())

    def upsert(self, entry: SurfaceMapEntry) -> None:
        self.entries[entry.syllable.lower()] = entry

    def to_dict(self) -> dict[str, Any]:
        return {
            "resolver_version": self.version,
            "note": "Derived TTS realization artifact — NOT language SSOT.",
            "entries": {k: v.to_dict() for k, v in sorted(self.entries.items())},
        }

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "TtsPronunciationSurfaceMapV1":
        data = json.loads(path.read_text(encoding="utf-8"))
        entries = {
            k: SurfaceMapEntry(**v) for k, v in (data.get("entries") or {}).items()
        }
        return cls(entries)
