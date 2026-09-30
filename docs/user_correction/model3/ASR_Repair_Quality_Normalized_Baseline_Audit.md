# ASR Repair Quality Normalized Baseline Audit

Generated: 2026-09-10  
Phase: `ASR_REPAIR_QUALITY_NORMALIZED_BASELINE_AUDIT`  
Mode: READ_ONLY / OFFLINE  
RUN_ID: `dialog200_full_pipeline_20260909_001141`

## Verdict

`ASR_REPAIR_NORMALIZED_BASELINE_PASS_MAJOR_REINTERPRETATION`

## Two baselines (both kept)

| Baseline | Meaning | Status |
|----------|---------|--------|
| `LINGUA_DIALOG200_BASELINE_V1` | USER_VISIBLE end-to-end text quality | **FROZEN** (25→31, +6) |
| `LINGUA_ASR_REPAIR_NORMALIZED_BASELINE_V1` | ASR **content** repair after script/punct/ws norm | **NEW** |

```text
LINGUA_DIALOG200_BASELINE_V1 = USER_VISIBLE_END_TO_END_BASELINE
LINGUA_ASR_REPAIR_NORMALIZED_BASELINE_V1 = CONTENT_REPAIR_BASELINE
```

## Normalization (offline only)

```text
NFKC → OpenCC t→cn (opencc-js/t2cn, same as FW normalizeForFwRepairInput)
→ punctuation/whitespace strip (dialog200 norm)
→ Latin lowercase
```

Symmetric on RAW/FINAL/REFERENCE. No synonym/homophone equivalence.  
**Not wired into production runtime** (audit tooling under `docs/user_correction/model3/` only).

Synthetic tests: **PASS**

## Normalized metrics (200 / 200)

| Metric | Value |
|--------|------:|
| RAW_NORMALIZED_CORRECT | **31** |
| FINAL_NORMALIZED_CORRECT | **31** |
| NORMALIZED_NET_CORRECT_GAIN | **0** |
| RAW_NORMALIZED_CER | **0.1674** |
| FINAL_NORMALIZED_CER | **0.167** |
| NORMALIZED_CER_DELTA | **-0.0004** |
| ALREADY_CORRECT_NORMALIZED | 31 |
| ASR_REPAIR_FULL_RESCUE | **0** |
| ASR_REPAIR_PARTIAL_IMPROVEMENT | **2** |
| ASR_REPAIR_UNCHANGED | 167 |
| ASR_REPAIR_REGRESSED | **0** |
| NORMALIZATION_CHANGED (surface-only raw→final) | 64 |
| cases_with_raw_script_difference | 65 |
| cases_with_final_script_change | 64 |

REGRESSED_CASE_IDS: (none)

## Reinterpretation of V1 outcomes

| | Count |
|--|------:|
| Original FULL_RESCUE | 6 |
| → reclassified ALREADY_CORRECT_NORMALIZED | **6** |
| Original PARTIAL_IMPROVEMENT | 60 |
| → still ASR_REPAIR_PARTIAL_IMPROVEMENT | **2** |
| → reclassified ASR_REPAIR_UNCHANGED | **58** |
| Original improved (FULL+PARTIAL) | 66 |
| Normalized ASR repair improved (FULL+PARTIAL) | **2** |
| Improvements removed by normalization calibration | **64** |

## Original vs Normalized matrix

| original_outcome | normalized_repair_outcome | count |
|---|---|---:|
| UNCHANGED | ASR_REPAIR_UNCHANGED | 109 |
| PARTIAL_IMPROVEMENT | ASR_REPAIR_UNCHANGED | 58 |
| CORRECT_PRESERVED | ALREADY_CORRECT_NORMALIZED | 25 |
| FULL_RESCUE | ALREADY_CORRECT_NORMALIZED | 6 |
| PARTIAL_IMPROVEMENT | ASR_REPAIR_PARTIAL_IMPROVEMENT | 2 |

## Required answers

| # | Answer |
|---|--------|
| A | Of V1 exact +6: **0** are true ASR content full rescues; **6/6** FULL_RESCUE were already correct after script norm. `NORMALIZED_NET_CORRECT_GAIN` = **0** |
| B | **6/6** already correct in normalized space |
| C | Still true ASR_REPAIR_PARTIAL among original PARTIAL: **2** |
| D | PARTIAL that are normalization-only (→ UNCHANGED): **58** |
| E | Normalized regressions: **0** — IDs listed above |
| F | RAW_NORMALIZED_CORRECT = **31** |
| G | FINAL_NORMALIZED_CORRECT = **31** |
| H | NORMALIZED_NET_CORRECT_GAIN = **0** |
| I | CER 0.1674 → 0.167 (Δ -0.0004) |
| J | User-visible +6 remains real as presentation quality. True lexical/phonetic exact rescue gain is **0**; partial content distance improvement remains **2** cases (d084, d184); **0** content regressions were masked in V1 |
| K | **No** — only **2** true content partials remain; multi-error coverage is not the next bottleneck |
| L | ONE next: `ACTUAL_ASR_REPAIR_SUCCESS_FAILURE_TARGETED_AUDIT`（为何主链几乎不产生真实 lexical/phonetic correction） |

## Suggested (not frozen) normalized gates

```text
ASR_REPAIR_FULL_RESCUE >= 0
ASR_REPAIR_PARTIAL_IMPROVEMENT >= 2
ASR_REPAIR_REGRESSED <= 0
NORMALIZED_NET_CORRECT_GAIN >= 0
FINAL_NORMALIZED_CER <= 0.167
```

Do **not** replace V1 gates yet. Dual acceptance later.

## Freeze

```text
MODEL3 = KEEP FROZEN
RETRY_ARCHITECTURE = KEEP FROZEN
FULL_MAINLINE = KEEP FROZEN
LINGUA_DIALOG200_BASELINE_V1 = KEEP FROZEN
```

This phase is evaluation calibration only.
