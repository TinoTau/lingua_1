import sqlite3, json
db = sqlite3.connect(
    r"file:d:/Programs/github/lingua_1/node_runtime/lexicon/v3/lexicon.sqlite?mode=ro",
    uri=True,
)
c = db.cursor()
cols = [r[1] for r in c.execute("PRAGMA table_info(base_lexicon)")]
print("COLS", cols)
row = c.execute("SELECT * FROM base_lexicon LIMIT 1").fetchone()
print("ROW0", row)
tables = [x[0] for x in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("TABLES", tables[:40])
db.close()
