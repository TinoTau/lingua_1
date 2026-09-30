#!/usr/bin/env python3
"""Diagnostic-only lexicon counterfactual helper for exact query attribution."""
import json
import re
import sqlite3
import sys

DB = sys.argv[1]
req = json.loads(sys.stdin.read() or "{}")


def strip_tone(p: str) -> str:
    return re.sub(r"[0-5]", "", (p or "").lower()).replace(" ", "")


def has_surface_pinyin(conn, surface: str, pinyin_key: str) -> bool:
    if not surface or not pinyin_key:
        return False
    key = strip_tone(pinyin_key)
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    # Lingua v3 lexicon: term(word, pinyin_key, tone_pinyin_key)
    if "term" in tables:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(term)")}
        word_col = "word" if "word" in cols else ("surface" if "surface" in cols else None)
        if word_col:
            select_cols = [c for c in ("pinyin_key", "tone_pinyin_key", "pinyin") if c in cols]
            if select_cols:
                sql = f"SELECT {', '.join(select_cols)} FROM term WHERE {word_col}=?"
                rows = conn.execute(sql, (surface,)).fetchall()
                for row in rows:
                    if any(strip_tone(str(v or "")) == key for v in row):
                        return True
    return False


conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
out = {
    "ok": True,
    "tables": [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()],
}
if "surface" in req and "pinyinKey" in req:
    out["has"] = has_surface_pinyin(conn, req["surface"], req["pinyinKey"])
print(json.dumps(out, ensure_ascii=False))
