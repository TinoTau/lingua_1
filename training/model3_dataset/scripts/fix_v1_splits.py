# -*- coding: utf-8 -*-
"""Fix split leakage: assign split only by sourceSentenceId group key."""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

DATA = REPO / "training/model3_dataset/model3_v1_synthetic_100k"
SEED = 2026082402
SHARD_SIZE = 5000


def assign_split_group_key(gkey: str, seed: int) -> str:
    h = int(hashlib.sha256(f"{seed}:{gkey}".encode()).hexdigest(), 16) % 100
    if h < 80:
        return "train"
    if h < 90:
        return "dev"
    return "test"


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    samples = []
    for sp in ("train", "dev", "test"):
        for p in sorted((DATA / sp).glob("shard-*.jsonl")):
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        samples.append(json.loads(line))

    for s in samples:
        sid = s["groupKeys"]["sourceSentenceId"]
        s["split"] = assign_split_group_key(sid, SEED)

    split_samples = defaultdict(list)
    for s in samples:
        split_samples[s["split"]].append(s)

    for sp in ("train", "dev", "test"):
        for old in (DATA / sp).glob("shard-*.jsonl"):
            old.unlink()

    checksum_rows = []
    for sp in ("train", "dev", "test"):
        rows = split_samples[sp]
        for i in range(0, len(rows), SHARD_SIZE):
            shard_rows = rows[i : i + SHARD_SIZE]
            path = DATA / sp / f"shard-{i // SHARD_SIZE:05d}.jsonl"
            with path.open("w", encoding="utf-8") as f:
                for s in shard_rows:
                    f.write(json.dumps(s, ensure_ascii=False) + "\n")
            checksum_rows.append(
                {
                    "path": str(path.relative_to(REPO)).replace("\\", "/"),
                    "sha256": sha256_file(path),
                    "lines": len(shard_rows),
                    "split": sp,
                }
            )

    with (DATA / "checksums.csv").open("w", encoding="utf-8") as f:
        f.write("path,sha256,lines,split\n")
        for row in checksum_rows:
            f.write(f"{row['path']},{row['sha256']},{row['lines']},{row['split']}\n")

    manifest = json.loads((DATA / "dataset_manifest.json").read_text(encoding="utf-8"))
    manifest["splitCounts"] = dict(Counter(s["split"] for s in samples))
    manifest["splitFix"] = "sourceSentenceId_only_20260824"
    (DATA / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    sets = {sp: set() for sp in ("train", "dev", "test")}
    for s in samples:
        sets[s["split"]].add(s["groupKeys"]["sourceSentenceId"])
    leak = {
        "train_dev": len(sets["train"] & sets["dev"]),
        "train_test": len(sets["train"] & sets["test"]),
        "dev_test": len(sets["dev"] & sets["test"]),
    }
    print(json.dumps({"samples": len(samples), "splitCounts": manifest["splitCounts"], "leak": leak}, indent=2))


if __name__ == "__main__":
    main()
