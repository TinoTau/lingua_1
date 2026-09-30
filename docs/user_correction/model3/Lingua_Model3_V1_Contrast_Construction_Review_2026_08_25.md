# Lingua Model3 V1 Contrast Construction Review

**Date:** 2026-08-25  
**Phase:** `MODEL3_V1_CONTRAST_CONSTRUCTION_REVIEW`  
**Verdict:** `PASS_FINDING`  
**Scope:** AUDIT ONLY (no retrain / no corpus regen / no architecture change)

## Executive finding

Pilot STRONG pairs are **same-`currentText` dual-anchor** contrasts with `pair_consistency_loss=true`.  
Full100K “STRONG” is dominated by **SEED_V1 pairs that share only `targetSurface`** (`same currentText` ≈ 0 in the 16k seed).  
Diet rebalance therefore improved family recall without restoring Anchor dependence.

## PILOT_STRONG_PAIR_INVARIANTS (from data)

1. `targetSurface` identical on KEEP/RETRY  
2. `currentText` identical  
3. Non-anchor context identical after stripping candidate anchors  
4. Anchor identity / `isAnchor` placement differs  
5. Target labels KEEP vs RETRY  
6. Training uses explicit pair-consistency fine-tune (`pair_consistency_loss=true`)

| Invariant | Pilot (n≈200) | Full100K (n≈200) |
|-----------|-------------------------------:|---------------------------------:|
| Same target | 100.0% | 100.0% |
| Same currentText | 100.0% | 7.0% |
| Same non-anchor context | 100.0% | 7.0% |
| Different Anchor | 100.0% | 100.0% |
| Anchor-only difference | 100.0% | 7.0% |

## Seed corpus (`MODEL3_ANCHOR_CONTEXT_SEED_V1`)

| Metric | Value |
|--------|------:|
| Seeds | 16000 |
| Strong groups | 5585 |
| KEEP+RETRY both present | 5138 |
| Same currentText | 0 |
| Same targetSurface | 5138 |
| Same referenceText | 0 |
| Same surrounding (anchor-stripped) | 0 |

**Interpretation:** seed “STRONG” is **semantic / sentence-level contrast**, not Pilot-style Anchor-only contrast.

## Full100K strongness (corpus)

| Class | Count |
|-------|------:|
| STRICT_STRONG | 203 |
| MODEL_VISIBLE_STRONG (tensor sample) | 0 / 100 |
| Effective model-visible strong (test est.) | 1 / 1030 |
| WEAK | 2453 |
| INVALID | 1269 |
| MEDIUM | 0 |

Source kinds (corpus strong pairs): `{'SEED_V1': 3536, 'REACHABLE_PAIR_EXTRA': 389}`

Mean non-anchor visible difference count (test sample): **272.45**

Causal classes (Full100K sample): `{'LOCAL_TEXT_CAUSAL': 66, 'INVALID_CONTRAST': 27, 'ANCHOR_CAUSAL': 7}`

## Training difference

| Item | Pilot | Full100K / Diet |
|------|-------|-----------------|
| Pair consistency loss | **YES** (config + per-epoch pair fine-tune) | **NO / missing** |
| Contrast group sampling | shuffle + pair fine-tune | Diet: group emit YES; Full100K baseline: row shuffle |
| class_weight_retry | 1.6014772797676338 | 2.5 |

## Pipeline mutation (30 Full100K strong pairs)

`{'seed_generation (KEEP/RETRY different currentText by design)': 27, 'none_preserved_same_text_dual_anchor': 2, 'stage2_or_materialization_broke_same_text': 1}`

Dominant break: **seed generation** invents different `currentText` for KEEP vs RETRY while tagging `contrastStrength=STRONG`.

## Anchor ablation failure (Full100K strong, model=`training/model3_dataset/model3_v1_diet_rebalance_ckpts/winner_seed_2026084421`, n=65)

| Mode | Rate |
|------|-----:|
| Both correct without Anchor | 90.8% |
| Collapse KEEP | 9.2% |
| Collapse RETRY | 0.0% |
| One flips | 0.0% |
| Surface dominated | 0.0% |
| Other | 0.0% |

**Why Strong Pair ≈0.66:** most pairs are solvable from **local/sentence surface cues** without Anchor; zero-ablation often leaves both sides correct → accuracy stays mediocre vs Pilot’s ~0.99.

## Root cause

- **Primary:** `STRONG_PAIR_INVARIANT_LOST` (A)  
- **Secondary:** ['PAIR_CONSISTENCY_LOSS_LOST', 'CONTRAST_DEFINITION_TOO_LOOSE', 'PAIR_SAMPLING_WEAKER_THAN_PILOT', 'STAGE2_MATERIALIZATION_BREAKS_PAIR']  
- **Classification:** `G` = `MULTIPLE`

## Decision

- Contrast construction bug: **YES**  
- Sampling/loss bug: **YES** (`pair_consistency_loss` dropped)  
- Stage2 bug: **YES**  
- Small BiGRU problem: **NO**  
- Architecture change required: **NO**  
- Safe to fix without runtime Anchor change: **YES**  
- Next: `MODEL3_V1_CONTRAST_PAIR_RECONSTRUCTION`

## STOP

No retrain · No diet retune · No new 100k · No TTS · No production RETRY. Awaiting user review.
