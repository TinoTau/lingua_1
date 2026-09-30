# Assembly Search Strategy Audit

**Date:** 2026-08-18 · READ ONLY

---

## Production Search Strategy

| Component | Strategy | Code |
|-----------|----------|------|
| Path enumeration | Lattice DFS with caps `maxActivePathsPerPosition=8`, `maxCompleteSegmentationPaths=8` | `lattice-fine-span-runtime.ts` |
| Per-span candidate set | Stable sort by score + candidateId; surface dedup; slice to per-span limit | `budgetPerSpanCandidates` |
| Sentence assembly | **DFS** slot-by-slot over non-overlapping repair subsets | `enumerateIntervalPaths` in `build-sentence-candidates.ts` |
| Overlap handling | Reject overlapping repair picks on same path (`rawOverlap`) | `pickOverlapsAny`, `allNonOverlapSubsets` |
| Traversal order | Slot index 0→N (PathFineSpan order); within slot all valid subsets | `visitSlot` |
| Scoring | Sum candidateScore; sort combinations descending before dedup | `combinationScore` |
| Early commit | **None** — enumerates subsets until enum node cap | capped at 1024 nodes |
| Beam | **Disabled** (`beamEnabled: false`) | orchestrator `architectureCompliance` |

---

## Not Greedy

Frozen implementation is **not** greedy single-path: each slot explores all non-overlap repair subsets (subject to caps). Empty subset allowed → raw identity path preserved.

---

## Pruning Funnel (Frozen Caps)

1. **Eligibility filter** — before DFS (domain bucket + span alignment)
2. **Per-span budget** — 8/6/4 candidates per slot
3. **maxIntervalRepairPicksPerPath=16** — during DFS
4. **maxIntervalEnumNodes=1024** — DFS node cap (truncation possible; not traced per-case in dialog200 trace)
5. **maxSentenceCandidates=16** — after full materialization (CrossPath merge)

---

## Historical Residue Assessment

| Pattern | Verdict |
|---------|---------|
| Old beam | NOT ACTIVE |
| First-valid short-circuit | NOT FOUND |
| Coarse-span hard boundary in Assembly | REPLACED by eligibility alignment |
| Legacy coarse pool | TEST ONLY |

**ASSEMBLY_SEARCH_DRIFT:** NO
