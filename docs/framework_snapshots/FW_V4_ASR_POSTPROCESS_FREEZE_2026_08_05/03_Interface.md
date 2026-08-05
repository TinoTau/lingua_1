# 03 — Interface / Data Contract Snapshot

| Field | Value |
|-------|-------|
| Snapshot | **FW_V4_ASR_POSTPROCESS_FREEZE_2026_08_05** |

## SentenceCombination（正式）

```ts
repairSelectionCompleteness: 'RAW' | 'PARTIAL_SELECTION' | 'COMPLETE_SELECTION'
repairPickCount: number
unrepairedRepairableSlotCount: number
```

+ `text` · `replacements[]` · `candidateScore`

Sole Owner: `buildSentenceCandidates`  
CrossPath: pass-through only  
KenLM: unaware  
JobResult: unchanged

### Capability boundary

`候选声城` may be `COMPLETE_SELECTION` when `声`/`城` are raw-only after Tone miss — **not** semantic correctness.

Authority: `docs/fw-detector/INTERFACE_FREEZE.md`
