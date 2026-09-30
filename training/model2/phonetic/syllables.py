"""Phonetic utilities aligned to Node lexicon/phonetic (pinyin-pro) semantics.

Prefer:
1) lexicon raw pinyin_key when provided
2) Node pinyin-pro CLI bridge (SSOT)
3) pypinyin fallback (NOT claimed as SSOT — agreement tests may flag gaps)
"""

from __future__ import annotations

import json
import re
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Optional

try:
    from pypinyin import Style, lazy_pinyin
except ImportError:  # pragma: no cover
    Style = None  # type: ignore
    lazy_pinyin = None  # type: ignore

RAW_PINYIN_SPLIT = re.compile(r"[\s,/|]+")
CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")
LATIN_RE = re.compile(r"[A-Za-z]")

PHONETIC_IMPL_NODE = "node-pinyin-pro-bridge-v1"
PHONETIC_IMPL_FALLBACK = "pypinyin-fallback-v1"
PHONETIC_SCHEMA_VERSION = "phonetic-node-align-v1"

_CLI = Path(__file__).resolve().parent / "node_syllables_cli.mjs"


def normalize_syllable(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.strip().lower())


def parse_raw_pinyin(raw_pinyin) -> Optional[list[str]]:
    if isinstance(raw_pinyin, list):
        out = [normalize_syllable(x) for x in raw_pinyin if isinstance(x, str)]
        out = [x for x in out if x]
        return out or None
    if isinstance(raw_pinyin, str) and raw_pinyin.strip():
        out = [normalize_syllable(x) for x in RAW_PINYIN_SPLIT.split(raw_pinyin)]
        out = [x for x in out if x]
        return out or None
    return None


def has_cjk(text: str) -> bool:
    return bool(CJK_RE.search(text))


@lru_cache(maxsize=4096)
def _node_syllables(text: str, tone_type: str = "none") -> Optional[tuple[str, ...]]:
    if not _CLI.is_file():
        return None
    try:
        proc = subprocess.run(
            ["node", str(_CLI), text, tone_type],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )
        if proc.returncode != 0:
            return None
        arr = json.loads(proc.stdout.strip() or "[]")
        if not isinstance(arr, list):
            return None
        return tuple(str(x) for x in arr)
    except Exception:
        return None


def syllables_from_text_fallback(text: str) -> list[str]:
    """Approximate Node behavior: Latin letters become single-char syllables."""
    trimmed = text.strip()
    if not trimmed:
        return []
    if lazy_pinyin is None or Style is None:
        raise RuntimeError("pypinyin is required for Dataset phonetic fallback")
    out: list[str] = []
    buf_cjk: list[str] = []
    def flush_cjk():
        nonlocal buf_cjk
        if not buf_cjk:
            return
        chunk = "".join(buf_cjk)
        arr = lazy_pinyin(chunk, style=Style.NORMAL, errors=lambda x: [])
        out.extend(normalize_syllable(str(x)) for x in arr if normalize_syllable(str(x)))
        buf_cjk = []

    for ch in trimmed:
        if CJK_RE.match(ch):
            buf_cjk.append(ch)
        elif LATIN_RE.match(ch):
            flush_cjk()
            out.append(ch.lower())
        else:
            flush_cjk()
    flush_cjk()
    return out


def syllables_from_text(text: str) -> list[str]:
    trimmed = text.strip()
    if not trimmed:
        return []
    if not has_cjk(trimmed) and not LATIN_RE.search(trimmed):
        return []
    node = _node_syllables(trimmed, "none")
    if node is not None:
        return list(node)
    return syllables_from_text_fallback(trimmed)


def syllables_from_text_tone_num(text: str) -> list[str]:
    trimmed = text.strip()
    if not trimmed or not has_cjk(trimmed):
        return []
    node = _node_syllables(trimmed, "num")
    if node is not None:
        return list(node)
    if lazy_pinyin is None or Style is None:
        raise RuntimeError("pypinyin is required")
    arr = lazy_pinyin(trimmed, style=Style.TONE3, errors=lambda x: [])
    return [normalize_syllable(x) for x in arr if normalize_syllable(str(x))]


def text_to_syllables(text: str, raw_pinyin=None) -> list[str]:
    from_raw = parse_raw_pinyin(raw_pinyin)
    if from_raw:
        return from_raw
    return syllables_from_text(text)


def active_phonetic_impl() -> str:
    probe = _node_syllables("南宁", "none")
    return PHONETIC_IMPL_NODE if probe is not None else PHONETIC_IMPL_FALLBACK


def syllables_key(syllables: list[str]) -> str:
    return "|".join(syllables)


def levenshtein_syllables(a: list[str], b: list[str]) -> int:
    if not a:
        return len(b)
    if not b:
        return len(a)
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev = row[0]
        row[0] = i
        for j, cb in enumerate(b, 1):
            temp = row[j]
            cost = 0 if ca == cb else 1
            row[j] = min(row[j] + 1, row[j - 1] + 1, prev + cost)
            prev = temp
    return row[len(b)]
