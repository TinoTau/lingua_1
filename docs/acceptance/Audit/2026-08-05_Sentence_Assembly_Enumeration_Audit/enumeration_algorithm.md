# Enumeration Algorithm — Exact Spec（from code）

**File:** `electron_node/electron-node/main/src/fw-detector/build-sentence-candidates.ts`  
**Limits:** `span-assembly-v4/v4-limits.ts`

## Pseudocode

```text
FUNCTION buildSentenceCandidates(raw, spanSets, maxN, coarseRanges?):
  IF spanSets empty OR maxN <= 0: RETURN []

  coarse ← resolveCoarseSpanRanges(spanSets, coarseRanges)

  paths, rejectedOverlap ← enumerateIntervalPaths(spanSets, coarse, raw)

  scored ← []
  FOR each picks IN paths:
    text ← applyReplacementsRightToLeft(raw, picks)
    meta ← deriveRepairSelectionCompleteness(spanSets, picks, coarse)  // metadata only
    scored.push({ text, replacements: picks, candidateScore: sum(scores), ...meta })

  SORT scored BY candidateScore DESC

  unique ← Map()  // key = text, first wins
  FOR combo IN scored:
    IF text not in unique: unique.set(text, combo)

  RETURN unique.values().slice(0, maxN)


FUNCTION enumerateIntervalPaths(spanSets, coarse, raw):
  paths ← []
  enumNodes ← 0
  capped ← false

  FUNCTION visitSlot(slotIndex, chosen):
    enumNodes ← enumNodes + 1
    IF enumNodes > 1024:
      capped ← true; RETURN

    IF slotIndex >= len(spanSets):
      IF len(chosen) <= 16:
        paths.push(buildPathFromRepairs(raw, chosen, coarse))
      RETURN

    slotRepairs ← filter(spanSets[slotIndex], repairTarget == true)
    subsets ← allNonOverlapSubsets(slotRepairs)   // includes []

    FOR subset IN subsets:
      IF len(chosen)+len(subset) > 16: CONTINUE
      IF any pick in subset overlaps chosen: CONTINUE
      visitSlot(slotIndex+1, chosen ∪ subset)
      IF capped: RETURN

  visitSlot(0, [])
  RETURN paths


FUNCTION allNonOverlapSubsets(picks):
  // DFS over pick indices; skip overlapping additions; always keep empty set
  ...


FUNCTION buildPathFromRepairs(raw, repairPicks, coarse):
  gaps ← canonical picks for uncovered intervals inside each coarse range
  RETURN repairPicks ∪ gaps
```

## Classification

| Pattern | Used? |
|---------|------:|
| Single replacement paths | Yes（size-1 subsets） |
| Multi replacement paths | Yes（larger subsets） |
| Path expansion / DFS | **Yes** |
| Full cartesian product of all slot options | **No**（only repairTarget picks; subsets + overlap prune） |
| BFS | No |
| Beam search | No |

## Worked micro-example

Slots: `[后选|{候选,后选}]`, `[声|{声}]`, `[城|{城}]`

- Slot1 repairs = `{候选}` → subsets `[]`, `[候选]`
- Slot2/3 repairs empty → only `[]`
- Paths: RAW `后选声城`；repair `候选声城` (+ gap fills)
- Both survive if scores/order allow；exact-text distinct → 2 slots
