# READ-ONLY lexicon lookups for P empty-hit contrast audit
import sqlite3, json, sys

db = sqlite3.connect(
    "file:d:/Programs/github/lingua_1/node_runtime/lexicon/v3/lexicon.sqlite?mode=ro",
    uri=True,
)
cur = db.cursor()

targets = [
    ("p2_u001_016", "礼宾部"),
    ("p2_u001_002", "奶精"),
    ("p2_u002_016", "咖啡师"),
    ("p2_u003_001", "营运证"),
    ("p2_u004_001", "生成"),
    ("p2_u003_016", "换乘"),
    ("p2_u001_004", "内处理"),
]
variants = {
    "p2_u001_016": ["李守步", "礼宾部", "礼鋲部"],
    "p2_u001_002": ["来精", "奶精"],
    "p2_u002_016": ["咖啡丝", "咖啡师"],
    "p2_u003_001": ["营运真", "营运证"],
    "p2_u004_001": ["升层", "生成"],
    "p2_u003_016": ["翻成", "换乘"],
    "p2_u001_004": ["类处理", "内处理"],
}

out = []
for cid, term in targets:
    rows = cur.execute(
        "SELECT id, word, pinyin_key, tone_pinyin_key, enabled, prior_score "
        "FROM base_lexicon WHERE word=? LIMIT 10",
        (term,),
    ).fetchall()
    item = {"caseId": cid, "term": term, "termRows": rows, "variants": {}}
    for w in variants[cid]:
        rows2 = cur.execute(
            "SELECT word, pinyin_key, tone_pinyin_key, enabled FROM base_lexicon WHERE word=? LIMIT 5",
            (w,),
        ).fetchall()
        item["variants"][w] = rows2
    out.append(item)

# Also probe hypothesized keys we may reconstruct later
probe_keys = [
    ("nai|jing", "nai3|jing1", 2),
    ("lai|jing", "lai2|jing1", 2),
    ("ka|fei|shi", "ka1|fei1|shi1", 3),
    ("ka|fei|si", "ka1|fei1|si1", 3),
    ("ying|yun|zheng", None, 3),
    ("sheng|cheng", None, 2),
    ("sheng|ceng", None, 2),
    ("huan|cheng", None, 2),
    ("fan|cheng", None, 2),
    ("nei|chu|li", None, 3),
    ("lei|chu|li", None, 3),
    ("li|bin|bu", None, 3),
    ("li|shou|bu", None, 3),
    ("ni|shou|bu", None, 3),
]

probes = []
for pk, tk, n in probe_keys:
    if tk:
        rows = cur.execute(
            "SELECT word, pinyin_key, tone_pinyin_key FROM base_lexicon "
            "WHERE pinyin_key=? AND tone_pinyin_key=? AND enabled=1 AND length(word)=? "
            "ORDER BY prior_score DESC LIMIT 10",
            (pk, tk, n),
        ).fetchall()
    else:
        rows = cur.execute(
            "SELECT word, pinyin_key, tone_pinyin_key FROM base_lexicon "
            "WHERE pinyin_key=? AND enabled=1 AND length(word)=? "
            "ORDER BY prior_score DESC LIMIT 10",
            (pk, n),
        ).fetchall()
    probes.append({"pinyin_key": pk, "tone_pinyin_key": tk, "len": n, "rows": rows})

print(json.dumps({"targets": out, "probes": probes}, ensure_ascii=False, indent=2))
db.close()
