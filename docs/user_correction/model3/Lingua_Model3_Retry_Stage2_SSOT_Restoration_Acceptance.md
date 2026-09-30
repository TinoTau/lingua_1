# Lingua — Delta 1 Retry Stage-2 Query Enumeration SSOT Restoration Acceptance

Generated: 2026-09-03T21:17:00Z  
Phase: `MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE`  
Mode: READ-ONLY ACCEPTANCE — FULL PRODUCTION-EQUIVALENT REPLAY — TRACE COMPARISON — DRIFT VERIFICATION  
Production code changes in this phase: **NONE**

================================
1. VERDICT
==========

**MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE_PASS_WITH_NONBLOCKING_FINDINGS**

Hard gates for Unit #1 Stage-2 SSOT restoration: **PASS** on dialog_200 / 200.

Freeze evidence state (not a new architecture SSOT):

| Item | State |
|------|--------|
| `DELTA_RQ_STAGE2_NO_SLIDING` | **RESOLVED_ACCEPTED** |
| `RETRY_STAGE2_SUCCESS_PATH_QUERY_ENUMERATION` | **LEGAL_BOUNDED_WINDOW_SPACE_1_TO_5** |
| `DELTA_RQ_FALLBACK_BOUNDARY_LOCK` | **ACTIVE_UNRESOLVED** |

Nonblocking findings (do not undo architectural acceptance):

1. Internal `postRetryWorking` pressure up to **30** (more Stage-2 queries as designed); **cross-path sentence pool max = 8 ≤ 16**.  
2. Cross-run final-text neutral diffs (**87**) between frozen BEFORE provenance and AFTER replay — **all inspected Delta2 cross-run diffs co-occur with ASR `raw_asr` divergence**; not attributed to Delta 1.

Next phase: **`MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DESIGN`**

================================
2. ENVIRONMENT VALIDITY GATE
============================

System Node v24 (`NODE_MODULE_VERSION` 137) **cannot** load `better-sqlite3` built for Electron ABI 119.

Authoritative production-equivalent runtime = **Electron 28.3.3** (`modules=119`):

| Check | Result |
|-------|--------|
| LEXICON_RUNTIME_OK | YES |
| SQLITE_NATIVE_OK | YES |
| RECALL_RUNTIME_OK | YES |
| AUTHORITATIVE_LEXICON | `node_runtime/lexicon/v3/lexicon.sqlite` |
| SCHEMA | `lexicon-v3-runtime-v3` |
| bundle | v3-runtime / bundleVersion 14 / checksum `sha256:59de3890…` |
| base_lexicon rows | 10381 |

Stale artifact firewall:

- `model3_v1_retry_region_controlled_validation.json` → **`STALE_INVALID_FOR_CURRENT_ACCEPTANCE`** (`lexiconOk=false`, NODE_MODULE_VERSION mismatch). Not used for Recall quality / latency / rescue rate.

================================
3. CODE DELTA VERIFICATION
==========================

Production files in scope (2):

1. `model3-retry-router.ts` — success-path Stage-2 query source switch  
2. `model3-retry-stage2-windows.ts` — consumer + minimal coordinate adapter  

| Classification | Assessment |
|----------------|------------|
| DELTA1_REQUIRED | Router: `resegmentOk ? enumerateStage2… : localSpans` |
| MINIMAL_COORDINATE_ADAPTER | Identity `charSyllableRanges` when CJK stream empty (ASCII fixtures) |
| INCIDENTAL_SIMPLIFICATION | 0 |
| UNRELATED_CHANGE | **0** |

New file ownership: **`CONSUMER_ADAPTER`** (not NEW_ARCHITECTURE_OWNER).  
Reuses `buildLexicalWindowQueries` / `buildWindowDescriptorForRange`. Does not own window-length policy, Recall, Domain, barriers, or RetryRegion derivation.

ASCII adapter: **`SAFE_GENERIC_ADAPTER`** — no case IDs / dialog_200 / expected surfaces; not activated for normal CJK (CJK coordinate ranges non-empty).

Anti-overfit production scan: **NO** case IDs / reference strings / cohort names.

================================
4. BEFORE / AFTER IDENTITY
==========================

| Axis | Identity |
|------|----------|
| BEFORE artifact | `model3_v2_s3_candidate_provenance_raw.jsonl` (pre-Delta1, localSpan-only Stage-2) |
| AFTER artifact | `model3_retry_stage2_acceptance_after_raw.jsonl` (this acceptance; 200/200) |
| Baseline model | `MODEL3_V2_S3_RANDOM_INIT_V1` / sha `f1e41969…` |
| A1 model | `MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1` / sha `2d1c7632…` |
| Dataset | `test wav/dialog_200` + `cases.manifest.json` |
| Lexicon | v3-runtime bundle 14 (above) |
| Intended semantic diff | Stage-2 query enumeration only |

Note: cross-run ASR `raw_asr` may diverge; final-text A/B is **not** used as a hard gate. Architecture gates use AFTER traces + independent window oracle.

================================
5. DENOMINATORS (AFTER)
=======================

| Population | N |
|------------|---|
| ALL_VALID_UTTERANCES | 200 |
| RETRY_REGION_CREATED | 196 |
| RESEGMENT_OK regions | 164 |
| RESEGMENT_FALLBACK regions | 400 |

================================
6. FIRST SEMANTIC CHANGE
========================

BEFORE (frozen): **127 / 168** successful regions **do not** match full 1..min(5,R) window cardinality (localSpan-only).  

AFTER: **missing=extra=outOfRegion=0** on 164 successful regions.

**FIRST_UNEXPECTED_CHANGE_COUNT = 0**  
Allowed first change: **STAGE2_QUERY_ENUMERATION**

================================
7. WINDOW CONTRACT (REAL REPLAY)
================================

| Metric | Value |
|--------|------:|
| successfulRetryRegionCount | 164 |
| expectedWindowCount | 877 |
| actualWindowCount | 877 |
| missingWindowCount | **0** |
| extraWindowCount | **0** |
| outOfRegionWindowCount | **0** |
| COORDINATE_MISMATCH_COUNT | **0** (syllable↔raw width + pinyin key) |
| previousValidQueryCount | 425 |
| previousValidQueriesMissingAfter | **0** |

Cross-FineSpan:

| Metric | Value |
|--------|------:|
| crossFineSpanRegionCount | 118 |
| crossFineSpanWindowCount | 400 |
| crossFineSpanWindowsActuallyQueried | **400** |
| crossFineSpanWindowsWithRecallHits | 0 (not a Delta1 failure) |

================================
8. DELTA 2 PARITY
=================

Authoritative check: **within AFTER run**, `resegmentOk=false` → Stage-2 queries == `newLocalSpanSurfaces`.

| Metric | Value |
|--------|------:|
| observedFallbackRegions | 400 |
| DELTA2_REAL_REPLAY_BEHAVIOR_CHANGE_COUNT | **0** |
| status | **PARITY_PASS** |

Cross-run BEFORE↔AFTER query-text diffs (16) all co-occur with `raw_asr` divergence → **not** Delta 2 code change.

================================
9. MULTIPATH / BARRIERS / L=1 / INVARIANTS
==========================================

| Gate | Result |
|------|--------|
| multipathRetryCount | 101 |
| preferredPathCollapseCount | **0** |
| anchorCrossingCount | **0** |
| unrelatedKeepCrossingCount | **0** |
| singleCharQueryCount | 425 |
| singleCharContractViolationCount | **0** |
| secondDomainVoteCount | **0** |
| secondModel3StageCount | **0** |
| recursiveRetryCount | **0** |
| asrRerunCount | **0** |
| Recall entrypoint | still `recallSpanTopKV2` |

================================
10. CANDIDATE BUDGET / PERFORMANCE
==================================

| Metric | Value |
|--------|------:|
| maxCrossPathCandidateSentenceCount | **8** (≤16) |
| maxPostRetryWorking (internal) | 30 |
| Performance class | **NONBLOCKING_INCREASE** |

No cap change. No architecture optimization in this phase.

================================
11. FINAL OUTPUT REPLAY (CROSS-RUN)
===================================

| Class | N |
|-------|--:|
| finalUnchanged | 113 |
| finalChangedNeutral | 87 |
| finalImproved | 0 |
| finalRegressed | **0** |
| baselineCorrectRegressed | **0** |

Delta 1 does **not** require accuracy improvement. Neutral cross-run churn is ASR-contaminated evidence only.

================================
12. DRIFT GATE
==============

All unexpected-change questions: **NO** (see `model3_retry_stage2_acceptance_drift_gate.csv`).

================================
13. CLASSIFICATION
==================

| Bucket | Result |
|--------|--------|
| ARCHITECTURE_SEMANTIC_ACCEPTANCE | **PASS** |
| RUNTIME_CORRECTNESS | **PASS** (Electron ABI) |
| REGRESSION | **NONE** (hard) |
| PERFORMANCE | NONBLOCKING_INCREASE |
| MODEL_QUALITY | unchanged requirement (KEEP_ON_LOCUS etc. out of Unit #1) |
| UNRELATED_EXISTING_ISSUE | stale Node24 sqlite ABI for non-Electron tools |

================================
14. DECISION_REQUIRED_BEFORE_FREEZE
===================================

**EMPTY**

================================
15. ARTIFACTS (≤7)
==================

1. `Lingua_Model3_Retry_Stage2_SSOT_Restoration_Acceptance.md` (this file)  
2. `model3_retry_stage2_real_replay_trace.csv`  
3. `model3_retry_stage2_window_acceptance.csv`  
4. `model3_retry_stage2_candidate_lifecycle.csv`  
5. `model3_retry_stage2_delta2_real_parity.csv`  
6. `model3_retry_stage2_acceptance_drift_gate.csv`  
7. `model3_retry_stage2_acceptance_summary.json`  

Supporting (not counted as architecture freeze):  
`model3_retry_stage2_acceptance_after_raw.jsonl` (AFTER dump); frozen BEFORE provenance unchanged.

================================
16. NEXT PHASE
==============

**MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DESIGN**

Do **not** develop Delta 2 until that design phase completes.
