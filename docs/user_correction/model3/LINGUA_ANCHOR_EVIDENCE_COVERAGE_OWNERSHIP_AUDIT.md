# LINGUA_ANCHOR_EVIDENCE_COVERAGE_OWNERSHIP_AUDIT

**Phase:** `LINGUA_ANCHOR_EVIDENCE_COVERAGE_OWNERSHIP_AUDIT`  
**Date:** 2026-09-13  
**Mode:** READ-ONLY · TRACE-FIRST · GEOMETRY-FIRST · FIRST-LOSS · NO PRODUCT CHANGE

---

## 0. Short verdict

Partial upstream evidence becomes whole-PathFineSpan protection because:

1. **Model2 / Domain materialize** stamps every surviving candidate onto the **full origin window** geometry and **drops** relation-level `changedPositions` / sub-span ownership.  
2. **`materializeModel3Anchors`** tests only **any** retained-domain **or** any Model2 provenance candidate bound to the PathFineSpan — **no evidence-coverage test**.  
3. Anchor Mark copies **`PathFineSpan.rawStart/rawEnd`** wholesale.

**WHOLE_SPAN_PROMOTION_BOUNDARY** = `model3-anchor-adapter.ts::materializeModel3Anchors` (`domainOk || model2Ok` → push Mark with span raw range).  
**ANCHOR_COVERAGE_TEST** = **ABSENT**.  
**PRIMARY_FIRST_FAILURE** for A1–A4 false Anchors = **G7** (adapter booleanize + whole-span promote).  
**Earlier Model2 position-coverage loss** (G1) is real but is **not** what lights soft-domain Anchors on A1–A3.

---

## 1. Frozen SSOT (not reopened)

Model3 = TEXT_ONLY PathFineSpan KEEP/RETRY; no candidate-identity / Model2-internal Model3 input; KEEP/RETRY semantics as prior ownership audit; Model2 global relation intentional; Model2-on-Retry = NO.

Anchor meaning used here: **upstream protection that suppresses Model3 RETRY for the geometry it validly owns** — not “proven final correction.”

---

## 2. Geometry type inventory

| TYPE | OWNER | START/END UNIT | INCL/EXCL | SUBSPAN? | OVERLAP? | MULTI-CHAR? | SURVIVES NEXT? | IDENTITY |
|------|-------|----------------|-----------|----------|----------|-------------|----------------|----------|
| GlobalWindowDescriptor | FineSpan windowing | syllable + raw char | raw half-open `[rawStart,rawEnd)` (slice) | YES (by syl range) | YES across windows | YES | YES into recall | `windowId` |
| WindowCandidate | Recall / Model2 materialize | syllable + raw | same | YES in type; Model2 stamps **full policy window** | via Compatibility | YES | YES into LexicalEdge | `candidateId` |
| origin / policy window | Model2 policy input | syllable + raw | same | YES | — | YES | stamped onto cand | `spanId` / `originSpanId` |
| LexicalEdge | `buildLexicalEdges` | syllable only (+ cand raw) | syl range | Edge = one `(sylStart,sylEnd)` | one edge per boundary key | YES | YES → PathFineSpan | `edgeId` |
| SegmentationPath | Lattice path enum | ordered edgeRefs | — | path = edge sequence | non-overlap enforced later | YES | YES | `pathId` |
| PathFineSpan | `materializePathFineSpans` | syllable + raw (from first cand or syl→raw map) | raw slice | YES as unit | NO (assert non-overlap) | YES | YES → Vote / Anchor / Model3 | `spanId` (`fine:path:idx`) |
| Domain evidence geom | Domain cand / soft D | cand raw/syl = origin window | — | **No separate coverage geom** | — | YES | booleanized at Anchor | term + domains |
| Model2 evidence geom | Relation adapter → materialize | **At source:** changedPositions; **After materialize:** full window only | — | Position-level **lost** at materialize | — | YES | SPAN_BINDING at Anchor | provenance on cand |
| Model3AnchorMark | Anchor adapter | **PathFineSpan raw only** | slice | **NO** | NO | YES | Model3 mask | `spanId` + source |
| RetryRegion | Retry host | RETRY PathFineSpan(s) | — | PathFineSpan-grained | — | YES | reseg | span ids |

**Units:** Do **not** assume syllable index ≡ raw char index. PathFineSpan raw may come from `candidates[0].raw*` when edge has candidates (`materialize-path-fine-spans.ts`).

**EVIDENCE_COVERAGE_GEOMETRY** as a first-class field: **ABSENT**. Only **PATHFINESPAN_GEOMETRY** + candidate **window-stamped** raw/syl + optional `originSpanId`.

**EVIDENCE_COVERAGE_COLLAPSED_TO_SPAN_BINDING = YES**

---

## 3. Anchor adapter — exact predicate

File: `electron_node/electron-node/main/src/model3-runtime/model3-anchor-adapter.ts`

| Helper | Tests |
|--------|--------|
| `candidateBoundToSpan` | `originSpanId === span.spanId` **OR** (not covered ∧ syl+raw **contained in** PathFineSpan) |
| `hasRetainedDomainEvidence` | bound ∧ not covered ∧ `source ∈ {domain_term,passive_domain_weak}` ∧ `domains ∩ retainedDomains ≠ ∅` |
| `hasModel2Evidence` | bound ∧ not covered ∧ `retrievalProvenance ∈ {PROFILE_RETRIEVAL, PROFILE_PRONUNCIATION, PROFILE_DOMAIN}` |
| `materializeModel3Anchors` | `if (domainOk \|\| model2Ok)` → Anchor Mark with **`rawStart/rawEnd = span.rawStart/rawEnd`** |

**Does adapter perform ANY explicit evidence-coverage test?** **NO**  
**ANCHOR_COVERAGE_TEST = ABSENT**

No: geometry equality of replacement vs ASR surface; no changed-position coverage; no full-span lexical identity proof; no subspan mask.

---

## 4. Whole-span promotion

```
WHOLE_SPAN_PROMOTION_BOUNDARY =
  model3-anchor-adapter.ts::materializeModel3Anchors
  :: if (domainOk || model2Ok) anchors.push({ rawStart: span.rawStart, rawEnd: span.rawEnd, ... })

WHOLE_SPAN_PROMOTION_INPUT =
  existence of ≥1 geometrically bound Domain and/or Model2-provenance WindowCandidate

WHOLE_SPAN_PROMOTION_OUTPUT =
  Model3AnchorMark covering entire PathFineSpan raw range

WHOLE_SPAN_PROMOTION_HAS_COVERAGE_PROOF = NO
```

---

## 5. Model2 evidence geometry

| Stage | Geometry |
|-------|----------|
| Relation adapter | **PARTIAL** available: `changedPositions`, transformed syllables (prior audits) |
| `materializeProfileHits` / `materializeDomainHits` | Candidate **forced** to `policyInput.rawStart/rawEnd` + full syl range; **no** `changedPositions` field on `WindowCandidate` |
| LexicalEdge / PathFineSpan | Inherits stamped full-window cand geom |
| Anchor adapter | Reads only provenance **existence** → **SPAN_BINDING_ONLY** |

```
MODEL2_GEOMETRY_AVAILABLE_AT_SOURCE = PARTIAL
MODEL2_GEOMETRY_AVAILABLE_AT_ANCHOR = SPAN_BINDING_ONLY
FIRST_MODEL2_COVERAGE_LOSS_BOUNDARY =
  candidate-materialize.ts::materializeProfileHits|materializeDomainHits
  (full-window stamp; position coverage discarded / never persisted)
```

Not about feeding Model2 internals to Model3 — only what Anchor upstream can know.

---

## 6. Domain evidence geometry

| Stage | Geometry |
|-------|----------|
| Soft/base domain hit | Bound to **origin window** with syllable-length match (`domainHitMatchesOriginSpanRange`) |
| Materialize | Full origin window stamp (`source=domain_term`, often `PROFILE_DOMAIN`) |
| Domain Vote | Retains **domains** utterance/path-level; does **not** invent new raw ranges for Anchor |
| Anchor | `hasRetainedDomainEvidence` → boolean → whole PathFineSpan |

```
DOMAIN_GEOMETRY_AVAILABLE_AT_SOURCE = FULL   // window-length bind by contract
DOMAIN_GEOMETRY_AVAILABLE_AT_ANCHOR = SPAN_BINDING_ONLY
FIRST_DOMAIN_COVERAGE_LOSS_BOUNDARY =
  model3-anchor-adapter.ts::hasRetainedDomainEvidence → materializeModel3Anchors
  (any retained domain_term on span → whole-span Anchor; no coverage proof)
```

Domain Vote does **not** widen raw ranges; it supplies retained domain set for the boolean.

---

## 7. PROFILE_DOMAIN double role

`materializeDomainHits` sets:

- `source = domain_term` → can satisfy **domainOk**
- `retrievalProvenance = PROFILE_DOMAIN` → can satisfy **model2Ok**

**EVIDENCE_INDEPENDENCE_COLLAPSE = YES** (one soft candidate counted as two “reasons”).  
Affects **EVIDENCE STRENGTH** (false independence) and **labeling** (`DOMAIN_AND_MODEL2`); **geometry** remains the same full-window stamp (not a second range).

---

## 8. LexicalEdge / segmentation / PathFineSpan binding

**LEXICAL_EDGE_COVERAGE_SEMANTICS = WINDOW_HAS_EVIDENCE**

- One edge per `(syllableStart,syllableEnd)` with non-empty recalled candidates.  
- Edge evidence = OR over candidates (`hasExact` / fuzzy / …).  
- Does **not** mean “every syllable explained”; means “this window has ≥1 candidate.”

**Segmentation:** PathFineSpan = one selected LexicalEdge (edgeRefs[i]); raw from first cand or syl map. For A1–A4 / C1–C2 audited spans, PathFineSpan raw **equals** candidate/window raw — **segmentation does not widen** these cases.

**PathFineSpan binding for Anchor:** uses **path-level `activeCandidates`**, not only `span.candidates`, via `candidateBoundToSpan` (originSpanId **or** containment).

**PATHFINESPAN_CAN_CONTAIN_NARROWER_EVIDENCE = YES** (containment branch). Empirically A1–A4/C1–C2 trigger cands are **full-span stamped**, so false Anchor here is **not** raw-range widening from a subspan cand; it is **boolean promote of full-window soft/P evidence**.

---

## 9. Case matrix (6)

| caseId | PFS surface | PFS raw | evidence source | src/cand/edge/PFS/Anchor raw | full-span stamps? | firstCoverageLossBoundary | wholeSpanPromotion | domainOk | model2Ok | evidIndep | granMismatch | residualBeforeM3 |
|--------|-------------|---------|-----------------|------------------------------|-------------------|---------------------------|--------------------|----------|----------|-----------|--------------|------------------|
| **A1** p2_u004_019 | 德鸾 | [3,5) | MODEL2_D soft (+P attempt no hit) | all [3,5) for soft cands | soft=yes window; P pos-level lost earlier | **ANCHOR_ADAPTER** (trigger); G1 for P positions | adapter | YES | YES | YES | YES | NO |
| **A2** p2_u002_012 | 注册 | [6,8)* | MODEL2_D soft | soft = PFS | same | ANCHOR_ADAPTER | adapter | YES | YES | YES | YES | NO |
| **A3** p2_u001_020 | 理事 | [5,7) | MODEL2_D soft | soft = PFS | same | ANCHOR_ADAPTER | adapter | YES | YES | YES | YES | NO |
| **A4** p2_u004_009 | 藏 | [2,3) | MODEL2_P 常 | cand=PFS=Anchor | mono full | ANCHOR_ADAPTER (any P→Anchor) | adapter | NO | YES | NO | YES† | NO‡ |
| **C1** p2_u001_039 | 刘 | [7,8) | MODEL2_P 牛 | cand=PFS=Anchor | mono full | none for geom over-extend | adapter | NO | YES | NO | NO§ | n/a |
| **C2** p2_u004_001 | 升层 | [6,8) | MODEL2_P 生成 (+domain) | cand=PFS | full window stamp; pos cov lost at materialize | G1 pos-level then G7 promote | adapter | YES | YES | YES | YES (pos vs window) | NO |

\*raw from prior sufficiency matrix.  
†granularity vs compound context 藏头灯 — mono PFS cannot encode “protect char but leave compound residual exposed as non-Anchor sibling of same compound.”  
‡runtimeCanExposeResidualBeforeModel3: adjacent 头灯 may be other PFS; **partial protection inside one PFS** not representable.  
§C1 mono useful P: geom ownership matches PFS; false-Anchor **geometry** issue absent (GT usefulness ≠ geometry).

---

## 10. Control comparison (no GT runtime logic)

Observable at Anchor time **without** target:

| Signal | A1–A3 | A4 | C1 | C2 |
|--------|-------|----|----|-----|
| PROFILE_PRONUNCIATION present | NO | YES | YES | YES |
| PROFILE_DOMAIN soft primary | YES | NO | NO | often also domain |
| cand.replacement == ASR surface | typically NO (预订/…) | NO (常≠藏) | NO (牛≠刘) | NO (生成≠升层) |
| cand raw == PFS raw | YES | YES | YES | YES |
| Geometry over-extend vs cand raw | NO | NO | NO | NO |

**There is no Anchor-time geometry/coverage property that separates A4 from C1.**  
A1–A3 **are** separable from C1/C2 by **PROFILE_DOMAIN-soft-only** vs **PROFILE_PRONUNCIATION** (producer class), not by raw-range mismatch.

Do **not** use target correctness.

---

## 11. Root-cause taxonomy (A1–A4 primary)

| Case | PRIMARY |
|------|---------|
| A1 | **G7_ANCHOR_ADAPTER_BOOLEANIZES_AND_PROMOTES_WHOLE_SPAN** |
| A2 | **G7_…** |
| A3 | **G7_…** |
| A4 | **G7_…** |

Sum = 4.

**Secondary (not primary):** G1 Model2 position loss at materialize (A1 P-attempt, C2); G8 Anchor granularity cannot represent partial protection inside / around compound (A4 context); PROFILE_DOMAIN independence collapse (A1–A3, C2).

**Controls:** C1/C2 = geometrically consistent full-window P stamp + G7 promote (same promote path); not counted as false-Anchor primary.

---

## 12. Anchor granularity capability

```
CURRENT_ANCHOR_GRANULARITY_CAPABILITY =
  A + E only:
  - whole PathFineSpan Model3AnchorMark (rawStart/rawEnd copy)
  - boolean isAnchor attached to PathFineSpan for Model3 feature + mask
  NOT B/C/D (no sub-PFS Anchor ranges; no multi-range inside PFS; no per-syllable protection)
```

**GRANULARITY_MISMATCH = YES** when valid evidence ownership is position-level or softer than “whole PFS protection,” but Anchor can only be whole-PFS boolean.

**PARTIAL_SPAN_PROTECTION_NOT_REPRESENTABLE_BEFORE_MODEL3 = YES**  
Model3 decision unit = PathFineSpan; no upstream API marks “protect syl i only” while leaving sibling syllables of the **same** PathFineSpan as non-Anchor without **splitting** that PathFineSpan (segmentation ownership / ACP).

Do **not** casually recommend splits this round.

---

## 13. Patch-free locality

| Module | Status |
|--------|--------|
| Model2 inference / relation behavior | UNCHANGED for a coverage-*ownership* freeze; MAY_REQUIRE_CHANGE only if persisting position geometry |
| Tone / Lexicon recall | UNCHANGED |
| LexicalEdge builder | UNCHANGED |
| Segmentation | UNCHANGED (unless ACP for split) |
| Domain Vote | UNCHANGED |
| Model3 input / model / training | UNCHANGED (**NO**) |
| Retry / Assembly / KenLM / JobResult | UNCHANGED |
| Anchor adapter | **MAY_REQUIRE_CHANGE** (coverage test / refuse soft-only) — **not this round** |
| Candidate materialize | **MAY_REQUIRE_CHANGE** (preserve coverage geom) — **not this round** |

**PATCH_FREE_LOCAL_REFACTOR_FEASIBLE = UNKNOWN** until next ownership freeze chooses adapter-only vs materialize geometry vs ACP.

**ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED = YES** if requiring sub-PathFineSpan protection or segmentation splits; **NO** for merely documenting G7 ABSENT coverage test.

**MODEL3_CHANGE_REQUIRED = NO**  
**MODEL2_SEMANTIC_CHANGE_REQUIRED = NO** (relation application frozen)  
**JOBRESULT_CHANGE_REQUIRED = NO**  
**PRODUCT_CODE_CHANGE_THIS_ROUND = NO**

---

## 14. Required verdict fields

```
BASELINE_IDENTITY = PASS
PRIMARY_FALSE_ANCHOR_CASES = 4
CONTROL_CASES = 2
EVIDENCE_GEOMETRY_TRACE_COMPLETE = YES
MODEL2_GEOMETRY_AVAILABLE_AT_SOURCE = PARTIAL
MODEL2_GEOMETRY_AVAILABLE_AT_ANCHOR = SPAN_BINDING_ONLY
DOMAIN_GEOMETRY_AVAILABLE_AT_SOURCE = FULL
DOMAIN_GEOMETRY_AVAILABLE_AT_ANCHOR = SPAN_BINDING_ONLY
LEXICAL_EDGE_COVERAGE_SEMANTICS = WINDOW_HAS_EVIDENCE
PATHFINESPAN_CAN_CONTAIN_NARROWER_EVIDENCE = YES
ANCHOR_COVERAGE_TEST = ABSENT
WHOLE_SPAN_PROMOTION_BOUNDARY = model3-anchor-adapter.ts::materializeModel3Anchors::domainOk||model2Ok→PathFineSpan.raw*
WHOLE_SPAN_PROMOTION_HAS_COVERAGE_PROOF = NO
EVIDENCE_INDEPENDENCE_COLLAPSE = YES
CURRENT_ANCHOR_GRANULARITY_CAPABILITY = whole PathFineSpan Mark + boolean isAnchor only (A+E)
GRANULARITY_MISMATCH = YES
PARTIAL_SPAN_PROTECTION_NOT_REPRESENTABLE_BEFORE_MODEL3 = YES
PRIMARY_FIRST_COVERAGE_LOSS = Anchor adapter boolean existence→whole-PFS Mark (G7); Model2 position coverage first lost earlier at candidate-materialize (G1) but does not light A1–A3 soft Anchors
PRIMARY_FIRST_FAILURE_MECHANISM = G7_ANCHOR_ADAPTER_BOOLEANIZES_AND_PROMOTES_WHOLE_SPAN
ONE_NEXT_OWNER = ANCHOR_ADAPTER_COVERAGE_OWNER
PATCH_FREE_LOCAL_REFACTOR_FEASIBLE = UNKNOWN
ARCHITECTURE_CHANGE_PROPOSAL_REQUIRED = YES
MODEL3_CHANGE_REQUIRED = NO
MODEL2_SEMANTIC_CHANGE_REQUIRED = NO
JOBRESULT_CHANGE_REQUIRED = NO
PRODUCT_CODE_CHANGE_THIS_ROUND = NO
ONE_NEXT_DELTA = Freeze coverage-ownership finding: Anchor adapter has ABSENT coverage test and always promotes PathFineSpan raw range; next predev must choose whether to add an adapter-local coverage gate vs restore Model2/Domain evidence-coverage geometry upstream vs ACP for sub-PFS protection — implement none yet.
```

**ACP note:** Required **if** product needs partial-span protection representable before Model3; not required to **record** G7/ABSENT.

---

## 15. Acceptance checklist

BASELINE_IDENTITY = PASS · cases 4+2 · geometries inventoried · Model2/Domain/Edge/Seg/PFS/Adapter traced · whole-span boundary found · first loss per case · PROFILE_DOMAIN audited · granularity + retry compatibility audited · no GT runtime logic · no full-ASR-explanation rule · no Model3 input / Model2 relation reopen · no new sufficiency classifier · no product change · exactly one owner / delta = YES

---

## 16. STOP

No Anchor/Model3/Model2/Domain Vote/Retry changes. Coverage-loss and whole-span promotion boundaries identified. One next owner / delta only.
