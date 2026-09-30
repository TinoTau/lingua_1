# -*- coding: utf-8 -*-
"""Readonly lexicon surface resolve via existing sqlite (no Model3 lexicon)."""

from __future__ import annotations

import re
import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Optional

_CJK = re.compile(r"^[\u4e00-\u9fff\u3400-\u4dbf]$")


def default_sqlite_path(repo: Path) -> Path:
    return repo / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite"


class LexiconSurfaceResolver:
    """Thin readonly adapter over base_lexicon Mode-C keys."""

    def __init__(self, sqlite_path: Path):
        if not sqlite_path.is_file():
            raise FileNotFoundError(sqlite_path)
        self.path = sqlite_path
        self._con = sqlite3.connect(f"file:{sqlite_path.as_posix()}?mode=ro", uri=True)

    def close(self) -> None:
        self._con.close()

    @staticmethod
    def strip_tone(toned: str) -> str:
        return re.sub(r"[^a-z]", "", (toned or "").lower())

    def lookup_len1_by_tone_key(self, tone_pinyin_key: str, limit: int = 16) -> list[tuple[str, float, str]]:
        pk = self.strip_tone(tone_pinyin_key)
        tk = re.sub(r"[^a-z0-9]", "", (tone_pinyin_key or "").lower())
        if not pk or not tk:
            return []
        rows = self._con.execute(
            "SELECT word, prior_score, source FROM base_lexicon "
            "WHERE enabled=1 AND length(word)=1 AND pinyin_key=? AND tone_pinyin_key=? "
            "ORDER BY prior_score DESC, word ASC LIMIT ?",
            (pk, tk, limit),
        ).fetchall()
        return [(str(w), float(p or 0), str(s or "")) for w, p, s in rows]

    def lookup_len1_by_plain(self, pinyin_key: str, limit: int = 16) -> list[tuple[str, float, str]]:
        pk = self.strip_tone(pinyin_key)
        if not pk:
            return []
        rows = self._con.execute(
            "SELECT word, prior_score, source FROM base_lexicon "
            "WHERE enabled=1 AND length(word)=1 AND pinyin_key=? "
            "ORDER BY prior_score DESC, word ASC LIMIT ?",
            (pk, limit),
        ).fetchall()
        return [(str(w), float(p or 0), str(s or "")) for w, p, s in rows]

    def has_surface_len1(self, surface: str, tone_pinyin_key: str) -> bool:
        if not _CJK.match(surface):
            return False
        pk = self.strip_tone(tone_pinyin_key)
        tk = re.sub(r"[^a-z0-9]", "", (tone_pinyin_key or "").lower())
        row = self._con.execute(
            "SELECT 1 FROM base_lexicon WHERE enabled=1 AND length(word)=1 "
            "AND word=? AND pinyin_key=? AND tone_pinyin_key=? LIMIT 1",
            (surface, pk, tk),
        ).fetchone()
        return row is not None

    def pick_replacement(
        self,
        tone_pinyin_key: str,
        *,
        exclude: set[str],
    ) -> Optional[dict]:
        cands = self.lookup_len1_by_tone_key(tone_pinyin_key)
        filtered = [c for c in cands if c[0] not in exclude and _CJK.match(c[0])]
        if not filtered:
            return None
        # Deterministic: existing ORDER BY prior_score DESC, word ASC — take first
        word, prior, source = filtered[0]
        return {
            "surface": word,
            "prior_score": prior,
            "source": source,
            "candidate_count": len(filtered),
            "selection_provenance": "base_lexicon_order_prior_desc_word_asc",
            "replacementSource": "BASE_LEXICON",
        }
