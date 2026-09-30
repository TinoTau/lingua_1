#!/usr/bin/env python3
"""Warm-ish score latency: one query process scores a large batch (single load)."""
from __future__ import annotations

import csv
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path("/mnt/d/Programs/github/lingua_1")
sys.path.insert(0, str(ROOT / "scripts" / "kenlm"))
from lib.tokenize_char import tokenize_line  # noqa: E402

OUT = ROOT / "docs/acceptance/Test/2026-08-05_KenLM_CorpusV1_Production_Readiness_AB"
QUERY = ROOT / "kenLM/kenlm/build/bin/query"
OLD = ROOT / "electron_node/services/asr_sherpa_lm/models/kenLM/zh_char_3gram.trie.bin"
NEW = ROOT / "kenLM/model/corpus_v1/zh_char_3gram.trie.bin"
SAMPLE = [
    "后选声城",
    "候选声城",
    "你好世界",
    "今天天气不错",
    "我们下午讨论候选生成方案",
]


def measure(model: Path, repeats: int = 40) -> dict:
    many = SAMPLE * repeats
    payload = ("\n".join(tokenize_line(t) for t in many) + "\n").encode()
    # cold single-line (load dominated)
    t0 = time.perf_counter()
    subprocess.run(
        [str(QUERY), str(model)],
        input=(tokenize_line(SAMPLE[0]) + "\n").encode(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    cold_ms = (time.perf_counter() - t0) * 1000
    # single-load large batch
    t0 = time.perf_counter()
    proc = subprocess.run(
        [str(QUERY), str(model)],
        input=payload,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    wall_ms = (time.perf_counter() - t0) * 1000
    n = 0
    for line in proc.stdout.decode("utf-8", "replace").splitlines():
        if re.search(r"Total:\s*([-+eE0-9.]+)", line):
            n += 1
    # approximate pure scoring after subtracting a cold-load proxy
    score_only = max(wall_ms - cold_ms, 0.0)
    return {
        "model": model.name,
        "coldSingleMs": round(cold_ms, 2),
        "batchN": n,
        "batchWallMs": round(wall_ms, 2),
        "approxScoreOnlyMs": round(score_only, 2),
        "approxPerCandidateMs": round(score_only / max(n, 1), 4),
        "note": "query exits at EOF; resident process requires production kenlm wrapper",
    }


def main() -> int:
    rows = [measure(OLD), measure(NEW)]
    # append to memory_results
    mem_path = OUT / "memory_results.csv"
    existing = list(csv.DictReader(mem_path.open(encoding="utf-8"))) if mem_path.exists() else []
    fields = ["metric", "value"]
    for r in rows:
        prefix = "old" if "asr_sherpa" in str(r) or r is rows[0] else "new"
        # use order
        prefix = "oldSingleLoadBatch" if r is rows[0] else "newSingleLoadBatch"
        for k, v in r.items():
            if k == "model":
                continue
            existing.append({"metric": f"{prefix}_{k}", "value": v})
    with mem_path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(existing)
    print(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
