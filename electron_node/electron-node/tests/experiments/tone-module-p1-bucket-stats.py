import json, sqlite3
from collections import defaultdict
from pathlib import Path
p = Path(r"D:/Programs/github/lingua_1/node_runtime/lexicon/v3/lexicon.sqlite")
conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
rows = []
for t in ("base_lexicon", "domain_lexicon"):
    rows += conn.execute(f"SELECT word,pinyin_key,tone_pinyin_key,prior_score,repair_target FROM {t} WHERE enabled=1").fetchall()
by = defaultdict(list)
for w, pk, tk, pr, rt in rows:
    by[(pk, len(w))].append((w, tk, pr, rt))
multi = sum(1 for g in by.values() if len({x[0] for x in g}) >= 2)
dist = sum(1 for g in by.values() if len({x[1] for x in g if x[1]}) >= 2)
repair_buckets = sum(1 for g in by.values() if len({x[0] for x in g if x[3] == 1}) >= 2)
print(json.dumps({"totalWords": len(rows), "homophoneBuckets": multi, "toneDistinctBuckets": dist, "repairHomophoneBuckets": repair_buckets}))
