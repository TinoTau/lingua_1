# FW Repair V4 — Multi-Path Lexical Lattice V1 · Delete / Replace Matrix

| Field | Value |
|-------|-------|
| Date | 2026-07-26 |
| Phase | **0.5** — refined for implementation |
| Plan | `FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Development_Plan_2026_07_26.md` |
| Contract | `FW_Repair_V4_Multi_Path_Lexical_Lattice_V1_Implementation_Contract_V1.0.0_2026_07_26.md` |
| Status | **ACTIVE** — Architecture V1.0.0 **FROZEN FOR IMPLEMENTATION** (2026-07-26); code symbols remain PENDING until listed Phase |

Final disposition vocabulary (only):

```text
PENDING | DELETED | REPLACED | REUSED_AS_UTILITY | RENAMED | NOT_FOUND
```

---

## Matrix

| file | symbol | current responsibility | current callers | replacement file | replacement symbol | phase | tests affected | documents affected | final disposition | status |
|------|--------|------------------------|-----------------|------------------|--------------------|-------|----------------|--------------------|-------------------|--------|
| `span-assembly-v4/ltr-fine-span-generator.ts` | `runLtrFineSpanGeneration` | Production Fine Span SSOT (LTR greedy sequence) | `span-assembly-v4-orchestrator.ts` | lattice path enumerator module (Phase 2) | `enumerateCompleteSegmentationPaths` | 2 | `ltr-fine-span-generator.test.ts`, `phase0-coordinate-ssot.test.ts`, `freeze-contract.test.ts` | ARCHITECTURE, INTERFACE_FREEZE, Phase0 audit | REPLACED | PENDING |
| `span-assembly-v4/ltr-fine-span-generator.ts` | `commitBestFormalFineSpan` | Unique formal commit at cursor | `runLtrFineSpanGeneration` | — | Path enumeration | 2 | same | SoftBoundary docs | DELETED | PENDING |
| `span-assembly-v4/ltr-fine-span-generator.ts` | `runLtrFineSpanCommit` | Alias of commitBestFormalFineSpan | tests/docs naming | — | — | 2 | tests using alias | Development Plan naming | DELETED | PENDING |
| `span-assembly-v4/ltr-fine-span-generator.ts` | `generateLocalOptionsAtCursor` | Local 2..5 windows at cursor | LTR generator; phase0 tests | lattice window generator | `buildLexicalWindowQueries` | 1–2 | `ltr-fine-span-generator.test.ts`, `phase0-coordinate-ssot.test.ts` | window contract docs | REPLACED | PENDING |
| `span-assembly-v4/ltr-fine-span-generator.ts` | `buildLtrOptionWindows` | Alias of generateLocalOptionsAtCursor | possible legacy | — | — | 2 | — | — | DELETED | PENDING |
| `span-assembly-v4/ltr-fine-span-generator.ts` | cursor advancement `cursor = formalSpan.syllableEnd` | Greedy ownership of next start | inside `runLtrFineSpanGeneration` | — | full-utterance windows + paths | 2 | LTR tests asserting unique sequence | Pre-dev audit | DELETED | PENDING |
| `span-assembly-v4/generate-global-windows.ts` | `generateGlobalWindows` | Legacy global windows (not production SSOT) | tests only (`generate-global-windows.test.ts`) | lattice window generator | `buildLexicalWindowQueries` | 6 | `generate-global-windows.test.ts` | dead-code notes | DELETED | PENDING |
| `span-assembly-v4/blocked-window-filter.ts` | `truncateWindows` | Truncate window lists / diagnostics | diagnostics tests; not LTR SSOT | keep utility if still needed for blocked gaps | possibly `REUSED_AS_UTILITY` for blockedFilter only | 3–6 | `span-assembly-v4-diagnostics.test.ts` | diagnostics docs | REUSED_AS_UTILITY | PENDING |
| `span-assembly-shared/utterance-domain-vote.ts` | `voteUtteranceDomainFromPool` | Domain vote **kernel** (formula frozen) | `runDomainAwareAssembly` | same kernel | same symbol | 3 | presence-vote / assemble tests | Runtime SSOT | REUSED_AS_UTILITY | PENDING |
| `span-assembly-v4/assemble-domain-aware-span-sets.ts` | `runDomainAwareAssembly` | Utterance-once vote + SameDomain assembly | orchestrator | path-scoped caller wrapper | `voteDomainsForPath` + `assembleSameDomainCandidatesForPath` | 3 | assemble / presence / p5 tests | Domain Vote docs | REPLACED | PENDING |
| `span-assembly-v4/span-assembly-v4-orchestrator.ts` | utterance-once vote/assembly call site | Single Formal pool assumption | `runFwDetectorV4Path` | orchestrator loop over paths | path loop | 2–3 | freeze-contract, orchestrator | ARCHITECTURE | REPLACED | PENDING |
| `span-assembly-v4/candidate-compatibility-graph.ts` | `areCandidatesCompatible` | Intra-candidate compatibility predicate | graph builder | keep per-path | same | 3 | compatibility tests | SoftBoundary | REUSED_AS_UTILITY | PENDING |
| `span-assembly-v4/candidate-compatibility-graph.ts` | `buildCandidateCompatibilityGraph` | Build compatibility graph | `resolveCompatibilityRelations` | per-path only if KEEP | same or narrowed | 3 | compatibility tests | Phase3 report | PENDING | PENDING |
| `span-assembly-v4/candidate-compatibility-graph.ts` | `resolveCompatibilityRelations` | Resolve relations / drops on formal set | orchestrator after LTR | KEEP intra-span / DELETE overlap-vs-unique-formal after Path guarantees | TBD after Phase3 audit | 3 | compatibility + freeze | Phase3 KEEP/DELETE report | PENDING | PENDING |
| `span-assembly-v4/candidate-compatibility-graph.ts` | `__testOnly.pickDropCandidate` | Test helper | unit tests | — | — | 3 | unit | — | REUSED_AS_UTILITY | PENDING |
| `build-sentence-candidates.ts` | `mergeCrossBucketSentenceCandidates` | Merge bucket sentences to ≤16 | orchestrator | global allocator with multi-source Trace | `allocateGlobalSentenceCandidates` (+ may wrap merge) | 4 | presence / freeze | KenLM runtime docs | REPLACED | PENDING |
| `lexicon-v2/lexicon-runtime-v2.ts` | `lookupTermDomainTagsInScope` | Per-term parent domain tags SQL (N+1) | `recall-span-topkv3.ts` parent path | batch multi-id tags loader | `lookupTermDomainTagsForTermIdsInScope` (name TBD) | 5 | freeze-contract asserts symbol today | Phase2 SQLite audit | DELETED | PENDING |
| `lexicon-v2/recall-span-topkv3.ts` | parent loop calling tags API | Parent candidate domain enrichment | recall orchestration | batch assemble `domains[]` once | recall-internal batch | 5 | recall tests / freeze | Domain tag residue audit | REPLACED | PENDING |
| `freeze-contract.test.ts` | LTR-only / single-path assertions | Freeze that unique Formal + utterance vote | CI | Path-aware freeze assertions | new expects | 6 | freeze-contract.test.ts | INTERFACE_FREEZE | REPLACED | PENDING |
| docs `INTERFACE_FREEZE.md` / `ARCHITECTURE.md` / `freeze/FROZEN.md` / SoftBoundary docs | LTR unique Fine Span claims | Documented SSOT | readers | Lattice Architecture SSOT | SegmentationPath[] | 6 | — | all conflicting freeze docs | REPLACED | PENDING |

---

## Caller notes (current)

```text
runLtrFineSpanGeneration ← span-assembly-v4-orchestrator
commitBestFormalFineSpan ← runLtrFineSpanGeneration only
generateLocalOptionsAtCursor ← runLtrFineSpanGeneration + tests
voteUtteranceDomainFromPool ← runDomainAwareAssembly (+ tests)
runDomainAwareAssembly ← orchestrator
mergeCrossBucketSentenceCandidates ← orchestrator
resolveCompatibilityRelations ← orchestrator
lookupTermDomainTagsInScope ← recall-span-topkv3 parent path
generateGlobalWindows ← tests only (NOT production orchestrator)
truncateWindows ← diagnostics tests / blocked filter utilities
```

---

## Phase mapping reminder

| Phase | Focus |
|-------|-------|
| 0.5 | Matrix refined; no production deletes |
| 1 | New windows/edges (harness); LTR still live |
| 2 | Cut LTR production ownership |
| 3 | Vote/Assembly callers + Compatibility KEEP/DELETE |
| 4 | Global ≤16 + KenLM metadata |
| 5 | Parent tags N+1 delete |
| 6 | Dead code + docs + freeze re-lock; every row must leave PENDING |

---

## Supersession

This file supersedes the Phase 0 draft matrix of the same stem dated 2026-07-26 for implementation tracking.
