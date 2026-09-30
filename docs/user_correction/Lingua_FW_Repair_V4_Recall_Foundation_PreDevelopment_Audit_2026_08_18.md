# Lingua FW Repair V4 Recall Foundation Pre-Development Audit

**Date:** 2026-08-18  
**Phase:** RECALL_FOUNDATION_COMPLETION_V1 (Audit A/B/C)

**Artifacts:** `training/model2_v3/experiments/v3_stage_j_live_dialog200/recall_foundation_completion_2026_08_18/`

## Accounting

- True recall units: 405
- Accounting conserved: True
- 367 vs 345: EXPLAINED (True)
- 26 vs 4: EXPLAINED (True)
- Accounting gate: PASS

## Waterfall

```json
{
  "LEXICON_COVERAGE_GAP": 345,
  "EXPECTED_NON_CANDIDATE_RECOVERY": 22,
  "QUERY_GENERATION_GAP": 34,
  "SUCCESS_POST_BUDGET": 4
}
```

## Normalization

- Restore gate: PASS
- Restore existing OpenCC: YES

## Lexicon

- Single-char frozen design: CONFIRMED (FROZEN_DESIGN_DATA_MISSING)
- Authoritative single-char source: 2510 unique surfaces
- Lexicon completion gate: PASS

## Next (only if gates PASS)

1. Restore OpenCC at FW Repair entry (preserve raw ASR trace)
2. Import single-char base_lexicon via authoritative rebuild pipeline
3. Rebuild sqlite + real Node dialog_200 regression
