# Lingua — Delta 1 Retry Stage-2 Query Enumeration SSOT Restoration Development

Generated: 2026-09-03T20:30:00Z  
Phase: `MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DEVELOPMENT`  
Mode: CONTROLLED PRODUCTION DEVELOPMENT — TRACE-BASED ACCEPTANCE — AUTOMATIC DRIFT CHECK

================================
1. VERDICT
==========

**MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DEVELOPMENT_PASS**

Single control variable changed: `RETRY_STAGE2_QUERY_ENUMERATION_SOURCE`

- BEFORE (success path): Stage-2 RAW_RECALL queries from `RetryRegionLocalSpan[]` only  
- AFTER (success path): Stage-2 RAW_RECALL queries = every legal contiguous syllable window `L=1..min(5,R)` inside RetryRegion  
- Fallback / Delta 2: **byte/semantic equivalent** (`DELTA2_BEHAVIOR_CHANGE_COUNT = 0`)  
- First semantic difference: **STAGE2_QUERY_ENUMERATION**  
- DECISION_REQUIRED: **EMPTY**

`DEVELOPMENT_EVIDENCE_STATE`: Unit #1 success-path Stage-2 query enumeration restored to legal bounded region window space; architecture SSOT unchanged; no new architecture freeze.

================================
2. FILES MODIFIED
=================

Production (2 / max 3):

1. `electron_node/electron-node/main/src/model3-runtime/model3-retry-router.ts`  
2. `electron_node/electron-node/main/src/model3-runtime/model3-retry-stage2-windows.ts` (new consumer + minimal coordinate adapter)

Tests (not production scope):

3. `model3-retry-stage2-windows.test.ts` (new)  
4. `model3-retry-region-resegment.test.ts` (success-path expectation → full window set)  
5. `model3-mainline.integration.test.ts` (F/G recall-count expectations → window cardinality)

Evidence artifacts (≤7):

- `Lingua_Model3_Retry_Stage2_SSOT_Restoration_Development_Report.md` (this file)  
- `model3_retry_stage2_before_after_trace.csv`  
- `model3_retry_stage2_window_set_assertion.csv`  
- `model3_retry_stage2_control_cohort_results.csv`  
- `model3_retry_stage2_drift_gate.csv`  
- `model3_retry_stage2_delta2_parity.csv`  
- `model3_retry_stage2_development_evidence.json`

================================
3. EXACT CODE DELTA
===================

### Router (`model3-retry-router.ts`)

On each RetryRegion after resegment:

```text
stage2QueryLocals =
  resegmentResult.ok
    ? enumerateStage2SuccessPathQueryLocals({ region, rawText, globalSyllables })
    : localSpans   // Delta 2 unchanged
for (local of stage2QueryLocals) { … recallSpanTopKV2 … materialize … }
```

- No dual path / feature flag / legacy mode  
- Still uses `recallSpanTopKV2` via injected `recall`  
- Ownership / materialization unchanged (`overlappingOriginalSpans`)

### Window consumer (`model3-retry-stage2-windows.ts`)

- Calls `buildLexicalWindowQueries` (SHARED_LEXICAL_WINDOW_OWNER)  
- Clips results to RetryRegion raw/syllable bounds  
- Minimal identity `charSyllableRanges` adapter only when CJK coordinate is empty but syllable stream length matches raw (ASCII fixtures)

================================
4. BEFORE TRACE
===============

Success-path queries = retained/localSpan bounds only.

| Cohort | R | Before query set (surface) |
|--------|---|----------------------------|
| A | 2 | 顺; 便 |
| B | 3 | 顺; 便; 向; 顺便 |
| C | 3 | path-union localSpans (no preferred-path; still FineSpan bounds) |
| D | 1 | A |
| E | 1+1 | A; C |
| F | 1 | B |

See `model3_retry_stage2_before_after_trace.csv`.

================================
5. AFTER TRACE
==============

Success-path queries = complete legal 1..min(5,R) window set.

| Cohort | R | After query set (surface) |
|--------|---|---------------------------|
| A | 2 | 顺; 便; **顺便** |
| B | 3 | 顺; 便; 向; 顺便; **便向**; **顺便向** |
| C | 3 | region window space (6); no preferred-path collapse |
| D | 1 | A (unchanged cardinality) |
| E | 1+1 | A; C (unchanged; no Anchor cross) |
| F | 1 | B (unchanged; no KEEP cross) |

================================
6. FIRST SEMANTIC CHANGE
========================

**STAGE2_QUERY_ENUMERATION**

Not Model3 / RetryRegion / barrier / regional lattice / path selection / Domain Vote / Recall algorithm.

→ No `CONTROL_VARIABLE_VIOLATION`.

================================
7. WINDOW-SET ASSERTION
=======================

Programmatic checks (unit tests + CSV):

| R | expected | actual | missing | extra | outOfRegion |
|---|----------|--------|---------|-------|-------------|
| 1 | 1 | 1 | 0 | 0 | 0 |
| 2 | 3 | 3 | 0 | 0 | 0 |
| 3 | 6 | 6 | 0 | 0 | 0 |
| 4 | 10 | 10 | 0 | 0 | 0 |
| 5 | 15 | 15 | 0 | 0 | 0 |
| 7 | 25 | 25 | 0 | 0 | 0 |

Required: **missing=extra=outOfRegion=0** — PASS.

================================
8. CONTROL COHORT RESULTS
=========================

| Cohort | Result |
|--------|--------|
| A_ADEQUATE_LOCALSPAN | PASS |
| B_CROSS_LOCALSPAN_WINDOW | PASS |
| C_MULTIPATH | PASS |
| D_SINGLE_CHAR | PASS |
| E_ANCHOR_ADJACENT | PASS |
| F_KEEP_ADJACENT | PASS |

X/Y excluded from Unit #1 primary acceptance (as designed).

================================
9. DELTA 2 PARITY
=================

Fallback (`resegmentOk=false`) fixture R=3 with three FineSpan localSpans:

- BEFORE queries: 顺; 便; 向  
- AFTER queries: 顺; 便; 向  
- No cross-localSpan windows injected  

**DELTA2_BEHAVIOR_CHANGE_COUNT = 0**

================================
10. DRIFT GATE
==============

All checks **NO** unexpected change — see `model3_retry_stage2_drift_gate.csv`.

→ No `DEVELOPMENT_DRIFT_DETECTED`.

================================
11. ANTI-OVERFIT GATE
====================

| Gate | Result |
|------|--------|
| OVERFITTING_DETECTED | NO |
| REFERENCE_LEAKAGE | NO |
| TEST_GAMING | NO |
| CASE_SPECIFIC_RUNTIME_PATCH | NO |

No dialog_200 / case-ID / reference-text branches in production.

================================
12. DOWNSTREAM REPLAY
=====================

This unit verified unchanged downstream entrypoints on fixtures:

Recall (`recallSpanTopKV2`) → materialize → per-span merge → (Assembly/KenLM/JobResult untouched).

Full dialog_200 A1 replay: **deferred to ACCEPTANCE phase** (not required to invent final-text wins here).  
Neutral final-text does **not** invalidate Stage-2 SSOT restoration.

Fixture-level classification: **unchanged** downstream algorithms; **improved** Stage-2 query expressiveness on success path.

================================
13. PERFORMANCE
===============

| Metric | Note |
|--------|------|
| Enumeration bound | `SUM(R-L+1)`, `L=1..min(5,R)` |
| Candidate pool cap | ≤16 unchanged |
| Recall entrypoint | unchanged |
| Cache | existing utterance/query-key dedup reused; no new cache |

More Stage-2 queries on large R are expected and bounded. No architecture performance change in this unit.

================================
14. REMOVED / REUSED LOGIC
==========================

Removed (success path only):

- Sole reliance on `for (local of localSpans)` as Stage-2 query source

Reused:

- `buildLexicalWindowQueries` / `buildWindowDescriptorForRange`  
- `theoreticalLexicalWindowCount`  
- Existing owner binding / materialize / merge / `recallSpanTopKV2`  
- Fallback `localSpans` loop when `resegmentOk=false`

Not introduced:

- Stage2QueryManager / RetryWindowPlanner / feature flag / dual query path

================================
15. REMAINING ISSUES
====================

1. Full dialog_200 before/after provenance replay not executed in this development unit (Acceptance phase).  
2. ASCII unit fixtures require identity char↔syllable adapter when CJK coordinate is empty — production CJK path uses authoritative `buildUtteranceSyllableCoordinate` ranges.

================================
16. DECISION_REQUIRED
=====================

**EMPTY**

================================
17. NEXT PHASE
==============

**MODEL3_RETRY_STAGE2_SSOT_RESTORATION_ACCEPTANCE**

Do **not** start Delta 2 (`DELTA_RQ_FALLBACK_BOUNDARY_LOCK`) until Unit #1 is independently accepted.
