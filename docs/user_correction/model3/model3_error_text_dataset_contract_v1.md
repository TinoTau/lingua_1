# Model3 Error-Text Dataset Contract V1

**Status:** FROZEN (design)  
**Evidence level default:** `SYNTHETIC_TEXT`  
**Not a runtime rule table.**

## Purpose

Build reproducible **reference → phonetic corruption → error text** pairs for later Model3 training (with Anchor / evidence / Stage2 KEEP|RETRY labels).

## Schemas

- `ERROR_TEXT_SAMPLE_V1` — `model3_error_text_sample_v1_schema.json`
- `CORRUPTION_RECORD_V1` — `model3_corruption_record_v1_schema.json`

## Hard rules

1. Every corruption must be **phonetically explainable** (or tagged `isPhonetic=false` for orthographic track).
2. **No** random Hanzi / synonym / same-length swap.
3. **No** independent Model3 lexicon — offline replacement via existing authoritative lexical data only.
4. `expectedRepairClass` ≠ Model3 `KEEP`/`RETRY` (Stage2 owns labels).
5. Anchors for RETRY-oriented positives: do **not** corrupt intended Anchor spans; use `ANCHOR_CANDIDATE` vs `RUNTIME_CONFIRMED_ANCHOR` distinction; do **not** forge Model2 Anchors (`MODEL2_ANCHOR_UNAVAILABLE` OK).
6. Include `corruptionCount=0` CLEAN samples.
7. Support `contrastGroupId`.
8. Default train set **excludes** dialog_200 acceptance cases.

## Distributions

Retain both **natural** and **balanced research** subsets; do not pretend balanced = production.
