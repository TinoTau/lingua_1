# Lingua Model3 V1 — Real-Distribution RETRY Pilot Dataset

**Phase:** `MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_DATASET`  
**Date:** 2026-08-28  
**Result:** **PASS_WITH_LIMITATIONS**  
**Mode:** Dataset generation + validation ONLY (no training)

---

## Dataset Identity

| Field | Value |
|-------|-------|
| Dataset ID | `MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT` |
| Version | `model3_v1_real_distribution_retry_pilot_20260828` |
| New RETRY positives | **3000** |
| Hard KEEP near (in pilot) | 0 |
| Reused HARD_KEEP pointers | 2500 |
| Reused NATURAL_KEEP pointers | 2500 |
| Reused NO_ANCHOR pointers | 1500 |
| Total training-pool candidates | 9500 |
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
| Frozen spans | **153** |
| Dynamic recalculation | **NO** |

---

## RETRY Distribution (selected)

### ERROR_SHAPE
| Shape | Count | % of RETRY samples |
|-------|------:|-------------------:|
| SINGLE_CHAR | 1260 | 42.0 |
| MULTI_CHAR | 1440 | 48.0 |
| INSERTION | 180 | 6.0 |
| DELETION | 120 | 4.0 |

### ERROR_RELATION
| Relation | Count |
|----------|------:|
| PHONETIC | 3000 |
| NON_PHONETIC | 0 |
| UNKNOWN | 0 |

### Corruption-region length (QA metadata)
| Len | Count | % |
|-----|------:|--:|
| 1 | 1260 | 42.0 |
| 2 | 831 | 27.7 |
| 3 | 568 | 18.93 |
| 4+ | 341 | 11.37 |

### FineSpan.surface length (actual Model3 span input)
| Len | Count | % |
|-----|------:|--:|
| 1 | 5690 | 100.0 |
| 2 | 0 | 0.0 |
| 3 | 0 | 0.0 |
| 4+ | 0 | 0.0 |

---

## Coverage vs Synthetic V1 Gap

| Capability | Status |
|------------|--------|
| Phonetic coverage expanded | YES (broader lexicon-tone inject + multi-char phonetic/swap) |
| Multi-char corruption RETRY | **YES** (1440 samples) |
| Multi-char FineSpan.surface | **NO** (frozen harness limitation; Full100K also 0) |
| Insertion coverage | YES (180) |
| Deletion coverage | YES via existing FineSpan RETRY (120); rejected gap-only = 0 |
| Character-form RETRY | **0** |
| Gap-detection semantics | **NO** |

---

## Quality

| Check | Result |
|-------|--------|
| Valid Anchor on RETRY samples | PASS |
| Target NON-ANCHOR | PASS |
| Label leakage into feat builder | **0** |
| Exact duplicates dropped | 278 |
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
