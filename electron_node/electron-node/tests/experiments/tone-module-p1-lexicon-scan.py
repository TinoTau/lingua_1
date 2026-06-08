#!/usr/bin/env python3
"""Read-only lexicon homophone scan for ToneModule P1 benefit audit."""
from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[4]
SQLITE = PROJECT_ROOT / "node_runtime" / "lexicon" / "v3" / "lexicon.sqlite"
OUT = Path(__file__).resolve().parent / "tone-module-p1-lexicon-scan.json"


def main() -> None:
    conn = sqlite3.connect(f"file:{SQLITE}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows = []
    for table in ("base_lexicon", "domain_lexicon"):
        q = (
            f"SELECT word, pinyin_key, tone_pinyin_key, prior_score, repair_target "
            f"FROM {table} WHERE enabled=1 AND tone_pinyin_key IS NOT NULL AND tone_pinyin_key != ''"
        )
        for r in conn.execute(q):
            rows.append(dict(r))

    by: dict[str, list] = defaultdict(list)
    for r in rows:
        k = f"{r['pinyin_key']}::{len(r['word'])}"
        by[k].append(r)

    distinguishable = []
    indistinguishable = []
    for key, group in by.items():
        if len(group) < 2:
            continue
        pinyin_key = key.split("::")[0]
        freq = sum(float(g.get("prior_score") or 0) for g in group)
        tone_map: dict[str, list] = defaultdict(list)
        for g in group:
            tone_map[g["tone_pinyin_key"]].append(g)
        tone_keys = list(tone_map.keys())
        if len(tone_keys) >= 2:
            for i, ta in enumerate(tone_keys):
                for tb in tone_keys[i + 1 :]:
                    a, b = tone_map[ta][0], tone_map[tb][0]
                    distinguishable.append(
                        {
                            "pinyin": pinyin_key,
                            "wordA": a["word"],
                            "toneA": ta,
                            "wordB": b["word"],
                            "toneB": tb,
                            "freqScore": freq,
                            "repairA": a.get("repair_target") == 1,
                            "repairB": b.get("repair_target") == 1,
                        }
                    )
        if len(tone_keys) == 1:
            words = sorted({g["word"] for g in group})
            for i, wa in enumerate(words):
                for wb in words[i + 1 :]:
                    indistinguishable.append(
                        {
                            "wordA": wa,
                            "wordB": wb,
                            "pinyin": pinyin_key,
                            "tone": tone_keys[0],
                            "freqScore": freq,
                        }
                    )

    distinguishable.sort(key=lambda x: -x["freqScore"])
    indistinguishable.sort(key=lambda x: -x["freqScore"])
    repair_targets = conn.execute(
        "SELECT word, pinyin_key, tone_pinyin_key, prior_score FROM base_lexicon WHERE repair_target=1 AND enabled=1"
    ).fetchall()
    conn.close()

    out = {
        "totalLexiconRowsWithTone": len(rows),
        "distinguishablePairCount": len(distinguishable),
        "indistinguishablePairCount": len(indistinguishable),
        "repairTargetCount": len(repair_targets),
        "top100Distinguishable": distinguishable[:100],
        "top50Indistinguishable": indistinguishable[:50],
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"distinguishable": len(distinguishable), "indistinguishable": len(indistinguishable), "out": str(OUT)}))


if __name__ == "__main__":
    main()
