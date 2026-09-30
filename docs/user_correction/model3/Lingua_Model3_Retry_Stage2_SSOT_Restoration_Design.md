# Lingua — Delta 1 Retry Stage-2 Query Enumeration SSOT Restoration Design

Generated: 2026-09-03T20:11:49Z  
Phase: `MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DESIGN`  
Mode: READ-ONLY DESIGN — no production change

================================
1. EXECUTIVE VERDICT
====================

**MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DESIGN_PASS_IMPLEMENTATION_READY**

Next phase: `MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DEVELOPMENT`

Control variable: `RETRY_STAGE2_QUERY_ENUMERATION_SOURCE` only.

Preferred design: **OPT_A_REENUMERATE_WINDOWS_ON_SUCCESS**

- Stage-2 semantic contract: legal **overlapping lexical windows (1..5)** inside fixed RetryRegion  
- Owner: **SHARED_LEXICAL_WINDOW_OWNER** (Lattice Window Generator / `window-construction-core`)  
- Implementation: reuse `buildLexicalWindowQueries` / `buildWindowDescriptorForRange` on **LATTICE success path only**  
- Delta 2 fallback: **unchanged**  
- DECISION_REQUIRED: **empty**  
- Automatic drift gate: **PASS**

================================
2. AUTHORITATIVE SSOT EVIDENCE
=============================

| ID | Clause | Implication |
|----|--------|-------------|
| S2-01 | RETRY ≠ recall at frozen FineSpan boundaries | localSpan-only sole source is invalid |
| S2-02 | re-segmentation + re-recall in region | Stage-2 re-recalls legal local units |
| S2-03 | reuse window generation; recallSpanTopKV2 and/or recallTopKForWindows | windows are legal query units |
| S2-04 | Window Generator owns 1..5 | N=5 not reinvented |
| S2-05 | windows overlap; path FineSpans do not | Stage-2 = window space |
| S2-07 | Historical answer | **Not A**; Unit#1 selects **B** |

See `model3_retry_stage2_semantic_contract.csv`.

================================
3. CURRENT STAGE-2 CALL GRAPH
=============================

```text
RetryRegion (FIXED)
 → regional slice
 → runLatticeFineSpanGeneration
      → buildLexicalWindowQueries (1..5)     ← WINDOW SPACE EXISTS
      → recallTopKForWindows
      → edges → pathFineSpanViews
 → collectLocalSpansFromRetainedPathViews   ← KEEPS FineSpan geometry only
 → RetryRegionLocalSpan[]
 → Stage-2 for each localSpan               ← QUERY SET = FineSpan bounds only
      → windowText/pinyin inline
      → recallSpanTopKV2
 → materialize → merge → Assembly…
```

Fallback (OUT OF SCOPE): `resegmentOk=false` → `fallbackRegionLocalSpans` → same localSpan loop.

================================
4. STAGE-2 SEMANTIC CONTRACT
============================

Inside an already-legal RetryRegion, after successful regional reinterpretation, Stage-2 MUST make expressible to authoritative Recall:

**every contiguous syllable window of length L ∈ [1, min(5, R)] whose syllable range lies entirely inside the RetryRegion**, with correct global raw/syllable offsets, pinyin key, and existing tone attachment rules.

Stage-2 MUST NOT:

- treat retained PathFineSpan / localSpan boundaries as the exclusive query set  
- widen RetryRegion / cross Anchor / unrelated KEEP  
- change Domain Vote / Model3 / Recall algorithm  
- alter fallback (Delta 2).

================================
5. WINDOW VS PATH SEMANTICS
===========================

| Concept | Role |
|---------|------|
| Lattice WINDOW | Overlapping candidate lexical query unit (1..5) |
| Retained PATH FINESPAN | Non-overlapping segmentation hypothesis |

Unit #1 Stage-2 operates on **region-level WINDOW SPACE** (Lattice model: windows before paths).  
Path identity is preserved when materializing hits onto overlapping source FineSpans (existing `overlappingOriginalSpans` / owner binding).

================================
6. QUERY ENUMERATION OWNERSHIP
==============================

| Layer | Classification |
|-------|----------------|
| Semantic owner | **SHARED_LEXICAL_WINDOW_OWNER** |
| Code | `window-construction-core` + `buildLexicalWindowQueries` |
| Stage-2 | **CONSUMER** — chooses when to invoke inside RetryRegion |
| Not frozen | Function name must equal `buildLexicalWindowQueries` |

================================
7–8. EXISTING HELPER / buildLexicalWindowQueries
================================================

`buildLexicalWindowQueries` **does** implement the required contiguous 1..5 enumeration semantics.  
It is already production-used by lattice (comment “harness only” is STALE).

| Question | Answer |
|----------|--------|
| Full utterance required? | NO — works on region slice |
| Bounded region? | YES if caller passes slice or clips |
| Global offsets? | Adapter if slice-local; or descriptor on full utterance with clipped starts |
| Cross Anchor/KEEP? | NO if confined to RetryRegion |
| N? | 1..5; Lattice owns N |
| L=1? | YES; Recall enforces single-char contract |
| Does Recall/domain? | NO |

**Direct reuse: YES_WITH_MINIMAL_COORDINATE_ADAPTER.**

================================
9. CURRENT SEMANTIC LOSS
========================

First loss of cross-localSpan lexical expressibility:

**collectLocalSpansFromRetainedPathViews → Stage-2 localSpan-only loop**

| Transition | Preserved | Discarded |
|------------|-----------|-----------|
| Lattice windows → edges/paths | path geometry | overlapping window set as query space |
| pathFineSpanViews → localSpans | remapped FineSpan bounds | lattice Stage-1 candidates |
| localSpans → Stage-2 queries | FineSpan-length queries only | any window spanning ≥2 FineSpans |

================================
10–11. DESIGN OPTIONS / PREFERRED
=================================

See `model3_retry_stage2_design_options.csv`.

| Option | Verdict |
|--------|---------|
| OPT_A re-enumerate windows on success | **PREFERRED** |
| OPT_B consume lattice windows | REJECT_FOR_UNIT1_SCOPE |
| OPT_C recallTopKForWindows switch | Rejected — beyond enumeration-source variable |

================================
12. BEFORE / AFTER CONTRACT
===========================

**BEFORE** (resegmentOk): Stage-2 query set = localSpans only; cannot express cross-FineSpan windows.

**AFTER** (same region/barriers/resegment): Stage-2 query set = all legal 1..5 windows inside region; localSpan-length queries remain as subset.

**UNCHANGED:** Model3, RetryRegion, barriers, Domain Vote, Model2, Recall algorithm, Lexicon, Assembly, KenLM, cap≤16, JobResult, **Delta 2**.

================================
13. PERFORMANCE BOUND
=====================

`sum_{L=1..min(5,R)}(R-L+1)` per region.  
Typical R=2..4 → 3..14; worst observed R=7 → 25. **Bounded.** Cap≤16 unchanged.

================================
14. TRACE CONTRACT
==================

Compare BEFORE/AFTER at Stage-2:

- retryRegionId, resegmentOk / localSpanSource  
- localSpans[]  
- enumeratedQueries[] (syllableStart/End, rawStart/End, windowText, windowPinyinKey, querySource=WINDOW)  
- rawRecallInvocation linkage  

Side-channel only; **no JobResult fields**.  
First semantic delta must be at **STAGE2_QUERY_ENUMERATION**.

================================
15. CONTROL COHORTS
===================

See `model3_retry_stage2_control_cohorts.csv`.  
Exclude KEEP_ON_LOCUS / no-region and fallback-only from Unit #1 primary gate.

Frozen baseline: ~50 cases with any resegmentOk; ~43 multipath+ok.

================================
16. AUTOMATIC DRIFT GATE
========================

See `model3_retry_stage2_drift_gate.csv` — **all PASS**.

================================
17. DECISION_REQUIRED_BEFORE_DEVELOPMENT
=======================================

**(empty)**

SSOT determines Not-A / windows required. OPT_A selected for Unit #1 isolation without unresolved ownership conflict. No ACP.

================================
18. TARGET LIST
===============

Production (≤3):

1. `model3-retry-router.ts` — Stage-2 success-path query enumeration  

Reuse only (no semantic rewrite): `build-lexical-window-queries.ts`, `window-construction-core.ts`

Do **not** touch: `fallbackRegionLocalSpans`, `deriveRetryRegions`, Model3, Recall internals, JobResult.

================================
19. CHECK LIST
==============

- [x] one variable only  
- [x] Stage-2 enumeration only  
- [x] RetryRegion unchanged  
- [x] barriers unchanged  
- [x] Model3 unchanged  
- [x] Domain Vote unchanged  
- [x] Model2 unchanged  
- [x] Recall algorithm unchanged  
- [x] Lexicon unchanged  
- [x] Delta 2 unchanged  
- [x] multipath preserved  
- [x] single-character contract preserved (via Recall)  
- [x] candidate cap <=16  
- [x] JobResult unchanged  
- [x] no config flag  
- [x] no compatibility path  
- [x] no case-specific logic  
- [x] no reference leakage  
- [x] no heldout tuning  
- [x] trace first change at Stage-2  
- [x] downstream replay planned  

================================
20. NEXT PHASE
==============

`MODEL3_RETRY_STAGE2_SSOT_RESTORATION_DEVELOPMENT`

Exactly one.
