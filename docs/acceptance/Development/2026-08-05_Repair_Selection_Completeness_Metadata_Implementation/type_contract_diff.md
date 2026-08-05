# Type Contract Diff — SentenceCombination

**Sole formal definition:** `electron_node/electron-node/main/src/fw-detector/build-sentence-candidates.ts`  
（`RepairSelectionCompleteness` 类型在 `derive-repair-selection-completeness.ts` 定义并 re-export）

## Before

```ts
export type SentenceCombination = {
  text: string;
  replacements: SpanReplacementPick[];
  candidateScore: number;
};
```

## After

```ts
export type RepairSelectionCompleteness =
  | 'RAW'
  | 'PARTIAL_SELECTION'
  | 'COMPLETE_SELECTION';

export type SentenceCombination = {
  text: string;
  replacements: SpanReplacementPick[];
  candidateScore: number;
  repairSelectionCompleteness: RepairSelectionCompleteness;
  repairPickCount: number;
  unrepairedRepairableSlotCount: number;
};
```

## Forbidden parallel names (not created)

```text
repairCompleteness / isPartial / isComplete / repairStatus /
selectionStatus / semanticCompleteness
```

## Consumers

| Module | Change |
|--------|--------|
| CrossPath merge | Type-compatible pass-through only |
| KenLM / rerank | No field reads |
| CombinationTrace | Optional observation fields added |
| JobResult | Unchanged |
