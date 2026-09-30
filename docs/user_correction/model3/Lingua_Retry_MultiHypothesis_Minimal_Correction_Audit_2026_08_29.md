# Lingua — Retry Multi-Hypothesis Minimal Correction Audit

**Phase:** RETRY_MULTIHYPOTHESIS_MINIMAL_CORRECTION_AUDIT  
**Mode:** STRICT READ-ONLY / PRE-DEVELOPMENT IMPLEMENTATION AUDIT  
**Date:** 2026-08-29  
**Production Code Modified:** NO

---

## Executive Summary

Prior historical SSOT audit established **SEMANTIC_IMPLEMENTATION_DRIFT**: original contract is **one bounded Retry operation** (re-segment + re-recall within a derived region), **not** one SegmentationPath. Current Retry runs regional lattice correctly but **discards all but one retained path** via `preferredPathFineSpanView` before per-span Recall.

**Minimal correction:** iterate **all retained regional `pathFineSpanViews`**, dedup local spans by coordinate, feed existing `routeModel3Retry` per-span Recall loop. No new ranking, no Model3/Vote/Recall/Lattice core changes.

---

## PART A — CURRENT RETRY DATAFLOW

### CURRENT_RETRY_FLOW

| Step | File | Function | Input | Output | Ownership | Candidate/Budget Mutation |
|------|------|----------|-------|--------|-----------|-------------------------|
| 1 | `run-model3-path-step.ts` | `runModel3PathStep` | `activeCandidates`, `pathFineSpans` | `vote`, `decisions` | Model3 path step | Pool built; Vote once |
| 2 | `model3-anchor-adapter.ts` | `materializeModel3Anchors` | pool, vote | `anchors` | Model3 | Read-only |
| 3 | `model3-inference-client.ts` | `host.inferPath` | span features | `decisions[]` KEEP/RETRY | Model3 | None |
| 4 | `model3-retry-router.ts` | `deriveRetryRegions` | decisions, anchors, pathFineSpans | `Model3RetryRegion[]` | Retry router | None |
| 5 | `model3-retry-region-resegment.ts` | `resegmentRetryRegionWithLattice` | region slice, retainedDomains | `localSpans[]` (**1 path only**) | Retry resegment | None (span list only) |
| 6 | `lattice-fine-span-runtime.ts` | `runLatticeFineSpanGeneration` | region rawText/syllables | `lexicalEdges`, `segmentationPaths`, `pathFineSpanViews` | Lattice/FineSpan | Stage-1 window Recall inside lattice |
| 7 | `model3-retry-region-resegment.ts` | `preferredPathFineSpanView` | paths, views | **single** `PathFineSpanView` | Retry consumer (**DRIFT**) | **N→1 path discard** |
| 8 | `model3-retry-region-resegment.ts` | `mapLocalSpansToGlobal` | selected path spans | `RetryRegionLocalSpan[]` | Retry resegment | None |
| 9 | `model3-retry-router.ts` | `routeModel3Retry` loop | localSpans | per-span `recallSpanTopKV2` hits | Retry router | Stage-2 span Recall |
| 10 | `model3-retry-router.ts` | `materializeLocalSpanHits` | hits, local | `WindowCandidate[]` | Retry router | Append retry candidates |
| 11 | `model3-retry-router.ts` | `mergeSpanCandidates` | before + retry, `perSpanCap` | capped span candidates | Retry router | Per-span dedup + cap (4/6/8) |
| 12 | `run-model3-path-step.ts` | `buildFineSpanCandidatePool` | post-retry activeCandidates | assembly pool | Assembly adapter | Pool refresh if mutated |
| 13 | `assemble-domain-aware-span-sets.ts` | `completeDomainAwareAssemblyFromVote` | pool, **same vote** | assembly result | Assembly | Sentence candidates ≤16 via existing path |

---

## PART A — DISCARD POINT

### MULTIHYPOTHESIS_DISCARD_POINT

| Field | Value |
|-------|-------|
| **file** | `electron_node/electron-node/main/src/model3-runtime/model3-retry-region-resegment.ts` |
| **function** | `preferredPathFineSpanView` (called from `resegmentRetryRegionWithLattice` L186–189) |
| **line / code region** | L91–106 (selection); L186–192 (single view → `localSpans`) |
| **input cardinality** | `pathFineSpanViews.length` = 1..8 (controlled max 4 at d160) |
| **output cardinality** | **1** `PathFineSpanView` → 1 span set |
| **reason currently documented** | Comment L88–89: "Select the lattice-preferred path view using existing compareBestFirst SSOT" |
| **business requirement found** | **NO** — historical SSOT audit found no explicit single-path requirement; origin = technical simplification in 2026-08-28 region correction |
| **Original contract** | One bounded Retry **operation**; regional lattice may retain multiple SegmentationPaths; all legitimate local hypotheses/windows should reach Recall |

---

## PART B — REUSE OPTIONS COMPARISON

See `retry_multihypothesis_reuse_options.csv` for full matrix.

| Dimension | Option A — WindowQuery | Option B — LexicalEdge | Option C — Retained Path |
|-----------|------------------------|------------------------|--------------------------|
| reusesExistingSSOT | Partial | Partial | **YES** |
| requiresNewDataStructure | YES (window→retry mapping) | YES (edge→candidate projection) | **NO** |
| requiresNewRanking | NO | NO | **NO** |
| duplicatesRecall | Risk HIGH (bypass stage-2) | Risk HIGH (skip span recall) | **LOW** (extends existing stage-2) |
| duplicatesLattice | NO | NO | **NO** |
| changesFineSpanOwnership | YES | YES | **NO** |
| changesRecallOwnership | YES | YES | **NO** |
| semanticMatchToOriginalDesign | Medium | Medium | **HIGH** |
| implementationComplexity | Medium-High | High | **Low** |

**Option A rejected:** Would bypass pathFineSpanView materialization and reimplement window→span→owner mapping parallel to existing Retry router logic.

**Option B rejected:** LexicalEdges from lattice Stage-1 are path-agnostic but Retry consumer contract is per-span `recallSpanTopKV2` + `materializeLocalSpanHits`; projecting edges to WindowCandidates duplicates materialization ownership and skips tone-bound span recall.

**Option C chosen:** Mirrors first-pass orchestrator L294 (`for (const view of lattice.pathFineSpanViews)`), minimal surface change.

---

## PART C — FIRST-PASS REUSABLE COMPONENTS

### First-pass multi-hypothesis handling

`span-assembly-v4-orchestrator.ts` L294: iterates **all** `lattice.pathFineSpanViews` → per-path compatibility → Model2 → path assembly → `mergeCrossPathSentenceCandidates(..., 16)`.

### SAFE_REUSABLE_COMPONENTS

- `runLatticeFineSpanGeneration` (regional slice — already used)
- All retained `pathFineSpanViews` / `mapLocalSpansToGlobal` per view
- Local span dedup by `(syllableStart, syllableEnd, rawStart, rawEnd)`
- `routeModel3Retry` per-span Recall loop + `mergeSpanCandidates`
- `vote.retainedDomains` (frozen)
- `buildFineSpanCandidatePool` + `completeDomainAwareAssemblyFromVote` (same vote)
- Existing per-span caps (`getPerSpanCandidateLimit`) and global Assembly ≤16

### UNSAFE_TO_REENTER_COMPONENTS

- `voteUtteranceDomainFromPool` (second Vote)
- `host.inferPath` / Model3 (second invocation)
- `materializeModel3Anchors` regeneration for decisions
- Full `span-assembly-v4-orchestrator` (Model2, cross-path sentence merge, KenLM)
- ASR/FW preprocessing
- Recursive Retry / second mainline

---

## PART D — DOMAIN SEMANTICS

**CAN_REUSE_FROZEN_RETAINED_DOMAINS: YES**

Retry already passes `vote.retainedDomains` to regional lattice (`resegmentRetryRegionWithLattice` L168) and to `recallSpanTopKV2` (`run-model3-path-step.ts` L159). Multi-hypothesis correction adds more local windows recalled under the **same** domain scope. No per-path Vote required — domain is utterance-frozen before Model3.

---

## PART E — MODEL2

**Does Retry currently invoke Model2?** NO.

**MODEL2_REQUIRED_FOR_MINIMAL_CORRECTION: NO**

Model2 expands activeCandidates at first-pass path checkpoint. Retry operates on regional span Recall → WindowCandidate materialization. Restoring multi-hypothesis local windows does not require Model2 profile expansion; frozen API does not naturally apply to bounded regional retry recall.

---

## PART F — CANDIDATE BUDGET

### Existing caps

| Mechanism | Cap | Location |
|-----------|-----|----------|
| Per-span candidate limit | 8 / 6 / 4 | `per-span-candidate-limit.ts` |
| Complete segmentation paths | ≤8 | `V4_LIMITS.maxCompleteSegmentationPaths` |
| mergeSpanCandidates | per-span cap | `model3-retry-router.ts` L185–205 |
| Global sentence cap | ≤16 | Assembly / `mergeCrossPathSentenceCandidates` |
| Text dedup | exact text first-wins | cross-path merge |

### BUDGET_FLOW_BEFORE

Regional lattice (≤8 paths) → **1 path** → N local spans → N × `recallSpanTopKV2` → mergeSpanCandidates(perSpanCap) → postRetryPool → Assembly ≤16.

### BUDGET_FLOW_AFTER_MINIMAL_CORRECTION

Regional lattice (≤8 paths) → **all paths, deduped local spans** → M unique local spans (M ≤ region syllable windows, typically ≤15 for 5-syllable region × multi-char overlap) → M × `recallSpanTopKV2` → same mergeSpanCandidates → same Assembly ≤16.

**New config:** NO  
**Global ≤16 preserved:** YES (Assembly unchanged; per-span caps unchanged)

---

## PART G — D160 MECHANISM TRACE

Region: **顺便向木李** (5 syllables). Regional paths = 4.

| Path rank (best-first) | Surfaces | lex2 edges | Current Recall windows |
|------------------------|----------|------------|------------------------|
| 1 (selected) | 顺\|便\|向\|木\|李 | 0 | 5 single-char windows |
| 2 | 顺便\|向\|木\|李 | 1 | **discarded** |
| 3 | 顺\|便\|向木\|李 | 1 | **discarded** |
| 4 | 顺便\|向木\|李 | 2 | **discarded** |

### D160_MECHANISM_TRACE

**Current:** Only rank-1 single-char spans reach `recallSpanTopKV2`. Multi-char windows (e.g. 顺便 0:2) never enter Stage-2 Recall despite Stage-1 lattice having recalled them.

**Option A:** All recallable region windows → Recall directly. Would include 顺便(0:2), 向(2:3), 木(3:4), 李(4:5), plus alt-boundary windows 向木(3:5) if in window set.

**Option B:** Reuse LexicalEdges with span≥2 from lattice. Would surface 顺便, 向木 candidates without path iteration; requires new edge→candidate adapter.

**Option C:** Union local spans from all 4 pathFineSpanViews → dedup → Stage-2 Recall on: 顺, 便, 顺便, 向, 木, 向木, 李 (7 unique windows). Multi-char hypotheses reach existing Recall mechanism. **No reference-specific logic.**

---

## PART H — SIX MULTIPATH CASES

See `retry_multihypothesis_case_evidence.csv`.

---

## PART I — REGION / ANCHOR SAFETY

**REGIONAL_PATH_BOUNDARY_SAFETY: PASS**

- `deriveRetryRegions` bounds by RETRY spans; Anchor/KEEP break merge (`model3-retry-region.ts` L53–55).
- Regional lattice slices `[region.rawStart, region.rawEnd)` / syllable range only.
- `enumerateCompleteSegmentationPaths` produces complete coverage paths within slice syllableCount — cannot extend outside region.
- `mapLocalSpansToGlobal` adds region offset only.
- All retained paths are sub-segmentations of the same bounded syllable interval.

---

## PART J — RECALL DUPLICATION

| Stage | Location | API | Scope |
|-------|----------|-----|-------|
| **RECALL_STAGE_1** | `lattice-fine-span-runtime.ts` L394+ | `recallTopKForWindows` | All recallable lexical windows in region |
| **RECALL_STAGE_2** | `model3-retry-router.ts` L346+ | `recallSpanTopKV2` | Per selected local span surface |

**DUPLICATED_LOOKUP: PARTIAL**

Stage-1 builds LexicalEdges (window-level). Stage-2 re-queries Lexicon per local span text/pinyin for Retry candidate materialization. Same pinyin keys may be queried twice. Stage-2 is required for Retry WindowCandidate shape + tone binding + span ownership (`materializeLocalSpanHits`).

**MINIMAL_REUSE_OPPORTUNITY:** Option C still uses Stage-2 but on **more** deduped local spans from all paths. Eliminating Stage-2 would require Option B (edge projection) — architecture risk. Stage-1 results are not discarded by correction; only Stage-2 **input span set** expands.

---

## PART K — DATA STRUCTURES

**NEW_PRODUCTION_TYPE_REQUIRED: NO**

Existing types suffice:
- `PathFineSpanView`, `RetryRegionLocalSpan`, `ResegmentRetryRegionResult` (extend `localSpans` to union, no new type)
- `WindowCandidate`, `Model3RetryRegion`, `LexicalEdge`

---

## PART L — PERFORMANCE ESTIMATE

From existing caps/traces (no new benchmarks):

| Metric | Before (typical) | After (worst-case) |
|--------|------------------|---------------------|
| Retained regional paths | ≤8 | ≤8 (unchanged) |
| Local spans per region (d160) | 5 | ~7–8 (deduped union) |
| Recall Stage-2 calls per region | = local span count | ≤ unique spans across all paths |
| Candidate before dedup | bounded by perSpanCap × spanCount | same caps apply |
| Assembly input | ≤16 | ≤16 (unchanged) |
| Latency delta (controlled traces) | d160 overhead ~10ms | estimate +2–5ms (2–3 extra recall calls max in multipath cases) |

Controlled case overheadMs: d179=60, d142=17, d099=7, d131=17, d160=10, d176=9 — dominated by lattice; incremental recall cost small vs lattice.

---

## PART M — MINIMAL CORRECTION BOUNDARY

### MINIMAL_TARGET_FILES

| File | Why | Change Category |
|------|-----|-----------------|
| `model3-retry-region-resegment.ts` | Remove single-path discard; union all pathFineSpanViews → deduped localSpans | **Primary correction** |
| `model3-retry-router.ts` | Optional: trace diagnostics for multi-path local span count | Observability only (may be zero change) |
| Tests referencing single-path Retry | Validate multi-span union | Test update (next phase) |

### FILES_THAT_MUST_NOT_CHANGE

Model3 files, FineSpan core, Lattice core, Recall core, Domain Vote, Assembly core, KenLM, Lexicon, JobResult, training.

---

## PART M — RETIREMENT

**preferredPathFineSpanView: RETIRE_CANDIDATE**

- Sole consumer: `resegmentRetryRegionWithLattice`
- After correction: iterate all views; no path ranking for Retry consumption
- `compareSegmentationPathBestFirst` remains in Lattice enumeration (unchanged); only Retry **consumer** ranking removed

---

## PART O — VERDICTS

### Correction Strategy

**REUSE_RETAINED_PATHS_MINIMAL**

### Architecture

**PURE_IMPLEMENTATION_CORRECTION**

### Training Gates

| Gate | Status |
|------|--------|
| ARCHITECTURE_TRAINING_GATE | OPEN |
| DEVELOPMENT_SEQUENCE_GATE | **HOLD** (until correction implemented + minimally validated) |

### Next Phase

**RETRY_MULTIHYPOTHESIS_MINIMAL_CORRECTION_DEVELOPMENT** (do not execute)

---

## PART P — DEVELOPMENT PLAN (PROPOSED, NOT IMPLEMENTED)

**STEP 1 — Replace single-path selection in `resegmentRetryRegionWithLattice`**

- After successful lattice, iterate `lattice.pathFineSpanViews` (all retained, enumeration order).
- For each view: `mapLocalSpansToGlobal(view.pathFineSpans, region, rawText)`.
- Dedup local spans by key `${syllableStart}:${syllableEnd}:${rawStart}:${rawEnd}` (stable first-wins).
- Return deduped union as `localSpans`.
- Delete `preferredPathFineSpanView`.

**STEP 2 — Verify router compatibility**

- Confirm `routeModel3Retry` loop (L334+) handles expanded `localSpans` without change.
- Confirm `mergeSpanCandidates` caps prevent explosion.
- Confirm `overlappingOriginalSpans` / `findOwningPathFineSpan` handle multi-char locals spanning original single-char spans.

**STEP 3 — Controlled validation**

- Re-run 13 controlled cases + 6 multipath cases.
- Assert: multi-path regions produce `newLocalSpanSurfaces` supersets vs today where alt paths differ.
- Assert: Model3 once, Vote once, no recursive retry, candidate ≤16, no cross-anchor/KEEP.
- Retire tests asserting single-path-only Retry behavior.

**Rejoin point:** Existing `routeModel3Retry` → `mergeSpanCandidates` → `buildFineSpanCandidatePool` → same Vote Assembly.

---

## PART Q — TARGET LIST

| ID | Target |
|----|--------|
| T1 | Retry no longer discards all but one retained regional hypothesis before Recall |
| T2 | No new ranking/scoring logic |
| T3 | No recursive Retry |
| T4 | Model3 invoked once |
| T5 | Domain Vote once |
| T6 | Anchors cannot be crossed |
| T7 | KEEP barriers cannot be crossed |
| T8 | Existing retainedDomains reused |
| T9 | Candidate dedup preserved |
| T10 | Global candidate cap ≤16 |
| T11 | No new JobResult fields |
| T12 | No new config unless strictly unavoidable |
| T13 | No second mainline |
| T14 | d160 alternative local hypotheses visible to existing Recall without reference-specific logic |
| T15 | All six controlled multipath cases preserve structural safety |

---

## PART Q — CHECKLIST

- [ ] Model3 unchanged
- [ ] FineSpan core unchanged
- [ ] Lattice core unchanged
- [ ] Recall core unchanged
- [ ] Domain Vote unchanged
- [ ] Assembly core unchanged
- [ ] KenLM unchanged
- [ ] Lexicon unchanged
- [ ] JobResult unchanged
- [ ] No fallback path
- [ ] No compatibility mode
- [ ] No scoring
- [ ] No new service
- [ ] No recursive Retry
- [ ] no cross-Anchor
- [ ] no cross-KEEP
- [ ] candidate ≤16
- [ ] duplicate candidates deduped
- [ ] controlled multipath traces pass
- [ ] existing single-path-only helper retired if obsolete

---

## PART S — GOVERNANCE

| Item | Status |
|------|--------|
| Production Code Modified | NO |
| Tests Modified | NO |
| SSOT Modified | NO |
| Architecture Modified | NO |
| FineSpan / Lattice / Recall / Lexicon / Model3 / Domain Vote / Assembly / KenLM / Training / Config / JobResult Modified | NO |
| New Fallback / Compatibility Path | NO |

---

## Artifacts (5)

1. `Lingua_Retry_MultiHypothesis_Minimal_Correction_Audit_2026_08_29.md` (this file)
2. `retry_multihypothesis_reuse_options.csv`
3. `retry_multihypothesis_case_evidence.csv`
4. `retry_multihypothesis_audit_summary.json`
5. `retry_multihypothesis_audit_governance.json`
