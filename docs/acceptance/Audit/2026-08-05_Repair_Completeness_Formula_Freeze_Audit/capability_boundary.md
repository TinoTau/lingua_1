# Capability Boundary

## Structural vs Semantic

| Kind | Example | Assembly can prove? |
|------|---------|---------------------|
| **Structural Partial** | `后选→候选` selected but `计化` repairable left as raw | **YES** → `PARTIAL_SELECTION` |
| **Structural Complete Selection** | All slots that *had* repair options were selected; other chars raw-only | **YES** → `COMPLETE_SELECTION` |
| **Semantic Partial** | `候选声城` — human wants `候选生成` but `声`/`城` had **no** Recall options | **NO** |

## Formal acknowledgment

```text
CURRENT_METADATA_INSUFFICIENT_FOR_SEMANTIC_PARTIAL_CLASSIFICATION
```

For `候选声城` / `候选生城` under Tone miss:

- Repairable slots observed: typically `后选` only (and unrelated domain slots).
- `声` / `城` / `生`+`城` char slots: **raw-only** (empty sameDomain/base).
- Formula A/B ⇒ **`COMPLETE_SELECTION`** when `后选→候选` is applied.
- Must **not** force `PARTIAL` via string “声城不是词”.

## Naming consequence

Field describes **replacement selection completeness**, not semantic repair success:

```text
repairSelectionCompleteness
```

## What this metadata will NOT do

- Will not mark `候选声城` as incomplete solely because residual looks wrong.
- Will not recover `生成` without Recall candidates.
- Will not authorize CrossPath/KenLM filtering by itself (metadata-only).
