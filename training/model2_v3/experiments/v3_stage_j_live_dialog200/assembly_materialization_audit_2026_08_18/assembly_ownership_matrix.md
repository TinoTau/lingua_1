# Assembly Ownership Matrix

**Audit date:** 2026-08-18

| Owner | Owns | Must NOT own (per freeze) |
|-------|------|---------------------------|
| **FineSpan / Lattice** | PathFineSpan ranges, segmentation path choice, non-overlap invariant, tone rebind diagnostics | Domain vote, sentence enumeration, KenLM ranking |
| **Recall + Model2 expand** | WindowCandidate discovery, union identity (termId), retrieval budgets P/D | Sentence path selection, overlap resolution |
| **Domain Vote** | Presence counts, retainedDomains, tie/ratio threshold 0.75 | Per-span winner selection, sentence generation |
| **SameDomain bucket** | Partition domain_term into retained-domain buckets; parallel bucket grids | Global sentence cap, cross-domain mixing inside bucket |
| **Assembly eligibility** | Full-span alignment gate, dropReason traces | Domain vote tallies |
| **Assembly DFS** | Non-overlap repair subsets, gap canonical fill, Formula A metadata, path-local exact dedup | Semantic similarity, KenLM scores |
| **CrossPath merge** | Path×bucket collection, exact-text dedup first-wins, global ≤16 | Regenerate sentences, re-run DFS |
| **KenLM** | Score, rank, weak_veto pick | Create/prune candidates, completeness |

---

## Drift Check: Assembly Extra Responsibilities?

| Suspected drift | Finding |
|-----------------|---------|
| Assembly does domain decision | **NO** — Vote precedes; Assembly consumes buckets |
| Assembly hard-filters all non-winning domains globally | **NO** — multi-bucket generation for all retained domains |
| Assembly applies global candidate budget before materialization | **NO** — cap at CrossPath post-DFS |
| Assembly silently drops without trace | **Partial** — `assemblyDropTraces` on eligibility failures; DFS cap hits not per-case traced |

**Verdict:** Ownership boundaries match freeze. Trace funnel misattributes union visibility to Assembly input.
