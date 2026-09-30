#!/usr/bin/env python3
"""READ_ONLY batch lexicon lookup for recall/model2 decomposition audit."""
import json
import sqlite3
import sys
from pathlib import Path

db_path = Path(sys.argv[1])
words_path = Path(sys.argv[2])
out_path = Path(sys.argv[3])
words = json.loads(words_path.read_text(encoding="utf-8"))

db = sqlite3.connect(str(db_path))
db.row_factory = sqlite3.Row
out = {}
for w in words:
    rows = db.execute(
        """
        SELECT t.id, t.word, t.pinyin_key, t.tone_pinyin_key, t.enabled, t.source, t.tier,
               group_concat(d.domain_id) AS domains
        FROM term t
        LEFT JOIN term_domain_tags d ON d.term_id = t.id
        WHERE t.word = ?
        GROUP BY t.id
        """,
        (w,),
    ).fetchall()
    mapped = []
    for r in rows:
        mapped.append(
            {
                "termId": r["id"],
                "surface": r["word"],
                "pinyin": r["pinyin_key"],
                "tone_pinyin": r["tone_pinyin_key"],
                "enabled": r["enabled"],
                "source": r["source"],
                "tier": r["tier"],
                "domains": (r["domains"] or "").split(",") if r["domains"] else [],
            }
        )
    enabled = [m for m in mapped if m["enabled"] == 1]
    out[w] = {
        "present": len(mapped) > 0,
        "enabled_present": len(enabled) > 0,
        "rows": (enabled or mapped)[:5],
    }

out_path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print(f"OK words={len(words)} hits={sum(1 for v in out.values() if v['enabled_present'])}")
