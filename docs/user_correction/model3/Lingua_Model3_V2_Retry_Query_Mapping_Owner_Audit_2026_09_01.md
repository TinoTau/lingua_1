# Lingua — Model3 V2 Retry Query Mapping Owner Audit + Evidence Freeze

Date: 2026-09-01  
Phase: `MODEL3_V2_RETRY_QUERY_MAPPING_OWNER_AUDIT`  
Mode: FREEZE CONFIRMED EVIDENCE / READ-ONLY PRODUCTION-SEMANTIC OWNER AUDIT

================================
EXECUTIVE VERDICT
=================

| Item | Result |
|------|--------|
| **Verdict** | **`RETRY_QUERY_MAPPING_OWNER_AUDIT_PASS_SINGLE_DOMINANT_OWNER`** |
| **48-case owner distribution** | **`deriveRetryRegions` / RETRY_REGION_DERIVATION: 34** · **multi-unit parity scope: 14** |
| **Largest code owner** | **`deriveRetryRegions`** (`model3-retry-region.ts`) — **34 / 48 (70.8%)** |
| **Second owner** | **Multi-unit parity evaluation scope** — **14 / 48 (29.2%)** |
| **48 vs 13 OLD_BOUNDARY relationship** | **Distinct mechanisms.** 13 remain **`fallbackRegionLocalSpans`** cross-boundary lock. **0 / 48** reclassified into that bucket on primary-target trace. |
| **Architecture classification** | **IMPLEMENTATION_DRIFT_FROM_FROZEN_ARCHITECTURE** (13 controls) + **region-scope limitation within frozen deriveRetryRegions contract** (34) |
| **ACP required** | **NO** |
| **Next phase** | **`MODEL3_V2_RETRY_QUERY_MAPPING_MINIMAL_CORRECTION_DESIGN`** (design only — not executed) |

**Headline:** The generic symptom **`RETRY_QUERY_BOUNDARY` (48)** decomposes into two proven code-level owners. **Neither is Recall.** **Neither is pinyin/tone.** **Dominant first-loss is `deriveRetryRegions` excluding the primary expected-repair interval from the Retry region** (34 cases). The remaining 14 cases receive **repair-capable query geometry for the primary target** via the existing fallback → `routeModel3Retry` path; they remain in the boundary bucket only because **multi-unit parity evaluation** marks the case failed when other utterance units are assessed against this region's invocations.

================================
FROZEN EVIDENCE
===============

See **`model3_v2_retry_query_freeze_state.csv`**. Authoritative frozen items:

| Item | Status |
|------|--------|
| Path-local Domain Vote | FROZEN — one vote per retained path |
| Model3 KEEP/RETRY only | FROZEN |
| S3 checkpoint `MODEL3_V2_S3_RANDOM_INIT_V1` | FROZEN |
| Final causal acceptance 0/0/200 | FROZEN |
| Historical `LOCAL_RESEGMENTATION=84` retired | FROZEN → `HISTORICAL_REGIONAL_LATTICE_FAILURE_COHORT` |
| Query parity 8 confirmed Recall | FROZEN |
| Boundary symptom 48 / OLD_BOUNDARY 13 | FROZEN as prior labels |
| Pinyin not primary (PINYIN_MISMATCH=0) | FROZEN |
| Candidate cap ≤16 / JobResult contract | FROZEN |
| Prior summary arithmetic | **CORRECTED:** 8+62+1=71 (was reconcile=70) |

================================
AUTHORITATIVE CALL GRAPH
========================

```
Model3 RETRY decisions
  → deriveRetryRegions (model3-retry-region.ts)
  → resegmentRetryRegionWithLattice (model3-retry-region-resegment.ts)
      → runLatticeFineSpanGeneration (lattice-fine-span-runtime.ts)
      → on failure: fallbackRegionLocalSpans (model3-retry-region-resegment.ts)
      → on success: mapLocalSpansToGlobal (model3-retry-region-resegment.ts)
  → routeModel3Retry (model3-retry-router.ts)
      → windowText = rawText.slice(local.rawStart, local.rawEnd)
      → windowPinyinKey = globalSyllables.slice(...).join('|')
      → recallSpanTopKV2 (run-model3-path-step.ts)
```

Trace authority: **`model3_v2_retry_recall_query_trace.jsonl`** (DIAGNOSTIC_REPLAY, 84/84).

================================
48-CASE POPULATION
==================

- **Recovered:** 48 / 48 from `model3_v2_retry_recall_query_parity_cases.csv` (`firstFailOwner=RETRY_QUERY_BOUNDARY`)
- **Controls:** 13 OLD_BOUNDARY (stable) · 8 Recall parity-pass (stable)
- **Fresh ASR:** NO
- **Production code modified:** NO

================================
RETRY REGION DERIVATION (34 / 48)
=================================

**Owner:** `deriveRetryRegions` / `buildRegionFromSpans`  
**File:** `model3-retry-region.ts`  
**Mechanism:** Retry region `rawStart/rawEnd` is the union of **contiguous Model3 RETRY PathFineSpans only**. KEEP spans and Anchor spans break merge groups. The **primary expected-repair interval** (parity CSV) lies **outside** this region.

**First-loss stage:** `deriveRetryRegions` — before lattice, fallback, or Recall query construction.

**Representative cases:** d008 (expected 三期 7–9, region 26–28), d022 (expected 订单显 3–7, region 3–4 定), d011 (expected 处 2–3, region 14–15 微).

**Region sufficiency class:** `REGION_TOO_NARROW` or `REGION_DISJOINT` vs primary unit.

**Architecture note:** Frozen Retry permits sliding/overlapping windows **within** a region, but cannot expand into KEEP-span territory without additional RETRY spans. These 34 cases are **not** fixed by Recall compensation or fallback alone under current region bounds.

================================
FALLBACK / LATTICE (48 cohort context)
========================================

All 48 share **`resegmentOk=false`** (historical lattice-failure cohort). **48 / 48** enter **`fallbackRegionLocalSpans`**.

**Critical finding:** For the **48 primary targets**, **0** first-fail at `fallbackRegionLocalSpans` after primary-target-scoped trace. The 13 OLD_BOUNDARY controls **do** first-fail there (cross-boundary fallback lock) — **kept distinct from 48**.

Lattice failure code is not in trace payload; observed contract: **`resegmentOk=false` → FALLBACK**.

================================
MULTI-UNIT PARITY SCOPE (14 / 48)
=================================

**Owner:** Parity evaluation scope (audit artifact), not a production query mapper defect for the primary target.

**Mechanism:** Primary expected-repair unit is **inside** the Retry region. **`fallbackRegionLocalSpans` → `routeModel3Retry`** emits a local span whose bounds are **BOUNDARY_EXACT** or **BOUNDARY_SUPERSET_COMPATIBLE** for the primary unit. Actual `recallSpanTopKV2` inputs are repair-capable for that unit. Case remains **`QUERY_MULTIPLE_MISMATCHES` / RETRY_QUERY_BOUNDARY** because **other utterance correction units** are evaluated against this region's invocations.

**Representative cases:** d010 (医 0–1 exact), d062, d089, d127, d134, d190.

**Production path for primary target:** lattice fail → fallback (first-pass boundaries) → correct windowText/windowPinyinKey for primary interval → Recall invoked.

================================
MULTIPLE MISMATCH DECOMPOSITION (D22)
=====================================

Prior **`QUERY_MULTIPLE_MISMATCHES = 35`** (84-cohort parity) decomposes as:

| Component | Count (pair-events) | Meaning |
|-----------|--------------------:|---------|
| `boundary_disjoint` | 258 | Unit–invocation pairs where span interval is disjoint |
| `multi_unit_target` | 209 | Utterances with >1 repair unit evaluated |
| `boundary_overlap_insufficient` | 3 | Partial overlap without superset |

**Terminal owner:** Not "multiple mismatches" — split into **region excludes primary (34)** vs **primary query OK, multi-unit scope (14)**.

================================
ROOT CAUSE DISTRIBUTION
=======================

| rootCauseId | Count | Owner function | % of 48 |
|-------------|------:|----------------|--------:|
| `RC_REGION_EXCLUDES_PRIMARY_REPAIR` | 34 | `deriveRetryRegions` | 70.8% |
| `RC_MULTI_UNIT_PARITY_SCOPE` | 14 | Parity multi-unit scope | 29.2% |

See **`model3_v2_retry_query_root_causes.csv`**.

================================
MINIMAL FUTURE CORRECTION BOUNDARY
==================================

**No code changes in this phase.**

| Question | Answer |
|----------|--------|
| Dominant fix restorable in one existing function? | **Partially** — region scope touches `deriveRetryRegions` merge policy vs frozen RETRY-only bounds |
| New data structures? | **NO** (preferred) |
| New API / JobResult? | **NO** |
| Candidate cap change? | **NO** |
| Model3 retrain? | **NO** |
| Recall redesign for these 48? | **NO** |
| Restore sliding/overlap in fallback/lattice? | **YES for 13 OLD_BOUNDARY** (separate track); **not the dominant 48 mechanism** |

================================
ARCHITECTURE DRIFT
==================

| Class | Applies to |
|-------|------------|
| `IMPLEMENTATION_DRIFT_FROM_FROZEN_ARCHITECTURE` | 13 OLD_BOUNDARY (`fallbackRegionLocalSpans` reuses first-pass boundaries) |
| `IMPLEMENTATION_BUG_WITHIN_FROZEN_ARCHITECTURE` | 34 region-scope cases under current RETRY-only region contract |
| `TRACE_CLASSIFICATION_ERROR` | 14 multi-unit parity scope cases |

**ACP:** **NO** — frozen architecture already permits overlap/sliding **within** region; dominant gap is **region bounds vs repair interval**, not missing Recall/Lexicon feature.

================================
GOVERNANCE
==========

| Component | Changed |
|-----------|---------|
| Domain Vote | NO |
| FineSpan | NO |
| Model2 | NO |
| Model3 / S3 | NO |
| Retry / Fallback / Recall | NO |
| Assembly / KenLM / JobResult | NO |
| Production behavior | NO |

Audit script only: **`run-model3-v2-retry-query-mapping-owner-audit.mjs`** (read-only classification).

================================
REQUIRED QUESTIONS (SELECTED)
=============================

| ID | Answer |
|----|--------|
| D1 | YES — 48/48 recovered |
| D2 | YES — 13/13 OLD_BOUNDARY controls stable |
| D3 | YES — 8/8 Recall controls stable |
| D5 | **34** insufficient Retry region for primary repair |
| D11 | **0** of 48 are OLD_BOUNDARY on primary-target trace |
| D19 | **14** trace-classification (multi-unit scope) |
| D23 | **`deriveRetryRegions`** |
| D25 | YES — one function accounts for majority (34/48) |
| D26–D27 | 48 and 13 are **distinct**; shared fallback function only for 13 |
| D42 | NO — Recall is not primary blocker |
| D43 | YES — boundary/region scope still primary |
| D46 | YES — arithmetic metadata corrected |
| D47–D48 | NO production/business changes |

================================
NEXT PHASE
==========

**Exactly one:** `MODEL3_V2_RETRY_QUERY_MAPPING_MINIMAL_CORRECTION_DESIGN`

**Do not execute automatically.** Await user review.

================================
ARTIFACTS (6)
===============

1. `Lingua_Model3_V2_Retry_Query_Mapping_Owner_Audit_2026_09_01.md` (this file)
2. `model3_v2_retry_query_owner_cases.csv`
3. `model3_v2_retry_query_root_causes.csv`
4. `model3_v2_retry_query_mapping_chain.csv`
5. `model3_v2_retry_query_freeze_state.csv`
6. `model3_v2_retry_query_owner_summary.json`
