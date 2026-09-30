#!/usr/bin/env python3
"""Preload lexicon pinyin keys for a list of surfaces (UTF-8 JSON file in/out)."""
import json
import re
import sqlite3
import sys

db_path = sys.argv[1]
in_path = sys.argv[2]
out_path = sys.argv[3]


def strip_tone(p: str) -> str:
    return re.sub(r"[0-5]", "", (p or "").lower()).replace(" ", "")


with open(in_path, "r", encoding="utf-8") as f:
    surfaces = json.load(f)

conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
out = {}
for surface in surfaces:
    rows = conn.execute(
        "SELECT pinyin_key, tone_pinyin_key FROM term WHERE word=?",
        (surface,),
    ).fetchall()
    keys = []
    for pk, tpk in rows:
        if pk:
            keys.append(strip_tone(pk))
        if tpk:
            keys.append(strip_tone(tpk))
    out[surface] = sorted(set(keys))

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

print(json.dumps({"ok": True, "n": len(out)}, ensure_ascii=False))
