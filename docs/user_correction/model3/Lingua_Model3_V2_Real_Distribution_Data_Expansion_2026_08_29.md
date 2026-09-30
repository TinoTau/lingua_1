# Lingua — Model3 V2 Real Distribution Data Expansion

**Phase:** MODEL3_V2_REAL_DISTRIBUTION_DATA_EXPANSION  
**Date:** 2026-08-29  
**New model trained:** NO  
**Architecture / label / feature contract changed:** NO

---

## MAIN VERDICT

| Field | Verdict |
|-------|---------|
| **Verdict** | **REAL_DISTRIBUTION_EXPANSION_READY** |
| **Primary gap** | **REAL_RETRY_FEATURE_COMBINATION_MISSING** |
| **Dataset expanded** | **YES** |
| **New model trained** | **NO** |
| **Next phase** | **MODEL3_V2_REALDIST_MODEL_TRAINING** (not executed) |

Confirmed gap is **not** “need arbitrary more data” and **not** feature-capacity failure. TRAIN RETRY FineSpans cluster at utterance **TAIL** while real HIGH RETRY FineSpans sit **HEAD/MID**, often in MULTI_CHAR / INSERTION-like local regions.

---

## FROZEN ARCHITECTURE

| Item | Status |
|------|--------|
| Architecture changed | **NO** |
| Label contract changed | **NO** (`MODEL3_LABEL_CONTRACT_V2_20260829`) |
| Feature contract changed | **NO** (same 6 dims) |

---

## REAL TARGET INVENTORY

| Group | Count |
|-------|------:|
| HIGH/MEDIUM RETRY-eligible cases | **13** |
| Real RETRY FineSpans analyzed | **13** (probe / primary path non-Anchor) |
| REAL KEEP controls | **6** |
| UNKNOWN mismatches (not used as GT) | 31 |

**Note:** `first_pass_cand_log1p` is **not persisted** in dialog_200 acceptance `span_margins`. Cand comparisons use train dumps only; real cand marked MISSING (does not block expansion — position/structure gap is independently proven).

---

## FEATURE DISTRIBUTION

### span_rel_position (critical)

| Group | n | p10 | p50 | p90 | mean |
|-------|--:|----:|----:|----:|-----:|
| TRAIN RETRY (V2) | 18302 | 0.47 | **1.00** | 1.00 | 0.84 |
| REAL RETRY | 13 | 0.05 | **0.34** | 0.65 | 0.33 |
| TRAIN KEEP (sample) | ~30k | — | mixed | — | — |
| REAL KEEP | 6 | 0.0* | 0.0* | 0.0* | 0.0* |

\*KEEP control extractor used first non-Anchor span (often index 0); not used as primary gap proof.

### Other features (TRAIN RETRY vs REAL RETRY)

| Feature | TRAIN RETRY | REAL RETRY | Gap? |
|---------|-------------|------------|------|
| isAnchor | 0 (eligible) | 0 | no |
| span_len_log1p | all ~0.693 (1-char) | all ~0.693 | no |
| current_cjk_len_log1p | all ~0.693 | all ~0.693 | no |
| pinyin_channel_avail | ~1.0 | 1.0 (assumed) | no |
| first_pass_cand_log1p | ~0.0 in sampled V2 | MISSING dump | inconclusive |

Full table: `model3_v2_real_train_feature_gap.csv`.

---

## IMPORTANT FEATURE COMBINATIONS

Combo key: `length | cand | pinyin | position`

| Combo | REAL RETRY | V2 TRAIN RETRY |
|-------|----------:|---------------:|
| L1\|C0\|P1\|POS_MID | 7 | 3590 (covered) |
| L1\|C0\|P1\|POS_HEAD | 6 | **17 (thin)** |

Independent feature dims look similar (all 1-char), but **position bin** is the discriminating combination vs training.

---

## PRIMARY DISTRIBUTION GAP

**Classification:** `REAL_RETRY_FEATURE_COMBINATION_MISSING`

**Evidence:**
1. Real HIGH families: MULTI_CHAR_REPLACEMENT=6, INSERTION=4, PHONETIC=3.
2. V2 TRAIN RETRY position p50=**1.0** (tail-heavy generation templates).
3. Real RETRY position p50=**0.34**.
4. HEAD combo only 17 train RETRY vs 6/13 real targets.
5. Existing 4 available scalar dims do **not** separate REAL RETRY from REAL KEEP alone — BiGRU sequence + position still provide capacity; **FEATURE_CAPACITY_REVIEW_REQUIRED = NO**.

---

## TARGETED EXPANSION

| Item | Value |
|------|------:|
| Original `MODEL3_V2_LABELED` | 114,418 |
| **Added samples** | **4,900** (+4.28%) |
| Total `MODEL3_V2_REALDIST_EXPANDED_V1` | **119,318** |
| New MULTI HEAD/MID | 2,000 |
| New PHONETIC HEAD/MID | 1,000 |
| New INSERTION HEAD/MID | 700 |
| New HARD KEEP HEAD/MID | 1,200 |

Expansion RETRY span positions: p50=**0.316**, mean=**0.325** (aligned with real).

No dialog_200 text. Structural patterns only.

Path: `training/model3_dataset/model3_v2_realdist_expanded_v1/`

---

## BEFORE / AFTER COVERAGE

| gap | before (V2) | after (expanded) | status |
|-----|-------------|------------------|--------|
| RETRY HEAD (pos≤0.35) | 41 / 18302 (**0.2%**), p50=1.0 | 5697 / 28414 (**20%**), p50=0.59 | **PASS** |
| RETRY MID (0.2–0.8) | 5517 | 12443 | **PASS** |
| MULTI_CHAR HEAD/MID family | TAIL-biased | +6518 RETRY spans | **PASS** |
| INSERTION HEAD/MID family | weak vs real mix | +2594 RETRY spans | **PASS** |
| HARD KEEP HEAD/MID contrast | — | +1200 samples | **PASS** |

Expansion-only RETRY: head=5656, mid=6926, p50=0.316.

---

## DATASET DISTRIBUTION

| Label | Count |
|-------|------:|
| KEEP | 2,218,643 |
| RETRY | 28,414 |
| MASKED | 104,651 |
| EXCLUDE | 1 |

Eligible RETRY ratio rises vs V2 labeled (~0.85% → ~1.2% order; not force-balanced). No class_weight / threshold changes.

---

## LEAKAGE CHECK

**dialog_200 training leakage: 0**

---

## V2 LABEL QA

| Check | Status |
|-------|--------|
| Anchor never RETRY | PASS |
| Label contract V2 unchanged | PASS |
| referenceReachable / phoneticCompatible not gates | PASS (unchanged materializer) |
| Schema validation (sampled) | PASS |

---

## BASELINES PRESERVED

| Artifact | Preserved |
|----------|-----------|
| `MODEL3_V2_LABELED` | **YES** |
| `MODEL3_V2_REGION_LABEL_V1` | **YES** |

New identity: `MODEL3_V2_REALDIST_EXPANDED_V1`.

---

## NEXT PHASE

**MODEL3_V2_REALDIST_MODEL_TRAINING**

Do not execute in this phase.

---

## Artifacts

1. This report  
2. `model3_v2_real_train_feature_gap.csv`  
3. `model3_v2_realdist_expansion_qa.csv`  
4. `model3_v2_realdist_expansion_summary.json`  
5. `model3_v2_realdist_expansion_governance.json`  

Supporting: `model3_v2_realdist_real_target_features.csv`

**STOP.**
