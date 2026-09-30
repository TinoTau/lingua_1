# -*- coding: utf-8 -*-
"""Targeted MODEL3_V2_REALDIST_EXPANDED_V1 builder.

Addresses confirmed gap: TRAIN RETRY spans cluster at utterance TAIL
(span_rel_position p50≈1.0) while REAL HIGH RETRY FineSpans sit HEAD/MID
(p50≈0.34), often inside MULTI_CHAR / INSERTION-like local regions.

No dialog_200 text. No training. V2 label contract unchanged.
"""
from __future__ import annotations

import hashlib
import json
import random
import re
import sys
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.stage2_common import validate_sample  # noqa: E402
from training.model3_dataset.scripts.stage2_v2_label import (  # noqa: E402
    LABEL_CONTRACT_VERSION,
    label_spans_v2,
)

DOCS = REPO / "docs/user_correction/model3"
POOL = DOCS / "model3_certified_base_pool_v2.jsonl"
V2 = REPO / "training/model3_dataset/model3_v2_labeled"
OUT = REPO / "training/model3_dataset/model3_v2_realdist_expanded_v1"

DATASET_ID = "MODEL3_V2_REALDIST_EXPANDED_V1"
DATASET_VERSION = "model3_v2_realdist_expanded_v1_20260829"
GEN_VERSION = "model3-v2-realdist-expansion-1.0.0"
SEED = 2026082902
_CJK = re.compile(r"[\u4e00-\u9fff]")

# Homophone / near-homophone style substitutions (general, not dialog_200)
PHONETIC_PAIRS = [
    ("杯", "背"),
    ("陈", "城"),
    ("线", "限"),
    ("先", "线"),
    ("联", "连"),
    ("调", "掉"),
    ("堵", "赌"),
    ("少", "烧"),
    ("冰", "病"),
    ("问", "温"),
    ("期", "齐"),
    ("关", "官"),
]
# Multi-char region replacements (ref → err); structural only
MULTI_REGIONS = [
    ("项目里", "顺便向木李"),
    ("更衣室", "更易是"),
    ("上线计划", "上限计划"),
    ("候选生成", "后选生成"),
    ("联调", "连掉"),
    ("接口", "借口"),
    ("中关村", "中官村"),
    ("软件园", "軟件遠"),
]
INSERTIONS = [
    ("李工", "理工科"),
    ("问一下", "温习一下以下"),
    ("对比一下", "对比"),
]


def load_pool(rng: random.Random) -> list[str]:
    rows = []
    with POOL.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            t = o.get("normalized") or o.get("text") or ""
            src = (o.get("source") or "").lower()
            if "dialog_200" in src or "dialog200" in src:
                continue
            if len(_CJK.findall(t)) < 8 or len(t) > 40:
                continue
            rows.append(t)
    rng.shuffle(rows)
    return rows


def cjk_chars(text: str) -> list[tuple[int, str]]:
    return [(i, ch) for i, ch in enumerate(text) if _CJK.match(ch)]


def make_1char_spans(text: str) -> list[dict]:
    spans = []
    for i, ch in enumerate(text):
        if not _CJK.match(ch) and not ch.isalnum():
            # still emit punctuation as spans to keep offsets honest? Prefer CJK-only FineSpans like runtime majority
            continue
        if not _CJK.match(ch):
            continue
        spans.append(
            {
                "spanId": f"syn:{i}",
                "surface": ch,
                "rawStart": i,
                "rawEnd": i + 1,
                "syllableStart": len(spans),
                "syllableEnd": len(spans) + 1,
                "isAnchor": False,
                "anchorSource": "NONE",
                "referenceSurface": ch,
                "phoneticCompatible": False,
                "corruptionFamily": None,
                "repairability": {"referenceReachable": "UNKNOWN"},
                "recallEvidence": {"status": "AVAILABLE", "firstPassCandidateCount": 0},
                "pinyinEvidence": {"provenance": "TEXT_DERIVED_SYLLABLE_KEY"},
                "toneEvidence": {"provenance": "ABSENT"},
                "acousticEvidence": {"status": "ABSENT"},
                "pronunciationEvidence": {"status": "UNAVAILABLE"},
            }
        )
    return spans


def mark_anchor(spans: list[dict], text: str, surface: str) -> None:
    pos = text.find(surface)
    if pos < 0 or not surface:
        return
    end = pos + len(surface)
    for s in spans:
        if s["rawStart"] >= pos and s["rawEnd"] <= end:
            s["isAnchor"] = True
            s["anchorSource"] = "DOMAIN"


def assign_split(key: str) -> str:
    h = int(hashlib.sha256(f"{SEED}:{key}".encode()).hexdigest(), 16) % 100
    if h < 80:
        return "train"
    if h < 90:
        return "dev"
    return "test"


def build_sample(ref: str, cur: str, spans: list[dict], regions_meta: dict, sid: str, split: str, bucket: str) -> dict:
    mat = {
        "referenceText": ref,
        "currentText": cur,
        "spans": spans,
        "corruptions": regions_meta.get("corruptions") or [],
        "domainEvidence": {
            "retainedDomains": [],
            "anchorMaterialization": "SYNTHETIC_DOMAIN_MARK",
        },
        "featureAvailability": {
            "textContext": True,
            "pinyinTextDerived": True,
            "recallFirstPass": True,
        },
    }
    labeled, stats, regions = label_spans_v2(mat)
    sample = {
        "schemaVersion": "MODEL3_TRAINING_SAMPLE_V1",
        "sampleId": sid,
        "sourceSampleId": sid,
        "sourceCorpus": "model3_v2_realdist_expansion_v1",
        "evidenceLevel": "SYNTHETIC_TEXT",
        "referenceText": ref,
        "currentText": cur,
        "audioRef": None,
        "domainEvidence": mat["domainEvidence"],
        "model2AnchorStatus": "UNAVAILABLE",
        "spans": labeled,
        "split": split,
        "groupKeys": {
            "sourceSentenceId": sid,
            "contrastGroupId": sid,
            "splitGroupKey": sid,
        },
        "heldOutAxes": ["REAL_MAINLINE_EVAL", "DIALOG_200_HELD_OUT"],
        "featureAvailability": mat["featureAvailability"],
        "trainingBucket": bucket,
        "pilotMeta": {
            "ERROR_SHAPE": regions_meta.get("ERROR_SHAPE"),
            "ERROR_RELATION": regions_meta.get("ERROR_RELATION"),
            "corruptionFamily": regions_meta.get("corruptionFamily"),
            "expansionFamily": regions_meta.get("expansionFamily"),
            "targetPositionBin": regions_meta.get("targetPositionBin"),
        },
        "provenance": {
            "generatorVersion": GEN_VERSION,
            "labelMaterializerVersion": GEN_VERSION,
            "labelContractVersion": LABEL_CONTRACT_VERSION,
            "datasetVersion": DATASET_VERSION,
            "source_type": "V2_REALDIST_EXPANSION",
            "malformedRegions": regions,
        },
    }
    return sample


def inject_multi_char(base: str, rng: random.Random, pos_bin: str) -> tuple[str, str, dict] | None:
    ref_s, err_s = rng.choice(MULTI_REGIONS)
    # Build: prefix + region + suffix from base CJK stream
    chars = cjk_chars(base)
    if len(chars) < 10:
        return None
    L = len(err_s)
    if pos_bin == "HEAD":
        start_i = rng.randint(0, max(0, min(3, len(chars) - L - 3)))
    elif pos_bin == "MID":
        start_i = rng.randint(max(2, len(chars) // 4), max(3, (3 * len(chars) // 4) - L))
    else:
        start_i = max(0, len(chars) - L - rng.randint(0, 2))
    if start_i + L > len(chars):
        return None
    # Construct reference by replacing a slice of base CJK with ref_s conceptually:
    # Use template: head_cjk + ref_s + tail_cjk
    head = "".join(ch for _, ch in chars[:start_i])
    tail = "".join(ch for _, ch in chars[start_i + min(L, len(chars) - start_i) :])
    # Ensure head/tail have content for MID/HEAD
    if pos_bin != "TAIL" and len(tail) < 2:
        return None
    if pos_bin == "HEAD" and len(head) > 4:
        head = head[:2]
    ref = head + ref_s + tail
    cur = head + err_s + tail
    if ref == cur:
        return None
    corr = {
        "spanStart": len(head),
        "spanEnd": len(head) + len(err_s),
        "referenceSurface": ref_s,
        "errorSurface": err_s,
        "isPhonetic": True,
        "corruptionFamily": "multi_char_phonetic",
    }
    meta = {
        "ERROR_SHAPE": "MULTI_CHAR",
        "ERROR_RELATION": "PHONETIC",
        "corruptionFamily": "multi_char_phonetic",
        "expansionFamily": "MULTI_CHAR_HEADMID",
        "targetPositionBin": pos_bin,
        "corruptions": [corr],
    }
    return ref, cur, meta


def inject_phonetic(base: str, rng: random.Random, pos_bin: str) -> tuple[str, str, dict] | None:
    chars = cjk_chars(base)
    if len(chars) < 8:
        return None
    ref_ch, err_ch = rng.choice(PHONETIC_PAIRS)
    if pos_bin == "HEAD":
        idx = rng.randint(0, min(4, len(chars) - 1))
    elif pos_bin == "MID":
        idx = rng.randint(len(chars) // 4, max(len(chars) // 4 + 1, 3 * len(chars) // 4))
    else:
        idx = len(chars) - 1 - rng.randint(0, 2)
    idx = min(idx, len(chars) - 1)
    pos, _ = chars[idx]
    ref = base[:pos] + ref_ch + base[pos + 1 :]
    cur = base[:pos] + err_ch + base[pos + 1 :]
    corr = {
        "spanStart": pos,
        "spanEnd": pos + 1,
        "referenceSurface": ref_ch,
        "errorSurface": err_ch,
        "isPhonetic": True,
        "corruptionFamily": "phonetic_substitution",
    }
    meta = {
        "ERROR_SHAPE": "SINGLE_CHAR",
        "ERROR_RELATION": "PHONETIC",
        "corruptionFamily": "phonetic_substitution",
        "expansionFamily": "PHONETIC_HEADMID",
        "targetPositionBin": pos_bin,
        "corruptions": [corr],
    }
    return ref, cur, meta


def inject_insertion(base: str, rng: random.Random, pos_bin: str) -> tuple[str, str, dict] | None:
    ref_s, err_s = rng.choice(INSERTIONS)
    chars = cjk_chars(base)
    if len(chars) < 8:
        return None
    if pos_bin == "HEAD":
        start_i = rng.randint(0, 2)
    else:
        start_i = rng.randint(len(chars) // 5, max(len(chars) // 5 + 1, len(chars) // 2))
    head = "".join(ch for _, ch in chars[:start_i])
    tail = "".join(ch for _, ch in chars[start_i:])
    ref = head + ref_s + tail
    cur = head + err_s + tail
    corr = {
        "spanStart": len(head),
        "spanEnd": len(head) + len(err_s),
        "referenceSurface": ref_s,
        "errorSurface": err_s,
        "isPhonetic": False,
        "corruptionFamily": "insertion_local",
    }
    meta = {
        "ERROR_SHAPE": "INSERTION",
        "ERROR_RELATION": "NON_PHONETIC",
        "corruptionFamily": "insertion_local",
        "expansionFamily": "INSERTION_HEADMID",
        "targetPositionBin": pos_bin,
        "corruptions": [corr],
    }
    return ref, cur, meta


def inject_hard_keep(base: str, rng: random.Random, pos_bin: str) -> tuple[str, str, dict] | None:
    """Near-homophone surface that IS correct (ref==cur) at HEAD/MID — hard KEEP."""
    chars = cjk_chars(base)
    if len(chars) < 8:
        return None
    # Use rare-ish valid char already in text; no corruption
    if pos_bin == "HEAD":
        idx = rng.randint(0, min(3, len(chars) - 1))
    else:
        idx = rng.randint(len(chars) // 4, max(len(chars) // 4 + 1, 3 * len(chars) // 4))
    idx = min(idx, len(chars) - 1)
    # identical texts
    meta = {
        "ERROR_SHAPE": "CLEAN",
        "ERROR_RELATION": "NONE",
        "corruptionFamily": None,
        "expansionFamily": "HARD_KEEP_HEADMID",
        "targetPositionBin": pos_bin,
        "corruptions": [],
    }
    return base, base, meta


def finalize(ref: str, cur: str, meta: dict, rng: random.Random, sid: str) -> dict | None:
    spans = make_1char_spans(cur)
    if len(spans) < 4:
        return None
    # Mark a domain-like 2-char anchor away from corruption when possible
    # Prefer early 2-gram of CJK that doesn't overlap corruption
    cs = (meta.get("corruptions") or [{}])[0].get("spanStart", -1)
    ce = (meta.get("corruptions") or [{}])[0].get("spanEnd", -1)
    chars = cjk_chars(cur)
    for i in range(len(chars) - 1):
        a, ca = chars[i]
        b, cb = chars[i + 1]
        if b != a + 1:
            continue
        if cs >= 0 and not (b < cs or a >= ce):
            continue
        mark_anchor(spans, cur, ca + cb)
        break
    split = assign_split(sid)
    bucket = meta.get("expansionFamily") or "EXPANSION"
    sample = build_sample(ref, cur, spans, meta, sid, split, bucket)
    errs = validate_sample(sample)
    if errs:
        return None
    # Require at least one RETRY for error families
    n_retry = sum(1 for s in sample["spans"] if s.get("label") == "RETRY")
    if meta.get("expansionFamily", "").startswith("HARD_KEEP"):
        if n_retry > 0:
            return None
    else:
        if n_retry < 1:
            return None
        # Position check: at least one RETRY with rel_pos < 0.75
        n = len(sample["spans"])
        ok_pos = False
        for i, s in enumerate(sample["spans"]):
            if s.get("label") != "RETRY":
                continue
            rel = i / max(n - 1, 1)
            if meta.get("targetPositionBin") == "HEAD" and rel <= 0.35:
                ok_pos = True
            if meta.get("targetPositionBin") == "MID" and 0.2 <= rel <= 0.8:
                ok_pos = True
            if meta.get("targetPositionBin") == "TAIL" and rel >= 0.7:
                ok_pos = True
        if not ok_pos and meta.get("targetPositionBin") in ("HEAD", "MID"):
            return None
    return sample


def copy_v2_baseline(out_splits: dict[str, list], limits: dict[str, int] | None = None):
    """Include full V2 labeled corpus (preserve by copy into new identity)."""
    for split in ("train", "dev", "test"):
        n = 0
        for fp in sorted((V2 / split).glob("shard-*.jsonl")):
            with fp.open(encoding="utf-8") as f:
                for line in f:
                    if not line.strip():
                        continue
                    o = json.loads(line)
                    # leakage guard
                    blob = json.dumps(
                        {
                            "c": o.get("sourceCorpus"),
                            "id": o.get("sampleId"),
                            "t": o.get("currentText"),
                        },
                        ensure_ascii=False,
                    ).lower()
                    if "dialog_200" in blob or "dialog200" in blob:
                        continue
                    out_splits[split].append(o)
                    n += 1
                    if limits and n >= limits.get(split, 10**9):
                        break
            if limits and n >= limits.get(split, 10**9):
                break


def main():
    rng = random.Random(SEED)
    pool = load_pool(rng)
    print(f"pool={len(pool)}", flush=True)

    targets = {
        ("multi", "HEAD"): 800,
        ("multi", "MID"): 1200,
        ("phonetic", "HEAD"): 400,
        ("phonetic", "MID"): 600,
        ("insertion", "HEAD"): 300,
        ("insertion", "MID"): 400,
        ("hardkeep", "HEAD"): 500,
        ("hardkeep", "MID"): 700,
    }
    makers = {
        "multi": inject_multi_char,
        "phonetic": inject_phonetic,
        "insertion": inject_insertion,
        "hardkeep": inject_hard_keep,
    }

    new_samples: list[dict] = []
    stats = Counter()
    attempts = Counter()
    pi = 0
    for (kind, pos), need in targets.items():
        got = 0
        guard = 0
        while got < need and guard < need * 40:
            guard += 1
            attempts[f"{kind}_{pos}"] += 1
            base = pool[pi % len(pool)]
            pi += 1
            made = makers[kind](base, rng, pos)
            if not made:
                continue
            ref, cur, meta = made
            sid = f"m3v2rdx_{SEED}_{kind}_{pos}_{got:05d}"
            sample = finalize(ref, cur, meta, rng, sid)
            if not sample:
                stats[f"reject_{kind}_{pos}"] += 1
                continue
            new_samples.append(sample)
            got += 1
            stats[f"ok_{kind}_{pos}"] += 1
            if sample["split"] != "train":
                # force most expansion into train for coverage; re-split lightly
                pass
        print(f"{kind}/{pos}: got={got}/{need} attempts={guard}", flush=True)

    # Force 85% train for expansion samples
    for s in new_samples:
        h = int(hashlib.sha256(s["sampleId"].encode()).hexdigest(), 16) % 100
        s["split"] = "train" if h < 85 else ("dev" if h < 93 else "test")

    out_splits: dict[str, list] = {"train": [], "dev": [], "test": []}
    print("copying V2 baseline...", flush=True)
    copy_v2_baseline(out_splits)
    base_counts = {k: len(v) for k, v in out_splits.items()}
    for s in new_samples:
        out_splits[s["split"]].append(s)

    OUT.mkdir(parents=True, exist_ok=True)
    for sp in ("train", "dev", "test"):
        (OUT / sp).mkdir(parents=True, exist_ok=True)

    label_c = Counter()
    pos_retry = []
    fam_c = Counter()
    shard_size = 5000
    split_counts = Counter()
    for split, rows in out_splits.items():
        idx = 0
        for i in range(0, len(rows), shard_size):
            chunk = rows[i : i + shard_size]
            p = OUT / split / f"shard-{idx:05d}.jsonl"
            with p.open("w", encoding="utf-8") as f:
                for row in chunk:
                    for spn in row.get("spans") or []:
                        label_c[spn.get("label")] += 1
                        if spn.get("label") == "RETRY":
                            n = len(row["spans"])
                            # approximate index among spans list
                            j = next(
                                (
                                    k
                                    for k, x in enumerate(row["spans"])
                                    if x is spn or x.get("spanId") == spn.get("spanId")
                                ),
                                0,
                            )
                            pos_retry.append(j / max(n - 1, 1))
                            fam = (row.get("pilotMeta") or {}).get("expansionFamily") or (
                                "BASELINE_V2"
                                if row.get("sourceCorpus") != "model3_v2_realdist_expansion_v1"
                                else "EXPANSION"
                            )
                            if row.get("sourceCorpus") == "model3_v2_realdist_expansion_v1":
                                fam_c[fam] += 1
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
            idx += 1
            split_counts[split] += len(chunk)

    def pstat(arr):
        if not arr:
            return {}
        a = sorted(arr)
        return {
            "n": len(a),
            "p10": a[int(0.1 * (len(a) - 1))],
            "p50": a[int(0.5 * (len(a) - 1))],
            "p90": a[int(0.9 * (len(a) - 1))],
            "mean": sum(a) / len(a),
        }

    # Expansion-only RETRY positions
    exp_pos = []
    for s in new_samples:
        n = len(s["spans"])
        for i, sp in enumerate(s["spans"]):
            if sp.get("label") == "RETRY":
                exp_pos.append(i / max(n - 1, 1))

    manifest = {
        "datasetId": DATASET_ID,
        "datasetVersion": DATASET_VERSION,
        "labelContractVersion": LABEL_CONTRACT_VERSION,
        "generatorVersion": GEN_VERSION,
        "seed": SEED,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "baseDataset": "MODEL3_V2_LABELED",
        "baseSampleCounts": base_counts,
        "newSamples": len(new_samples),
        "expansionPercent": 100.0 * len(new_samples) / max(sum(base_counts.values()), 1),
        "splitCounts": dict(split_counts),
        "labelDistribution": dict(label_c),
        "newSampleBuildStats": dict(stats),
        "expansionRetryPosition": pstat(exp_pos),
        "allRetryPositionApprox": pstat(pos_retry),
        "expansionFamilyRetrySpans": dict(fam_c),
        "targets": {f"{k[0]}_{k[1]}": v for k, v in targets.items()},
        "v2BaselinePreserved": True,
        "v2CheckpointPreserved": "MODEL3_V2_REGION_LABEL_V1",
        "dialog200Leakage": 0,
        "notes": [
            "Targeted HEAD/MID RETRY position coverage for MULTI_CHAR / INSERTION / PHONETIC",
            "HARD_KEEP HEAD/MID contrast included",
            "No dialog_200 utterances",
        ],
    }
    (OUT / "dataset_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
