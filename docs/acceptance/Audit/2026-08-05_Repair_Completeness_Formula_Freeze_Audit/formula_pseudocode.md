# Formula Pseudocode (Formula A — Slot Coverage)

Pure function. Assembly-local only. Deterministic.

```text
INPUT:
  spanSets: SpanReplacementPick[][]   // per FineSpan selected pool at assembly
  combination.replacements: SpanReplacementPick[]  // chosen path after enum + gap fills

DEFINE isCanonical(pick):
  pick.source == 'canonical_exact' OR pick.word == pick.span.text

DEFINE isRepairOption(pick):
  NOT isCanonical(pick)

DEFINE repairableSlot(i):
  EXISTS pick IN spanSets[i] WHERE isRepairOption(pick)

DEFINE repairedInCombination(i):
  EXISTS pick IN combination.replacements
    WHERE pick covers FineSpan i
      AND isRepairOption(pick)

repairPickCount =
  COUNT pick IN combination.replacements WHERE isRepairOption(pick)

unrepairedRepairableSlotCount =
  COUNT i WHERE repairableSlot(i) AND NOT repairedInCombination(i)

IF repairPickCount == 0:
  repairSelectionCompleteness = RAW
ELSE IF unrepairedRepairableSlotCount == 0:
  repairSelectionCompleteness = COMPLETE_SELECTION
ELSE:
  repairSelectionCompleteness = PARTIAL_SELECTION

OUTPUT metadata only:
  repairSelectionCompleteness
  repairPickCount
  unrepairedRepairableSlotCount
```

## Notes

- Gap-filled canonical picks are **not** repair picks.
- Slots with empty non-canonical options are **raw-only** and ignored by `unrepairedRepairableSlotCount`.
- No thresholds. No clusters required for Formula A.
- No `candidateText` dictionary / blacklist.
