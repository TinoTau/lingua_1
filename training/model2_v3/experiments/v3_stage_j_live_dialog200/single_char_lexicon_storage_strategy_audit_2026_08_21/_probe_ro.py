"""Read-only probe for storage strategy audit. Do not write sqlite."""
import sqlite3
from pathlib import Path

db = Path(r"d:\Programs\github\lingua_1\node_runtime\lexicon\v3\lexicon.sqlite")
con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
poly = con.execute(
    "SELECT word, COUNT(DISTINCT pinyin_key) c FROM base_lexicon "
    "WHERE length(word)=1 GROUP BY word HAVING c>1"
).fetchall()
dup = con.execute(
    "SELECT pinyin_key, word, COUNT(*) c FROM base_lexicon "
    "WHERE length(word)=1 GROUP BY 1,2 HAVING c>1"
).fetchall()
print("len1_poly_surfaces", len(poly))
print("len1_pk_dup", len(dup))
print("sample_poly", poly[:8])
print("domain_l1", con.execute("SELECT COUNT(*) FROM domain_lexicon WHERE length(word)=1").fetchone()[0])
print("idiom_l1", con.execute("SELECT COUNT(*) FROM idiom_lexicon WHERE length(word)=1").fetchone()[0])
print(
    "term_l1",
    con.execute("SELECT COUNT(*) FROM term WHERE length(word)=1 AND enabled=1").fetchone()[0],
)
print("cols", [r[1] for r in con.execute("PRAGMA table_info(base_lexicon)")])
# same surface different tone under same pinyin_key impossible by PK; check tone diversity across poly
print(
    "pk",
    con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='base_lexicon'"
    ).fetchone()[0],
)
con.close()
