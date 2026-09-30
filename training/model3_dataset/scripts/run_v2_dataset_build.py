# -*- coding: utf-8 -*-
"""Build Model3 V2 labeled dataset by relabeling V1 sources (no model training)."""
from __future__ import annotations

import argparse
import json
import hashlib
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.stage2_common import validate_sample  # noqa: E402
from training.model3_dataset.scripts.stage2_v2_label import (  # noqa: E402
    LABEL_CONTRACT_VERSION,
    derive_malformed_regions,
    label_spans_v2,
    relabel_sample_v2,
)

OUT = REPO / "training/model3_dataset/model3_v2_labeled"
DOCS = REPO / "docs/user_correction/model3"
DATASET_ID = "MODEL3_V2_LABELED"
DATASET_VERSION = "model3_v2_labeled_20260829"
GEN_VERSION = "model3-v2-dataset-build-1.0.0"
SHARD_SIZE = 5000

SOURCE_ROOTS = [
    REPO / "training/model3_dataset/model3_v1_anchor_contrast_full100k",
    REPO / "training/model3_dataset/model3_v1_real_distribution_retry_pilot",
    REPO / "training/model3_dataset/model3_v1_strict_contrast_reconstruction",
]


def iter_source_samples(root: Path):
    for split in ("train", "dev", "test"):
        d = root / split
        if not d.exists():
            continue
        for p in sorted(d.glob("shard-*.jsonl")):
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        yield json.loads(line), split, p.name, root.name


def is_dialog200(sample: dict) -> bool:
    blob = json.dumps(
        {
            "sourceCorpus": sample.get("sourceCorpus"),
            "sourceSampleId": sample.get("sourceSampleId"),
            "sampleId": sample.get("sampleId"),
            "heldOutAxes": sample.get("heldOutAxes"),
        },
        ensure_ascii=False,
    ).lower()
    return "dialog_200" in blob or "dialog200" in blob


def make_gap_fill_synthetic() -> list[dict]:
    """Minimal synthetic rows for TONE / EXCLUDE / deletion-gap coverage."""
    rows = []
    tone_case = {
        "sampleId": "m3v2syn_tone_001",
        "referenceText": "上下文出现缓存。核验对象:晒",
        "currentText": "上下文出现缓存。核验对象:赛",
        "spans": [
            {"spanId": "t0", "surface": "上", "rawStart": 0, "rawEnd": 1, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "上", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
            {"spanId": "t1", "surface": "赛", "rawStart": 13, "rawEnd": 14, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "晒", "phoneticCompatible": True, "repairability": {"referenceReachable": "NO"}, "corruptionFamily": "tone_substitution"},
        ],
        "pilotMeta": {"ERROR_SHAPE": "SINGLE_CHAR", "ERROR_RELATION": "PHONETIC", "corruptionFamily": "tone_substitution"},
    }
    exclude_case = {
        "sampleId": "m3v2syn_excl_001",
        "referenceText": "发票抬头开错了能重新开具电子发票吗",
        "currentText": "发票抬头开错了能重新开具电子发票吗",
        "spans": [
            {"spanId": "e0", "surface": "发", "rawStart": 0, "rawEnd": 1, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "发", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
            {"spanId": "e1", "surface": "票", "rawStart": 1, "rawEnd": 2, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "据", "phoneticCompatible": False, "repairability": {"referenceReachable": "UNKNOWN"}},
        ],
        "pilotMeta": {"ERROR_SHAPE": "AMBIGUOUS", "ERROR_RELATION": "UNKNOWN"},
    }
    deletion_case = {
        "sampleId": "m3v2syn_del_001",
        "referenceText": "请按上线计划执行后选生城流程",
        "currentText": "请按计划执行后选流程",
        "spans": [
            {"spanId": "d0", "surface": "请", "rawStart": 0, "rawEnd": 1, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "请", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
            {"spanId": "d1", "surface": "按", "rawStart": 1, "rawEnd": 2, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "按", "phoneticCompatible": False, "repairability": {"referenceReachable": "UNKNOWN"}},
        ],
        "pilotMeta": {"ERROR_SHAPE": "DELETION", "ERROR_RELATION": "NON_PHONETIC"},
    }
    for c in (tone_case, exclude_case, deletion_case):
        rows.append(
            {
                "schemaVersion": "MODEL3_TRAINING_SAMPLE_V1",
                "sampleId": c["sampleId"],
                "sourceSampleId": c["sampleId"],
                "sourceCorpus": "model3_v2_gap_fill_synthetic",
                "evidenceLevel": "SYNTHETIC_TEXT",
                "referenceText": c["referenceText"],
                "currentText": c["currentText"],
                "audioRef": None,
                "domainEvidence": {},
                "model2AnchorStatus": "UNAVAILABLE",
                "split": "test",
                "groupKeys": {"sourceSentenceId": c["sampleId"], "contrastGroupId": c["sampleId"], "splitGroupKey": c["sampleId"]},
                "heldOutAxes": ["V2_GAP_FILL_QC"],
                "featureAvailability": {"textContext": True, "pinyinTextDerived": True},
                "pilotMeta": c.get("pilotMeta"),
                "provenance": {"generatorVersion": GEN_VERSION, "source_type": "V2_GAP_FILL_SYNTHETIC"},
                "spans": c["spans"],
            }
        )
    return rows


def make_length_changing_synthetic() -> list[dict]:
    """Hand-built harness-shaped rows for mandatory length-changing region QA."""
    rows = []
    cases = [
        {
            "sampleId": "m3v2syn_lenchg_001",
            "referenceText": "请把文件发到项目里讨论",
            "currentText": "请把文件发到顺便向木李讨论",
            "spans": [
                {"spanId": "s0", "surface": "请", "rawStart": 0, "rawEnd": 1, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "请", "phoneticCompatible": False, "repairability": {"referenceReachable": "NO"}},
                {"spanId": "s1", "surface": "把", "rawStart": 1, "rawEnd": 2, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "把", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
                {"spanId": "s2", "surface": "文", "rawStart": 2, "rawEnd": 3, "isAnchor": True, "anchorSource": "DOMAIN", "referenceSurface": "文", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
                {"spanId": "s3", "surface": "件", "rawStart": 3, "rawEnd": 4, "isAnchor": True, "anchorSource": "DOMAIN", "referenceSurface": "件", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
                {"spanId": "s4", "surface": "发", "rawStart": 4, "rawEnd": 5, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "发", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
                {"spanId": "s5", "surface": "到", "rawStart": 5, "rawEnd": 6, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "到", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
                {"spanId": "s6", "surface": "顺", "rawStart": 6, "rawEnd": 7, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "项", "phoneticCompatible": True, "repairability": {"referenceReachable": "NO"}, "corruptionFamily": "multi_char_phonetic"},
                {"spanId": "s7", "surface": "便", "rawStart": 7, "rawEnd": 8, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "目", "phoneticCompatible": True, "repairability": {"referenceReachable": "NO"}, "corruptionFamily": "multi_char_phonetic"},
                {"spanId": "s8", "surface": "向", "rawStart": 8, "rawEnd": 9, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "里", "phoneticCompatible": False, "repairability": {"referenceReachable": "NO"}, "corruptionFamily": "multi_char_phonetic"},
                {"spanId": "s9", "surface": "木", "rawStart": 9, "rawEnd": 10, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "里", "phoneticCompatible": False, "repairability": {"referenceReachable": "NO"}, "corruptionFamily": "multi_char_phonetic"},
                {"spanId": "s10", "surface": "李", "rawStart": 10, "rawEnd": 11, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "里", "phoneticCompatible": False, "repairability": {"referenceReachable": "NO"}, "corruptionFamily": "multi_char_phonetic"},
                {"spanId": "s11", "surface": "讨", "rawStart": 11, "rawEnd": 12, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "讨", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
                {"spanId": "s12", "surface": "论", "rawStart": 12, "rawEnd": 13, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "论", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
            ],
            "pilotMeta": {"ERROR_SHAPE": "MULTI_CHAR", "ERROR_RELATION": "PHONETIC", "corruptionFamily": "multi_char_phonetic"},
        },
        {
            "sampleId": "m3v2syn_lenchg_002",
            "referenceText": "下午三点前把结论发群里",
            "currentText": "下午3点前把结论发群里",
            "spans": [
                {"spanId": "a0", "surface": "下", "rawStart": 0, "rawEnd": 1, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "下", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
                {"spanId": "a1", "surface": "午", "rawStart": 1, "rawEnd": 2, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "午", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
                {"spanId": "a2", "surface": "3", "rawStart": 2, "rawEnd": 3, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "三", "phoneticCompatible": False, "repairability": {"referenceReachable": "NO"}, "corruptionFamily": "orthographic_digit"},
                {"spanId": "a3", "surface": "点", "rawStart": 3, "rawEnd": 4, "isAnchor": False, "anchorSource": "NONE", "referenceSurface": "点", "phoneticCompatible": False, "repairability": {"referenceReachable": "YES"}},
            ],
            "pilotMeta": {"ERROR_SHAPE": "SINGLE_CHAR", "ERROR_RELATION": "NON_PHONETIC"},
        },
    ]
    for c in cases:
        base = {
            "schemaVersion": "MODEL3_TRAINING_SAMPLE_V1",
            "sampleId": c["sampleId"],
            "sourceSampleId": c["sampleId"],
            "sourceCorpus": "model3_v2_length_changing_synthetic",
            "evidenceLevel": "SYNTHETIC_TEXT",
            "referenceText": c["referenceText"],
            "currentText": c["currentText"],
            "audioRef": None,
            "domainEvidence": {},
            "model2AnchorStatus": "UNAVAILABLE",
            "split": "test",
            "groupKeys": {"sourceSentenceId": c["sampleId"], "contrastGroupId": c["sampleId"], "splitGroupKey": c["sampleId"]},
            "heldOutAxes": ["V2_LENGTH_CHANGING_QC"],
            "featureAvailability": {"textContext": True, "pinyinTextDerived": True},
            "pilotMeta": c.get("pilotMeta"),
            "provenance": {"generatorVersion": GEN_VERSION, "source_type": "V2_LENGTH_CHANGING_SYNTHETIC"},
            "spans": c["spans"],
        }
        rows.append(base)
    return rows


def classify_family(sample: dict, span: dict, regions: list[dict]) -> str:
    pm = sample.get("pilotMeta") or {}
    fam = (span.get("corruptionFamily") or pm.get("corruptionFamily") or "").lower()
    if span.get("label") == "EXCLUDE_FROM_SUPERVISED":
        return "EXCLUDE"
    if span.get("label") == "MASKED":
        return "ANCHOR"
    if span.get("labelClass") in ("HARD_KEEP", "UNREPAIRABLE_KEEP") or sample.get("trainingBucket") == "HARD_KEEP":
        return "HARD_KEEP"
    if span.get("label") != "RETRY":
        return "CLEAN_KEEP"
    if "tone" in fam:
        return "TONE_RETRY"
    if pm.get("ERROR_SHAPE") == "MULTI_CHAR" or any(r.get("lengthChanging") for r in regions):
        return "MALFORMED_REGION_RETRY"
    anchors = [(s["rawStart"], s["rawEnd"]) for s in sample.get("spans", []) if s.get("isAnchor")]
    s0, s1 = span["rawStart"], span["rawEnd"]
    for a0, a1 in anchors:
        if s1 == a0 or s0 == a1:
            return "ANCHOR_ADJACENT_RETRY"
    return "PHONETIC_RETRY"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-per-root", type=int, default=0, help="0 = all")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    for sp in ("train", "dev", "test"):
        (OUT / sp).mkdir(parents=True, exist_ok=True)

    relabel_stats = Counter()
    label_stats = Counter()
    family_stats = Counter()
    len_stats = Counter()
    val_fail = Counter()
    transition = Counter()
    sources = Counter()
    dialog_skipped = 0
    failed = Counter()
    shards: dict[str, list[dict]] = defaultdict(list)

    seen_ids: set[str] = set()

    for root in SOURCE_ROOTS:
        n = 0
        for sample, split, shard_name, root_name in iter_source_samples(root):
            if args.max_per_root and n >= args.max_per_root:
                break
            if is_dialog200(sample):
                dialog_skipped += 1
                continue
            sid = sample.get("sampleId") or ""
            if sid in seen_ids:
                continue
            seen_ids.add(sid)

            try:
                out, meta = relabel_sample_v2(sample)
            except Exception as e:
                failed[str(e.__class__.__name__)] += 1
                continue

            errs = validate_sample(out)
            for e in errs:
                val_fail[e] += 1
            if errs:
                failed["validation"] += 1
                continue

            if meta["changed_span_labels"]:
                relabel_stats["relabelled"] += 1
            else:
                relabel_stats["unchanged"] += 1

            for s in out["spans"]:
                label_stats[s["label"]] += 1
                if s.get("targetMask") == 1 and not s.get("isAnchor"):
                    label_stats["eligible"] += 1
                slen = len(s.get("surface") or "")
                len_stats[min(slen, 5) if slen <= 5 else "5+"] += 1
                fam = classify_family(out, s, meta["regions"])
                if s.get("targetMask") == 1:
                    family_stats[fam] += 1
                old = meta["old_labels"].get(s["spanId"])
                if old and old != s["label"]:
                    transition[f"{old}->{s['label']}"] += 1

            out["provenance"]["datasetVersion"] = DATASET_VERSION
            out["provenance"]["v2SourceRoot"] = root_name
            out["provenance"]["v2SourceShard"] = shard_name
            sources[root_name] += 1
            shards[split].append(out)
            n += 1

    for syn in make_length_changing_synthetic() + make_gap_fill_synthetic():
        out, meta = relabel_sample_v2(syn)
        if validate_sample(out):
            failed["synthetic_validation"] += 1
        else:
            relabel_stats["synthetic_added"] += 1
            for s in out["spans"]:
                label_stats[s["label"]] += 1
                fam = classify_family(out, s, meta["regions"])
                if s.get("targetMask") == 1:
                    family_stats[fam] += 1
            shards["test"].append(out)

    shard_idx = {"train": 0, "dev": 0, "test": 0}
    split_counts = Counter()
    for split, rows in shards.items():
        for i in range(0, len(rows), SHARD_SIZE):
            chunk = rows[i : i + SHARD_SIZE]
            p = OUT / split / f"shard-{shard_idx[split]:05d}.jsonl"
            with p.open("w", encoding="utf-8") as f:
                for row in chunk:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
            shard_idx[split] += 1
            split_counts[split] += len(chunk)

    eligible = label_stats["eligible"]
    retry = label_stats["RETRY"]
    manifest = {
        "datasetId": DATASET_ID,
        "datasetVersion": DATASET_VERSION,
        "labelContractVersion": LABEL_CONTRACT_VERSION,
        "generatorVersion": GEN_VERSION,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceRoots": [str(p.name) for p in SOURCE_ROOTS],
        "sampleCount": sum(split_counts.values()),
        "splitCounts": dict(split_counts),
        "relabelStats": dict(relabel_stats),
        "dialog200Excluded": dialog_skipped,
        "failed": dict(failed),
        "validationFailures": dict(val_fail),
        "labelDistribution": {k: v for k, v in label_stats.items() if k != "eligible"},
        "eligibleSpanCount": eligible,
        "retryRatioEligible": retry / eligible if eligible else 0.0,
        "familyDistributionEligible": dict(family_stats),
        "fineSpanLengthEligible": {str(k): v for k, v in len_stats.items()},
        "labelTransitions": dict(transition),
        "sourceSampleCounts": dict(sources),
        "v1BaselinePreserved": "MODEL3_SYNTHETIC_V1 seed_2026082520",
        "notes": [
            "V2 region supervision; phoneticCompatible and referenceReachable are not RETRY gates",
            "dialog_200 held out",
            "No model training in this phase",
        ],
    }
    (OUT / "dataset_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (DOCS / "model3_v2_dataset_summary.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
