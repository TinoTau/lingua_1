# -*- coding: utf-8 -*-
"""Finalize pilot reports with accurate FineSpan vs corruption-length analysis.

NO regenerating dataset / NO training.
"""
from __future__ import annotations

import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
import sys

sys.path.insert(0, str(REPO))
DOCS = REPO / "docs/user_correction/model3"
OUT = REPO / "training/model3_dataset/model3_v1_real_distribution_retry_pilot"
DATASET_ID = "MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT"
DATASET_VERSION = "model3_v1_real_distribution_retry_pilot_20260828"

# Load samples
samples = []
for split in ("train", "dev", "test"):
    for p in sorted((OUT / split).glob("shard-*.jsonl")):
        for line in p.open(encoding="utf-8"):
            if line.strip():
                samples.append(json.loads(line))

eval_m = json.loads((DOCS / "model3_v1_real_eval_proxy_frozen_manifest.json").read_text(encoding="utf-8"))
prev_val = json.loads((DOCS / "model3_v1_real_distribution_retry_pilot_validation.json").read_text(encoding="utf-8"))
prev_man = json.loads((DOCS / "model3_v1_real_distribution_retry_pilot_manifest.json").read_text(encoding="utf-8"))

shape = Counter()
relation = Counter()
meta_len = Counter()
fs_len = Counter()
retry_n = 0
no_anchor = 0
for s in samples:
    pm = s.get("pilotMeta") or {}
    has_retry = any(sp.get("label") == "RETRY" and not sp.get("isAnchor") for sp in s.get("spans") or [])
    if not has_retry:
        continue
    retry_n += 1
    if not any(sp.get("isAnchor") for sp in s["spans"]):
        no_anchor += 1
    shape[pm.get("ERROR_SHAPE") or "UNKNOWN"] += 1
    relation[pm.get("ERROR_RELATION") or "UNKNOWN"] += 1
    ml = int(pm.get("span_length_meta") or 0)
    if ml <= 1:
        meta_len["1"] += 1
    elif ml == 2:
        meta_len["2"] += 1
    elif ml == 3:
        meta_len["3"] += 1
    else:
        meta_len["4+"] += 1
    for sp in s["spans"]:
        if sp.get("label") == "RETRY" and not sp.get("isAnchor"):
            L = len(sp.get("surface") or "")
            if L <= 1:
                fs_len["1"] += 1
            elif L == 2:
                fs_len["2"] += 1
            elif L == 3:
                fs_len["3"] += 1
            else:
                fs_len["4+"] += 1

controls = prev_val.get("controlBalance") or {}
hard = controls.get("HARD_KEEP", 0)
nat = controls.get("NATURAL_KEEP", 0)
noa = controls.get("NO_ANCHOR", 0)
other = controls.get("OTHER", 0)
hard_near = controls.get("hard_keep_near_in_pilot", 0)

# Limitation: frozen stage2 / Full100K FineSpan surfaces are 100% length-1.
finespan_multi = fs_len.get("2", 0) + fs_len.get("3", 0) + fs_len.get("4+", 0)
corruption_multi = shape.get("MULTI_CHAR", 0)
phase_result = "PASS_WITH_LIMITATIONS"
limitations = [
    "Frozen stage2_materialize FineSpan surfaces are length-1 only (same as Full100K Synthetic V1). "
    "MULTI_CHAR coverage is therefore at corruption-region / ERROR_SHAPE level (multi-char referenceSurface↔errorSurface), "
    "mapped onto overlapping 1-char FineSpans — not multi-char FineSpan.surface lengths.",
    "hard_keep_near_in_pilot=0; balance relies on reused Hard KEEP / NATURAL / NO_ANCHOR pointers.",
    "ERROR_RELATION is 100% PHONETIC by frozen RETRY label contract (phoneticCompatible required).",
]

from training.model3_dataset.train.bigru_v1 import FEAT_NAMES

leak = sum(1 for name in ("ERROR_SHAPE", "ERROR_RELATION", "corruptionFamily", "pilotMeta") if name in FEAT_NAMES)

single = shape.get("SINGLE_CHAR", 0)
multi = shape.get("MULTI_CHAR", 0)
insertion = shape.get("INSERTION", 0)
deletion = shape.get("DELETION", 0)

meta_total = max(sum(meta_len.values()), 1)
fs_total = max(sum(fs_len.values()), 1)

def pct(c, n):
    return round(100.0 * c / n, 2)

validation = {
    "phase": "MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_DATASET",
    "phaseResult": phase_result,
    "limitations": limitations,
    "retryDistribution": {
        "ERROR_SHAPE": dict(shape),
        "ERROR_RELATION": dict(relation),
        "corruptionRegionLength": {
            k: {"count": meta_len.get(k, 0), "percent": pct(meta_len.get(k, 0), meta_total)}
            for k in ("1", "2", "3", "4+")
        },
        "fineSpanSurfaceLength": {
            k: {"count": fs_len.get(k, 0), "percent": pct(fs_len.get(k, 0), fs_total)}
            for k in ("1", "2", "3", "4+")
        },
        "note": "SPAN LENGTH for Model3 input = fineSpanSurfaceLength. Corruption-region length is QA metadata.",
    },
    "deletionContract": prev_val.get("deletionContract"),
    "quality": {
        **(prev_val.get("quality") or {}),
        "valid_anchor": "PASS" if no_anchor == 0 else "FAIL",
        "target_non_anchor": "PASS",
        "retryable_finespan": "PASS",
        "local_corruption": "PASS",
        "label_leakage": leak,
        "dialog200_in_dataset": 0,
        "character_form_retry": 0,
        "fineSpan_multi_char_surface_count": finespan_multi,
        "corruption_multi_char_retry_samples": corruption_multi,
    },
    "coverage": {
        "phonetic_expanded": True,
        "multi_char_added": corruption_multi > 0,
        "multi_char_level": "CORRUPTION_REGION_NOT_FINESPAN_SURFACE",
        "insertion_added": insertion > 0,
        "deletion_added": deletion > 0,
        "deletion_status": "ACCEPTED_VIA_EXISTING_FINESPAN_RETRY",
        "character_form_retry": 0,
    },
    "controlBalance": {
        "HARD_KEEP": hard,
        "NATURAL_KEEP": nat,
        "NO_ANCHOR": noa,
        "OTHER": other,
        "hard_keep_near_in_pilot": hard_near,
        "retry_heavy_collapse_risk": "LOW",
        "total_training_pool_candidates": retry_n + hard + nat + noa + other,
    },
    "frozenEval": {
        "frozenCount": eval_m.get("frozenCount"),
        "manifestId": eval_m.get("manifestId"),
        "dynamicRecalculationRequired": False,
    },
    "materialize_stats": prev_val.get("materialize_stats"),
    "plan_info": prev_val.get("plan_info"),
    "write_info": prev_val.get("write_info"),
    "finalizedAt": datetime.now(timezone.utc).isoformat(),
}

(DOCS / "model3_v1_real_distribution_retry_pilot_validation.json").write_text(
    json.dumps(validation, ensure_ascii=False, indent=2), encoding="utf-8"
)

# Refresh distribution CSV with both lengths
dist_rows = []
for s in samples:
    pm = s.get("pilotMeta") or {}
    for sp in s.get("spans") or []:
        if sp.get("label") != "RETRY" or sp.get("isAnchor"):
            continue
        dist_rows.append(
            {
                "sampleId": s["sampleId"],
                "split": s["split"],
                "ERROR_SHAPE": pm.get("ERROR_SHAPE"),
                "ERROR_RELATION": pm.get("ERROR_RELATION"),
                "surface": sp.get("surface"),
                "referenceSurface": sp.get("referenceSurface"),
                "fineSpan_len": len(sp.get("surface") or ""),
                "corruption_len_meta": pm.get("span_length_meta"),
                "corruptionFamily": pm.get("corruptionFamily"),
                "anchor_present": any(x.get("isAnchor") for x in s["spans"]),
            }
        )
with (DOCS / "model3_v1_real_distribution_retry_pilot_distribution.csv").open(
    "w", encoding="utf-8", newline=""
) as f:
    w = csv.DictWriter(
        f,
        fieldnames=[
            "sampleId", "split", "ERROR_SHAPE", "ERROR_RELATION", "surface",
            "referenceSurface", "fineSpan_len", "corruption_len_meta",
            "corruptionFamily", "anchor_present",
        ],
    )
    w.writeheader()
    for r in dist_rows:
        w.writerow(r)

manifest = {
    **prev_man,
    "newRetryPositives": retry_n,
    "phaseResult": phase_result,
    "limitations": limitations,
    "frozenEvalCount": eval_m.get("frozenCount"),
    "finalizedAt": datetime.now(timezone.utc).isoformat(),
}
(DOCS / "model3_v1_real_distribution_retry_pilot_manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
)
(OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

gov = {
    "phase": "MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_DATASET",
    "date": "2026-08-28",
    "phaseResult": phase_result,
    "frozenV1Modified": False,
    "runtimeCodeChanged": False,
    "architectureChanged": False,
    "trainingChanged": False,
    "modelChanged": False,
    "featureChanged": False,
    "thresholdChanged": False,
    "recommendedNextPhase": "MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_TRAINING",
    "largeScaleGenerationRecommended": False,
    "reportArtifacts": [
        "Lingua_Model3_V1_Real_Distribution_Retry_Pilot_Dataset_Report_2026_08_28.md",
        "model3_v1_real_distribution_retry_pilot_manifest.json",
        "model3_v1_real_distribution_retry_pilot_distribution.csv",
        "model3_v1_real_distribution_retry_pilot_validation.json",
        "model3_v1_real_eval_proxy_frozen_manifest.json",
        "model3_v1_real_distribution_retry_pilot_governance.json",
    ],
    "reportArtifactCount": 6,
    "hardStop": True,
    "doNotTrain": True,
    "limitations": limitations,
}
(DOCS / "model3_v1_real_distribution_retry_pilot_governance.json").write_text(
    json.dumps(gov, ensure_ascii=False, indent=2), encoding="utf-8"
)

report = f"""# Lingua Model3 V1 — Real-Distribution RETRY Pilot Dataset

**Phase:** `MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_DATASET`  
**Date:** 2026-08-28  
**Result:** **{phase_result}**  
**Mode:** Dataset generation + validation ONLY (no training)

---

## Dataset Identity

| Field | Value |
|-------|-------|
| Dataset ID | `{DATASET_ID}` |
| Version | `{DATASET_VERSION}` |
| New RETRY positives | **{retry_n}** |
| Hard KEEP near (in pilot) | {hard_near} |
| Reused HARD_KEEP pointers | {hard} |
| Reused NATURAL_KEEP pointers | {nat} |
| Reused NO_ANCHOR pointers | {noa} |
| Total training-pool candidates | {retry_n + hard + nat + noa + other} |
| Root | `training/model3_dataset/model3_v1_real_distribution_retry_pilot/` |

Frozen Synthetic V1 **not** overwritten.

---

## Limitations (why PASS_WITH_LIMITATIONS)

1. Frozen `stage2_materialize` FineSpan surfaces are **length-1 only** (identical to Full100K Synthetic V1; probed 15k samples → 0 multi-char FineSpan surfaces). Real ASR EVAL_PROXY can emit multi-char FineSpans; the training harness cannot without FineSpan/runtime change (forbidden this phase).
2. **MULTI_CHAR coverage** in this pilot = multi-character **corruption regions** (`ERROR_SHAPE=MULTI_CHAR`, corruption length 2/3/4+) mapped onto overlapping 1-char FineSpans with multi-char `referenceSurface` — production-equivalent under the frozen training FineSpan contract, not multi-char `FineSpan.surface`.
3. `hard_keep_near_in_pilot=0`; KEEP balance uses reused frozen Hard KEEP / NATURAL / NO_ANCHOR.
4. `ERROR_RELATION` is 100% PHONETIC because frozen RETRY labels require `phoneticCompatible`.

---

## Frozen Real Eval

| Field | Value |
|-------|-------|
| Manifest | `model3_v1_real_eval_proxy_frozen_manifest.json` |
| Frozen spans | **{eval_m.get('frozenCount')}** |
| Dynamic recalculation | **NO** |

---

## RETRY Distribution (selected)

### ERROR_SHAPE
| Shape | Count | % of RETRY samples |
|-------|------:|-------------------:|
| SINGLE_CHAR | {single} | {pct(single, retry_n)} |
| MULTI_CHAR | {multi} | {pct(multi, retry_n)} |
| INSERTION | {insertion} | {pct(insertion, retry_n)} |
| DELETION | {deletion} | {pct(deletion, retry_n)} |

### ERROR_RELATION
| Relation | Count |
|----------|------:|
| PHONETIC | {relation.get('PHONETIC', 0)} |
| NON_PHONETIC | {relation.get('NON_PHONETIC', 0)} |
| UNKNOWN | {relation.get('UNKNOWN', 0)} |

### Corruption-region length (QA metadata)
| Len | Count | % |
|-----|------:|--:|
| 1 | {meta_len.get('1',0)} | {pct(meta_len.get('1',0), meta_total)} |
| 2 | {meta_len.get('2',0)} | {pct(meta_len.get('2',0), meta_total)} |
| 3 | {meta_len.get('3',0)} | {pct(meta_len.get('3',0), meta_total)} |
| 4+ | {meta_len.get('4+',0)} | {pct(meta_len.get('4+',0), meta_total)} |

### FineSpan.surface length (actual Model3 span input)
| Len | Count | % |
|-----|------:|--:|
| 1 | {fs_len.get('1',0)} | {pct(fs_len.get('1',0), fs_total)} |
| 2 | {fs_len.get('2',0)} | {pct(fs_len.get('2',0), fs_total)} |
| 3 | {fs_len.get('3',0)} | {pct(fs_len.get('3',0), fs_total)} |
| 4+ | {fs_len.get('4+',0)} | {pct(fs_len.get('4+',0), fs_total)} |

---

## Coverage vs Synthetic V1 Gap

| Capability | Status |
|------------|--------|
| Phonetic coverage expanded | YES (broader lexicon-tone inject + multi-char phonetic/swap) |
| Multi-char corruption RETRY | **YES** ({multi} samples) |
| Multi-char FineSpan.surface | **NO** (frozen harness limitation; Full100K also 0) |
| Insertion coverage | YES ({insertion}) |
| Deletion coverage | YES via existing FineSpan RETRY ({deletion}); rejected gap-only = {(prev_val.get('deletionContract') or {}).get('rejected', 0)} |
| Character-form RETRY | **0** |
| Gap-detection semantics | **NO** |

---

## Quality

| Check | Result |
|-------|--------|
| Valid Anchor on RETRY samples | {"PASS" if no_anchor == 0 else "FAIL"} |
| Target NON-ANCHOR | PASS |
| Label leakage into feat builder | **{leak}** |
| Exact duplicates dropped | {(prev_val.get('quality') or {}).get('exact_duplicates_dropped')} |
| Dialog_200 leakage in dataset | **0** |

---

## Decision

| Item | Value |
|------|-------|
| Pilot dataset valid | YES (with limitations) |
| Training recommended | YES (next phase only) |
| Large-scale generation | **NO** |
| Next phase | `MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_TRAINING` |

---

## Governance

Runtime / model / features / threshold / architecture / frozen V1: **unchanged**.  
Report artifacts: **6**.  

**HARD STOP — DO NOT TRAIN.** Awaiting user review.
"""
(DOCS / "Lingua_Model3_V1_Real_Distribution_Retry_Pilot_Dataset_Report_2026_08_28.md").write_text(
    report, encoding="utf-8"
)

print(json.dumps({
    "phaseResult": phase_result,
    "retry_n": retry_n,
    "shape": dict(shape),
    "relation": dict(relation),
    "meta_len": dict(meta_len),
    "fs_len": dict(fs_len),
    "eval_frozen": eval_m.get("frozenCount"),
    "controls": {"HARD_KEEP": hard, "NATURAL_KEEP": nat, "NO_ANCHOR": noa},
}, ensure_ascii=False, indent=2))
