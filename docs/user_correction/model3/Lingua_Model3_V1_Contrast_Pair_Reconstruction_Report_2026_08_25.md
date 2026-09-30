# Lingua Model3 V1 Contrast Pair Reconstruction

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_CONTRAST_PAIR_RECONSTRUCTION`  
**Verdict:** `PASS_WITH_PRECISION_GAP`  
**Contract:** `STRICT_ANCHOR_CONTRAST_PAIR_V1`

## Reconstruction

| Metric | Value |
|--------|------:|
| Candidate groups | 12797 |
| Accepted STRICT | 8000 |
| Rejected | 4797 |
| Acceptance rate | 0.6251 |
| Unique target surfaces | 121 |
| MODEL_VISIBLE_STRONG_RATE | 1.0000 |
| Materialize once | YES |
| Full100K mutated | NO |

## Training

Paired sampling: **YES** · Pair consistency loss: **YES** (Pilot CE+margin 0.35) · From scratch: **YES** · class_weight_retry=2.616

## Quality

| Metric | Value |
|--------|------:|
| Precision | 0.3200 |
| Recall | 0.9971 |
| F1 | 0.4845 |
| False RETRY | 0.055436 |

## STRICT pairs (test)

| Condition | Pair accuracy |
|-----------|-------------:|
| Normal | 0.9975 (n=2753) |
| Anchor Zero | 0.0000 |
| Anchor Shuffle | 0.0000 |
| Zero Δ | 0.9975 |
| Shuffle Δ | 0.9975 |

## Safety

Hard KEEP false RETRY: 0.005501760563380281 (n=329)  
NO_ANCHOR false RETRY: 0.0 (n=593)

## Comparison

| Model | Precision | F1 | Strict Pair | Strict Zero | Strict Shuffle |
|-------|----------:|---:|------------:|------------:|---------------:|
| Original Pilot | 0.5167 | 0.6795 | 0.9896 | — | — |
| Full100K | 0.9826 | 0.9629 | 0.6330 | — | — |
| Diet B | 0.9609 | 0.9655 | 0.6657 | 0.6680 | 0.6453 |
| Strict Reconstruction | 0.3200 | 0.4845 | 0.9975 | 0.0000 | 0.0000 |

## Root-cause closure

- STRONG_PAIR_INVARIANT_LOST: **CLOSED**
- PAIR_CONSISTENCY_LOSS_LOST: **CLOSED**
- PAIR_SAMPLING_WEAKER_THAN_PILOT: **CLOSED**
- STAGE2_MATERIALIZATION_BREAKS_PAIR: **CLOSED**

## Decision

- Strict construction proven: **YES**
- Anchor causality restored: **YES**
- Precision guard: **PARTIAL**
- Safe rebuild Full100K contrast portion: **YES**
- Ready TTS: **NO**
- Next: `MODEL3_V1_STRICT_CONTRAST_AND_HARD_KEEP_BALANCE`

## STOP

No Full100K rewrite · No TTS · No production RETRY · No runtime changes. Awaiting user review.
