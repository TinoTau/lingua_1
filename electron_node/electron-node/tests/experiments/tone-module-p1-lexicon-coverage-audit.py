#!/usr/bin/env python3
"""Read-only tone_pinyin_key coverage audit."""
import json
import re
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[4] / "node_runtime/lexicon/v3/lexicon.sqlite"
OUT = Path(__file__).resolve().parent / "tone-module-p1-lexicon-coverage-audit.json"

DIGIT_RE = re.compile(r"[1-5]")


def classify_tone(val: str | None) -> str:
    if val is None or not str(val).strip():
        return "empty"
    if DIGIT_RE.search(str(val)):
        return "with_digit"
    return "no_digit"


def audit_table(conn, table: str) -> dict:
    total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    rows = conn.execute(
        f"SELECT tone_pinyin_key, pinyin_key, repair_target FROM {table}"
    ).fetchall()
    stats = {"empty": 0, "no_digit": 0, "with_digit": 0, "tone_eq_pinyin": 0, "repair_target": 0}
    for tk, pk, rt in rows:
        c = classify_tone(tk)
        stats[c] += 1
        if tk and pk and tk.strip() == pk.strip():
            stats["tone_eq_pinyin"] += 1
        if rt == 1:
            stats["repair_target"] += 1
    return {"table": table, "total": total, **stats}


def index_info(conn, table: str) -> list:
    return [
        {"name": r[1], "unique": r[2], "columns": [c[2] for c in conn.execute(f"PRAGMA index_info({r[1]})").fetchall()]}
        for r in conn.execute(f"PRAGMA index_list({table})").fetchall()
    ]


def main():
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    tables = ["base_lexicon", "domain_lexicon", "idiom_lexicon"]
    coverage = [audit_table(conn, t) for t in tables]
    indexes = {t: index_info(conn, t) for t in tables}
    conn.close()
    out = {"db": str(DB), "coverage": coverage, "indexes": indexes, "note": "target_lexicon table does not exist; repair_target is a column"}
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
