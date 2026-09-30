# Lingua Model3 V1 — ASR Postprocess Retry-Region Correction Report

**Phase:** `MODEL3_V1_ASR_POSTPROCESS_RETRY_REGION_CORRECTION`  
**Date:** 2026-08-28  
**Result:** **PASS_WITH_LIMITATIONS**

---

## Summary

Implemented bounded **retry-region** interpretation in ASR postprocess. Model3, FineSpan, Recall, Assembly, and Domain Vote architectures remain frozen.

| Component | Changed |
|-----------|---------|
| Model3 output / checkpoint / features | NO |
| FineSpan architecture | NO |
| Recall architecture | NO |
| Assembly architecture | NO |
| ASR postprocess RETRY interpretation | YES |

---

## RETRY semantics (SSOT)

**Old:** `RETRY(spanId)` → `recallSpanTopKV2` on **current** FineSpan bounds (boundary-locked, per-span independent).

**New:** `RETRY(spanId)` → ASR postprocess derives **bounded retry region(s)** (adjacent RETRY merge allowed) → **local lattice re-segmentation** on region slice → **existing** `recallSpanTopKV2` per local span → **replace** region candidates in pool (not append second path).

Model3 still emits only `KEEP | RETRY` per spanId.

---

## Implementation (minimal)

| File | Role |
|------|------|
| `model3-retry-region.ts` | Region derivation + adjacent merge |
| `model3-retry-region-resegment.ts` | Local lattice re-segmentation on slice |
| `model3-retry-router.ts` | Region-based replace + trace |
| `run-model3-path-step.ts` | Wire lattice deps + diagnostics |
| `model3-retry-region.test.ts` | §30–38 unit tests |

---

## Invariants (verified)

| Invariant | Status |
|-----------|--------|
| Model3 once per path | PASS |
| Retry once (no recursion) | PASS |
| Domain Vote once | PASS |
| Anchor protected | PASS |
| Per-span budget | PASS |
| Global ≤16 (unchanged KenLM cap) | PASS |
| No ASR rerun | PASS |
| No second Domain Vote | PASS |

---

## Real cases (16 unique / 17 rows)

| Class | Before | After |
|-------|-------:|------:|
| SUFFICIENT | 3 | 3 |
| PARTIALLY_SUFFICIENT | 4 | 10 |
| SEGMENTATION_LOCKED | 6 | 0 |
| NO_REPAIRABLE_TARGET | 3 | 3 |

**Segmentation-locked reduced:** YES (mechanism unblocked; full rescue still needs Model3 RETRY + lexicon/training).

---

## Limitations

1. **PathFineSpan[] unchanged** — pool assignment still uses original span bounds; multi-char local spans fan out per-char when lengths align.
2. **Model2** — not forced in retry path; base/domain Recall only (`NOT_REQUIRED` for this phase).
3. **dialog_200** — KEEP-only Model3 V1 may still show RETRY=0; no regression expected on KEEP path.
4. **Deletions** — `NO_REPAIRABLE_TARGET` unchanged (no gap fabrication).

---

## Recommended next phase

`MODEL3_V1_TRAINING_COVERAGE_FOR_PRODUCTION_FINESPAN_FORMS` — after postprocess correction validated; pilot remains **HOLD_MULTIPLE_GAPS**.

---

## Artifacts (5)

1. This report  
2. `model3_v1_retry_region_correction_validation.json`  
3. `model3_v1_retry_region_real_cases.csv`  
4. `model3_v1_retry_region_correction_governance.json`  
5. Updated `MODEL3_V1_MAINLINE_INTEGRATION_ROLLBACK_MANIFEST.json`
