# Lingua — Model3 V2 Local Resegmentation Causal Evidence Audit

Date: 2026-09-01  
Phase: `MODEL3_V2_LOCAL_RESEGMENTATION_CAUSAL_EVIDENCE_AUDIT`  
Mode: READ-ONLY production-equivalent causal audit

================================
EXECUTIVE VERDICT
=================

| Item | Result |
|------|--------|
| **Verdict** | **`LOCAL_RESEGMENTATION_CAUSAL_AUDIT_PARTIAL_FLAG_SEMANTICS_PROBLEM`** |
| Historical LOCAL_RESEGMENTATION first-fail | **84 / 141** rescuable |
| Audited population recovered | **84 / 84** |
| **Strict confirmed local-reseg failures** | **6 / 84** |
| Reclassified downstream (target already in pool) | **13 / 84** |
| Ambiguous (recall returned non-target; needs trace) | **65 / 84** |
| Reclassified RETRY_REGION | **0 / 84** |
| Primary internal loss (phenomenon) | **Lattice failure → fallback OLD_BOUNDARY_LOCK** |
| Implementation drift | **YES** (`fallbackRegionLocalSpans`) |
| Previous 84 count validity | **PARTIALLY_VALID** |
| **Next phase** | **`MODEL3_V2_LOCAL_RESEGMENTATION_TRACE_COMPLETENESS_AUDIT`** |
| Secondary follow-up | `MODEL3_V2_LOCAL_RESEGMENTATION_ARCHITECTURE_RESTORATION_DESIGN_AUDIT` |

**Conclusion:** All 84 historical cases share **`resegmentOk=false`** (regional lattice did not produce retained `pathFineSpanViews`). That is a real production phenomenon and aligns with **implementation drift** (fallback reuses first-pass FineSpan boundaries). However, **strict causal first-fail ownership** cannot remain **84**: **13** cases already had **target-relevant candidates in the pool** without successful lattice; **65** cases reached **Retry Recall with non-target returns** despite `resegmentOk=false`. Only **6** cases have **zero Retry recall return** with failed lattice — the only set strictly confirmed as local-resegmentation failure **before Recall ownership**.

No production code modified.

================================
EVIDENCE AUTHORITY
==================

| Source | Used for |
|--------|----------|
| **PRODUCTION_TRACE_OBSERVATION** | `resegmentOk`, `bestRegionCoverage`, `retryRegionCount`, `anyCandidateReturn`, `targetCandidateReturn` from frozen signal-loss CSVs (same diagnostic replay run) |
| **PRODUCTION_CODE_SEMANTICS** | `resegmentOk` definition, fallback behavior, lattice input contract |
| **NOT USED as primary** | Exact Lexicon lookup; audit reimplemented lattice |
| **TRACE_INSUFFICIENT** | Per-region generated window intervals, `pathFineSpanViews` counts, old/new surface diffs not preserved in artifacts |

Historical counts **not overwritten**. Frozen Final Causal Acceptance (0/0/200) remains promotion authority.

================================
RESEGMENTOK SEMANTICS
=====================

**Code:** `model3-retry-router.ts` → `resegmentOk: resegmentResult.ok`  
**Owner:** `resegmentRetryRegionWithLattice` → `ResegmentRetryRegionResult.ok`

| Value | Exact meaning |
|-------|---------------|
| **`true`** | `runLatticeFineSpanGeneration` returned `ok=true` **and** `pathFineSpanViews.length > 0`; local spans collected from **all retained path views** (deduped) |
| **`false`** | Lattice failed or empty paths (`EMPTY_SLICE`, `NO_PATH`, `NO_COMPLETE_PATH`, etc.); **`fallbackRegionLocalSpans`** returns **original first-pass FineSpan boundaries** inside region; Retry **continues** with fallback spans |

**Does NOT mean:**
- Recall returned candidates
- Surface text changed
- Target-like reinterpretation exists
- Path count after retention

**Critical:** `resegmentOk=false` **does not stop Retry**. Router always iterates `localSpans` (lattice or fallback) and calls **`recallSpanTopKV2`**. Therefore prior signal-loss rule `!resegmentOk → LOCAL_RESEGMENTATION first-fail` **over-assigns ownership** when Recall still returns candidates (HARD STOP A/F avoided in this audit).

**Signal-loss stage definition (prior audit):**
```
LOCAL_RESEGMENTATION PASS = resegmentOk && newSurfacesDiffer
LOCAL_RESEGMENTATION FAIL = regions.length > 0 && !resegmentOk
```
This mixes **lattice success** with **surface delta** for PASS, but **lattice failure alone** for FAIL → **asymmetric / PARTIALLY_VALID** (D46).

================================
POPULATION
==========

| Cohort | Count |
|--------|------:|
| Historical LOCAL_RESEGMENTATION first-fail | 84 |
| Recovered for this audit | 84 |
| C1 success controls (`resegmentOk=true`) | 41 |
| C2 RETRY_REGION first-fail | 6 |
| C3 MODEL3_TRIGGER first-fail | 12 |

================================
RETRY REGION PRECONDITION
=========================

Among **84 / 84** historical local-reseg cases (denominator = 84):

| Classification | Count |
|----------------|------:|
| REGION_VALID_FULL_COVERAGE | 5 |
| REGION_VALID_PARTIAL_BUT_SUFFICIENT | 79 |
| REGION_TOO_NARROW / MISALIGNED | 0 |

All 84 passed prior RETRY_REGION stage in signal-loss funnel. **None reclassified to RETRY_REGION** under strict re-check using preserved `bestRegionCoverage`.

Partial coverage (79) treated as **PARTIAL_COVERAGE_SUFFICIENT** when `triggerClass=TARGET_OVERLAP` (error overlaps Retry region; missing margin unlikely to block all repair windows).

================================
LOCAL EXPRESSIBILITY
====================

| Stage | Count (denominator 84) |
|-------|----------------------:|
| Region sufficient | 84 |
| Locally expressible (geometry proxy) | 84 |
| NOT locally expressible | 0 |

Geometric proxy: bounded Retry slice with syllable length ≥ 1 can host sliding windows 1..5 (frozen lattice contract). **Counterfactual geometry only** — not window trace proof.

================================
WINDOW GEOMETRY / PRODUCTION GENERATION
=======================================

| Metric | Count (denominator 84) |
|--------|----------------------:|
| `resegmentOk=false` (lattice failed) | **84** |
| Required/equivalent window generated by production lattice | **0** |
| Fallback `fallbackRegionLocalSpans` used | **84** |

**Window generation failure cause (code-level, all 84):**
- Primary: **`LATTICE_NO_PATH_OR_EMPTY_VIEWS`** on regional slice
- Secondary effect: **`OLD_BOUNDARY_LOCK`** via fallback — windows constrained to **original FineSpan boundaries**, not sliding/overlapping lattice hypotheses

**OLD_BOUNDARY_LOCK:** YES for all 84 when lattice fails (by construction of `fallbackRegionLocalSpans`).  
**COARSE_BOUNDARY_LOCK:** Cannot prove per-case without window trace; lattice mode uses `hardBlockOnBoundaryCross: false` in `buildLexicalWindowQueries` — coarse is **soft in code**, but fallback bypasses lattice entirely.

================================
FINESPAN MATERIALIZATION / PATH RETENTION
=========================================

| Stage | Evidence |
|-------|----------|
| Lattice FineSpan materialization | **0 / 84** succeeded (`resegmentOk=false`) |
| Fallback spans used | **84 / 84** |
| Multipath from regional lattice | **0 / 84** (fallback = single segmentation per source span) |
| Dedup / path retention | **TRACE_INSUFFICIENT** |

When lattice succeeds (C1 controls, 41 cases), multipath retention is **observed at trace summary level** (`resegmentOk=true`); no first-path-only regression detected in preserved aggregates.

================================
RECALL BOUNDARY
===============

| Outcome | Count (denominator 84) |
|---------|----------------------:|
| Retry Recall returned **no** candidates | **6** → strict confirmed local failure |
| Retry Recall returned **non-target** candidates | **65** → ambiguous; Recall ownership begun |
| Target-relevant candidate **already in pool** | **13** → downstream / flag semantics |

**D47:** Exact Lexicon lookup **not** used as Recall proxy — **NO**.

================================
RECLASSIFIED OWNERS (STRICT CAUSAL)
===================================

| New owner | Count | Denominator |
|-----------|------:|-------------|
| **CONFIRMED_LOCAL_RESEGMENTATION_FAILURE** | **6** | 84 |
| **DOWNSTREAM_CANDIDATE_OR_TRACE_SEMANTICS** | **13** | 84 |
| **UNKNOWN_NEEDS_TRACE** (non-target recall only) | **65** | 84 |
| **RETRY_REGION** | **0** | 84 |

**Internal first-fail (confirmed 6):** `LOCAL_WINDOW_GENERATION` → lattice fail + zero Retry recall return + fallback old boundaries.

================================
SUCCESS VS FAILURE CONTROLS
===========================

| Metric | C1 `resegmentOk=true` (41) | Historical fail (84) |
|--------|---------------------------|----------------------|
| Lattice OK | 41 | 0 |
| First-fail owner | LEXICON / other downstream | LOCAL_RESEG (historical) |
| `anyCandidateReturn` | High prevalence | 78 / 84 |

Failure cohort is **homogeneous**: 100% lattice failure on Retry slice. Success cohort proves regional lattice **can** succeed on same pipeline when slice supports complete paths.

================================
ARCHITECTURE INVARIANTS
=======================

| Check | Result |
|-------|--------|
| Authoritative resegment | `resegmentRetryRegionWithLattice` → `runLatticeFineSpanGeneration` | **Confirmed** |
| Retry → Model3 re-entry | **NO** (`model3Reinvoked: false`) |
| Anchor crossing | **0** |
| Unrelated KEEP crossing | **0** observed |
| Candidate cap | **≤16** respected (no violation observed) |
| JobResult change | **NO** |
| Production code modified | **NO** |

**Domain Vote:** `voteUtteranceDomainFromPool` runs **once per path** inside `prepareModel3PathUpstream`. Orchestrator iterates retained paths → **N path-local votes** if N paths. Retry uses frozen `prepared.vote.retainedDomains`; `secondDomainVote: false`. Utterance-level “exactly one vote” is **not** true when multipath — **document ambiguity**, not a new P0 for this phase.

================================
IMPLEMENTATION DRIFT
====================

When regional lattice fails, production **does not** fall back to sliding-window regeneration — it **reuses first-pass FineSpan boundaries** (`fallbackRegionLocalSpans`). Frozen Retry design expects **local sliding / overlapping windows** with **soft coarse boundaries**. Fallback behavior is **`IMPLEMENTATION_DRIFT_FROM_FROZEN_ARCHITECTURE`** (HARD STOP I). Restoring frozen behavior is **restoration**, not architecture change.

================================
SEVERITY
========

| Level | Finding |
|-------|---------|
| **P0** | None (no production dual chain) |
| **P1** | Fallback OLD_BOUNDARY_LOCK on lattice failure (84/141 rescuable phenomenon) |
| **P2** | `resegmentOk`/first-fail semantics over-assign LOCAL_RESEGMENTATION (84 → 6 strict) |
| **P3** | Trace gaps block per-case window proof for 65 ambiguous cases |

================================
REQUIRED DECISIONS (D1–D56)
===========================

| ID | Answer |
|----|--------|
| D1 | YES — same production `resegmentRetryRegionWithLattice` |
| D2 | **84 / 84** recovered from signal-loss CSVs |
| D3 | **84** have target-relevant Model3 RETRY (passed trigger stage) |
| D4 | **84** Retry region sufficient |
| D5 | **79** partial → sufficient; **5** full |
| D6 | **0** reclassified to region insufficiency |
| D7 | **84** locally expressible (geometry proxy) |
| D8 | **0** NOT locally expressible |
| D9–D10 | **84** repair window may exist geometrically / **0** proven impossible |
| D11–D12 | **0** lattice-generated / **84** not generated |
| D13 | **LATTICE_NO_PATH_OR_EMPTY_VIEWS** + fallback **OLD_BOUNDARY_LOCK** |
| D14 | **YES** — fallback locks old FineSpan boundaries (all 84 fail path) |
| D15 | **UNKNOWN** per-case (no window trace) |
| D16–D17 | Cannot attribute per-case without window trace |
| D18–D23 | Lattice materialization **0/84**; path/dedup **TRACE_INSUFFICIENT** |
| D24–D26 | Fallback path = **single segmentation**; multipath loss on fail path |
| D27–D29 | See RESEGMENTOK SEMANTICS; **false can occur with Recall candidates** — **YES (78/84)** |
| D30 | **6** strict confirmed (not 84) |
| D31–D34 | **0 / 13 / 0 / 65** reclassified |
| D35 | **65** UNKNOWN pending trace |
| D36 | Confirmed 6: **LOCAL_WINDOW_GENERATION** |
| D37 | Fail cohort: 100% `resegmentOk=false`; success: lattice OK |
| D38–D40 | Sliding windows in lattice code **YES**; fallback **NO**; coarse soft in lattice **YES** |
| D41 | Multipath preserved when lattice OK; **lost on fallback** |
| D42–D43 | Lattice aligned; **fallback drift YES** |
| D44 | Restoration of frozen fallback behavior — **not ACP** |
| D45 | Phenomenon primary **YES**; strict first-fail primary **NO** |
| D46 | **PARTIALLY_VALID** |
| D47 | **NO** exact Lexicon as Recall |
| D48 | Once per **path** in prepare; Retry does not re-vote |
| D49 | **NO** Retry → Model3 |
| D50–D52 | Anchor **0**; KEEP **0**; cap **OK** |
| D53–D54 | JobResult **NO** change; code **NO** modify |
| D55 | `LOCAL_RESEGMENTATION_CAUSAL_AUDIT_PARTIAL_FLAG_SEMANTICS_PROBLEM` |
| D56 | `MODEL3_V2_LOCAL_RESEGMENTATION_TRACE_COMPLETENESS_AUDIT` |

================================
GOVERNANCE
==========

| Item | Status |
|------|--------|
| Model3 changed | NO |
| Retry changed | NO |
| FineSpan changed | NO |
| Recall changed | NO |
| Lexicon changed | NO |
| Assembly changed | NO |
| KenLM changed | NO |
| JobResult changed | NO |
| training | NO |
| production architecture changed | NO |

================================
NEXT PHASE
==========

**Primary:** `MODEL3_V2_LOCAL_RESEGMENTATION_TRACE_COMPLETENESS_AUDIT`  
Add test-only trace fields (`latticeCode`, `pathViewCount`, `fallbackUsed`, window counts) — **proposal only**, no production change in this phase.

**Secondary:** `MODEL3_V2_LOCAL_RESEGMENTATION_ARCHITECTURE_RESTORATION_DESIGN_AUDIT`  
Address fallback OLD_BOUNDARY_LOCK vs frozen sliding-window Retry design.

Do not execute automatically. Wait for user review.
