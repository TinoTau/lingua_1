# -*- coding: utf-8 -*-
"""Generate ~100k MODEL3_TRAINING_SAMPLE_V1 synthetic corpus (V1 baseline phase)."""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import sys
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

# repo root on path
REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.anchor_diet import (
    apply_anchor_diet,
    overlaps_char_index,
    reserved_anchor_char_range,
)
from training.model3_dataset.scripts.stage2_common import (
    build_sample,
    label_spans,
    run_harness,
    validate_sample,
)
from training.model3_error_text.generator.corrupt import (
    annotate_sentence,
    apply_corruptions,
    try_orthographic_de_di_de,
    try_phonetic_corruption,
)
from training.model3_error_text.generator.families import ACTIVE_FAMILIES_V1
from training.model3_error_text.generator.lexicon_resolve import (
    LexiconSurfaceResolver,
    default_sqlite_path,
)

OUT = REPO / "training/model3_dataset/model3_v1_synthetic_100k"
DOCS = REPO / "docs/user_correction/model3"
POOL = DOCS / "model3_certified_base_pool_v2.jsonl"

SEED = 2026082402
TARGET_SAMPLES = 100000
SHARD_SIZE = 5000
HARNESS_CHUNK = 200
HARNESS_WORKERS = 3
NO_ANCHOR_RATIO = 0.20
GEN_VERSION = "model3-v1-synthetic-generator-1.0.0"
DATASET_VERSION = "model3_v1_synthetic_100k_20260824"
SIDECAR_NAME = "anchor_provenance_sidecar.jsonl"


def load_all_bases() -> list[dict]:
    rows = []
    with POOL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            text = o.get("normalized") or ""
            if not text or len(text) < 4 or len(text) > 40:
                continue
            if "dialog_200" in (o.get("source") or "").lower():
                continue
            rows.append(o)
    return rows


def assign_split_group_key(gkey: str, seed: int) -> str:
    h = int(hashlib.sha256(f"{seed}:{gkey}".encode()).hexdigest(), 16) % 100
    if h < 80:
        return "train"
    if h < 90:
        return "dev"
    return "test"


def make_variants_for_base(
    base: dict,
    resolver: LexiconSurfaceResolver,
    rng: random.Random,
    split: str,
    surface_pair_splits: dict[str, str],
    annotate_cache: dict[str, tuple],
) -> list[dict]:
    text = base["normalized"]
    sid = base.get("source_sentence_id") or (
        "prior:" + hashlib.sha1(text.encode()).hexdigest()[:12]
    )
    if text in annotate_cache:
        annos, _, meta = annotate_cache[text]
    else:
        annos, _, meta = annotate_sentence(text)
        annotate_cache[text] = (annos, "", meta)
    if meta.get("skip") or not annos:
        return []
    eligible = [a for a in annos if not a.skip_reason]
    if not eligible:
        return []

    reserved = reserved_anchor_char_range(text, eligible, rng)
    intended_anchor = "ANCHOR_CONDITIONED" if rng.random() >= NO_ANCHOR_RATIO else "NO_ANCHOR"

    def base_meta(extra: dict) -> dict:
        m = {
            "sourceSentenceId": sid,
            "sourceCorpus": base.get("source") or "certified_pool_v2",
            "source_type": base.get("source_type") or "PRIOR_CERTIFIED",
            "evidence_level": base.get("evidence_level") or "SYNTHETIC_TEXT",
            "shard": base.get("shard"),
            "split": split,
            "contrastGroupId": f"cg:{sid}",
            "splitGroupKey": sid,
            "intendedAnchorDiet": intended_anchor,
            **extra,
        }
        return m

    variants: list[dict] = []

    # CLEAN KEEP
    variants.append(
        {
            **base_meta({"variantKind": "CLEAN_KEEP", "corruptions": []}),
            "referenceText": text,
            "errorText": text,
            "expectedRepairClass": "CLEAN",
        }
    )

    # phonetic singles — avoid reserved anchor zone when anchor-conditioned
    phon_candidates: list[dict] = []
    seen_starts: set[int] = set()
    for _pass in range(2):
        fams = list(ACTIVE_FAMILIES_V1)
        rng.shuffle(fams)
        for a in eligible:
            if len(phon_candidates) >= 12:
                break
            if a.index in seen_starts:
                continue
            if intended_anchor == "ANCHOR_CONDITIONED" and reserved and overlaps_char_index(
                a.index, reserved[0], reserved[1]
            ):
                continue
            for fam in fams:
                c = try_phonetic_corruption(text, a, fam, resolver)
                if c and c["referenceSurface"] != c["errorSurface"]:
                    c["corruptionFamily"] = fam
                    phon_candidates.append(c)
                    seen_starts.add(a.index)
                    break

    rng.shuffle(phon_candidates)
    for c in phon_candidates[:10]:
        try:
            err = apply_corruptions(text, [c])
        except Exception:
            continue
        spk = f"surf:{hashlib.sha1(c['errorSurface'].encode()).hexdigest()[:16]}"
        if spk not in surface_pair_splits:
            surface_pair_splits[spk] = split
        variants.append(
            {
                **base_meta(
                    {
                        "variantKind": "SINGLE_PHONETIC",
                        "corruptions": [c],
                        "surfacePairKey": spk,
                        "corruptionFamily": c.get("corruptionFamily"),
                    }
                ),
                "referenceText": text,
                "errorText": err,
                "expectedRepairClass": "PHONETIC_CANDIDATE",
            }
        )

    # double corruption pairs (deterministic when enough candidates)
    if len(phon_candidates) >= 2:
        pairs = [(0, 1)]
        if len(phon_candidates) >= 4:
            pairs.append((2, 3))
        for i, j in pairs:
            c1, c2 = phon_candidates[i], phon_candidates[j]
            if c1["spanStart"] == c2["spanStart"]:
                continue
            try:
                err = apply_corruptions(text, [c1, c2])
                variants.append(
                    {
                        **base_meta(
                            {
                                "variantKind": "DOUBLE_PHONETIC",
                                "corruptions": [c1, c2],
                                "corruptionFamily": "double",
                            }
                        ),
                        "referenceText": text,
                        "errorText": err,
                        "expectedRepairClass": "PHONETIC_CANDIDATE",
                    }
                )
            except Exception:
                pass

    # orthographic hard negative
    if rng.random() < 0.06:
        for a in eligible:
            if intended_anchor == "ANCHOR_CONDITIONED" and reserved and overlaps_char_index(
                a.index, reserved[0], reserved[1]
            ):
                continue
            o = try_orthographic_de_di_de(text, a)
            if o:
                try:
                    err = apply_corruptions(text, [o])
                    variants.append(
                        {
                            **base_meta(
                                {
                                    "variantKind": "ORTHO_HARD_NEG",
                                    "corruptions": [o],
                                    "corruptionFamily": "ORTHOGRAPHIC_DE_DI_DE",
                                }
                            ),
                            "referenceText": text,
                            "errorText": err,
                            "expectedRepairClass": "NON_PHONETIC",
                        }
                    )
                except Exception:
                    pass
                break

    return variants


def harness_worker(args: tuple) -> tuple[int, list[dict]]:
    worker_id, chunk, work_dir = args
    resp = work_dir / f"_harness_resp_{worker_id}.jsonl"
    outs = run_harness(chunk, resp, work_dir, worker_id)
    return worker_id, outs


def run_harness_parallel(all_requests: list[dict], work_dir: Path, workers: int = HARNESS_WORKERS) -> dict[str, dict]:
    mats: dict[str, dict] = {}
    cache_path = work_dir / "_harness_all_resp.jsonl"
    if cache_path.exists():
        with cache_path.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    m = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if m.get("id"):
                    mats[m["id"]] = m
        print(f"cached harness mats {len(mats)}")

    pending = [r for r in all_requests if r["id"] not in mats]
    if not pending:
        return mats

    chunks: list[tuple[int, list[dict]]] = []
    for i in range(0, len(pending), HARNESS_CHUNK):
        chunk = pending[i : i + HARNESS_CHUNK]
        chunks.append((len(chunks), chunk, work_dir))

    with cache_path.open("a", encoding="utf-8") as af:
        if workers <= 1:
            for wid, chunk, wd in chunks:
                _, outs = harness_worker((wid, chunk, wd))
                for m in outs:
                    if m.get("id"):
                        mats[m["id"]] = m
                        af.write(json.dumps(m, ensure_ascii=False) + "\n")
                af.flush()
        else:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = [ex.submit(harness_worker, (wid, chunk, wd)) for wid, chunk, wd in chunks]
                for fut in as_completed(futs):
                    _, outs = fut.result()
                    for m in outs:
                        if m.get("id"):
                            mats[m["id"]] = m
                            af.write(json.dumps(m, ensure_ascii=False) + "\n")
                    af.flush()
    return mats


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def stratified_pick(plans: list[dict], target_n: int, rng: random.Random) -> list[dict]:
    """Resample toward corruption mix that improves RETRY density while keeping clean KEEP."""
    buckets: dict[str, list[dict]] = defaultdict(list)
    for p in plans:
        buckets[p.get("variantKind", "OTHER")].append(p)
    weights = {
        "CLEAN_KEEP": 0.16,
        "SINGLE_PHONETIC": 0.64,
        "DOUBLE_PHONETIC": 0.12,
        "ORTHO_HARD_NEG": 0.08,
    }
    picked: list[dict] = []
    for kind, w in weights.items():
        need = max(0, int(target_n * w))
        pool = buckets.get(kind, [])
        rng.shuffle(pool)
        picked.extend(pool[:need])
    rng.shuffle(picked)
    if len(picked) < target_n:
        used = {p["harnessId"] for p in picked}
        rest = [p for p in plans if p["harnessId"] not in used]
        rng.shuffle(rest)
        picked.extend(rest[: target_n - len(picked)])
    rng.shuffle(picked)
    return picked[:target_n]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target-samples", type=int, default=TARGET_SAMPLES)
    parser.add_argument("--harness-workers", type=int, default=HARNESS_WORKERS)
    args = parser.parse_args()
    target_n = args.target_samples
    workers = args.harness_workers

    OUT.mkdir(parents=True, exist_ok=True)
    for sp in ("train", "dev", "test"):
        (OUT / sp).mkdir(exist_ok=True)

    rng = random.Random(SEED)
    resolver = LexiconSurfaceResolver(default_sqlite_path(REPO))
    annotate_cache: dict[str, tuple] = {}
    bases = load_all_bases()
    print(f"bases loaded {len(bases)}")

    # group split first
    groups: dict[str, dict] = {}
    for b in bases:
        sid = b.get("source_sentence_id") or (
            "prior:" + hashlib.sha1((b.get("normalized") or "").encode()).hexdigest()[:12]
        )
        groups[sid] = b

    split_by_group = {g: assign_split_group_key(g, SEED) for g in groups}
    surface_pair_splits: dict[str, str] = {}

    base_items = list(groups.items())
    rng.shuffle(base_items)

    error_plans: list[dict] = []
    idx = 0
    touched = 0
    rounds = 2
    for sid, b in base_items:
        sp = split_by_group[sid]
        for round_i in range(rounds):
            r_local = random.Random(SEED + round_i * 9973 + int(hashlib.sha1(sid.encode()).hexdigest()[:8], 16))
            vars_ = make_variants_for_base(b, resolver, r_local, sp, surface_pair_splits, annotate_cache)
            for v in vars_:
                v["sourceSampleId"] = f"e{SEED}_{idx:06d}"
                v["harnessId"] = f"h{SEED}_{idx:06d}"
                v["generationRound"] = round_i
                idx += 1
                error_plans.append(v)
        touched += 1
        if touched % 100 == 0:
            print(f"variant_gen bases={touched} plans={len(error_plans)}", flush=True)

    print(f"raw_plans {len(error_plans)} from bases={touched}", flush=True)
    if len(error_plans) < target_n:
        print(f"WARNING: only {len(error_plans)} plans for target {target_n}", flush=True)

    rng.shuffle(error_plans)
    error_plans = stratified_pick(error_plans, target_n, rng)
    print(f"error_plans {len(error_plans)} (bases_touched~{len({e['sourceSentenceId'] for e in error_plans})})")

    requests = [
        {
            "id": e["harnessId"],
            "currentText": e["errorText"],
            "referenceText": e["referenceText"],
            "corruptions": e["corruptions"],
        }
        for e in error_plans
    ]

    mats_by_id = run_harness_parallel(requests, OUT, workers)

    sidecar_path = OUT / SIDECAR_NAME
    sidecar_path.write_text("", encoding="utf-8")
    samples: list[dict] = []
    excluded: list[dict] = []
    label_stats: Counter = Counter()
    anchor_buckets: Counter = Counter()
    corruption_stats: Counter = Counter()
    val_fail: Counter = Counter()

    for e in error_plans:
        hid = e["harnessId"]
        mat = mats_by_id.get(hid)
        if not mat or not mat.get("ok"):
            excluded.append({"id": hid, "reason": "harness_fail", "detail": mat})
            continue

        diet_rng = random.Random(int(hashlib.sha1(hid.encode()).hexdigest(), 16) % (2**32))
        sidecar = apply_anchor_diet(mat, e["intendedAnchorDiet"], diet_rng)

        # reject simulated anchor on corrupted span
        bad_anchor = False
        for s in mat.get("spans") or []:
            if s.get("isAnchor") and not (
                (s.get("referenceSurface") or s.get("surface")) == s.get("surface")
            ):
                bad_anchor = True
                break
        if bad_anchor:
            excluded.append({"id": hid, "reason": "corrupted_anchor_span"})
            continue

        spans, st = label_spans(mat)
        label_stats.update(st)
        anchor_buckets[sidecar["anchorDietBucket"]] += 1
        vk = e.get("variantKind") or "unknown"
        corruption_stats[vk] += 1

        sidecar["sampleId"] = f"m3v1_{SEED}_{e['sourceSampleId']}"
        sidecar["harnessId"] = hid
        sidecar["variantKind"] = vk
        sidecar["corruptionFamily"] = e.get("corruptionFamily")

        with sidecar_path.open("a", encoding="utf-8") as sf:
            sf.write(json.dumps(sidecar, ensure_ascii=False) + "\n")

        spk = e.get("surfacePairKey")
        split = e["split"]

        sample = build_sample(
            mat,
            spans,
            {
                "sourceSampleId": e["sourceSampleId"],
                "sourceCorpus": e["sourceCorpus"],
                "sourceSentenceId": e["sourceSentenceId"],
                "contrastGroupId": e.get("contrastGroupId"),
                "splitGroupKey": e.get("splitGroupKey"),
                "surfacePairKey": spk,
                "source_type": e.get("source_type"),
                "shard": e.get("shard"),
            },
            sidecar["sampleId"],
            split,
            GEN_VERSION,
            DATASET_VERSION,
            SIDECAR_NAME,
        )
        errs = validate_sample(sample)
        if errs:
            for er in errs:
                val_fail[er] += 1
            excluded.append({"id": sample["sampleId"], "reason": "validation", "errs": errs})
            continue
        samples.append(sample)

    # write shards
    split_samples: dict[str, list[dict]] = defaultdict(list)
    for s in samples:
        split_samples[s["split"]].append(s)

    checksum_rows = []
    for sp in ("train", "dev", "test"):
        rows = split_samples[sp]
        shard_idx = 0
        for i in range(0, len(rows), SHARD_SIZE):
            shard_rows = rows[i : i + SHARD_SIZE]
            path = OUT / sp / f"shard-{shard_idx:05d}.jsonl"
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
            shard_idx += 1

    checksum_csv = OUT / "checksums.csv"
    with checksum_csv.open("w", encoding="utf-8") as f:
        f.write("path,sha256,lines,split\n")
        for row in checksum_rows:
            f.write(f"{row['path']},{row['sha256']},{row['lines']},{row['split']}\n")

    split_counts = Counter(s["split"] for s in samples)
    anchor_utt = sum(1 for s in samples if any(sp["isAnchor"] for sp in s["spans"]))
    no_anchor_utt = len(samples) - anchor_utt
    real_domain_utt = sum(
        1
        for line in sidecar_path.open(encoding="utf-8")
        if '"anchorDietBucket": "REAL_DOMAIN"' in line or '"anchorDietBucket":"REAL_DOMAIN"' in line
    )
    sim_utt = sum(
        1
        for line in sidecar_path.open(encoding="utf-8")
        if "SIMULATED_TRAINING" in line
    )

    manifest = {
        "datasetVersion": DATASET_VERSION,
        "schemaVersion": "MODEL3_TRAINING_SAMPLE_V1",
        "generatorVersion": GEN_VERSION,
        "seed": SEED,
        "sampleCount": len(samples),
        "excludedCount": len(excluded),
        "splitCounts": dict(split_counts),
        "labelDistribution": dict(label_stats),
        "anchorBuckets": dict(anchor_buckets),
        "corruptionVariantKinds": dict(corruption_stats),
        "anchorConditionedUtterances": anchor_utt,
        "noAnchorUtterances": no_anchor_utt,
        "realDomainUtterancesSidecar": real_domain_utt,
        "simulatedTrainingUtterancesSidecar": sim_utt,
        "certifiedBasePool": 22177,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sidecar": SIDECAR_NAME,
        "dialog200Contamination": 0,
        "model2AnchorStatus": "UNAVAILABLE",
        "evidenceLevel": "SYNTHETIC_TEXT",
    }
    (OUT / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (OUT / "excluded_samples.jsonl").write_text(
        "\n".join(json.dumps(x, ensure_ascii=False) for x in excluded) + ("\n" if excluded else ""),
        encoding="utf-8",
    )

    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
