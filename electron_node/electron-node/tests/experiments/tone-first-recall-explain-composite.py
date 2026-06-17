#!/usr/bin/env python3
import json
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[4] / "node_runtime/lexicon/v3/lexicon.sqlite"
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)

queries = {
    "base_tone_only": (
        "EXPLAIN QUERY PLAN SELECT id FROM base_lexicon "
        "WHERE tone_pinyin_key = ? AND enabled = 1 AND length(word) = ? LIMIT 8",
        ("shao3|bing1", 2),
    ),
    "base_composite": (
        "EXPLAIN QUERY PLAN SELECT id FROM base_lexicon "
        "WHERE pinyin_key = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ? LIMIT 8",
        ("shao|bing", "shao3|bing1", 2),
    ),
    "base_plain": (
        "EXPLAIN QUERY PLAN SELECT id FROM base_lexicon "
        "WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ? LIMIT 8",
        ("shao|bing", 2),
    ),
}

out = {k: conn.execute(sql, params).fetchall() for k, (sql, params) in queries.items()}
print(json.dumps(out, ensure_ascii=False, indent=2))
