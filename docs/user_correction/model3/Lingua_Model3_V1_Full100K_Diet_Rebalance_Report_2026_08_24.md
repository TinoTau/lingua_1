# Lingua Model3 V1 Full100K Diet Rebalance

**Date:** 2026-08-24  
**Phase:** `MODEL3_V1_FULL100K_DIET_REBALANCE`  
**Verdict:** `ANCHOR_SIGNAL_STILL_WEAK`

## Integrity

Corpus regenerated: **NO** · Train/Dev/Test hash stable: **YES / YES / YES** · Labels changed: **NO**

## Comparison

| Model | Precision | Recall | F1 | False RETRY | Anchor Zero Δ | Anchor Shuffle Δ | Zero Flip | Shuffle Flip | Strong Pair | Heldout Family F1 | NO_ANCHOR FP |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Pilot | 0.5167 | 0.9924 | 0.6795 | 0.044462 | 0.3179 | 0.2185 | 0.0619 | 0.0689 | 0.9896 | 0.6859 |  |
| Full100K_Baseline | 0.9826 | 0.9440 | 0.9629 | 0.000076 | 0.0115 | 0.0165 | 0.0002 | 0.0002 | 0.6330 | 0.0964 | 0.000000 |
| Diet_A_fast | 0.9406 | 0.9796 | 0.9597 | 0.000282 | 0.0042 | 0.0059 | 0.0001 | 0.0002 | 0.6777 | 0.5974 | 0.000000 |
| Diet_B_fast | 0.9362 | 0.9825 | 0.9588 | 0.000305 | 0.0088 | 0.0117 | 0.0001 | 0.0003 | 0.6806 | 0.7143 | 0.000037 |
| Diet_C_fast | 0.9521 | 0.9694 | 0.9607 | 0.000222 | 0.0062 | 0.0734 | 0.0002 | 0.0008 | 0.6641 | 0.6420 | 0.000018 |
| Diet_D_fast | 0.9718 | 0.9534 | 0.9625 | 0.000126 | 0.0119 | 0.0574 | 0.0001 | 0.0006 | 0.6427 | 0.6369 | 0.000000 |
| Diet_B_full | 0.9445 | 0.9782 | 0.9610 | 0.000262 | 0.0090 | 0.0083 | 0.0002 | 0.0003 | 0.6748 | 0.6909 | 0.000018 |
| Diet_C_full | 0.9490 | 0.9753 | 0.9620 | 0.000239 | 0.0089 | 0.0588 | 0.0002 | 0.0007 | 0.6728 | 0.6743 | 0.000000 |
| Winner_Mean | 0.9609 | 0.9702 | 0.9655 | 0.000180 | 0.0133 | 0.0178 | 0.0003 | 0.0004 | 0.6657 | 0.6829 | 0.000000 |

## Fast screen ranking

Top2: **B, C**

## Winner

- Diet: **B**
- Mix: `{"NATURAL": 0.525, "CONTRAST": 0.25, "NO_ANCHOR": 0.15, "HARD_KEEP": 0.075}`
- Precision / Recall / F1: 0.9609 / 0.9702 / 0.9655
- False RETRY: 0.000180
- Anchor Zero Δ / Flip: 0.0133 / 0.0003
- Anchor Shuffle Δ / Flip: 0.0178 / 0.0004
- Strong Pair / Zero / Shuffle: 0.6657 / 0.6680 / 0.6453
- Held-out Family F1: 0.6829
- Unseen Surface / Context F1: 0.9855 / 1.0000
- NO_ANCHOR False RETRY: 0.000000

### Stability (3 seeds)

| Metric | Mean | Std | Min | Max |
|--------|-----:|----:|----:|----:|
| Precision | 0.9609 | 0.0050 | 0.9545 | 0.9665 |
| F1 | 0.9655 | 0.0012 | 0.9641 | 0.9669 |
| Anchor Zero Δ | 0.0133 | 0.0010 | 0.0120 | 0.0145 |
| Strong Pair | 0.6657 | 0.0057 | 0.6612 | 0.6738 |
| Heldout Family F1 | 0.6829 | 0.0092 | 0.6709 | 0.6933 |

## Performance

CPU p50/p95/p99 ms: 2.889 / 4.123 / 4.696

## Decision

- Training diet problem confirmed: **YES**
- Balanced diet found: **NO**
- Anchor signal restored: **NO**
- Precision preserved: **YES**
- Family generalization: **PASS**
- Ready for TTS-ASR: **NO**
- Next: `MODEL3_V1_CONTRAST_CONSTRUCTION_REVIEW`

## STOP

No new 100k · No TTS · No architecture / Recall / Domain Vote / Model2 changes · No production RETRY. Awaiting user review.
