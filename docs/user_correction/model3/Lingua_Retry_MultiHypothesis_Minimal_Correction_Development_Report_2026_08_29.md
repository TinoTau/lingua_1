# Lingua — Retry Multi-Hypothesis Minimal Correction Development Report

**Phase:** RETRY_MULTIHYPOTHESIS_MINIMAL_CORRECTION_DEVELOPMENT  
**Date:** 2026-08-29  
**Main Verdict:** PASS_WITH_NONBLOCKING_LIMITATIONS

---

## MAIN VERDICT

**PASS_WITH_NONBLOCKING_LIMITATIONS**

Consumer drift corrected and controlled ASR-env validation passed. dialog_200 mainline regression **ENVIRONMENT_BLOCKED** (ASR node :5020 did not become ready).

---

## CHANGE SUMMARY

| Item | Value |
|------|-------|
| Production files modified | `model3-retry-region-resegment.ts` |
| Tests modified/added | `model3-retry-region-resegment.test.ts` (new) |
| Validation harness | `tests/run-retry-multihypothesis-controlled-validation.mjs` (evidence only) |
| Production files added | 0 |
| Architecture changed | NO |

---

## DEDUP SAFETY

**DEDUP_SEMANTIC_EQUIVALENCE: PASS**

Downstream Retry Stage-2 (`routeModel3Retry` → `recallSpanTopKV2` → `materializeLocalSpanHits`) consumes:

- `local.rawStart`, `local.rawEnd`, `local.syllableStart`, `local.syllableEnd`
- `windowText` / `syllables` derived from those bounds
- `owner` span from `findOwningPathFineSpan` or `overlappingOriginalSpans` — both keyed on **global coordinate overlap**, not regional path provenance
- `span.toneRebindTrace` from **original utterance PathFineSpan** owner, not regional path span metadata

Two regional PathFineSpans mapping to identical global bounds produce identical Recall inputs. Path rank / boundaryKey / pathId are not consumed downstream.

**Effective downstream identity:** `syllableStart:syllableEnd:rawStart:rawEnd`

**Chosen dedup helper:** `dedupRetryRegionLocalSpans` (exported for tests)

**Path-dependent semantics lost:** NO

---

## BEFORE / AFTER FLOW

**Before:**
```
regional lattice → pathFineSpanViews[]
  → preferredPathFineSpanView (compareBestFirst rank-1)
  → mapLocalSpansToGlobal (one path)
  → localSpans
  → routeModel3Retry → recallSpanTopKV2
```

**After:**
```
regional lattice → pathFineSpanViews[] (all retained, enumeration order)
  → mapLocalSpansToGlobal per view
  → dedupRetryRegionLocalSpans
  → ONE localSpans collection
  → routeModel3Retry → recallSpanTopKV2 (unchanged)
```

No parallel per-path Retry pipelines. Paths expose local hypotheses only.

---

## REMOVED DRIFT

**preferredPathFineSpanView: REMOVED**

No remaining consumers. `compareSegmentationPathBestFirst` unchanged in Lattice enumeration.

---

## CONTROLLED VALIDATION

| Metric | Value |
|--------|-------|
| Total controlled cases | 13 |
| Multipath cases | 6 |
| Regions with newly visible unique spans | 6 |
| crossAnchor | 0 |
| crossKeep | 0 |
| outOfRegion | 0 |
| Model3 reinvocation | 0 |
| Domain Vote rerun | 0 |
| Recursive Retry | 0 |
| perSpanBudgetViolations | 0 |

### Six multipath cases

| Case | Paths | Before spans | After dedup | Newly visible | Stage-2 Recall |
|------|-------|--------------|-------------|---------------|----------------|
| d179 | 2 | 7 | 8 | 计划 | 8 |
| d142 | 2 | 5 | 6 | 堵车 | 6 |
| d099 | 2 | 3 | 4 | 和步 | 4 |
| d131 | 2 | 4 | 5 | 规则 | 5 |
| d160 | 4 | 5 | 7 | 向木, 顺便 | 7 |
| d176 | 2 | 4 | 5 | 规则 | 5 |

---

## D160 TRACE

| Field | Runtime value |
|-------|---------------|
| Retained paths | 4 |
| Before local spans | 顺\|便\|向\|木\|李 |
| After dedup local spans | 顺\|便\|向\|木\|李\|向木\|顺便 |
| Newly visible | 向木, 顺便 |
| Stage-2 Recall reached | YES (7 calls) |
| Reference-specific logic | NO |

**D160_ALTERNATIVE_HYPOTHESIS_VISIBLE: YES**

---

## CANDIDATE BUDGET

| Metric | Observation |
|--------|-------------|
| Unique local spans (d160) | 7 (was 5) |
| Stage-2 Recall calls (d160) | 7 (was 5) |
| perSpanBudgetViolations | 0 (all 13 cases) |
| mergeSpanCandidates | unchanged |
| Global KenLM ≤16 | Full-pipeline check deferred to dialog_200 (blocked) |

Intermediate growth bounded: max multipath Stage-2 calls = 8 (d179); no unbounded explosion.

---

## PERFORMANCE

| Field | Value |
|-------|-------|
| Environment | ELECTRON_RUN_AS_NODE + real SQLite Lexicon |
| Real SQLite Recall | YES |
| Median Retry-region latency | 5 ms |
| p95 Retry-region latency | 25 ms |
| Performance optimization added | NO |

---

## ONE-PATH REGRESSION

**PASS** — single-path cases (d195, d181, d139, d049, d002, d003, d019) show identical before/after local span sets and Recall call counts.

---

## FAILURE SEMANTICS

**Existing no-path/lattice-failure behavior preserved: YES**

`EMPTY_SLICE`, `NO_PATH`, lattice failure, and `fallbackRegionLocalSpans` paths unchanged.

---

## DIALOG_200

| Field | Value |
|-------|-------|
| Runner | `run-dialog200-model3-acceptance.mjs --anchored-only --max-minutes 15` |
| Cases discovered | 53 |
| Cases executed | 0 |
| Pipeline cases executed | 0 |
| Blocker | Node `:5020` health FAIL after `start-node-detached` (electron pid 3468 started) |
| Verdict | **ENVIRONMENT_BLOCKED** |

---

## GOVERNANCE

All frozen modules unchanged (Model3, FineSpan, Lattice, Recall, Lexicon, Domain Vote, Model2, Assembly, KenLM, Training, JobResult). No new config, types, services, fallback, ranking.

---

## TRAINING GATES

| Gate | Status |
|------|--------|
| ARCHITECTURE_TRAINING_GATE | OPEN |
| DEVELOPMENT_SEQUENCE_GATE | **OPEN** |

---

## NEXT PHASE

**RETRY_MULTIHYPOTHESIS_CORRECTION_ACCEPTANCE** (not executed)

---

## CHECKLIST

- [x] dedup semantic equivalence verified
- [x] single-path discard removed
- [x] all retained pathFineSpanViews consumed
- [x] local spans deduped safely
- [x] preferredPathFineSpanView retired
- [x] Model3 / Vote / Recall / Lattice / FineSpan unchanged
- [x] no cross-Anchor / cross-KEEP / out-of-region
- [x] per-span budget preserved
- [x] d160 mechanism trace recorded
- [x] six multipath cases validated
- [x] one-path regression PASS
- [x] real ASR runtime + SQLite Recall for controlled cases
- [ ] dialog_200 mainline (ENVIRONMENT_BLOCKED — :5020)

---

## Artifacts (5)

1. `Lingua_Retry_MultiHypothesis_Minimal_Correction_Development_Report_2026_08_29.md`
2. `retry_multihypothesis_controlled_results.csv`
3. `retry_multihypothesis_dialog200_results.csv`
4. `retry_multihypothesis_development_summary.json`
5. `retry_multihypothesis_development_governance.json`
