# Lingua Model3 V1 Full 100k Anchor-Contrast Development

**Date:** 2026-08-24  
**Phase:** `MODEL3_V1_ANCHOR_CONTRAST_FULL_100K_DEVELOPMENT`  
**Verdict:** `ANCHOR_SIGNAL_DILUTED`

## Dataset

| Metric | Value |
|--------|------:|
| Samples | 100000 |
| Train / Dev / Test | 76008 / 9182 / 14810 |
| NATURAL | 67817 |
| CONTRAST | 11889 |
| NO_ANCHOR | 18742 |
| HARD_KEEP | 1552 |
| KEEP / RETRY / MASKED | 2010973 / 7400 / 81258 |
| RETRY ratio (eligible) | 0.0037 |
| NO_ANCHOR utterances | 18742 |
| Mixed-label surfaces | 120 |

Hard zeros (Anchor RETRY / illegal RETRY / fake acoustic / dialog): **0 / 0 / 0 / 0**

## Shortcut baselines

| Baseline | RETRY F1 |
|----------|--------:|
| Surface lookup | 0.0423 |
| Pinyin lookup | 0.0423 |

Surface shortcut: **CONTROLLED** · Leakage gate: **YES**

## BiGRU `MODEL3_V1_ANCHOR_CONTRAST_FULL100K_BIGRU_V1`

| Metric | Value |
|--------|------:|
| Parameters | 238082 |
| RETRY P/R/F1 | 0.9826 / 0.9440 / 0.9629 |
| False RETRY | 0.000076 |

vs Pilot: precision 0.5167 → 0.9826 (**YES**)

## Anchor dependence

| Test | F1 | Flip |
|------|---:|-----:|
| Normal | 0.9629 | — |
| Anchor zero | 0.9514 | 0.0002 |
| Anchor shuffle | 0.9464 | 0.0002 |

**Contribution:** `WEAK` · Zero ΔF1=0.0115 · Shuffle ΔF1=0.0165

> Hard gate: flip ≈ 0 → **Anchor signal diluted** at natural scale (contrast bucket only ~12% vs Pilot ~99%).

## Strong contrast / NO_ANCHOR

- Strong pairs=1030 · pair accuracy=0.6330 · surface-dominated=0.0592
- NO_ANCHOR test N=2649 · false RETRY=0.000000

## Generalization

| Axis | N | RETRY F1 |
|------|--:|--------:|
| Unseen surface | 1336 | 0.9870 |
| Held-out family | 156 | 0.0964 |
| Unseen anchor context | 71 | 1.0000 |
| REAL_DOMAIN | 0 | INSUFFICIENT_REAL_DOMAIN_SAMPLE |

## Performance / Shadow

CPU p50/p95/p99 ms: 3.021 / 4.553 / 5.179  
Actual Retry: **NO** · Production output changed: **NO**

## Governance

Architecture / schema / formal Anchor / Domain Vote / Recall / Model2 / JobResult: **unchanged**  
Report artifacts: **4** (≤10)

## Artifacts

| File | Role |
|------|------|
| `Lingua_Model3_V1_Full100K_Development_Report_2026_08_24.md` | This report |
| `model3_v1_full100k_bundle.json` | Metrics bundle |
| `model3_v1_full100k_governance.json` | GO / inventory |
| `model3_v1_full100k_human_qa_500.csv` | Human QA sample |

## Decision

- Anchor signal preserved at scale: **NO**
- Precision improved: **YES**
- Small BiGRU suitable: **YES**
- Synthetic V1 ready: **NO** (need diet rebalance first)
- Ready for TTS-ASR: **NO**
- Next: `MODEL3_V1_FULL100K_DIET_REBALANCE`

## Interpretation

Precision goal met (false RETRY ≈ 0). Under a natural majority diet, the model again under-uses Anchor. Do **not** return to Pilot’s 99% contrast; raise Anchor-dependent contrast / hard-KEEP density while keeping NO_ANCHOR healthy.

## STOP

No TTS · No production RETRY · No architecture / Recall / Domain Vote / Model2 changes. Awaiting user review.
