# Lingua Model3 V1 Objective Rebalance

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_OBJECTIVE_REBALANCE`  
**Verdict:** `PASS`

## Sampler fix

| Check | Result |
|-------|--------|
| STRICT KEEP main CE | **PRESENT** (9064) |
| STRICT RETRY main CE | **PRESENT** (9064) |
| KEEP:RETRY ratio | 1.000 |
| Hard KEEP bucket | PRESENT (43757) |

Before: STRICT_KEEP=0 (swallowed). After: STRICT identity priority; Hard KEEP is tag-only for strict members.

## Config

| Param | Value |
|-------|------:|
| class_weight_retry | **1.0** (explicit) |
| Auto formula | **OFF** |
| Pair CE | **OFF** |
| Pair loss | PURE_MARGIN |
| Pair margin | 0.25 |
| Config hash | `70c9dbc79f12612a…` |

## Effective main-CE weight

All categories = **1.0** (pair margin is relative only).

## Fast screen

| Obj | λ | Precision | FPR | Strict Pair | Zero | Hard KEEP |
|-----|--:|----------:|----:|------------:|-----:|----------:|
| O0 | 0 | 0.0000 | 0.0000 | 0.0000 | 0.0000 | 1.0000 |
| O1 | 0.05 | 0.9032 | 0.0000 | 0.3186 | 0.0000 | 1.0000 |
| O2 | 0.10 | 0.8529 | 0.0000 | 0.3095 | 0.0000 | 1.0000 |
| O3 | 0.20 | 0.6719 | 0.0001 | 0.5347 | 0.0000 | 1.0000 |

Top2: **O3, O1**

## Winner

Objective **O3** · λ=0.2

| Metric | Mean |
|--------|-----:|
| Precision | 0.9865 |
| Recall | 0.9510 |
| F1 | 0.9684 |
| False RETRY | 0.0001 |
| Strict Pair | 0.8750 |
| Strict Zero | 0.0000 |
| Hard KEEP Acc | 1.0000 |
| NO_ANCHOR FP | 0.0000 |
| Heldout Family F1 | 0.6106 |

Global RETRY prior shift: **NO**  
Natural KEEP p90: -5.4583420753479 · NO_ANCHOR p90: -5.717611789703369

Gradients: KEEP=0.0005344899603043867 RETRY=0.4187344258227563 PairMargin=0.0 · Dominant=RETRY_CE

## Decision

- Objective imbalance fixed: **YES**
- Anchor causality preserved: **YES**
- Precision restored: **YES**
- Ready Full100K strict integration: **YES**
- Ready TTS: **NO**
- Next: `MODEL3_V1_FULL100K_STRICT_CONTRAST_INTEGRATION`

## STOP

No Full100K rebuild · No TTS · No production RETRY · No runtime change. Awaiting user review.
