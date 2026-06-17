#!/usr/bin/env python3
import json
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[4] / "node_runtime/lexicon/v3/lexicon.sqlite"
OUT = Path(__file__).resolve().parent / "tone-first-recall-lexicon-samples.json"

conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
words = ["中杯", "少糖", "少冰", "烧饼", "哨兵", "蓝莓马芬", "拿铁", "热美式"]
out = {"db": str(DB), "samples": {}, "ngram": {}, "explain": {}, "indexes": {}}

for w in words:
    out["samples"][w] = {}
    for t in ["base_lexicon", "domain_lexicon", "idiom_lexicon"]:
        rows = conn.execute(
            f"SELECT word, pinyin_key, tone_pinyin_key, repair_target, source FROM {t} WHERE word = ?",
            (w,),
        ).fetchall()
        out["samples"][w][t] = [
            {
                "word": r[0],
                "pinyin_key": r[1],
                "tone_pinyin_key": r[2],
                "repair_target": r[3],
                "source": r[4],
            }
            for r in rows
        ]

out["ngram"]["shaobing"] = [
    dict(
        zip(
            ["fragment_text", "ngram_pinyin_key", "ngram_tone_pinyin_key", "prior", "tier", "domain_id"],
            r,
        )
    )
    for r in conn.execute(
        "SELECT fragment_text, ngram_pinyin_key, ngram_tone_pinyin_key, prior, tier, domain_id "
        "FROM term_pinyin_ngrams WHERE ngram_pinyin_key = 'shao|bing' LIMIT 10"
    ).fetchall()
]

for t in ["base_lexicon", "domain_lexicon", "term_pinyin_ngrams"]:
    out["indexes"][t] = [
        {"name": r[1], "unique": r[2]}
        for r in conn.execute(f"PRAGMA index_list({t})").fetchall()
    ]

out["explain"] = {
    "plain": conn.execute(
        "EXPLAIN QUERY PLAN SELECT id FROM base_lexicon "
        "WHERE pinyin_key = ? AND enabled = 1 AND length(word) = ? LIMIT 8",
        ("shao|bing", 2),
    ).fetchall(),
    "tone": conn.execute(
        "EXPLAIN QUERY PLAN SELECT id FROM base_lexicon "
        "WHERE tone_pinyin_key = ? AND enabled = 1 AND length(word) = ? LIMIT 8",
        ("shao3|bing1", 2),
    ).fetchall(),
}

conn.close()
OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(out, ensure_ascii=False, indent=2))
