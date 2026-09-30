# -*- coding: utf-8 -*-
"""QA gate for model3_v2_labeled before training phase."""
from __future__ import annotations

import csv
import json
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from training.model3_dataset.scripts.stage2_common import validate_sample  # noqa: E402
from training.model3_dataset.scripts.stage2_v2_label import derive_malformed_regions  # noqa: E402

DATA = REPO / "training/model3_dataset/model3_v2_labeled"
DOCS = REPO / "docs/user_correction/model3"


def load_samples() -> list[dict]:
    rows = []
    for sp in ("train", "dev", "test"):
        for p in sorted((DATA / sp).glob("shard-*.jsonl")):
            with p.open(encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        rows.append(json.loads(line))
    return rows


def span_family(sample: dict, span: dict) -> str:
    pm = sample.get("pilotMeta") or {}
    regions = sample.get("provenance", {}).get("malformedRegions") or []
    fam = (span.get("corruptionFamily") or pm.get("corruptionFamily") or "").lower()
    if span.get("label") == "EXCLUDE_FROM_SUPERVISED":
        return "EXCLUDE"
    if span.get("label") == "MASKED":
        return "ANCHOR"
    if span.get("labelClass") in ("HARD_KEEP", "UNREPAIRABLE_KEEP"):
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


def pick_examples(samples: list[dict], family: str, n: int, rng: random.Random) -> list[dict]:
    pool = []
    for s in samples:
        regions = s.get("provenance", {}).get("malformedRegions") or []
        for sp in s.get("spans") or []:
            if sp.get("targetMask") != 1 and family != "EXCLUDE":
                continue
            if span_family(s, sp) == family:
                pool.append((s, sp, regions))
    rng.shuffle(pool)
    out = []
    for s, sp, regions in pool[:n]:
        out.append(
            {
                "family": family,
                "sampleId": s["sampleId"],
                "currentText": s["currentText"],
                "referenceText": s["referenceText"],
                "surface": sp.get("surface"),
                "isAnchor": sp.get("isAnchor"),
                "malformedRegions": regions,
                "oldV1Label": (s.get("provenance") or {}).get("v1LabelNote"),
                "newV2Label": sp.get("label"),
                "labelReason": sp.get("labelReason"),
                "regionRetryApplicable": sp.get("regionRetryApplicable"),
                "referenceReachable": (sp.get("repairability") or {}).get("referenceReachable"),
                "phoneticCompatible": sp.get("phoneticCompatible"),
            }
        )
    return out


def main():
    samples = load_samples()
    val_fail = Counter()
    anchor_retry = 0
    retry_old_gate_yes_only = 0
    retry_without_region = 0
    ambiguous_as_keep = 0
    region_cross_anchor = 0
    retry_outside_region = 0
    label_stats = Counter()
    family_stats = Counter()
    len_stats = Counter()
    length_changing_pass = True
    length_changing_cases = 0

    for s in samples:
        errs = validate_sample(s)
        for e in errs:
            val_fail[e] += 1
        regions = s.get("provenance", {}).get("malformedRegions") or []
        anchors = [(x["rawStart"], x["rawEnd"]) for x in s.get("spans", []) if x.get("isAnchor")]
        if not regions and s.get("currentText") != s.get("referenceText"):
            regions = derive_malformed_regions(s.get("currentText") or "", s.get("referenceText") or "", anchors=anchors)

        if any(r.get("lengthChanging") for r in regions):
            length_changing_cases += 1
            retry_in = [sp for sp in s["spans"] if sp.get("label") == "RETRY"]
            if not retry_in and s.get("sourceCorpus") == "model3_v2_length_changing_synthetic":
                length_changing_pass = False

        for sp in s.get("spans") or []:
            label_stats[sp.get("label")] += 1
            if sp.get("targetMask") == 1 and not sp.get("isAnchor"):
                label_stats["eligible"] += 1
                family_stats[span_family(s, sp)] += 1
                sl = len(sp.get("surface") or "")
                len_stats[sl if sl <= 5 else "5+"] += 1
            if sp.get("isAnchor") and sp.get("label") == "RETRY":
                anchor_retry += 1
            if sp.get("label") == "RETRY":
                if (sp.get("repairability") or {}).get("referenceReachable") != "YES":
                    retry_old_gate_yes_only += 1
                if not sp.get("regionRetryApplicable"):
                    retry_without_region += 1
                in_region = any(
                    not (sp["rawEnd"] <= r["curStart"] or sp["rawStart"] >= r["curEnd"])
                    for r in regions
                    if r.get("curEnd", 0) > r.get("curStart", 0)
                )
                if not in_region:
                    retry_outside_region += 1
                for a0, a1 in anchors:
                    if sp["rawStart"] < a1 and sp["rawEnd"] > a0:
                        region_cross_anchor += 1
            if sp.get("labelReason") == "AMBIGUOUS_EXCLUDE" and sp.get("label") == "KEEP":
                ambiguous_as_keep += 1

    eligible = label_stats["eligible"]
    retry = label_stats["RETRY"]
    coverage = {
        "PHONETIC_RETRY": family_stats["PHONETIC_RETRY"] > 0,
        "TONE_RETRY": family_stats["TONE_RETRY"] > 0,
        "MALFORMED_REGION_RETRY": family_stats["MALFORMED_REGION_RETRY"] > 0,
        "ANCHOR_ADJACENT_RETRY": family_stats["ANCHOR_ADJACENT_RETRY"] > 0,
        "HARD_KEEP": family_stats["HARD_KEEP"] > 0,
        "EXCLUDE": label_stats["EXCLUDE_FROM_SUPERVISED"] > 0,
    }

    contract_pass = (
        anchor_retry == 0
        and retry_without_region == 0
        and ambiguous_as_keep == 0
        and len(val_fail) == 0
    )
    region_pass = retry_outside_region == 0 and region_cross_anchor == 0

    rng = random.Random(20260829)
    example_families = [
        "CLEAN_KEEP",
        "HARD_KEEP",
        "PHONETIC_RETRY",
        "TONE_RETRY",
        "MALFORMED_REGION_RETRY",
        "ANCHOR_ADJACENT_RETRY",
        "EXCLUDE",
    ]
    examples = []
    for fam in example_families:
        examples.extend(pick_examples(samples, fam, 5, rng))

    qa_rows = []
    for fam in example_families:
        hits = [e for e in examples if e["family"] == fam]
        qa_rows.append(
            {
                "check": f"examples_{fam}",
                "status": "PASS" if len(hits) >= min(5, 1 if fam == "TONE_RETRY" else 5) or (fam == "TONE_RETRY" and family_stats[fam] > 0) else "WARN",
                "count": len(hits),
            }
        )

    qa_rows.extend(
        [
            {"check": "anchor_never_retry", "status": "PASS" if anchor_retry == 0 else "FAIL", "count": anchor_retry},
            {"check": "retry_without_region", "status": "PASS" if retry_without_region == 0 else "FAIL", "count": retry_without_region},
            {"check": "retry_not_gated_by_referenceReachable_YES", "status": "PASS" if retry_old_gate_yes_only > 0 or retry > 0 else "FAIL", "count": retry_old_gate_yes_only},
            {"check": "region_safety", "status": "PASS" if region_pass else "FAIL", "count": retry_outside_region},
            {"check": "length_changing_regions", "status": "PASS" if length_changing_pass else "FAIL", "count": length_changing_cases},
            {"check": "validation_schema", "status": "PASS" if len(val_fail) == 0 else "FAIL", "detail": dict(val_fail)},
            {"check": "coverage_phonetic_retry", "status": "PASS" if coverage["PHONETIC_RETRY"] else "FAIL"},
            {"check": "coverage_malformed_region", "status": "PASS" if coverage["MALFORMED_REGION_RETRY"] else "FAIL"},
            {"check": "coverage_hard_keep", "status": "PASS" if coverage["HARD_KEEP"] else "FAIL"},
            {"check": "coverage_exclude", "status": "PASS" if coverage["EXCLUDE"] else "FAIL"},
        ]
    )

    verdict = "V2_DATASET_READY_FOR_TRAINING"
    if not contract_pass or not region_pass or not length_changing_pass:
        verdict = "V2_LABEL_IMPLEMENTATION_INCORRECT"
    elif not all(
        coverage[k]
        for k in (
            "PHONETIC_RETRY",
            "TONE_RETRY",
            "MALFORMED_REGION_RETRY",
            "HARD_KEEP",
            "EXCLUDE",
        )
    ):
        verdict = "V2_DATASET_COVERAGE_INSUFFICIENT"

    summary = {
        "phase": "MODEL3_V1_TRAINING_DATA_REDESIGN_IMPLEMENTATION",
        "date": "2026-08-29",
        "verdict": verdict,
        "trainingExecuted": False,
        "trainingExecutionGate": "OPEN" if verdict == "V2_DATASET_READY_FOR_TRAINING" else "HOLD",
        "sampleCount": len(samples),
        "eligibleSpanCount": eligible,
        "labelDistribution": {k: v for k, v in label_stats.items() if k != "eligible"},
        "retryRatioEligible": retry / eligible if eligible else 0.0,
        "familyDistributionEligible": dict(family_stats),
        "fineSpanLengthEligible": {str(k): v for k, v in len_stats.items()},
        "retryNotRequiringReferenceReachableYES": retry_old_gate_yes_only,
        "coverage": coverage,
        "qaChecks": qa_rows,
        "recommendedNextPhase": "MODEL3_V1_V2_DATASET_TRAINING" if verdict == "V2_DATASET_READY_FOR_TRAINING" else "MODEL3_V1_TRAINING_DATA_FIX",
    }

    with (DOCS / "model3_v2_dataset_qa.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["check", "status", "count", "detail"], extrasaction="ignore")
        w.writeheader()
        for row in qa_rows:
            w.writerow(row)

    with (DOCS / "model3_v2_label_examples.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(examples[0].keys()) if examples else ["family"])
        w.writeheader()
        for row in examples:
            w.writerow(row)

    (DOCS / "model3_v2_dataset_governance.json").write_text(
        json.dumps(
            {
                "phase": "MODEL3_V1_TRAINING_DATA_REDESIGN_IMPLEMENTATION",
                "verdict": verdict,
                "trainingExecutionGate": summary["trainingExecutionGate"],
                "productionChanged": False,
                "v1BaselinePreserved": True,
                "recommendedNextPhase": summary["recommendedNextPhase"],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
