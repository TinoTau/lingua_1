#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Stream OSCAR Chinese Deduplicated and randomly sample ~1M cleaned sentences.
Does NOT download the full corpus.
Preferred: oscar-corpus/OSCAR-2301 language=zh (gated).
Fallback: oscar / unshuffled_deduplicated_zh (classic deduplicated Chinese).
"""
from __future__ import annotations

import argparse
import os
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from clean_zh import clean_sentence, sha1_line, split_sentences  # noqa: E402


def load_token() -> str | None:
    for p in (
        os.environ.get("HF_TOKEN"),
        os.environ.get("HUGGING_FACE_HUB_TOKEN"),
    ):
        if p and p.strip():
            return p.strip()
    for path in (
        Path.home() / ".cache/huggingface/token",
        Path("/mnt/c/Users/tinot/.cache/huggingface/token"),
    ):
        if path.is_file():
            return path.read_text(encoding="utf-8").strip()
    return None


def open_stream(token: str | None):
    from datasets import load_dataset

    errors = []
    # Try newer OSCAR first
    for name, kwargs in (
        (
            "oscar-corpus/OSCAR-2301",
            {"language": "zh", "streaming": True, "split": "train", "token": token},
        ),
        (
            "oscar-corpus/OSCAR-2201",
            {"language": "zh", "streaming": True, "split": "train", "token": token},
        ),
        (
            "oscar",
            {
                "name": "unshuffled_deduplicated_zh",
                "streaming": True,
                "split": "train",
                "token": token,
            },
        ),
    ):
        try:
            print(f"[oscar] trying {name} kwargs={ {k:v for k,v in kwargs.items() if k!='token'} }")
            if name == "oscar":
                ds = load_dataset("oscar", "unshuffled_deduplicated_zh", streaming=True, split="train", token=token)
            else:
                ds = load_dataset(name, language="zh", streaming=True, split="train", token=token)
            # probe
            it = iter(ds)
            first = next(it)
            print(f"[oscar] opened {name}; keys={list(first.keys())[:8]}")
            # re-open fresh iterator
            if name == "oscar":
                ds = load_dataset("oscar", "unshuffled_deduplicated_zh", streaming=True, split="train", token=token)
            else:
                ds = load_dataset(name, language="zh", streaming=True, split="train", token=token)
            return name, ds
        except Exception as e:
            errors.append(f"{name}: {e}")
            print(f"[oscar] failed {name}: {e}")
    raise RuntimeError("Cannot open OSCAR stream:\n" + "\n".join(errors))


def doc_text(row: dict) -> str:
    for k in ("text", "content", "raw_content"):
        v = row.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return ""


def sample_sentences(
    ds,
    out_path: Path,
    target: int,
    seed: int,
    max_docs: int,
) -> dict:
    rng = random.Random(seed)
    seen: set[str] = set()
    kept = 0
    docs = 0
    scanned_sents = 0
    t0 = time.time()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # Reservoir over candidate sentences with early stop once we have enough unique after filtering
    # Strategy: shuffle buffer of docs (datasets.shuffle) then take until target.
    shuffled = ds.shuffle(seed=seed, buffer_size=10_000)

    with open(out_path, "w", encoding="utf-8", newline="\n") as out:
        for row in shuffled:
            docs += 1
            text = doc_text(row)
            if not text:
                continue
            for s in split_sentences(text):
                scanned_sents += 1
                # random keep gate to diversify across long docs (keep ~all until near target)
                if kept < target * 0.9 or rng.random() < 0.35:
                    h = sha1_line(s)
                    if h in seen:
                        continue
                    seen.add(h)
                    out.write(s + "\n")
                    kept += 1
                    if kept >= target:
                        break
            if kept >= target:
                break
            if docs % 2000 == 0:
                print(
                    f"[oscar] docs={docs} kept={kept}/{target} scanned_sents={scanned_sents} "
                    f"elapsed={time.time()-t0:.0f}s"
                )
            if docs >= max_docs:
                print("[oscar] hit max_docs")
                break

    stats = {
        "docs_seen": docs,
        "sentences_scanned": scanned_sents,
        "sentences_kept": kept,
        "unique": len(seen),
        "out": str(out_path),
        "elapsed_sec": round(time.time() - t0, 1),
    }
    print("[oscar] done", stats)
    return stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "corpus" / "v1_raw" / "oscar_sentences.txt"))
    ap.add_argument("--target", type=int, default=1_000_000)
    ap.add_argument("--seed", type=int, default=20260804)
    ap.add_argument("--max-docs", type=int, default=5_000_000)
    args = ap.parse_args()

    token = load_token()
    print("[oscar] token", "yes" if token else "no")
    name, ds = open_stream(token)
    stats = sample_sentences(ds, Path(args.out), args.target, args.seed, args.max_docs)
    stats["source"] = name
    Path(args.out).with_suffix(".stats.json").write_text(
        __import__("json").dumps(stats, indent=2) + "\n", encoding="utf-8"
    )
    return 0 if stats["sentences_kept"] > 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
