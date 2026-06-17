#!/usr/bin/env python3
import json
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[4] / "node_runtime/lexicon/v3/lexicon.sqlite"
conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)

def stats(table):
    total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    with_digit = conn.execute(
        f"SELECT COUNT(*) FROM {table} WHERE tone_pinyin_key GLOB '*[1-5]*'"
    ).fetchone()[0]
    eq = conn.execute(
        f"SELECT COUNT(*) FROM {table} WHERE tone_pinyin_key = pinyin_key"
    ).fetchone()[0]
    return {"total": total, "with_digit": with_digit, "tone_eq_pinyin": eq}

out = {
    "coverage": {t: stats(t) for t in ["base_lexicon", "domain_lexicon", "idiom_lexicon"]},
    "tone_key_hits": {},
    "explain": {},
}

for key in ["shao3|bing1", "shao1|bing3", "shao|bing"]:
    out["tone_key_hits"][key] = {
        "base_tone": conn.execute(
            "SELECT COUNT(*) FROM base_lexicon WHERE tone_pinyin_key = ?", (key,)
        ).fetchone()[0],
        "base_plain": conn.execute(
            "SELECT COUNT(*) FROM base_lexicon WHERE pinyin_key = ?", (key,)
        ).fetchone()[0],
    }

out["explain"]["domain_tone"] = conn.execute(
    "EXPLAIN QUERY PLAN SELECT id FROM domain_lexicon "
    "WHERE domain_id = ? AND tone_pinyin_key = ? AND enabled = 1 AND length(word) = ? LIMIT 8",
    ("cafe", "zhong1|bei1", 2),
).fetchall()

out["explain"]["domain_plain"] = conn.execute(
    "EXPLAIN QUERY PLAN SELECT id FROM domain_lexicon "
    "WHERE domain_id = ? AND pinyin_key = ? AND enabled = 1 AND length(word) = ? LIMIT 8",
    ("cafe", "zhong|bei", 2),
).fetchall()

out["explain"]["ngram_tone"] = conn.execute(
    "EXPLAIN QUERY PLAN SELECT id FROM term_pinyin_ngrams WHERE ngram_tone_pinyin_key = ? LIMIT 8",
    ("shao3|bing1",),
).fetchall()

out["explain"]["ngram_plain"] = conn.execute(
    "EXPLAIN QUERY PLAN SELECT id FROM term_pinyin_ngrams WHERE ngram_pinyin_key = ? LIMIT 8",
    ("shao|bing",),
).fetchall()

ngram_tone_idx = [
    r[1]
    for r in conn.execute("PRAGMA index_list(term_pinyin_ngrams)").fetchall()
    if "tone" in r[1].lower()
]
out["ngram_has_tone_index"] = ngram_tone_idx

print(json.dumps(out, ensure_ascii=False, indent=2))
