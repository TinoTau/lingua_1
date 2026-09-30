# Model2 V2 Dataset Contract

Tag: `MODEL2_V2_RECALL_DATASET` / `FINESPAN_CONFORMING` / `TARGET_ABSENT_PRIMARY`

## Primary positive

```text
target ∈ lexicon
AND target absent from Base FuzzyPool on relevant FineSpan
AND FineSpan exists
AND UserProfile usable evidence
```

## Counterfactuals

Correct / Empty / Wrong / Swapped on same FineSpan+target

## Provenance (reported separately)

`REAL_ASR` | `FAMILY_SYNTH` | `ARTIFICIAL` | `CONTROL`

## Classes

PROFILE_RECALL_POSITIVE, PROFILE_NO_HELP, NO_CHANGE, WRONG_PROFILE,
MULTI_PROFILE, AMBIGUOUS_RECALL, NATURAL_BASE_MISS, ARTIFICIAL_MISS
