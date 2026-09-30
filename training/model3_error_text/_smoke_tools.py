# -*- coding: utf-8 -*-
"""Smoke: Node G2P + lexicon length-1 lookup."""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from training.model2.phonetic.syllables import syllables_from_text_tone_num  # noqa: E402
from training.model2.pronunciation.syllable_substitution import apply_family_to_syllable  # noqa: E402

DB = ROOT / "node_runtime/lexicon/v3/lexicon.sqlite"


def main() -> None:
    text = "让我们过上好日子"
    tones = syllables_from_text_tone_num(text)
    print("tones", tones)
    con = sqlite3.connect(str(DB))
    n = con.execute(
        "SELECT COUNT(*) FROM base_lexicon WHERE enabled=1 AND length(word)=1"
    ).fetchone()[0]
    print("len1", n)
    # n_l on 让 (rang4?)
    if tones:
        print("first", tones[0], "->", apply_family_to_syllable(tones[0], "n_l"))
    # find lan*
    rows = con.execute(
        "SELECT word, pinyin_key, tone_pinyin_key FROM base_lexicon "
        "WHERE enabled=1 AND length(word)=1 AND pinyin_key=? ORDER BY prior_score DESC, word LIMIT 8",
        ("lan",),
    ).fetchall()
    print("lan", rows)
    con.close()


if __name__ == "__main__":
    main()
