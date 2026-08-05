# Formula A Implementation Trace

## Entry

`buildSentenceCandidates(rawText, spanSets, maxSentenceCandidates, coarseSpanRanges?)`

1. Resolve `coarseRanges` (explicit or derived from spanSets)
2. Enumerate repair subset paths (unchanged)
3. For each path `picks`:
   - build `text` + `candidateScore` (unchanged)
   - `meta = deriveRepairSelectionCompleteness(spanSets, picks, coarseRanges)`
   - attach `...meta` onto `SentenceCombination`
4. Sort by `candidateScore` only (unchanged)
5. Dedup by `text` first-wins (unchanged)
6. Cap slice (unchanged)

## Helper

`deriveRepairSelectionCompleteness(spanSets, combinationReplacements, slotRanges)`

| Step | Implementation |
|------|----------------|
| Canonical | `source === 'canonical_exact' \|\| word === span.text` |
| Repair option | `!isCanonicalPick` |
| Repairable slot | `spanSets[i]` has ≥1 repair option |
| Slot identity | `slotRanges[i].start/end` |
| Covered | repair pick overlaps slot range |
| Raw-only | not repairable → skip unrepaired count |
| Enum | Formula A three-way |

## Multi-slot cover

One replacement whose range overlaps multiple repairable slots marks each overlapped slot repaired (no double unrepaired count).

## Non-goals (not implemented)

- Semantic correctness
- Tone / Recall re-query
- candidateText blacklists
- Cluster / frequency
- Admission / filter / re-rank
