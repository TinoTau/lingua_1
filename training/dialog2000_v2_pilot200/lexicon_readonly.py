# -*- coding: utf-8 -*-
"""Readonly lexicon surface → term id lookup (no writes)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional


class ReadonlyLexicon:
    def __init__(self, sqlite_path: Path):
        if not sqlite_path.is_file():
            raise FileNotFoundError(sqlite_path)
        self.path = sqlite_path
        self._con = sqlite3.connect(f"file:{sqlite_path.as_posix()}?mode=ro", uri=True)
        # Guard: refuse write API accidentally
        self._con.execute("PRAGMA query_only=ON")

    def close(self) -> None:
        self._con.close()

    def resolve_surface(self, surface: str) -> Optional[tuple[str, str]]:
        """Return (term_id, surface) if found in base_lexicon; else None."""
        row = self._con.execute(
            "SELECT id, word FROM base_lexicon WHERE enabled=1 AND word=? "
            "ORDER BY prior_score DESC LIMIT 1",
            (surface,),
        ).fetchone()
        if not row:
            return None
        return str(row[0]), str(row[1])

    def mutation_attempt_blocked(self) -> bool:
        """Used by tests — any write should fail under query_only."""
        try:
            self._con.execute(
                "INSERT INTO base_lexicon(id,pinyin_key,word,normalized,prior_score,repair_target,enabled,is_alias) "
                "VALUES('__pilot_should_fail__','x','测','测',0,0,1,0)"
            )
            return False
        except sqlite3.Error:
            return True
