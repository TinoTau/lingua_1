# Model3 V1 Generation / Split Audit

## Split timing

- `sourceSentenceId` group split assigned **before** variant generation in `run_v1_synthetic_100k.py`.
- Post-fix `fix_v1_splits.py` re-assigned split solely by `sourceSentenceId` (removed surfacePairKey override).
- sourceSentenceId train/dev/test leakage = **0**.

## Surface pair

- surfacePairKey still has minor cross-split overlap (same error surface pair can arise from different bases).
- train unique surface pairs: 170
- test fully-seen pair utterances: 7641; fully-unseen: 3

## Seed

- Generator seed `2026082402` controls sampling; no evidence it encodes labels.

## Near-duplicate structural overlap

```json
{
  "train_dev": 2019,
  "train_test": 2089,
  "dev_test": 964
}
```