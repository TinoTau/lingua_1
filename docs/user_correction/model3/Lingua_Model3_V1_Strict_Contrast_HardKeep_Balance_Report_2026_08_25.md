# Lingua Model3 V1 Strict Contrast + Hard KEEP Balance

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_STRICT_CONTRAST_AND_HARD_KEEP_BALANCE`  
**Verdict:** `PRECISION_GAP`

## Hard KEEP data

| Metric | Value |
|--------|------:|
| Accepted total | 58212 |
| Train | 48424 |
| Unique targets | 328 |
| Human QA | PASS (n=300) |

## Fast screen Top2

**C, D**

## Winner

Balance **D** · mix `{"STRICT": 0.3, "ANCHOR_CONDITIONED_HARD_KEEP": 0.3, "NATURAL": 0.25, "NO_ANCHOR": 0.15}`

| Metric | Mean |
|--------|-----:|
| Full100K Precision | 0.0171 |
| False RETRY | 0.2731 |
| Strict Pair | 0.9983 |
| Strict Zero | 0.0000 |
| Hard KEEP Acc | 0.6475 |

## vs Strict Reconstruction

Precision 0.32 → 0.02 · False RETRY 5.54% → 27.31% · Strict pair 99.75% → 99.8%

## Decision

- Anchor causality preserved: **YES**
- Precision restored: **NO**
- Hard KEEP boundary: **NO**
- Next: `MODEL3_V1_STRICT_HARDKEEP_REBALANCE`

## STOP

No Full100K rebuild · No TTS · No production RETRY. Awaiting user review.
