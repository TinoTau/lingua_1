# Model3 Error-Text Validation Rules

## Quarantine / reject

| Rule | Action |
|------|--------|
| `referenceText == errorText` but `corruptionCount > 0` | REJECT |
| Offset mismatch vs surfaces | REJECT |
| Corruption lacks phonetic explanation when `isPhonetic=true` | REJECT |
| Replacement has no provenance | REJECT |
| Broken Unicode / non-Chinese accidental insert | REJECT |
| Intended Anchor span illegally modified on RETRY-oriented sample | REJECT |
| Duplicate `sampleId` | REJECT |
| Polyphonic without source/target pronunciation | REJECT |
| Random/synonym replacement detected | REJECT |

## Allowed

- Semantically odd `errorText` (ASR-like) **if** phonetic explainable
- `referenceReachable=NO` as non-repairable negative

## Bias watch

Track rate of absurd multi-corruption sentences → flag `EASY_NEGATIVE_BIAS` if too high.
