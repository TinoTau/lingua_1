# Lingua Model3 V1 Full100K Strict Contrast Integration

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_FULL100K_STRICT_CONTRAST_INTEGRATION`  
**Verdict:** `PASS`

## SSOT

| Item | Value |
|------|------|
| Config | `training/model3_dataset/configs/model3_v1_training_config.json` |
| Config hash | `f32e3de456696798…` |
| Dataset manifest hash | `b028a8f63385d043…` |
| Full100K manifest hash | `2c135f36ac52331e…` |
| Hardcoded critical params | **NONE** |
| Silent defaults | **NONE** |

## Data integration

| Item | Value |
|------|------:|
| Full100K mutated | **NO** |
| Full100K train rows | 61008 |
| Strict groups | 4667 |
| Strict members | 9334 |
| Hard KEEP bucket | 43757 |
| Integrated train rows | 70342 |
| MV strong rate | 1.0000 |
| Cross-split pair leakage | 0 |

## Sampler (Balance D)

Configured 30/30/25/15 → actual shares:  
STRICT=0.300 HK=0.300  
NAT=0.250 NA=0.150  
KEEP:RETRY=1.000

## Objective (frozen O3)

class_weight_retry=1.0 · Auto=OFF · Pair CE=OFF · PURE_MARGIN · λ=0.2 · margin=0.25

## 3-seed quality

| Metric | Mean | Std |
|--------|-----:|----:|
| Precision | 0.9921 | 0.0035 |
| Recall | 0.9457 | 0.0040 |
| F1 | 0.9683 | 0.0004 |
| False RETRY | 0.000034 | 0.000015 |
| Strict Pair | 0.8358 | 0.0661 |
| Strict Zero | 0.0000 | 0.0000 |
| Strict Shuffle | 0.1668 | 0.0255 |
| Hard KEEP Acc | 1.0000 | 0.0000 |
| NO_ANCHOR FP | 0.000000 | 0.000000 |
| Heldout Family F1 | 0.5794 | 0.0375 |
| Unseen Surface F1 | 0.9916 | 0.0004 |
| Unseen Context F1 | 1.0000 | 0.0000 |

Global RETRY prior shift: **NO**  
Natural KEEP p90: -6.10389518737793 · NO_ANCHOR p90: -6.311458110809326

## CPU

params=237698 · size≈0.91MB · RAM≈8.91MB  
p50/p95/p99 ms: 3.281 / 4.548 / 5.235

## Error analysis

False RETRY analyzed: 15 · False KEEP: 69  
Primary: ['unseen_family', 'model_error_or_label', 'unseen_target', 'pronunciation_ambiguity_or_anchor_relation', 'context_insufficiency']

## Decision

- Objective Rebalance reproduced: **YES**
- Integration stable: **YES**
- Anchor causality: **YES**
- Generalization: **YES**
- Synthetic V1 ready to freeze: **YES**
- Ready TTS: **NO**
- Next: `MODEL3_V1_SYNTHETIC_FREEZE_AND_TTS_READINESS_AUDIT`

## STOP

No TTS · No production RETRY · No runtime change · Full100K not regenerated. Awaiting user review.
