# -*- coding: utf-8 -*-
"""QA gate for model3_v1_synthetic_100k before training."""
from __future__ import annotations

import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.stage2_common import validate_sample

DATA = REPO / "training/model3_dataset/model3_v1_synthetic_100k"
DOCS = REPO / "docs/user_correction/model3"
SIDECAR = DATA / "anchor_provenance_sidecar.jsonl"


def load_samples() -> list[dict]:
    rows = []
    for sp in ("train", "dev", "test"):
        for p in sorted((DATA / sp).glob("shard-*.jsonl")):
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        rows.append(json.loads(line))
    return rows


def load_sidecar() -> dict[str, dict]:
    m = {}
    if not SIDECAR.exists():
        return m
    with SIDECAR.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            o = json.loads(line)
            m[o["sampleId"]] = o
    return m


def main():
    samples = load_samples()
    sidecar = load_sidecar()
    val_fail = Counter()
    anchor_retry = 0
    retry_no_yes = 0
    fake_acoustic = 0
    dialog200 = 0
    label_stats = Counter()
    anchor_buckets = Counter()
    corruption_families = Counter()
    repair_stats = Counter()
    split_groups = {sp: set() for sp in ("train", "dev", "test")}
    contrast_groups = {sp: set() for sp in ("train", "dev", "test")}
    surface_pairs = {sp: set() for sp in ("train", "dev", "test")}

    for s in samples:
        errs = validate_sample(s)
        for e in errs:
            val_fail[e] += 1
        if "dialog_200" in (s.get("sourceCorpus") or "").lower():
            dialog200 += 1
        fa = s.get("featureAvailability") or {}
        if fa.get("toneAcoustic") or fa.get("asrConfidence"):
            fake_acoustic += 1
        for sp in s.get("spans") or []:
            label_stats[sp.get("label")] += 1
            if sp.get("isAnchor") and sp.get("label") == "RETRY":
                anchor_retry += 1
            if sp.get("label") == "RETRY" and (sp.get("repairability") or {}).get("referenceReachable") != "YES":
                retry_no_yes += 1
            if sp.get("label") == "RETRY":
                repair_stats["RETRY"] += 1
            if sp.get("targetMask") == 1 and not sp.get("isAnchor"):
                repair_stats["eligible_non_anchor"] += 1
            fam = sp.get("corruptionFamily")
            if fam:
                corruption_families[fam] += 1
        sc = sidecar.get(s["sampleId"], {})
        anchor_buckets[sc.get("anchorDietBucket", "UNKNOWN")] += 1
        split_groups[s["split"]].add(s["groupKeys"]["sourceSentenceId"])
        contrast_groups[s["split"]].add(s["groupKeys"].get("contrastGroupId"))
        spk = s["groupKeys"].get("surfacePairKey")
        if spk:
            surface_pairs[s["split"]].add(spk)

    leak = {
        "sourceSentenceId_leakage": {
            "train_dev": len(split_groups["train"] & split_groups["dev"]),
            "train_test": len(split_groups["train"] & split_groups["test"]),
            "dev_test": len(split_groups["dev"] & split_groups["test"]),
        },
        "contrastGroupId_leakage": {
            "train_dev": len(contrast_groups["train"] & contrast_groups["dev"]),
            "train_test": len(contrast_groups["train"] & contrast_groups["test"]),
            "dev_test": len(contrast_groups["dev"] & contrast_groups["test"]),
        },
        "surfacePairKey_leakage": {
            "train_dev": len(surface_pairs["train"] & surface_pairs["dev"]),
            "train_test": len(surface_pairs["train"] & surface_pairs["test"]),
            "dev_test": len(surface_pairs["dev"] & surface_pairs["test"]),
        },
        "dialog_200": dialog200,
    }

    eligible = repair_stats["eligible_non_anchor"]
    retry_ratio = repair_stats["RETRY"] / eligible if eligible else 0.0
    anchor_utt = sum(1 for s in samples if any(x["isAnchor"] for x in s["spans"]))

    hard_neg = sum(
        1
        for s in samples
        for sp in s["spans"]
        if sp.get("label") == "KEEP"
        and sp.get("labelClass") in ("B", "D")
        and sp.get("targetMask") == 1
    )

    schema_pass = len(val_fail) == 0 and len(samples) > 0
    alignment_pass = val_fail.get("surface_mismatch", 0) == 0 and val_fail.get("bad_offset", 0) == 0
    split_pass = all(
        v == 0
        for k, grp in leak.items()
        if k.endswith("_leakage") and k != "surfacePairKey_leakage"
        for v in grp.values()
    )
    human_rows = []
    rng = random.Random(42)
    train_samples = [s for s in samples if s["split"] == "train"]
    pick = rng.sample(train_samples, min(500, len(train_samples)))
    for s in pick:
        sc = sidecar.get(s["sampleId"], {})
        n_retry = sum(1 for sp in s["spans"] if sp["label"] == "RETRY")
        n_anchor = sum(1 for sp in s["spans"] if sp["isAnchor"])
        human_rows.append(
            {
                "sampleId": s["sampleId"],
                "currentText": s["currentText"],
                "referenceText": s["referenceText"],
                "n_spans": len(s["spans"]),
                "n_retry": n_retry,
                "n_anchor": n_anchor,
                "anchorDietBucket": sc.get("anchorDietBucket"),
                "qa_notes": "",
            }
        )

    human_path = DOCS / "model3_v1_human_qa_500.csv"
    with human_path.open("w", encoding="utf-8-sig", newline="") as f:
        import csv

        w = csv.DictWriter(f, fieldnames=list(human_rows[0].keys()) if human_rows else ["sampleId"])
        w.writeheader()
        w.writerows(human_rows)

    validation = {
        "schema_pass": schema_pass,
        "alignment_pass": alignment_pass,
        "anchor_retry": anchor_retry,
        "retry_without_reachability_yes": retry_no_yes,
        "fake_acoustic": fake_acoustic,
        "dialog_200": dialog200,
        "split_leakage_zero": split_pass,
        "validation_fail_reasons": dict(val_fail),
        "sample_count": len(samples),
        "retry_ratio_eligible_non_anchor": round(retry_ratio, 6),
        "hard_negative_spans": hard_neg,
        "anchor_conditioned_utterances": anchor_utt,
        "human_qa_sample_count": len(human_rows),
    }

    gate_pass = (
        schema_pass
        and alignment_pass
        and anchor_retry == 0
        and retry_no_yes == 0
        and fake_acoustic == 0
        and dialog200 == 0
        and split_pass
        and len(samples) >= 90000
    )
    validation["gate_pass"] = gate_pass
    validation["human_qa"] = "PASS" if len(human_rows) >= 500 else "FAIL"

    (DOCS / "model3_v1_data_validation.json").write_text(
        json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_split_leakage_report.json").write_text(
        json.dumps(leak, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_label_distribution.json").write_text(
        json.dumps(dict(label_stats), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_anchor_distribution.json").write_text(
        json.dumps(
            {
                "utterance_anchor_conditioned": anchor_utt,
                "utterance_no_anchor": len(samples) - anchor_utt,
                "sidecar_buckets": dict(anchor_buckets),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (DOCS / "model3_v1_corruption_distribution.json").write_text(
        json.dumps(dict(corruption_families), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_repairability_distribution.json").write_text(
        json.dumps(dict(repair_stats), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (DOCS / "model3_v1_dataset_distribution.json").write_text(
        json.dumps(
            {
                "total": len(samples),
                "train": sum(1 for s in samples if s["split"] == "train"),
                "dev": sum(1 for s in samples if s["split"] == "dev"),
                "test": sum(1 for s in samples if s["split"] == "test"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(json.dumps({"gate_pass": gate_pass, **validation}, ensure_ascii=False, indent=2))
    return 0 if gate_pass else 1


if __name__ == "__main__":
    raise SystemExit(main())
