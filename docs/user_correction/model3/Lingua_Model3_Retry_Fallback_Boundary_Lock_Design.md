# Lingua — Close Delta 1 / Delta 2 Retry Fallback Boundary Lock Design Audit

Generated: 2026-09-04T07:42:00Z  
Phase: `MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DESIGN`  
Mode: DELTA1 CLOSURE + READ-ONLY DELTA2 DESIGN AUDIT  
Production changes: **NONE**

================================
1. DELTA 1 CLOSURE RECORD
=========================

| Item | State |
|------|--------|
| `DELTA_RQ_STAGE2_NO_SLIDING` | **RESOLVED_ACCEPTED** — **CLOSED** |
| `RETRY_STAGE2_SUCCESS_PATH_QUERY_ENUMERATION` | **LEGAL_BOUNDED_WINDOW_SPACE_1_TO_5** |

Accepted baseline (evidence only; does not redefine architecture):

- successful regions 164; windows 877/877; missing/extra/outOfRegion 0  
- coordinate mismatch 0; previous valid queries missing 0  
- cross-FineSpan 400/400 queried; preferred-path collapse 0  
- Anchor/KEEP crossing 0; L=1 violations 0  
- second Domain Vote / second Model3 / recursive Retry / ASR rerun = 0  
- cross-path sentence pool max 8 ≤ 16  

**Do not reopen Delta 1** unless direct regression proves the accepted success-path contract is violated.  
This design does **not** re-audit, redesign, modify, or optimize Delta 1.

================================
2. EXECUTIVE VERDICT
====================

**MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DESIGN_PASS_IMPLEMENTATION_READY**

Open variable (exactly one):

`RETRY_FALLBACK_GEOMETRY_SOURCE`

Preferred design: **OPT_A_REGION_DIRECT_WINDOW_ENUM**

- Fallback semantics: **A** — regional path unavailable, but bounded lexical query reinterpretation still possible inside authoritative RetryRegion  
- Geometry owner: **SHARED_LEXICAL_WINDOW_OWNER** (query geometry), hard-bounded by **RetryRegion**  
- Candidate owner: existing **overlappingOriginalSpans** → first-pass path FineSpan (`originSpanId`)  
- Delta 1 reuse: **DIRECT_REUSE_SAFE** of accepted Stage-2 window consumer  
- `resegmentOk=false` remains false (no fake success)  
- `DECISION_REQUIRED_BEFORE_DEVELOPMENT`: **EMPTY**  
- Automatic drift gate: **PASS**  

Next phase: **`MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DEVELOPMENT`**

================================
3. DELTA 2 CURRENT CALL GRAPH
=============================

```text
RetryRegion (AUTHORITATIVE bounds; already barrier-safe)
 → regional slice (raw/syllables)
 → resegmentRetryRegionWithLattice
      → runLatticeFineSpanGeneration
      → on fail: fallbackRegionLocalSpans(sourceSpanIds → first-pass FineSpan bounds)  ← OLD_BOUNDARY_LOCK
 → router: localSpans = result.localSpans | fallback…
 → Stage-2: if !resegmentOk → for each localSpan (FineSpan-locked)          ← Delta2 fault
            if  resegmentOk → enumerateStage2SuccessPathQueryLocals (Delta1 CLOSED)
 → recallSpanTopKV2 (unchanged)
 → materializeLocalSpanHits / overlappingOriginalSpans
 → per-span merge → Assembly(same vote) → CrossPath≤16 → KenLM
```

| Transition | Producer | Consumer | Semantic guarantee | Fallback assumption | First-pass boundary dependency | Arch required? |
|------------|----------|----------|--------------------|---------------------|--------------------------------|----------------|
| deriveRetryRegions → region | Model3 decisions + path FineSpans | resegment/router | Hard raw/syl bounds; no Anchor/KEEP cross | Region valid even if lattice fails | Region edges from FineSpans | **YES** (RetryRegion SSOT) |
| lattice fail → fallbackRegionLocalSpans | resegment helper | Stage-2 (today) | Copies source FineSpan bounds | “No path ⇒ reuse suspicious geometry” | **YES — query authority** | **NO — proven drift** |
| localSpan → Recall | Stage-2 | recallSpanTopKV2 | Query text/pinyin/topK | Same as FineSpan lock today | Yes on fallback | Implementation only |
| hits → materialize | overlap owner | Assembly pool | `originSpanId` = first-pass FineSpan | Overlap works for non-exact windows | Supporting identity | **YES** (existing ownership) |
| pool → Assembly | buildFineSpanCandidatePool | completeDomainAwareAssemblyFromVote | Same vote/path | Mutated candidates still FineSpan-bound | Uses origin FineSpan IDs | **YES — no Assembly change** |

================================
4. RESEGMENT FAILURE TAXONOMY
=============================

Code-level failure classes (not all frequencies instrumented in accepted dump):

| failureClass | Location | Replay frequency |
|--------------|----------|------------------|
| EMPTY_SLICE | empty region text/syllables | NOT_INSTRUMENTED_IN_TRACE |
| LATTICE_FAIL_OR_NO_PATH | `!lattice.ok` or empty `pathFineSpanViews` (`EMPTY_INPUT`, `COVERAGE_INVARIANT`, `NO_COMPLETE_PATH`, `MATERIALIZATION_FAILED`, `EMPTY_DOMAIN_SCOPE`, `NO_PATH`) | DOMINANT of 400 (code not traced) |
| RESEGMENT_EXCEPTION | catch | NOT_INSTRUMENTED_IN_TRACE |

Workload observation (accepted AFTER; **not** architecture):

- **400** `resegmentOk=false` regions; **164** success  
- Fail R hist: R2=131, R3=94, R4=92, R1=42, R5=31, R6=10  
- Surface-count hist: 1→106, 2→73, 3→95, 4→93, 5→33  
- Cross-FineSpan legal-window potential ≈ **267**  
- Multipath cases with regions: **101**  

**Not semantically identical:** R=1 vs R≥2 multi-1-char FineSpan lock vs long R=6 pressure differ in query cardinality; all share the same **geometry-authority** defect (first-pass FineSpan lock).

Future development **must** trace `fallback reason / code` (side-channel).

See `model3_retry_fallback_failure_taxonomy.csv`.

================================
5. FALLBACK INPUT INVENTORY
===========================

At fallback entry (`resegmentOk=false`), still valid:

| Object | Class |
|--------|--------|
| RetryRegion raw/syllable bounds | AUTHORITATIVE |
| region raw text / global syllables | AUTHORITATIVE |
| pinyin from syllable slice | AUTHORITATIVE |
| retainedDomains / source pathId | AUTHORITATIVE |
| Anchor/KEEP (already in region derivation) | AUTHORITATIVE |
| original path FineSpans | VALID_SUPPORTING_EVIDENCE (ownership) / **STALE_FOR_REINTERPRETATION** (query geometry) |
| tone on owner FineSpan | VALID_SUPPORTING_EVIDENCE |
| regional retained path / lattice windows | FAILED_DERIVATION |
| first-pass FineSpan bounds as Stage-2 queries | STALE_FOR_REINTERPRETATION |

See `model3_retry_fallback_ownership_map.csv`.

================================
6. FIRST-PASS BOUNDARY DEPENDENCY
=================================

Today: **Stage-2 query geometry authority = first-pass FineSpan bounds** via `fallbackRegionLocalSpans`.

Architecture: FineSpan = local geometry/identity, **not** guaranteed lexical word / hard Retry boundary.

Therefore first-pass FineSpan bounds **must not** remain fallback query authority.

They **may** remain supporting evidence for candidate ownership (overlap).

================================
7. FALLBACK GEOMETRY OWNER
==========================

**SHARED_LEXICAL_WINDOW_OWNER**

Hard bounds: **RetryRegion** (unchanged).

Code map: `buildLexicalWindowQueries` / `buildWindowDescriptorForRange` / accepted `enumerateStage2SuccessPathQueryLocals` consumer.

Not: REGIONAL_LATTICE_OWNER (failed).  
Not: EXISTING_FALLBACK_OWNER (`fallbackRegionLocalSpans` — lock owner to remove).  
Not: new owner.

================================
8. QUERY GEOMETRY VS CANDIDATE OWNERSHIP
=======================================

| Concern | Answer |
|---------|--------|
| Does Stage-2 Recall require new FineSpan segmentation on fallback? | **NO** |
| Can Stage-2 operate on RetryRegion + legal window descriptors? | **YES** (Delta1 already does on success) |
| Who owns Recall candidates when window ≠ FineSpan? | **overlappingOriginalSpans** → first-pass `PathFineSpan` / `originSpanId` |
| New FallbackSpan / SyntheticFineSpan / RetryVirtualPath? | **FORBIDDEN / unnecessary** |

Proven by Delta1 acceptance: cross-FineSpan windows queried with overlap ownership; Assembly unchanged.

================================
9. ASSEMBLY CONTRACT
====================

Assembly consumes `FineSpanCandidatePool` / `WindowCandidate` with:

- `originSpanId` (first-pass FineSpan)  
- raw/syllable bounds on candidates (materialized onto owner FineSpan extents today)  
- same Domain Vote  

Does **not** require successful regional FineSpan IDs or a synthetic regional path.

**Can Delta2 be fixed without changing Assembly?** **YES.**

================================
10. DOMAIN / PATH CONTRACT
==========================

- No second Domain Vote  
- Fallback stays under existing retainedDomains + per-path `routeModel3Retry`  
- Multipath: each path independently falls back; **no preferred-path** restoration  
- Do not invent a regional path when resegmentation failed  

================================
11. DELTA 1 REUSE ASSESSMENT
============================

**DIRECT_REUSE_SAFE**

Same contract applies despite failed regional resegmentation because:

1. RetryRegion remains the authoritative hard bound  
2. Frozen Retry semantics demand bounded reinterpretation, not FineSpan lock  
3. Legal window space 1..min(5,R) is region-level WINDOW SPACE (not path FineSpan space)  
4. Candidate ownership already supports non-exact windows  
5. Reuse must **not** flip `resegmentOk` to true  

Implementation: call the same enumeration consumer on the `!ok` branch; success branch **byte/semantic untouched**.

================================
12. DESIGN OPTIONS
==================

| ID | Idea | Prefer? |
|----|------|---------|
| **OPT_A** | RetryRegion-direct legal window enum on fallback; reuse overlap ownership | **YES** |
| OPT_B | Duplicate window-core adapter at fallback site only | NO (dual-adapter drift) |
| OPT_C | Harvest partial lattice windows/edges without retained path | NO (fake-success / high risk) |

Invalid (excluded): keep OLD_BOUNDARY_LOCK; widen KEEP; second Model3/Vote/ASR; new regional path architecture.

See `model3_retry_fallback_design_options.csv`.

================================
13. PREFERRED DESIGN
====================

**OPT_A_REGION_DIRECT_WINDOW_ENUM**

Conceptual delta:

```text
BEFORE:
  if resegmentOk: Delta1 legal windows
  else: fallbackRegionLocalSpans as Stage-2 query geometry

AFTER:
  if resegmentOk: UNCHANGED Delta1
  else: same legal bounded window enumeration inside RetryRegion
        (resegmentOk stays false; localSpanSource=FALLBACK)
```

`fallbackRegionLocalSpans`: **RETAIN_FOR_NON_GEOMETRY_PURPOSE** (optional supporting/trace of original boundaries) — **must not** own Stage-2 query geometry after Delta2.

Failure semantics: **A** (single simple contract for all current failure classes that still have region bounds). EMPTY_SLICE with R=0 remains empty query set (degenerate).

================================
14. BEFORE / AFTER CONTRACT
===========================

**BEFORE** (`resegmentOk=false`, same RetryRegion):

- Stage-2 geometry = first-pass FineSpan bounds (`fallbackRegionLocalSpans`)  
- first-pass boundary dependency = **query authority**

**AFTER** (`resegmentOk=false`, same RetryRegion):

- Stage-2 geometry = legal contiguous windows L=1..min(5,R) inside RetryRegion  
- first-pass boundary dependency = **ownership support only** (overlap)

**UNCHANGED:** Delta1 success path, Model3, RetryRegion, barriers, regional lattice, `resegmentOk` meaning, Domain Vote, Model2, Recall, Lexicon, Assembly, KenLM, candidate cap, JobResult.

================================
15. PERFORMANCE BOUND
=====================

| Metric | Estimate |
|--------|----------|
| fallback regions | 400 (accepted replay) |
| current approx queries | ~1074 (surface counts) |
| OptA expected windows | ~2584 (= Σ theor(R)) |
| bound | Σ(R−L+1), L=1..min(5,R); max R observed 6 → 20 windows/region |
| unique after existing dedup | ≤ enumerated; reuse utterance cache / query-key dedup — **no new cache** |
| internal working pressure | may rise above Delta1’s maxPostRetryWorking=30 — **NONBLOCKING report**; cross-path cap remains ≤16 |
| hard budget violation? | **NO** predicted for sentence pool ≤16 → not DECISION_REQUIRED |

================================
16. CONTROL COHORTS
===================

Real fallback cohorts (from accepted AFTER; see CSV):

| Cohort | Need |
|--------|------|
| A_R1_FALLBACK | L=1 contract |
| B_R2PLUS_1CHAR_FINESPANS | escape 1-char FineSpan lock |
| C_CROSS_FINESPAN_LEGAL_WINDOW | cross-boundary legal window |
| D_MULTIPATH | no preferred-path collapse |
| E_BARRIER_ADJACENT / F_KEEP_ADJACENT | zero barrier/KEEP cross |
| G_FALLBACK_WITH_RECALL_HIT | ownership reaches downstream |
| H_LONG_HIGH_QUERY | bound/pressure |

No reference targets in runtime design.

================================
17. TRACE CONTRACT (FUTURE)
===========================

Side-channel only: utteranceId, pathId, retryOperationId, RetryRegion, `resegmentOk=false`, **fallback reason/code**, original FineSpans, **fallbackGeometrySource**, query descriptors/offsets, Recall, raw candidates, owner binding, Assembly input, cross-path, KenLM.  
No JobResult change.

================================
18. AUTOMATIC DRIFT GATE
========================

All required questions: **NO** unexpected change.  
See `model3_retry_fallback_drift_gate.csv`.

================================
19. DECISION_REQUIRED_BEFORE_DEVELOPMENT
=======================================

| Question | Answer |
|----------|--------|
| New FineSpan identity? | **NO** |
| Regional path required? | **NO** |
| Fallback geometry owner? | **SHARED_LEXICAL_WINDOW_OWNER** |
| Candidate materialization owner? | **overlappingOriginalSpans / first-pass FineSpan** |
| Existing overlap reuse? | **YES (proven)** |
| Delta1 window core reuse? | **DIRECT_REUSE_SAFE** |
| Assembly accepts without successful reseg? | **YES** |
| Fix without Assembly change? | **YES** |
| Fix without Recall change? | **YES** |
| Isolate from Delta1? | **YES** (success branch untouched) |

**DECISION_REQUIRED_BEFORE_DEVELOPMENT = EMPTY**  
`implementationReady = TRUE`

================================
20. TARGET LIST
===============

| Action | Target |
|--------|--------|
| **MODIFY** | `model3-retry-router.ts` — fallback Stage-2 query source only |
| **REUSE** | `enumerateStage2SuccessPathQueryLocals` / window-construction-core / `overlappingOriginalSpans` / `recallSpanTopKV2` |
| **RETAIN (non-geometry)** | `fallbackRegionLocalSpans` for optional trace/supporting surfaces |
| **DELETE (authority)** | use of `fallbackRegionLocalSpans` as Stage-2 **query geometry** authority |
| **READ_ONLY** | Model3, deriveRetryRegions, lattice, Assembly, KenLM, Lexicon, Domain Vote |
| **TESTS** | fallback window-set == legal 1..5; Delta1 success parity; barrier/KEEP/multipath/L=1; no `resegmentOk` flip |
| **TRACE** | fallback reason + geometrySource side-channel |

Preferred production files: **1–2** (max 3).

================================
21. CHECK LIST
==============

- [x] Delta 1 closed  
- [x] Delta 1 success path unchanged (design)  
- [x] one Delta 2 variable only  
- [x] RetryRegion / barriers / resegmentOk semantics unchanged  
- [x] first-pass FineSpan no longer fallback geometry authority (design)  
- [x] candidate ownership proven  
- [x] Assembly compatibility proven  
- [x] Domain/path / multipath preserved  
- [x] Model3 / Vote / Model2 / Recall / Lexicon / Assembly / KenLM unchanged  
- [x] single-character contract preserved  
- [x] candidate cap ≤16  
- [x] JobResult unchanged  
- [x] no feature flag / compatibility chain / new architecture owner  
- [x] no case-specific / reference leakage  
- [x] performance bounded  
- [x] DECISION_REQUIRED empty  

================================
22. NEXT PHASE
==============

**MODEL3_RETRY_FALLBACK_BOUNDARY_LOCK_DEVELOPMENT**

Do not start other deltas. Do not reopen Delta 1.
