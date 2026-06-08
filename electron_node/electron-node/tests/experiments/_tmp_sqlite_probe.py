import sqlite3
import json

DB = r"d:\Programs\github\lingua_1\node_runtime\lexicon\v3\lexicon.sqlite"
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

CASES = [
    ("钟贝", "中杯", "zhong|bei"),
    ("大悲", "大杯", "da|bei"),
    ("小背", "小杯", "xiao|bei"),
    ("美食", "美式", "mei|shi"),
    ("少病", "少冰", "shao|bing"),
    ("蓝美马分", "蓝莓马芬", "lan|mei|ma|fen"),
    ("深便", "顺便", "shen|bian"),
]

out = []
for span, target, key in CASES:
    domain = db.execute(
        "SELECT word, domain_id, prior_score, repair_target FROM domain_lexicon "
        "WHERE pinyin_key=? AND length(word)=? AND enabled=1 ORDER BY prior_score DESC LIMIT 12",
        (key, len(span)),
    ).fetchall()
    base = db.execute(
        "SELECT word, prior_score, repair_target FROM base_lexicon "
        "WHERE pinyin_key=? AND length(word)=? AND enabled=1 ORDER BY prior_score DESC LIMIT 12",
        (key, len(span)),
    ).fetchall()
    out.append(
        {
            "span": span,
            "target": target,
            "key": key,
            "domainTop": [dict(r) for r in domain],
            "baseTop": [dict(r) for r in base],
            "targetInDomain": any(r["word"] == target for r in domain),
            "targetInBase": any(r["word"] == target for r in base),
        }
    )

OUT = r"d:\Programs\github\lingua_1\electron_node\electron-node\tests\experiments\_cafe_sqlite_probe.json"
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
print(OUT)
