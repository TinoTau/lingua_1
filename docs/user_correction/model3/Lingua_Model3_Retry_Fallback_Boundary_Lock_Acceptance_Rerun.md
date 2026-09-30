# Lingua — Delta 2 Retry Fallback Boundary Lock Independent Acceptance (RERUN)

Generated: 2026-09-04T12:10:00Z  
Phase: `MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_ACCEPTANCE`  
Mode: READ-ONLY ACCEPTANCE — FULL PRODUCTION-EQUIVALENT REPLAY  
Production code changes in this phase: **NONE**

Prior Acceptance (2026-09-04T09:36Z): **FAIL** — blocked by `TS2339` / `npm run build:main`.  
Build repair: `MODEL3_RETRY_FALLBACK_BUILD_COMPLETENESS_REPAIR_PASS` (TYPE_ONLY; `FIRST_RUNTIME_SEMANTIC_CHANGE=NONE`).

================================
1. VERDICT
==========

**MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_ACCEPTANCE_PASS_WITH_NONBLOCKING_FINDINGS**

Architectural question — **YES**:

Every real `resegmentOk=false` RetryRegion uses complete legal bounded RetryRegion lexical windows `L=1..min(5,R)` as Stage-2 query authority (not first-pass FineSpan boundaries), while preserving Delta1 / RetryRegion / resegmentOk / barriers / ownership / Domain Vote / Recall / Assembly / candidate cap.

Freeze:

| Item | State |
|------|--------|
| `DELTA_RQ_FALLBACK_BOUNDARY_LOCK` | **RESOLVED_ACCEPTED** |
| `RETRY_FALLBACK_QUERY_GEOMETRY` | **LEGAL_BOUNDED_RETRY_REGION_WINDOW_SPACE_1_TO_5** |
| `FIRST_PASS_FINESPAN_FALLBACK_ROLE` | **OWNERSHIP_SUPPORT_ONLY_NOT_QUERY_AUTHORITY** |
| `DELTA1` | **RESOLVED_ACCEPTED_CLOSED** |

Nonblocking findings (do not undo acceptance):

1. Query amplification **1074 → 2463** (ratio **2.293**); internal `postRetryWorking` max **32**; cross-path sentence pool max **6 ≤ 16**.  
2. Cross-FineSpan windows fully queried (**1260/1260**) but **0** Recall hits on those cross windows → `QUERY_GEOMETRY_RESTORED` + `RECALL_UTILITY_UNPROVEN` (not a geometry failure).  
3. Cross-run final-text neutral diffs (**87**); **91** ASR-contaminated vs **109** causally comparable; **0** baseline-correct regressions.

`DECISION_REQUIRED_BEFORE_FREEZE`: **EMPTY**

Next phase: **`MODEL3_RETRY_POST_DELTA_RECONCILIATION`** (read-only).

================================
2. BUILD / ENVIRONMENT
======================

| Gate | Result |
|------|--------|
| `npm run build:main` | **PASS** (hard gate) |
| Runtime | Electron **28.3.3** / Node **18.18.2** / `modules=119` |
| LEXICON_RUNTIME_OK | YES |
| SQLITE_NATIVE_OK | YES |
| RECALL_RUNTIME_OK | YES |
| Lexicon | `node_runtime/lexicon/v3/lexicon.sqlite` |
| SCHEMA | `lexicon-v3-runtime-v3` |
| bundle | v3-runtime / bundleVersion **14** / checksum `sha256:59de3890…` |

Stale exclusion: `model3_v1_retry_region_controlled_validation.json` → **STALE_INVALID_FOR_CURRENT_ACCEPTANCE** (`lexiconOk=false` / ABI mismatch). Not used.

Causal identity (same harness class as Delta1 Acceptance):

| Axis | Identity |
|------|----------|
| Model3 baseline | `MODEL3_V2_S3_RANDOM_INIT_V1` / weights `f1e41969…` |
| Dual-weight A1 | `MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1` / `2d1c7632…` |
| BEFORE artifact | `model3_retry_stage2_acceptance_after_raw.jsonl` (Delta1 AFTER) |
| AFTER artifact | `model3_retry_fallback_acceptance_after_raw.jsonl` (this run, 200/200) |
| dialog_200 | `test wav/dialog_200/cases.manifest.json` |
| Intended runtime delta | `RETRY_FALLBACK_GEOMETRY_SOURCE` only |
| Type repair | TYPE_ONLY / `FIRST_RUNTIME_SEMANTIC_CHANGE=NONE` |

================================
3. CODE DIFF AUDIT
==================

Production files in Delta2 + repair scope:

1. `model3-retry-router.ts` — fallback Stage-2 → shared legal window enumerator; trace side-channel; **type repair**: `defaultResegment(): ResegmentRetryRegionResult`
2. `model3-types.ts` — optional `fallbackGeometrySource` / `fallbackReason`

| Line class | Count / assessment |
|------------|-------------------|
| DELTA2_REQUIRED | Router query-source switch (success+fallback share enumerator; `resegmentOk` unchanged) |
| TRACE_ONLY | `fallbackGeometrySource` / `fallbackReason` writes |
| TYPE_CONTRACT_ALIGNMENT | `defaultResegment` return type + import |
| UNRELATED_CHANGE | **0** |
| RUNTIME_LOGIC_CHANGE from type repair | **0** |

Trace boundary: fields only on `Model3RetryRegionTrace` / recall invocation traces — **not** JobResult / cross-service DTO / behavior selectors.

================================
4. REPLAY POPULATION
====================

| Metric | Value |
|--------|------:|
| utteranceCount | **200** |
| errorOrIncomplete | **0** |
| RetryRegionCreated (utterances) | 196 |
| resegmentOkRegionCount | **168** |
| fallbackRegionCount | **384** |
| multipathRetryUtteranceCount | 100 |

Note: region count exceeds utterance count (multipath). Denominators kept explicit.

================================
5. FALLBACK WINDOW CONTRACT
===========================

Hard gate on all usable `resegmentOk=false` regions (`R>0`, n=384):

| Metric | Value |
|--------|------:|
| expectedWindowCount | 2463 |
| actualWindowCount | 2463 |
| missingWindowCount | **0** |
| extraWindowCount | **0** |
| duplicateLogicalQueryCount | 0 |
| outOfRegionWindowCount | **0** |
| fallbackGeometrySource = `RETRY_REGION_LEGAL_WINDOW_SPACE` | **384/384** |

**PASS**

Failure-reason population (evidence only; no behavior branch):

| code | count |
|------|------:|
| `EMPTY_DOMAIN_SCOPE` | 384 |

================================
6. CROSS-FINESPAN BOUNDARY-LOCK ORACLE
======================================

| Metric | Value |
|--------|------:|
| crossFineSpanFallbackRegionCount | 282 |
| crossFineSpanPotentialWindowCount | 1260 |
| crossFineSpanActuallyQueriedCount | **1260** |
| equality | **1260 = 1260** |
| crossFineSpanWindowsWithRecallHits | 0 |

**PASS** (primary oracle for `DELTA_RQ_FALLBACK_BOUNDARY_LOCK`).  
Recall utility on newly legal cross windows: **UNPROVEN** (nonblocking).

================================
7. FIRST SEMANTIC CHANGE
========================

Allowed: **FALLBACK_STAGE2_QUERY_GEOMETRY**  
Type repair: **no** runtime semantic change.

`FIRST_UNEXPECTED_CHANGE_COUNT = 0`

Forbidden earlier changes (Model3 / eligibility / RetryRegion / barriers / lattice / resegmentOk / Domain Vote / Recall algorithm): **not observed**.

================================
8. resegmentOk PARITY
=====================

| Metric | Value |
|--------|------:|
| fallbackRegionCount | 384 |
| fallbackRegionsFlippedToSuccess | **0** |

**PASS** — legal window enum does not masquerade as lattice success.

================================
9. DELTA1 REAL PARITY
=====================

All real `resegmentOk=true` regions (n=168):

| Metric | Value |
|--------|------:|
| successRegionsCompared | 168 |
| DELTA1_SUCCESS_PATH_BEHAVIOR_CHANGE_COUNT | **0** |
| missing / extra / outOfRegion | **0 / 0 / 0** |

Delta 1 remains **CLOSED**.

================================
10. CANDIDATE OWNERSHIP
=======================

| Metric | Value |
|--------|------:|
| fallbackQueriesWithRecallHits | 686 |
| fallbackCandidatesProduced | 687 |
| existingOwnerBindings | 686 |
| missingOwnerBindings | **0** |
| NEW_CANDIDATE_OWNER_TYPE_COUNT | **0** |

Chain observed via existing `ownerSpanId` / overlappingOriginalSpans path.  
Cross-FineSpan hit utility still unproven (0 hits on cross windows).

================================
11. DOMAIN / MULTIPATH / BARRIERS
=================================

| Check | Value |
|-------|------:|
| secondDomainVoteCount | **0** |
| model3ReinvokedCount | 0 |
| preferredPathCollapseCount | 0 |
| crossPathOwnershipContaminationCount | 0 |
| outOfRetryRegionQueryCount | **0** |
| anchorCrossingCount | 0 |
| unrelatedKeepCrossingCount | 0 |

================================
12. SINGLE-CHAR CONTRACT
========================

| Metric | Value |
|--------|------:|
| fallbackSingleCharQueryCount | 1115 |
| singleCharContractViolationCount | **0** |

Recall entrypoint remains `recallSpanTopKV2` (unchanged).

================================
13. QUERY WORKLOAD
==================

| Metric | BEFORE (Delta1 AFTER) | AFTER (this) |
|--------|----------------------:|-------------:|
| fallback queries | 1074 | **2463** |
| expected legal windows | — | 2463 |
| queryAmplificationRatio | — | **2.293** |
| total recall invocations (all regions) | — | 3351 |

Measured (not design-estimate-only). Design ballpark ~1074→~2584 remains consistent.

================================
14. PERFORMANCE
===============

Classification: **NONBLOCKING_INCREASE**

| Metric | Value |
|--------|------:|
| utterance p50 / p95 / max (ms) | 9958 / 22853 / 37134 |
| maxPostRetryWorking | 32 |
| p50 / p95 postRetryWorking | 13 / 25 |
| maxCrossPathCandidateSentenceCount | **6** |

No hard latency budget freeze violated → no `DECISION_REQUIRED_BEFORE_FREEZE`. No optimization performed.

================================
15. CANDIDATE BUDGET
====================

| Metric | Value |
|--------|------:|
| maxCrossPathCandidateSentenceCount | 6 |
| crossPathOver16Cases | **0** |

**PASS** (≤16).

================================
16. FINAL OUTPUT
================

| Bucket | Count |
|--------|------:|
| finalUnchanged | 113 |
| finalImproved | 0 |
| finalRegressed | 0 |
| finalChangedNeutral | 87 |
| baselineCorrectRegressed | **0** |
| CAUSALLY_COMPARABLE | 109 |
| ASR_CONTAMINATED | 91 |

Delta 2 does **not** require accuracy improvement for acceptance.

================================
17. OLD INVALID ARTIFACT EXCLUSION
==================================

Excluded as current evidence:

- `model3_v1_retry_region_controlled_validation.json` (`lexiconOk=false`, ABI mismatch)

================================
18. BUILD REPAIR RUNTIME PARITY
===============================

| Check | Result |
|-------|--------|
| RUNTIME_LOGIC_CHANGE_COUNT | **0** |
| Diff scope | `defaultResegment` return type + `ResegmentRetryRegionResult` import |
| Fake `code` / consumer workaround | **NONE** |

================================
19. DRIFT GATE
==============

All unexpected-change checks: **NO**  
(type repair runtime behavior changed? **NO**)

================================
20. ANTI-OVERFIT
================

Production Delta2+repair scan: no dialog_200 IDs / reference strings / cohort names / heldout logic.

| Gate | Result |
|------|--------|
| OVERFITTING_DETECTED | NO |
| REFERENCE_LEAKAGE | NO |
| TEST_GAMING | NO |
| CASE_SPECIFIC_RUNTIME_PATCH | NO |

================================
21. DECISION_REQUIRED_BEFORE_FREEZE
===================================

**EMPTY**

================================
22. FREEZE STATE
================

| Item | State |
|------|--------|
| `DELTA_RQ_FALLBACK_BOUNDARY_LOCK` | **RESOLVED_ACCEPTED** |
| `RETRY_FALLBACK_QUERY_GEOMETRY` | **LEGAL_BOUNDED_RETRY_REGION_WINDOW_SPACE_1_TO_5** |
| `FIRST_PASS_FINESPAN_FALLBACK_ROLE` | **OWNERSHIP_SUPPORT_ONLY_NOT_QUERY_AUTHORITY** |
| Delta1 | **RESOLVED_ACCEPTED_CLOSED** |

Not frozen: Model3 quality, Recall quality, Lexicon coverage, performance optimization.

================================
23. NEXT PHASE
==============

**MODEL3_RETRY_POST_DELTA_RECONCILIATION** — READ-ONLY ONLY.

Do not immediately train Model3 / change Recall / Lexicon / optimize Retry / change candidate budget.

Acceptance classification:

| Bucket | Result |
|--------|--------|
| ARCHITECTURE_SEMANTIC_ACCEPTANCE | **PASS** |
| RUNTIME_CORRECTNESS | PASS |
| DELTA1_PARITY | PASS |
| FALLBACK_WINDOW_CONTRACT | PASS |
| OLD_BOUNDARY_LOCK_REMOVAL | PASS |
| CANDIDATE_OWNERSHIP | PASS (observed) |
| BARRIER_SAFETY | PASS |
| MULTIPATH | PASS |
| REGRESSION | PASS (0 baseline-correct regress) |
| PERFORMANCE | NONBLOCKING_INCREASE |
| MODEL_QUALITY | N/A (not required) |
| UNRELATED_EXISTING_ISSUE | Cross-FineSpan Recall utility unproven; ASR cross-run drift |

================================
24. ARTIFACTS
=============

1. This report  
2. `model3_retry_fallback_acceptance_real_replay.csv`  
3. `model3_retry_fallback_acceptance_windows.csv`  
4. `model3_retry_fallback_acceptance_ownership.csv`  
5. `model3_retry_fallback_acceptance_delta1_parity.csv`  
6. `model3_retry_fallback_acceptance_performance.csv`  
7. `model3_retry_fallback_acceptance_summary.json`  
(+ dump) `model3_retry_fallback_acceptance_after_raw.jsonl`
