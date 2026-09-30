# LINGUA_MODEL2_PRE_EDGE_INSERTION_SSOT_RESTORE_DEVELOPMENT_REPORT

| Field | Value |
|-------|-------|
| Date | 2026-09-12 |
| Phase | `LINGUA_MODEL2_PRE_EDGE_INSERTION_SSOT_RESTORE` |
| Business delta | **ONLY** `MODEL2_INSERTION_POINT_RESTORE` |
| Authoritative SSOT | `AUG12_PRE_LEXICAL_EDGE` |

---

## A. Files changed

| File | Change | KEEP/MOVE/DELETE/REFACTOR |
|------|--------|---------------------------|
| `model2-runtime/window-evidence.ts` | **NEW** WindowEvidence DTO | REFACTOR (new thin DTO) |
| `model2-runtime/finespan-adapter.ts` | PathFineSpan → WindowEvidence policy input | REFACTOR |
| `model2-runtime/expand-windows-with-model2.ts` | **NEW** window-batch semantic core | REFACTOR / MOVE |
| `model2-runtime/expand-active-candidates.ts` | **DELETED** | DELETE |
| `model2-runtime/merge-profile-candidates.ts` | Rename preferred `mergeProfileIntoWindowCandidates` | KEEP algorithm |
| `model2-runtime/dialog200-path-trace.ts` | `compactWindowEvidence` | KEEP + small add |
| `model2-runtime/candidate-materialize.ts` | Comment: origin = window | KEEP |
| `span-assembly-v4/lattice-fine-span-runtime.ts` | Wire Model2 pre-edge; sync retry path unchanged | MOVE |
| `span-assembly-v4/span-assembly-v4-orchestrator.ts` | Call WithPreEdgeModel2; remove post-seg expand | MOVE / DELETE hook |
| `span-assembly-v4/finespan-local-tone-binding.freeze.test.ts` | Window-local + single insertion freeze | UPDATE |
| `span-assembly-v4/model2-pre-edge-ssot.freeze.test.ts` | **NEW** multi-char geometry + edge merge | UPDATE |
| `model2-runtime/model2-runtime.test.ts` | WindowEvidence policy test | UPDATE |
| `model2-runtime/model2-runtime-final-closure.e2e.test.ts` | Use `expandWindowsWithModel2` | UPDATE |
| freeze/orch step3/phase2/lattice tests | Expect WithPreEdgeModel2 | UPDATE |
| `offline_harness/acoustic_b2_formal_materialize.cjs` | Lattice+pre-edge Model2 | UPDATE (no dual path) |
| `acoustic_training/gate0.py` + related tests | Wire check strings | UPDATE |
| Aug-12 / Aug-17 Model2 docs | CURRENT_SSOT / SUPERSEDED_INSERTION_POINT | DOCS |

**Unchanged (KEEP):** inference-host, Python host, relation-direction, relation-lexicon-adapter, materialize algorithms, buildLexicalEdges, injectFallbackEdges, Domain Vote, Model3, Retry, KenLM, Tone extract algorithm, rebindToneForFineSpan (path diagnostics).

---

## B. Final production chain

```text
buildLexicalWindowQueries (GlobalWindowDescriptor)
→ latticeHardBlockFilter
→ recallTopKForWindows                    # Base / Exact
→ expandWindowsWithModel2                 # ONE Model2 stage (P+D)
     window-local extractAcousticTonePatternForRecall
     host.infer → PAction → relation → recallSpanTopKV2
     materializeProfileHits / materializeDomainHits
     mergeProfileIntoWindowCandidates
→ buildLexicalEdges                       # candidate-backed only
→ injectFallbackEdges
→ enumerateCompleteSegmentationPaths
→ materializePathFineSpans
→ rebindToneForFineSpan                   # path diagnostics only; not Model2
→ resolveCompatibilityRelations
→ voteUtteranceDomainFromPool
→ materializeModel3Anchors                # PROFILE_* survives
→ Model3 KEEP/RETRY → routeModel3Retry    # NO Model2 reinvoke
→ completeDomainAwareAssemblyFromVote
→ KenLM
```

Owners:

- Lattice: `runLatticeFineSpanGenerationWithPreEdgeModel2` (production)
- Retry / Base-only: `runLatticeFineSpanGeneration` (no Model2)

---

## C. Deleted drift

| Item | Status |
|------|--------|
| Orchestrator `expandActiveCandidatesWithModel2` | **DELETED** |
| `expand-active-candidates.ts` | **DELETED** |
| PathFineSpan-required `buildModel2PolicyInput` | **DELETED** (replaced) |
| Post-seg-as-correct freeze assertions | **REPLACED** |
| Dual Model2 / compatibility flags | **NOT ADDED** |

---

## D. Reused components

| Component | Status |
|-----------|--------|
| `inference-host.ts` / `model2_inference_host.py` | KEEP |
| PAction / selected_actions | KEEP |
| `relation-direction.ts` | KEEP |
| `executeProfileLexiconQueries` / `recallSpanTopKV2` | KEEP |
| `candidate-materialize.ts` PROFILE_* | KEEP |
| `mergeProfileIntoWindowCandidates` | KEEP algorithm |
| `extractAcousticTonePatternForRecall` | KEEP (Model2 Tone source) |
| UserProfile / phonetic_bias plumbing | KEEP |

---

## E. Acceptance results

| Check | Result |
|-------|--------|
| ONE_MODEL2_PRODUCTION_INSERTION | **PASS** |
| MODEL2_PRE_EDGE_WINDOW_INPUT | **PASS** |
| BASE_AND_MODEL2_CANDIDATE_MERGE | **PASS** |
| MODEL2_MULTI_CHAR_GEOMETRY_PRESERVED | **PASS** (unit) |
| WINDOW_LOCAL_TONE_BINDING | **PASS** |
| NO_SHARED_TONE | **PASS** |
| PACTION_CONTRACT_UNCHANGED | **PASS** |
| D_CONTRACT_UNCHANGED | **PASS** (same infer migration) |
| RELATION_TRANSFORM_UNCHANGED | **PASS** |
| LEXICON_RECALL_CORE_UNCHANGED | **PASS** |
| MODEL2_PROVENANCE_SURVIVES_SEGMENTATION | **PASS** (WindowCandidate fields; edge→span refs; compat clone) |
| LEXICALEDGE_REQUIRES_CANDIDATE_EVIDENCE | **PASS** |
| BASE_PLUS_MODEL2_MISS_FALLS_TO_RESIDUAL | **PASS** |
| DOMAIN_VOTE_CONTRACT_UNCHANGED | **PASS** |
| MODEL3_CONTRACT_UNCHANGED | **PASS** |
| MODEL3_RETRY_CONTRACT_UNCHANGED | **PASS** |
| MODEL2_NOT_REINVOKED_ON_RETRY | **PASS** (sync lattice, no model2) |
| NO_POST_PATHFINESPAN_MODEL2_MAIN_HOOK | **PASS** |
| NO_DUAL_MODEL2_PATH | **PASS** |
| NO_COMPATIBILITY_FALLBACK | **PASS** |
| JOBRESULT_BOUNDARY_UNCHANGED | **PASS** |
| PRE_EDGE_MULTI_CHAR_MODEL2_RECALL | **PASS** (structural unit proof; live host Pilot deferred) |
| ARCHITECTURE_SMELL | **PASS** |

Typecheck: `tsc --project tsconfig.main.json --noEmit` **PASS**  
Freeze tests: `finespan-local-tone-binding` + `model2-pre-edge-ssot` **PASS**

---

## F. Representative multi-char structural trace

Case concept: **李守步 → 礼宾部** (geometry / merge / LexicalEdge — host not required for this structural proof).

```json
{
  "kind": "STRUCTURAL_PRE_EDGE_MULTI_CHAR",
  "windowText": "李守步",
  "windowId": "0:3",
  "window_syllable_length": 3,
  "base_candidate_count": 0,
  "relation_id": "n_l",
  "input_pronunciation_sequence": ["li", "shou", "bu"],
  "transformed_pronunciation_length": 3,
  "tone_pattern_length": 3,
  "tone_pattern_source": "WINDOW_LOCAL_or_TEST",
  "retrievalProvenance": "PROFILE_PRONUNCIATION",
  "LexicalEdge_geometry": "0:3",
  "LexicalEdge_created": true,
  "note": "Full live Lexicon hit for 礼宾部 deferred to Pilot remeasure"
}
```

See also: `LINGUA_MODEL2_PRE_EDGE_INSERTION_SSOT_RESTORE_TRACE.jsonl`

---

## G. Deferred findings

```text
DEFERRED_FINDINGS = [
  "Overlapping 1..5 windows increase Model2 invocation count (known performance consequence; no pruning this round)",
  "Full Pilot200 remeasure not run this round (by instruction)",
  "Live multi-char Lexicon hit under real host+tone for 礼宾部 etc. = next Pilot owner",
  "Historical 1..5 vs verbal 2..6 window geometry still out of scope",
  "Training gate0/harness string updates done; full acoustic Gate0 re-run not executed here"
]
```

---

## ONE_NEXT_OWNER

```text
ONE_NEXT_OWNER = PILOT200_PRE_EDGE_REMEASURE
  (targeted multi-char Base-miss cases after this restore; no architecture reopen)
```

**STOP.**
