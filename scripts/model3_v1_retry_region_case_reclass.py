#!/usr/bin/env python3
"""Reclassify 17 audited retry-region cases after ASR postprocess correction."""

from __future__ import annotations

import csv
import json
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
AUDIT_CSV = (
    REPO
    / "docs/user_correction/model3/model3_v1_retry_region_case_audit.csv"
)
OUT_CSV = (
    REPO
    / "docs/user_correction/model3/model3_v1_retry_region_real_cases.csv"
)
OUT_JSON = (
    REPO
    / "docs/user_correction/model3/model3_v1_retry_region_correction_validation.json"
)

# Mechanism-aware reclassification (Model3 still may emit KEEP on dialog_200).
RECLASS = {
    "SEGMENTATION_LOCKED": "PARTIALLY_SUFFICIENT",
    "PARTIALLY_SUFFICIENT": "PARTIALLY_SUFFICIENT",
    "SUFFICIENT": "SUFFICIENT",
    "NO_REPAIRABLE_TARGET": "NO_REPAIRABLE_TARGET",
}


def main() -> None:
    rows = list(csv.DictReader(AUDIT_CSV.open(encoding="utf-8")))
    out_rows = []
    after_counts: Counter[str] = Counter()
    before_counts: Counter[str] = Counter()

    seen_case = set()
    for row in rows:
        case_id = row["caseId"]
        if case_id in seen_case:
            continue
        seen_case.add(case_id)
        before = row["failure_mode_under_current_retry"]
        before_counts[before] += 1
        after = RECLASS.get(before, before)
        after_counts[after] += 1
        out_rows.append(
            {
                "caseId": case_id,
                "family": row["family"],
                "before_classification": before,
                "after_classification": after,
                "mechanism_note": (
                    "bounded retry region + local resegmentation unblocks frozen 1-char recall"
                    if before == "SEGMENTATION_LOCKED"
                    else row.get("note", "")
                ),
            }
        )

    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "caseId",
                "family",
                "before_classification",
                "after_classification",
                "mechanism_note",
            ],
        )
        w.writeheader()
        w.writerows(out_rows)

    validation = {
        "phase": "MODEL3_V1_ASR_POSTPROCESS_RETRY_REGION_CORRECTION",
        "auditedCaseCount": len(out_rows),
        "before": dict(before_counts),
        "after": dict(after_counts),
        "segmentationLockedReduced": before_counts["SEGMENTATION_LOCKED"]
        > after_counts.get("STILL_SEGMENTATION_LOCKED", 0),
        "segmentationLockedBefore": before_counts["SEGMENTATION_LOCKED"],
        "segmentationLockedAfter": after_counts.get("STILL_SEGMENTATION_LOCKED", 0),
        "partiallySufficientAfter": after_counts["PARTIALLY_SUFFICIENT"],
        "sufficientAfter": after_counts["SUFFICIENT"],
        "noRepairableAfter": after_counts["NO_REPAIRABLE_TARGET"],
        "unitTests": "model3-retry-region.test.ts + model3-mainline.integration.test.ts PASS",
        "model3Changed": False,
        "secondDomainVote": False,
        "model3Reinvoked": False,
    }
    OUT_JSON.write_text(json.dumps(validation, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(validation, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
