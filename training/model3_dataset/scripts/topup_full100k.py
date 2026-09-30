# -*- coding: utf-8 -*-
"""Top up full100k corpus to ~100k with additional NATURAL/NO_ANCHOR cleans."""
from __future__ import annotations

import hashlib
import json
import random
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.anchor_diet import apply_anchor_diet
from training.model3_dataset.scripts.run_anchor_contrast_full100k import (
    DATASET_VERSION,
    GEN_VERSION,
    HARNESS_CHUNK,
    OUT,
    POOL,
    SEED,
    assign_split,
    force_anchor_on_surface,
    harness_worker,
    sha256_file,
)
from training.model3_dataset.scripts.stage2_common import (
    build_sample,
    label_spans,
    validate_sample,
)

TARGET = 100000
PREFIXES = ["对了，", "然后，", "另外，"]


def load_bases():
    rows = []
    with POOL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            text = o.get("normalized") or ""
            if not text or len(text) < 4 or len(text) > 48:
                continue
            if "dialog_200" in (o.get("source") or "").lower():
                continue
            sid = o.get("source_sentence_id") or (
                "prior:" + hashlib.sha1(text.encode()).hexdigest()[:12]
            )
            o["_sid"] = sid
            o["_split"] = assign_split(sid)
            rows.append(o)
    return rows


def existing_ids():
    ids = set()
    for split in ("train", "dev", "test"):
        for p in (OUT / split).glob("shard-*.jsonl"):
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        ids.add(json.loads(line)["sampleId"])
    return ids


def run_harness_parallel(requests, work_dir, workers=4):
    mats = {}
    cache = work_dir / "_harness_all_resp.jsonl"
    if cache.exists():
        with cache.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    m = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if m.get("id"):
                    mats[m["id"]] = m
    pending = [r for r in requests if r["id"] not in mats]
    print(f"topup harness pending={len(pending)} cached={len(mats)}", flush=True)
    chunks = []
    for i in range(0, len(pending), HARNESS_CHUNK):
        chunks.append((len(chunks), pending[i : i + HARNESS_CHUNK], work_dir))
    with cache.open("a", encoding="utf-8") as af:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = [ex.submit(harness_worker, c) for c in chunks]
            for fut in as_completed(futs):
                _, outs = fut.result()
                for m in outs:
                    if m.get("id"):
                        mats[m["id"]] = m
                        af.write(json.dumps(m, ensure_ascii=False) + "\n")
                af.flush()
    return mats


def main():
    rng = random.Random(SEED + 99)
    existing = existing_ids()
    need = TARGET - len(existing)
    print(f"existing={len(existing)} need={need}", flush=True)
    if need <= 0:
        print("already at target")
        return

    bases = load_bases()
    rng.shuffle(bases)
    hold = set(b["_sid"] for b in bases[: max(80, len(bases) // 25)])
    plans = []
    idx = 900000
    for bi, b in enumerate(bases):
        if len(plans) >= need + 500:
            break
        text0 = b["normalized"]
        sid = b["_sid"]
        split = "test" if sid in hold else b["_split"]
        held = ["held_out_source_sentence"] if sid in hold else []
        pref = PREFIXES[bi % len(PREFIXES)]
        text = pref + text0
        diet = "NO_ANCHOR" if bi % 4 == 0 else "ANCHOR_CONDITIONED"
        plans.append(
            {
                "harnessId": f"f100k_top_{SEED}_{idx:06d}",
                "bucket": "NO_ANCHOR" if diet == "NO_ANCHOR" else "NATURAL",
                "contrastGroupId": f"nat:{sid}:top{bi % 3}",
                "anchorSurface": None,
                "referenceText": text,
                "errorText": text,
                "corruptions": [],
                "split": split,
                "heldOutAxes": held,
                "intendedDiet": diet,
                "sourceSentenceId": sid,
            }
        )
        idx += 1

    plans = plans[:need]
    print(f"topup_plans={len(plans)}", flush=True)
    reqs = [
        {"id": p["harnessId"], "currentText": p["errorText"], "referenceText": p["referenceText"], "corruptions": []}
        for p in plans
    ]
    mats = run_harness_parallel(reqs, OUT)

    sidecar_path = OUT / "anchor_provenance_sidecar.jsonl"
    new_samples = []
    label_stats = Counter()
    for p in plans:
        mat = mats.get(p["harnessId"])
        if not mat or not mat.get("ok"):
            continue
        if p["intendedDiet"] == "NO_ANCHOR":
            for s in mat.get("spans") or []:
                s["isAnchor"] = False
                s["anchorSource"] = "NONE"
            diet_info = {
                "anchorDietBucket": "NO_ANCHOR",
                "trainingAnchorEvidence": "NONE",
                "simulatedAnchorSpanIds": [],
            }
            sim_ids = []
        else:
            diet_info = apply_anchor_diet(mat, "ANCHOR_CONDITIONED", random.Random(hash(p["harnessId"]) % (2**32)))
            sim_ids = diet_info.get("simulatedAnchorSpanIds") or []
        spans, st = label_spans(mat)
        label_stats.update(st)
        sample_id = f"m3f100k_{SEED}_{p['harnessId']}"
        if sample_id in existing:
            continue
        with sidecar_path.open("a", encoding="utf-8") as sf:
            sf.write(
                json.dumps(
                    {
                        "sampleId": sample_id,
                        "harnessId": p["harnessId"],
                        "bucket": p["bucket"],
                        "seedType": None,
                        "anchorDietBucket": diet_info.get("anchorDietBucket"),
                        "trainingAnchorEvidence": diet_info.get("trainingAnchorEvidence"),
                        "simulatedAnchorSpanIds": sim_ids,
                        "contrastStrength": "NONE",
                        "contrastGroupId": p["contrastGroupId"],
                        "sourceKind": "CERTIFIED_POOL_TOPUP",
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
        sample = build_sample(
            mat,
            spans,
            {
                "sourceSampleId": p["harnessId"],
                "sourceCorpus": "anchor_contrast_full100k_v1",
                "sourceSentenceId": p["sourceSentenceId"],
                "contrastGroupId": p["contrastGroupId"],
                "splitGroupKey": p["contrastGroupId"],
                "surfacePairKey": None,
                "source_type": "CERTIFIED_POOL_TOPUP",
                "heldOutAxes": p["heldOutAxes"],
            },
            sample_id,
            p["split"],
            GEN_VERSION,
            DATASET_VERSION,
            "anchor_provenance_sidecar.jsonl",
        )
        sample["heldOutAxes"] = p["heldOutAxes"]
        sample["trainingBucket"] = p["bucket"]
        if validate_sample(sample):
            continue
        new_samples.append(sample)

    print(f"topup_new_samples={len(new_samples)}", flush=True)

    # append to existing shards (rewrite all for simplicity)
    by_split = defaultdict(list)
    for split in ("train", "dev", "test"):
        for p in sorted((OUT / split).glob("shard-*.jsonl")):
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        by_split[split].append(json.loads(line))
    for s in new_samples:
        by_split[s["split"]].append(s)

    SHARD = 5000
    checksum_rows = []
    for sp in ("train", "dev", "test"):
        for old in (OUT / sp).glob("shard-*.jsonl"):
            old.unlink()
        rows = by_split[sp]
        for i in range(0, len(rows), SHARD):
            path = OUT / sp / f"shard-{i // SHARD:05d}.jsonl"
            chunk = rows[i : i + SHARD]
            with path.open("w", encoding="utf-8") as f:
                for s in chunk:
                    f.write(json.dumps(s, ensure_ascii=False) + "\n")
            checksum_rows.append(
                {
                    "path": str(path.relative_to(REPO)).replace("\\", "/"),
                    "sha256": sha256_file(path),
                    "lines": len(chunk),
                    "split": sp,
                }
            )
    with (OUT / "checksums.csv").open("w", encoding="utf-8") as f:
        f.write("path,sha256,lines,split\n")
        for r in checksum_rows:
            f.write(f"{r['path']},{r['sha256']},{r['lines']},{r['split']}\n")

    # refresh manifest counts
    all_rows = by_split["train"] + by_split["dev"] + by_split["test"]
    label_stats = Counter()
    bucket_stats = Counter()
    for s in all_rows:
        bucket_stats[s.get("trainingBucket") or "UNKNOWN"] += 1
        for sp in s["spans"]:
            label_stats[sp.get("label")] += 1
    eligible = label_stats["KEEP"] + label_stats["RETRY"]
    no_anchor = sum(1 for s in all_rows if not any(sp.get("isAnchor") for sp in s["spans"]))
    man = json.loads((OUT / "dataset_manifest.json").read_text(encoding="utf-8"))
    man.update(
        {
            "sampleCount": len(all_rows),
            "splitCounts": dict(Counter(s["split"] for s in all_rows)),
            "labelDistribution": dict(label_stats),
            "bucketDistribution": dict(bucket_stats),
            "retryRatioEligible": label_stats["RETRY"] / eligible if eligible else 0.0,
            "anchorConditionedUtterances": len(all_rows) - no_anchor,
            "noAnchorUtterances": no_anchor,
            "topupAdded": len(new_samples),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
    )
    (OUT / "dataset_manifest.json").write_text(json.dumps(man, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"sampleCount": man["sampleCount"], "buckets": dict(bucket_stats), "labels": dict(label_stats)}, indent=2))


if __name__ == "__main__":
    main()
