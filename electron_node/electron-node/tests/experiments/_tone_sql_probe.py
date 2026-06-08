import sqlite3
import re

DB = r"d:\Programs\github\lingua_1\node_runtime\lexicon\v3\lexicon.sqlite"
db = sqlite3.connect(DB)
for t in ["base_lexicon", "domain_lexicon", "idiom_lexicon"]:
    total = db.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    with_tone = db.execute(
        f"SELECT COUNT(*) FROM {t} WHERE tone_pinyin_key IS NOT NULL AND TRIM(tone_pinyin_key) != ''"
    ).fetchone()[0]
    with_digit = db.execute(
        "SELECT COUNT(*) FROM " + t + " WHERE tone_pinyin_key GLOB '*[0-9]*'"
    ).fetchone()[0]
    print(t, "total", total, "with_tone_col", with_tone, "with_digit_in_tone", with_digit)

print("restaurant rows", db.execute("SELECT COUNT(*) FROM domain_lexicon WHERE domain_id='restaurant'").fetchone()[0])
print("restaurant words", [r[0] for r in db.execute("SELECT word FROM domain_lexicon WHERE domain_id='restaurant'").fetchall()])
print("shao|bing domain", db.execute("SELECT word,domain_id,pinyin_key,tone_pinyin_key,prior_score FROM domain_lexicon WHERE pinyin_key='shao|bing'").fetchall())
print("少冰 base", db.execute("SELECT word,pinyin_key,tone_pinyin_key FROM base_lexicon WHERE word='少冰'").fetchall())
print("少冰 domain", db.execute("SELECT word,domain_id,pinyin_key,tone_pinyin_key FROM domain_lexicon WHERE word='少冰'").fetchall())
db.close()
