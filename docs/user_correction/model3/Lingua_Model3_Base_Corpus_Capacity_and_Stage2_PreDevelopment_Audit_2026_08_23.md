# Lingua Model3 Base Corpus Capacity + Stage2 Pre-Development Audit

**Date:** 2026-08-23  
**Phase:** `MODEL3_BASE_CORPUS_CAPACITY_AND_STAGE2_PREDEVELOPMENT_AUDIT`  
**Type:** READ-ONLY  
**Verdict:** `BASE_CORPUS_GAP`

**Frozen:** `MODEL3_TRAINING_SAMPLE_V1` schema — **no change**

**Not done:** Stage2 implementation · 100k · training · TTS · runtime edits

---

## Consolidated artifacts (this round ≤7 files)

| # | File | Contents |
|---|------|----------|
| 1 | **This report** | Verdict · Q1–Q20 · decision |
| 2 | `model3_base_corpus_capacity_bundle.md` | Spoken-like contract · near-dup · gap closure |
| 3 | `model3_base_corpus_data.csv` | Inventory · overlap · certified contributions (`section` column) |
| 4 | `model3_certified_base_pool_summary.json` | Certified counts / shortfall |
| 5 | `model3_stage2_predevelopment_bundle.md` | Architecture · anchors · repairability · labels · checklist · pilot |
| 6 | `model3_stage2_tables.csv` | Capability / reuse / gaps / targets / label table / schema refs |
| 7 | `model3_stage2_offline_checks.json` | Domain Vote · Model2 · repairability · schema governance JSON |

---

## Executive answers (Q1–Q20)

| Q | Answer |
|---|--------|
| Q1 Additional spoken-like sources | `training_scale_v1`, `pseudo_user_accent_scale_v1` (ACCEPT_WITH_LIMIT). No large pure ACCEPT free-dialogue pool. |
| Q2 Overlap vs baseline | scale ∩ baseline **69**; accent ∩ baseline **120**; scale ∩ accent **184**; dialog_200 ∩ baseline **0** |
| Q3 Certified unique | **4955** (carrier-cap); uncapped union **14956** |
| Q4 ≥15k? | **NO** (both metrics) |
| Q5 Shortfall | Certified **10045**; even uncapped **44** |
| Q6 Rejected primary | carrier skeletons; wiki; news; probes; term lists |
| Q7 Carriers | Skeletons REJECT_PRIMARY; filled texts ACCEPT_WITH_LIMIT + **max 30 / carrier_id** |
| Q8 Eval contamination | dialog_200 EVAL_ONLY (68 unique); 0 exact overlap with baseline GT |
| Q9 FineSpan reuse | **PARTIAL** — production exists; offline harness missing |
| Q10 Domain Vote | **PARTIAL** — thin Node wrapper of production vote/assembly |
| Q11 SameDomain Anchor | **PARTIAL** — materializable once harness exists |
| Q12 Model2 first batch | **UNAVAILABLE** |
| Q13 Recall reuse | **PARTIAL** — harness missing |
| Q14 Retry equivalence | **PARTIAL** |
| Q15 UNKNOWN/EXCLUDE | unstable alignment; polyphony; reachable UNKNOWN; missing evidence |
| Q16 Decision table | **YES** — in `model3_stage2_tables.csv` (`label_decision`) |
| Q17 Schema change? | **NO** |
| Q18 Stage2 files | New `training/model3_dataset/materialize/*` + offline Node harness |
| Q19 Runtime change? | **NO** |
| Q20 Safe 100k now? | **NO** |

---

## Base corpus (summary)

| Pool | Count |
|------|------:|
| baseline unique | 9775 |
| Uncapped union (3 ACCEPT_WITH_LIMIT) | 14956 |
| Cap-controlled certified | **4955** |

**BASE_CORPUS_GAP: YES**

---

## Stage2 (summary)

Pipeline designed; **unimplemented**. Reuse = production FineSpan / Domain Vote / Recall via offline harness. Fake Model2 = 0. Label table READY.

---

## Decision

| Item | Value |
|------|--------|
| Safe to develop Stage2 | **YES** |
| Safe to close base gap with current sources only | **NO** |
| Safe to generate 100k | **NO** |
| Recommended next | `MODEL3_BASE_CORPUS_GAP_CLOSURE_AND_STAGE2_DEVELOPMENT` |

**STOP** — await user review.
