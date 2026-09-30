import sqlite3
import json
from pathlib import Path

db = sqlite3.connect(str(Path("node_runtime/lexicon/v3/lexicon.sqlite")))
db.row_factory = sqlite3.Row
c = db.cursor()
print("tables", [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")])
print("term_cols", [r[1] for r in c.execute("PRAGMA table_info(term)")])
row = c.execute("SELECT * FROM term LIMIT 1").fetchone()
print("sample", dict(row) if row else None)
print("缓存", [dict(r) for r in c.execute("SELECT * FROM term WHERE word=? LIMIT 3", ("缓存",))])
try:
    print("tag_cols", [r[1] for r in c.execute("PRAGMA table_info(term_domain_tags)")])
except Exception as e:
    print("no tags", e)
