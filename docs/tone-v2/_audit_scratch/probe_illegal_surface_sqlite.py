#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import json
import sqlite3
from pathlib import Path

DBS = [
    Path("/mnt/d/Programs/github/lingua_1/node_runtime/lexicon/v3/lexicon.sqlite"),
    Path("/mnt/d/Programs/github/lingua_1/node_runtime/lexicon/v2_shadow/lexicon_v2.sqlite"),
]
SURFACES = ["生城", "声城", "生成", "候选", "后选", "生", "城"]
OUT = Path(
    "/mnt/d/Programs/github/lingua_1/docs/acceptance/Audit/"
    "2026-08-05_Illegal_Surface_and_SameDomain_Bucket_Audit"
)
OUT.mkdir(parents=True, exist_ok=True)

result = []
for db in DBS:
    entry = {"path": str(db), "exists": db.exists(), "surfaces": {}}
    if not db.exists():
        result.append(entry)
        continue
    con = sqlite3.connect(str(db))
    con.row_factory = sqlite3.Row
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    entry["tables"] = tables
    for s in SURFACES:
        rows = []
        if "term" in tables:
            for r in con.execute(
                "SELECT id,word,pinyin_key,tone_pinyin_key,enabled,source,tier FROM term WHERE word=?",
                (s,),
            ):
                rows.append({"table": "term", **dict(r)})
        if "base_lexicon" in tables:
            for r in con.execute(
                "SELECT id,word,normalized,pinyin_key,tone_pinyin_key,enabled,source FROM base_lexicon WHERE word=? OR normalized=?",
                (s, s),
            ):
                rows.append({"table": "base_lexicon", **dict(r)})
        if "domain_lexicon" in tables:
            for r in con.execute(
                "SELECT id,word,domain_id,normalized,pinyin_key,tone_pinyin_key,enabled,source FROM domain_lexicon WHERE word=? OR normalized=?",
                (s, s),
            ):
                rows.append({"table": "domain_lexicon", **dict(r)})
        tags = []
        if "term_domain_tags" in tables and "term" in tables:
            for r in con.execute(
                "SELECT tdt.term_id, tdt.domain_id, tdt.weight FROM term_domain_tags tdt "
                "JOIN term t ON t.id=tdt.term_id WHERE t.word=?",
                (s,),
            ):
                tags.append(dict(r))
        entry["surfaces"][s] = {"rows": rows, "domain_tags": tags}
    con.close()
    result.append(entry)

(OUT / "_sqlite_surface_probe.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print("wrote", OUT / "_sqlite_surface_probe.json")
for e in result:
    print("DB", e["path"], "exists", e["exists"])
    for s, v in e.get("surfaces", {}).items():
        print(" ", s, "rows", len(v["rows"]), "tags", v["domain_tags"])
