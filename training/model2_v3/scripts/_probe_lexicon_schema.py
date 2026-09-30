import sqlite3
from pathlib import Path

db = sqlite3.connect("node_runtime/lexicon/v3/lexicon.sqlite")
cur = db.cursor()
for t in ["term", "base_lexicon", "domain_lexicon", "term_domain_tags", "domain_hierarchy"]:
    print("===", t)
    row = cur.execute("SELECT sql FROM sqlite_master WHERE name=?", (t,)).fetchone()
    print((row[0] or "")[:700])

print("--- samples ---")
print(
    cur.execute(
        "SELECT id,word,pinyin_key FROM base_lexicon WHERE pinyin_key=? LIMIT 5",
        ("nai|zi",),
    ).fetchall()
)
print(
    cur.execute(
        "SELECT id,word,pinyin_key FROM base_lexicon WHERE pinyin_key=? LIMIT 5",
        ("lai|zi",),
    ).fetchall()
)
print(cur.execute("SELECT domain_id FROM domain_hierarchy").fetchall())
print(
    cur.execute(
        "SELECT term_id, domain_id, weight FROM term_domain_tags LIMIT 5"
    ).fetchall()
)
