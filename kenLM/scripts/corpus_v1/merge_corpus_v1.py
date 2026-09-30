#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Merge Wikipedia + OSCAR cleaned sentence files into Corpus V1 (dedup, length gates)."""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
REPO = ROOT.parent
sys.path.insert(0, str(REPO / "scripts" / "kenlm"))
from clean_zh import MIN_CHARS, MAX_CHARS, clean_sentence, sha1_line  # noqa: E402
from lib.tokenize_char import tokenize_line  # noqa: E402


def merge(inputs: list[Path], raw_out: Path, char_out: Path) -> dict:
    seen: set[str] = set()
    kept = 0
    per_source: Counter[str] = Counter()
    dropped = Counter()
    vocab: Counter[str] = Counter()
    tokens = 0

    raw_out.parent.mkdir(parents=True, exist_ok=True)
    char_out.parent.mkdir(parents=True, exist_ok=True)

    with open(raw_out, "w", encoding="utf-8", newline="\n") as raw_f, open(
        char_out, "w", encoding="utf-8", newline="\n"
    ) as char_f:
        for src in inputs:
            if not src.exists():
                raise FileNotFoundError(src)
            name = src.stem
            with open(src, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    s = clean_sentence(line)
                    if not s:
                        dropped["clean_reject"] += 1
                        continue
                    h = sha1_line(s)
                    if h in seen:
                        dropped["dup"] += 1
                        continue
                    seen.add(h)
                    tok = tokenize_line(s)
                    if not tok:
                        dropped["tokenize_empty"] += 1
                        continue
                    raw_f.write(s + "\n")
                    char_f.write(tok + "\n")
                    kept += 1
                    per_source[name] += 1
                    parts = tok.split()
                    tokens += len(parts)
                    for p in parts:
                        vocab[p] += 1
                    if kept % 200_000 == 0:
                        print(f"[merge] kept={kept}")

    stats = {
        "inputs": [str(p) for p in inputs],
        "rawOut": str(raw_out),
        "charOut": str(char_out),
        "sentenceCount": kept,
        "tokenCount": tokens,
        "vocabularySize": len(vocab),
        "perSource": dict(per_source),
        "dropped": dict(dropped),
        "minChars": MIN_CHARS,
        "maxChars": MAX_CHARS,
    }
    print("[merge] done", json.dumps(stats, ensure_ascii=False, indent=2))
    return stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wiki", default=str(ROOT / "corpus" / "v1_raw" / "wikipedia_sentences.txt"))
    ap.add_argument("--oscar", default="")
    ap.add_argument("--wiki-only", action="store_true", help="Ignore OSCAR even if present")
    ap.add_argument("--raw-out", default=str(ROOT / "corpus" / "v1" / "corpus_v1.raw.txt"))
    ap.add_argument("--char-out", default=str(ROOT / "corpus" / "v1" / "corpus_v1.char.txt"))
    ap.add_argument("--stats-out", default=str(ROOT / "corpus" / "v1" / "corpus_v1.stats.json"))
    args = ap.parse_args()
    inputs = [Path(args.wiki)]
    oscar = Path(args.oscar) if args.oscar else (ROOT / "corpus" / "v1_raw" / "oscar_sentences.txt")
    if not args.wiki_only and oscar.is_file() and oscar.stat().st_size > 0:
        inputs.append(oscar)
    else:
        print(f"[merge] wikipedia-only (oscar skipped: wiki_only={args.wiki_only})")
    stats = merge(inputs, Path(args.raw_out), Path(args.char_out))
    stats["sourcesPolicy"] = "wikipedia_only" if len(inputs) == 1 else "wikipedia_plus_oscar"
    Path(args.stats_out).write_text(json.dumps(stats, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
