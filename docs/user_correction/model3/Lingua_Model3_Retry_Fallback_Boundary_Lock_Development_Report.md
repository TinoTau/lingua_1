# Lingua — Delta 2 Retry Fallback Boundary Lock Controlled Development

Generated: 2026-09-04T08:30:00Z  
Phase: `MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DEVELOPMENT`  
Mode: CONTROLLED SINGLE-VARIABLE DEVELOPMENT  

================================
1. VERDICT
==========

**MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DEVELOPMENT_PASS**

Control variable: `RETRY_FALLBACK_GEOMETRY_SOURCE`

- BEFORE (`resegmentOk=false`): Stage-2 queries from `fallbackRegionLocalSpans` / first-pass FineSpan bounds  
- AFTER (`resegmentOk=false`): Stage-2 queries from accepted legal bounded window enum `L=1..min(5,R)` inside RetryRegion  
- `resegmentOk` remains **false** on fallback  
- Delta1 success path: **DELTA1_SUCCESS_PATH_BEHAVIOR_CHANGE_COUNT = 0**  
- First semantic change: **FALLBACK_STAGE2_QUERY_GEOMETRY**  
- `DECISION_REQUIRED_FOR_USER`: **EMPTY**

`DEVELOPMENT_EVIDENCE_STATE`: Fallback Stage-2 query geometry authority restored to RetryRegion legal window space; architecture SSOT unchanged.

================================
2. FILES MODIFIED
=================

Production (2 / max 3):

1. `model3-retry-router.ts` — fallback Stage-2 query source → shared window enumerator  
2. `model3-types.ts` — optional side-channel `fallbackGeometrySource` / `fallbackReason`

Tests:

3. `model3-retry-stage2-windows.test.ts` — Delta2 window-set + Delta1 parity

Evidence (≤7): this report + 6 CSV/JSON companions.

================================
3. EXACT CONTROL VARIABLE DELTA
===============================

| | Before | After |
|--|--------|-------|
| `resegmentOk=false` Stage-2 queries | `localSpans` (= FineSpan lock) | `enumerateStage2SuccessPathQueryLocals` |
| `resegmentOk=true` Stage-2 queries | same enumerator | **unchanged** |
| `fallbackRegionLocalSpans` | query authority | retained for `newLocalSpanSurfaces` / supporting trace only |
| `fallbackGeometrySource` | (none / FineSpan) | `RETRY_REGION_LEGAL_WINDOW_SPACE` |

================================
4. CODE BEFORE / AFTER
======================

```text
BEFORE:
  stage2QueryLocals = ok ? enumerateWindows(...) : localSpans

AFTER:
  stage2QueryLocals = enumerateWindows(...)   // both branches; ok flag unchanged
  if (!ok) trace fallbackGeometrySource=RETRY_REGION_LEGAL_WINDOW_SPACE
           + fallbackReason=resegment.code
```

No second enumerator. No feature flag. No fake lattice success.

================================
5. FALLBACK FAILURE REASON TRACE
================================

Side-channel on `Model3RetryRegionTrace` / recall invocations when `resegmentOk=false`:

- `fallbackReason` ← `resegmentResult.code` or default `LATTICE_FAIL_OR_NO_PATH`  
- Existing codes still produced by resegment: `EMPTY_SLICE`, lattice codes / `NO_PATH`, exception message  

Diagnostic only — no behavior branching by reason.

================================
6–8. BEFORE / AFTER TRACE + FIRST CHANGE
========================================

Control cohorts A–H: first change = **FALLBACK_STAGE2_QUERY_GEOMETRY**.  
Not Model3 / RetryRegion / barriers / lattice / resegmentOk / Domain Vote / Recall algorithm.

See `model3_retry_fallback_before_after_trace.csv`.

================================
9. FALLBACK WINDOW-SET ASSERTION
================================

Unit fixture R=3 fallback: expected=actual=6; missing=extra=outOfRegion=0.  
Formula R=1/6: 1 / 20.  

See `model3_retry_fallback_window_assertion.csv`.

================================
10. CROSS-FINESPAN ASSERTION
============================

Fixture R=3 with three 1-char FineSpans: cross windows `顺便|便向|顺便向` all queried (3/3).  
Oracle: `crossFineSpanActuallyQueriedCount == crossFineSpanPotentialWindowCount`.

================================
11. CANDIDATE OWNERSHIP TRACE
=============================

`RetryRegion → window → recallSpanTopKV2 → overlappingOriginalSpans → originSpanId → pool → Assembly`

**NEW_CANDIDATE_OWNER_TYPE_COUNT = 0**

See `model3_retry_fallback_candidate_ownership.csv`.

================================
12. DELTA 1 PARITY
=================

Hard gate: success-path still uses the same enumerator; fixture R=2 success → `顺|便|顺便`; `resegmentOk=true`; no `fallbackGeometrySource`.

**DELTA1_SUCCESS_PATH_BEHAVIOR_CHANGE_COUNT = 0**

See `model3_retry_fallback_delta1_parity.csv`.

================================
13. BARRIER / MULTIPATH
=======================

Unit barriers (Anchor/KEEP adjacent) still confine queries to RetryRegion.  
No preferred-path / synthetic regional path introduced.  
Multipath remains per-path `routeModel3Retry`.

================================
14. SINGLE-CHARACTER
====================

L=1 windows still enumerated; Recall entrypoint unchanged (`recallSpanTopKV2`).

================================
15. CANDIDATE BUDGET
====================

No cap change. Cross-path sentence cap remains ≤16 (unchanged code).

================================
16. PERFORMANCE OBSERVATION
===========================

Design estimate retained: ~1074 → ~2584 fallback queries on dialog_200 workload class.  
No optimization in this unit. Full replay deferred to **ACCEPTANCE**.

Classification: expected **NONBLOCKING_INCREASE** (bounded by Σ(R−L+1)).

================================
17. DRIFT GATE
==============

All unexpected-change checks **NO** — see `model3_retry_fallback_drift_gate.csv`.

================================
18. ANTI-OVERFIT GATE
=====================

| Gate | Result |
|------|--------|
| OVERFITTING_DETECTED | NO |
| REFERENCE_LEAKAGE | NO |
| TEST_GAMING | NO |
| CASE_SPECIFIC_RUNTIME_PATCH | NO |

================================
19. DEFERRED FINDINGS
=====================

- Full dialog_200 AFTER provenance replay for Delta2 → Acceptance phase  
- Failure-code frequency instrumentation completeness (codes already emitted when available)

================================
20. DECISION_REQUIRED_FOR_USER
==============================

**EMPTY**

================================
21. NEXT PHASE
==============

**MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_ACCEPTANCE**

Do not start Model3 quality work or performance optimization next.
