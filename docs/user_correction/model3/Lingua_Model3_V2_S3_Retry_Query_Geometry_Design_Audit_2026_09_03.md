# Lingua Model3 V2 S3 — Retry Query Geometry Correction Design Audit

Generated: 2026-09-03T11:12:39Z  
Phase: `MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CORRECTION_DESIGN_AUDIT`

================================
EXECUTIVE VERDICT
=================

**MODEL3_S3_RETRY_QUERY_GEOMETRY_OWNER_NOT_ISOLATED**

Next phase: `MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CAUSAL_LOCALIZATION_COMPLETION`

Preferred design: **NO_DESIGN_SELECTION_YET**

KEEP_ON_LOCUS dominates (161/159). OPT1/OPT2 only enumerate windows inside existing RETRY regions and cannot reach KEEP-marked loci. OPT3 (widen into KEEP) violates frozen 'no unrelated KEEP crossing by default'. Model3 change is out of this phase's Query Geometry ownership. Next: causal localization completion separating MODEL3_TRIGGER_KEEP_ON_LOCUS vs in-region Stage-2 SSOT drift (OPT1+OPT2 secondary).

Measured Query share **166/237 = 70.04%** applies only among **lexically-evaluable repair events** — **not** overall system error prevalence. Lexicon prevalence remains **UNRESOLVED**.

================================
SSOT AUTHORITY MAP
==================

| Domain | Authority |
|--------|-----------|
| FineSpan | Frozen soft overlapping windows; NOT hard lexical boundary |
| Domain Vote | ONE per retained path; Retry MUST NOT re-vote |
| Model3 | KEEP/RETRY only; one decision stage |
| Retry | ONE bounded operation; barriers; reuse FineSpan/Recall |
| Recall | Existing recallSpanTopKV2; no threshold tuning this phase |
| Candidate pool | ≤16 |
| JobResult | Transport only — no audit fields |

Stale docs that treat FineSpan as hard Retry boundary or Stage-2 as same-boundary Recall: **SUPERSEDED**.

================================
FROZEN ARCHITECTURE CHECK
=========================

Mainline singular. No second Domain Vote / Model3 / recursive Retry / ASR rerun observed in frozen traces (`secondDomainVote=false`, `model3Reinvoked=false`).

**SSOT drift found:** Stage-2 RAW_RECALL does **not** reuse `buildLexicalWindowQueries` sliding windows; fallback may lock to first-pass FineSpan bounds.

================================
CURRENT RETRY CALL GRAPH
========================

See `model3_v2_s3_retry_query_call_graph.csv`.

```
Model3 KEEP|RETRY
 → maskAnchorDecisions
 → routeModel3Retry
    → deriveRetryRegions (RETRY-only adjacent merge; KEEP/Anchor break)
    → resegmentRetryRegionWithLattice
         → runLatticeFineSpanGeneration (Stage-1 windows 1..5)
         → collectLocalSpansFromRetainedPathViews (multipath union)
         OR fallbackRegionLocalSpans (OLD_BOUNDARY_LOCK)
    → for each localSpan: windowText/pinyin → recallSpanTopKV2  (Stage-2)
 → RAW_RECALL_OUTPUT
```

================================
RESPONSIBILITY / OWNERSHIP MAP
==============================

| Responsibility | Owner function | Duplicated? |
|----------------|----------------|-------------|
| RETRY decision | Model3 inferPath | NO |
| Retry region | deriveRetryRegions | NO |
| Barrier | isRetryEligible + maskAnchorDecisions | SPLIT (path-step + region) |
| Local re-segmentation | resegmentRetryRegionWithLattice | NO |
| Regional path enum | collectLocalSpansFromRetainedPathViews | NO |
| Query surface/pinyin/tone | routeModel3Retry Stage-2 loop | YES vs window-construction-core formula |
| Recall lookup | recallSpanTopKV2 | NO |

**DUPLICATED_OWNERSHIP:** barrier split; query-key formula copy; Stage-1 vs Stage-2 window enumeration divergence.

================================
TRACE CONTRACT
==============

Frozen provenance has regions + rawRecalls + decisions, but **missing** barrier edge fields, regional FineSpan dumps, queryId, dropReason, retryOperationId.

See `model3_v2_s3_retry_query_trace_contract.csv`.

Runtime instrumentation for this design audit: **not newly added** — consumed existing frozen candidate provenance. TRACE_ON/OFF parity for new fields: **deferred to TRACE_COMPLETION**.

================================
159 PARTIAL-COVERAGE FIRST-LOSS ANALYSIS
========================================

Aggregate FIRST_GEOMETRY_LOSS_STAGE: `{'MODEL3_RETRY_SPAN': 166}`

Drop reasons: `{'SPAN_NOT_MARKED_RETRY_ON_ASR_LOCUS': 166}`

Coverage relations: `{'DISJOINT': 159, 'NO_QUERY': 7}`

Resegment: `{'ANY_OK': 46, 'ALL_FAIL': 113, 'NO_REGION': 7}`

**Dominant code condition (not merely "region too short"):**
Exact condition: PathFineSpans overlapping ASR repair locus are KEEP (161/166 query fails). isRetryEligible requires decision==='RETRY'; KEEP flush in deriveRetryRegions excludes locus; Stage-2 never queries it. Not merely 'region too short'.

locusDecisionClass: `{'KEEP_ON_LOCUS': 161, 'NO_SPAN_ON_LOCUS': 5}`  
nearestRegionGap: `{'GAP_2_TO_5': 52, 'TOUCHING_OR_OVERLAP': 16, 'GAP_GT_5': 78, 'GAP_1': 13, 'NO_REGION': 7}`

Exact condition in code:
- `isRetryEligible` requires `decision === 'RETRY'` and non-Anchor
- KEEP/Anchor flush breaks merge groups (`model3-retry-region.ts`)
- ASR locus spans are **KEEP** → region cannot include them → Stage-2 never queries the locus
- Audit label `RETRY_REGION_PARTIAL_COVERAGE` = regions exist elsewhere but **none overlap** the ASR locus

================================
7 NO-RAW-RECALL-REGION ANALYSIS
===============================

Typically: no repair-capable query recorded for the locus — often zero RETRY on locus and/or empty rawRecalls. Structurally related to region miss; not a separate Recall-threshold problem.

================================
SUCCESSFUL QUERY CONTROLS
=========================

See `model3_v2_s3_retry_query_controls.csv` (Recall-miss / KenLM / survived cohorts).  
OPT1 must remain **additive** inside existing regions so currently adequate keys are preserved.

================================
ARCHITECTURE DRIFT AUDIT
========================

| Item | Status |
|------|--------|
| same-boundary Retry (fallback) | PRESENT_ACTIVE |
| Stage-2 no sliding windows | PRESENT_ACTIVE (**SSOT drift**) |
| single preferred regional path | ABSENT |
| second Domain Vote | ABSENT |
| second Model3 | ABSENT |
| recursive Retry | ABSENT |
| ASR rerun | ABSENT |

================================
ROOT CAUSE
==========

Two coupled mechanisms:

1. **KEEP_ON_LOCUS / Model3 trigger + region exclusion (DOMINANT for 159):**  
   PathFineSpans on the ASR repair locus are decided **KEEP**. `deriveRetryRegions` correctly refuses to include them (SSOT barrier). No Stage-2 query can cover the locus. Owner is **split**: Model3 decision vs Retry region contract — **not isolated** to a Stage-2 query bug.

2. **Stage-2 query enumeration SSOT drift (SECONDARY):**  
   Even when a region exists, Stage-2 does not reuse `buildLexicalWindowQueries`; fallback may lock to first-pass FineSpan bounds. Real drift, but **insufficient** to explain the KEEP_ON_LOCUS majority.

Mechanism (1) is **not** fixed by Recall tuning, blind ±N, or in-region sliding alone. Mechanism (2) is SSOT restoration without ACP but secondary for this cohort.

================================
CORRECTION OPTIONS
==================

See `model3_v2_s3_retry_query_design_options.csv` (OPT1, OPT2, OPT3).

================================
PREFERRED MINIMAL DESIGN
========================

**NO_DESIGN_SELECTION_YET**

KEEP_ON_LOCUS dominates (161/159). OPT1/OPT2 only enumerate windows inside existing RETRY regions and cannot reach KEEP-marked loci. OPT3 (widen into KEEP) violates frozen 'no unrelated KEEP crossing by default'. Model3 change is out of this phase's Query Geometry ownership. Next: causal localization completion separating MODEL3_TRIGGER_KEEP_ON_LOCUS vs in-region Stage-2 SSOT drift (OPT1+OPT2 secondary).

================================
SIMPLICITY / PERFORMANCE IMPACT
===============================

Preferred path targets: new config=0, new JobResult fields=0, new mainline=0, new fallback=0.  
Query delta bounded by region syllable length × max window 5; utterance cache absorbs duplicates. Candidate pool ≤16 unchanged.

================================
TARGET LIST
===========

Future development only (do not implement now):

1. `model3-retry-router.ts` — Stage-2 query enumeration owner
2. `model3-retry-region-resegment.ts` — fallback lock removal / slice windows
3. `build-lexical-window-queries.ts` / `window-construction-core.ts` — reuse
4. `model3-candidate-provenance-trace.ts` — RetryEventTrace stage fields (side-channel)
5. Controlled validation harness + TRACE_ON/OFF parity tests

================================
CHECK LIST
==========

- [ ] one Retry operation only
- [ ] no recursive Retry
- [ ] no ASR rerun
- [ ] no second Model3 stage
- [ ] no second Domain Vote
- [ ] no Anchor crossing
- [ ] no unrelated KEEP crossing
- [ ] multipath preserved
- [ ] existing FineSpan architecture preserved
- [ ] existing Recall API preserved
- [ ] Model2 ownership unchanged
- [ ] single-character contract unchanged
- [ ] candidate sentence cap <=16
- [ ] JobResult unchanged
- [ ] no test-specific branches
- [ ] no reference leakage
- [ ] TRACE_ON/OFF parity
- [ ] raw Recall trace preserved
- [ ] performance bounded

================================
FUTURE ACCEPTANCE DESIGN
========================

Cohorts A–G as specified (159 partial, 7 no-raw, success controls, recall-miss, Anchor-adjacent, KEEP-adjacent, multipath).

Architectural thresholds (frozen):  
`anchorCrossingCount=0`, `secondDomainVoteCount=0`, `secondModel3StageCount=0`, `recursiveRetryCount=0`, `asrRerunCount=0`, `candidatePoolMax<=16`.

Utility metrics: repairCapableQueryRate before/after; partialCoverageCount before/after; queryCountDelta; rawRecallInvocationDelta; then **downstream replay** (Assembly/KenLM/final text) — required for acceptance, not executed in this design audit.

================================
FREEZE / SUPERSEDE PROPOSAL
===========================

| Item | Action |
|------|--------|
| Measured 70.04% | FROZEN as lexical-event share only |
| Stage-2 sliding absent | RECORD as SSOT_DRIFT |
| Surface families | remain RETIRED |
| Lexicon prevalence 0 | FORBIDDEN conclusion |
| FIRST_CAUSAL_OWNER | still NOT_YET_ISOLATED |

================================
NEXT PHASE
==========

`MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CAUSAL_LOCALIZATION_COMPLETION`

Exactly one.

---

## D1–D55

{
  "D1": "deriveRetryRegions (model3-retry-region.ts)",
  "D2": "isRetryEligible + KEEP flush in deriveRetryRegions; maskAnchorDecisions in run-model3-path-step.ts",
  "D3": "resegmentRetryRegionWithLattice → runLatticeFineSpanGeneration",
  "D4": "collectLocalSpansFromRetainedPathViews (all views; preferred-path removed)",
  "D5": "routeModel3Retry loop over localSpans — NOT buildLexicalWindowQueries (Stage-2 gap)",
  "D6": "routeModel3Retry: windowText=rawText.slice; windowPinyinKey=syllables.join('|')",
  "D7": "PARTIAL — query key formula duplicated vs window-construction-core; barrier ownership split path-step+region",
  "D8": "see call_graph artifact",
  "D9": "FIRST_GEOMETRY_LOSS_STAGE=MODEL3_RETRY_SPAN for query fails; locusDecisionClass={'KEEP_ON_LOCUS': 161, 'NO_SPAN_ON_LOCUS': 5}; gapBuckets={'GAP_2_TO_5': 52, 'TOUCHING_OR_OVERLAP': 16, 'GAP_GT_5': 78, 'GAP_1': 13, 'NO_REGION': 7}",
  "D10": {
    "MODEL3_RETRY_SPAN": 166
  },
  "D11": "Exact condition: PathFineSpans overlapping ASR repair locus are KEEP (161/166 query fails). isRetryEligible requires decision==='RETRY'; KEEP flush in deriveRetryRegions excludes locus; Stage-2 never queries it. Not merely 'region too short'.",
  "D12": "RETRY-only region union IS required by barrier SSOT; but Stage-2 omitting sliding windows is NOT required by SSOT",
  "D13": "Stage-2 missing sliding windows = obsolete/accidental vs FineSpan soft-boundary SSOT; Model3 miss is model/trigger issue not obsolete barrier",
  "D14": "YES when fallbackRegionLocalSpans used; NO when lattice succeeds (resegmentOk)",
  "D15": "NO evidence of hard coarse lock in Retry path",
  "D16": "YES inside regional lattice Stage-1; NO at Stage-2 RAW_RECALL enumeration",
  "D17": "YES — collectLocalSpansFromRetainedPathViews unions all retained views",
  "D18": "Only if some retained localSpan (or Stage-1 window during lattice) equals that unit; Stage-2 does not re-enumerate cross-span windows",
  "D19": "Stage-2 query set == localSpans after resegment/fallback; no cross-FineSpan sliding at RAW_RECALL",
  "D20": "No overlapping Retry region and/or no rawRecalls for the ASR locus (often zero RETRY spans on locus)",
  "D21": "Structurally related to Model3/region miss subclass; not identical to PARTIAL when regions exist elsewhere",
  "D22": "NO (deriveRetryRegions skips anchors; maskAnchorDecisions)",
  "D23": "NO by construction (KEEP breaks merge); unrelated KEEP not entered",
  "D24": "NO",
  "D25": "NO",
  "D26": "NO",
  "D27": "NO",
  "D28": "NO (preferredPathFineSpanView removed)",
  "D29": "YES for lattice success path",
  "D30": "YES — key construction duplicated; Stage-1 vs Stage-2 window enum diverged",
  "D31": "YES for fallback boundary lock; YES for Stage-2 missing sliding (delete localSpan-only assumption)",
  "D32": "YES — buildLexicalWindowQueries / buildWindowDescriptorForRange",
  "D33": "YES",
  "D34": "YES (trace side-channel only)",
  "D35": "YES",
  "D36": "YES",
  "D37": "YES for geometry correction inside region; Model3 trigger quality out of scope",
  "D38": "YES",
  "D39": "YES",
  "D40": "Per region: ~sum_{L=1..5}(sylLen-L+1) windows; only within region syl length",
  "D41": "Same order as D40 before utterance cache dedup",
  "D42": "YES for identical keys; Stage-2 currently sets enableUtteranceRecallCache=false on regional lattice — Stage-2 recall closure uses runtime cache if configured",
  "D43": "LOW_MODERATE for OPT1/2; HIGH for OPT3",
  "D44": "LOW if perSpanCap + pool<=16 preserved",
  "D45": "Controls with NONE_QUERY_ADEQUATE should remain supersets; OPT1 adds windows but should not remove existing keys",
  "D46": "Should not — existing localSpan queries remain; additive enum",
  "D47": "NO Query-Geometry-only fix for KEEP_ON_LOCUS majority; secondary SSOT restore OPT1+OPT2 for in-region cases only",
  "D48": "fallbackRegionLocalSpans as Stage-2 authority (secondary); cannot delete KEEP barrier",
  "D49": "Bounded buildLexicalWindowQueries on region slice (secondary only)",
  "D50": "lattice window builders; recallSpanTopKV2; multipath collect",
  "D51": "OPT1/OPT2 restore SSOT but do not solve KEEP_ON_LOCUS majority",
  "D52": "NO",
  "D53": "NO",
  "D54": "MODEL3_S3_RETRY_QUERY_GEOMETRY_OWNER_NOT_ISOLATED",
  "D55": "MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CAUSAL_LOCALIZATION_COMPLETION",
  "locusDecisionClass": {
    "KEEP_ON_LOCUS": 161,
    "NO_SPAN_ON_LOCUS": 5
  },
  "nearestRegionGapBuckets": {
    "GAP_2_TO_5": 52,
    "TOUCHING_OR_OVERLAP": 16,
    "GAP_GT_5": 78,
    "GAP_1": 13,
    "NO_REGION": 7
  },
  "rootCauseExact": "isRetryEligible requires decision==='RETRY'; locus spans have decision==='KEEP'; flush() breaks pending before KEEP → region excludes locus",
  "measuredShareCaveat": "166/237 is among lexically-evaluable repair events only — NOT overall system prevalence",
  "lexiconPrevalence": "UNRESOLVED — do not treat as zero"
}
