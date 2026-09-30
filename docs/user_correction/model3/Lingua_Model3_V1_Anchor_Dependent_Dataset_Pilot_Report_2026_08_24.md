# Lingua Model3 V1 Anchor-Dependent Contrast Dataset Pilot

**Date:** 2026-08-24  
**Phase:** `MODEL3_V1_ANCHOR_DEPENDENT_DATASET_REDESIGN`  
**Verdict:** `PASS`

## Dataset

| Metric | Value |
|--------|------:|
| Utterances | 13603 |
| KEEP / RETRY spans | 141448 / 6765 |
| RETRY ratio | 0.0456 |
| Anchor-conditioned | 13530 |
| NO_ANCHOR | 73 |
| STRONG pairs | 4746 |
| MEDIUM pairs | 2019 |
| Same-target different-label surfaces | 75 |

## Shortcut baselines

| Baseline | RETRY F1 |
|----------|--------:|
| Surface lookup | 0.0000 |
| Linear (noleak feats) | 0.4062 |

Leakage gate stable: **YES**

## BiGRU `MODEL3_V1_ANCHOR_CONTRAST_PILOT_BIGRU_V1`

| Metric | Value |
|--------|------:|
| RETRY P/R/F1 | 0.5167 / 0.9924 / 0.6795 |
| False RETRY | 0.044462 |

## Anchor dependence

| Test | F1 | Flip |
|------|---:|-----:|
| Normal | 0.6795 | — |
| Anchor zero | 0.3617 | 0.0619 |
| Anchor shuffle | 0.4611 | 0.0689 |

**Contribution:** `STRONG` · Zero ΔF1=0.3179

## Strong contrast

Pairs=2114 · Pair accuracy=0.9896 · Surface-dominated=0.0104

## Generalization

| Axis | N | RETRY F1 |
|------|--:|--------:|
| Unseen surface | 1474 | 0.6771 |
| Held-out family | 3480 | 0.6859 |
| Unseen anchor context | 134 | 0.7953 |

## Performance

CPU p50/p95/p99 ms: 2.004 / 2.807 / 3.253

## Decision

- Dataset forces Anchor use: **YES**
- Surface shortcut controlled: **YES**
- Small BiGRU still suitable: **YES**
- Ready expand 100k: **YES** (awaiting user approval)
- Ready TTS-ASR: **YES** (gate passed; do **not** start until user approves)
- Next: `MODEL3_V1_ANCHOR_CONTRAST_FULL_100K_THEN_TTS`

## Design note (v1.2)

STRONG pairs use **same currentText** with dual candidate anchors; KEEP vs RETRY differ by simulated `isAnchor` placement. This makes Anchor-zero / shuffle ablating the `isAnchor` channel informative.

## Artifacts (≤3 docs files)

| File | Contents |
|------|----------|
| `Lingua_Model3_V1_Anchor_Dependent_Dataset_Pilot_Report_2026_08_24.md` | This report |
| `model3_anchor_contrast_bundle.json` | Dataset QA, baselines, training, acceptance, generalization, comparison |
| `model3_anchor_contrast_governance.json` | GO verdict, runtime impact, holdout, CPU, inventory |

Dataset: `training/model3_dataset/model3_v1_anchor_contrast_pilot/`  
Model: `training/model3_dataset/model3_v1_anchor_contrast_pilot_bigru/`

## STOP

No 100k expansion · No TTS · No production RETRY · No Domain Vote / Recall / Model2 / architecture changes. Awaiting user review.
