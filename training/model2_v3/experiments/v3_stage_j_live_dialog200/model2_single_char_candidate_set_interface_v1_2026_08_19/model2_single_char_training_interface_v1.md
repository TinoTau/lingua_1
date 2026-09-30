# Model2 single-char training interface V1 (not executed)

**Training this round:** NO

## Features (future)

- Frozen trunk `h` (128) from existing encode() — freeze during SC head train
- Candidate matrix K=8 × 16: relative index, aux surface hash, pinyin hash, tone, mask
- Left/right context: existing rawText slices hashed into candidate scoring path — **no new sentence encoder**
- Optional profile/domain as tie features only

Do not mutate `MODEL2_FEATURE_HASH_V1` packing used by P/D `infer`.

## Loss (proposal)

Masked CE over `ABSTAIN + C0..C7` with candidate mask. Invalid slots never supervised.

## Runtime until accepted weights

Host `disambiguate` returns ABSTAIN `HEAD_NOT_AVAILABLE`. Never argmax untrained logits.

New trained weights must be a **new file / new hash**. Do not overwrite `expA_frozen_trunk.pt`.
