# Lingua — Model3 V2 S1 Deletion Funnel Audit + Training Experiment

**Phase:** `MODEL3_V2_PRODUCTION_CORE_S1_TRAINING_EXPERIMENT`  
**Date:** 2026-08-30  
**Dataset:** `MODEL3_V2_PRODUCTION_CORE_S1` (`prod_core_s1_build_20260830_v1`)

---

## MAIN VERDICT

| Field | Value |
|-------|-------|
| **phase verdict** | **S1_TRAINING_EXPERIMENT_FORMAL_GOOD_REAL_WEAK** |
| **deletion audit** | **PASS** |
| **training executed** | **YES** |
| **preferred initialization** | **RANDOM_INIT_PREFERRED** |
| **S1 sufficient to proceed S2** | **YES** (pipeline + learning validated; scale insufficient for real generalization alone) |
| **architecture drift** | **NO** |

S1 formal B2 data trains a non-trivial Model3 from random init (test RETRY F1 **0.486**, not ALL_KEEP). Protected-real generalization remains weak (**0/13** eligible vs historical RealDist **7/13**). RealDist partial init did not recover historical RealDist benefit on S1-only training.

---

## DELETION FUNNEL

### Path-expanded counts (matches prior S1 build audit)

| Stage | Metric | Count |
|-------|--------|------:|
| **D0** | alignment `delete`-tag regions (path×) | **1,676** |
| **D0** | reference-missing `insert` opcodes (path×) | **567** |
| **D1** | CURRENT_SURFACE (delete-tag) | 636 unique / 1,676 path× |
| **D1** | NO_CURRENT_SURFACE (ref-missing) | 201 unique / 567 path× |
| **D2** | NO_ELIGIBLE_FINESPAN | 1,182 unique-region funnel |
| **D2** | ELIGIBLE_FINESPAN | 21 |
| **D3** | NON_ANCHOR eligible | 21 |
| **D4** | NO_REPAIRABLE_TARGET | 1,182 |
| **D4** | RETRY (unique-region projection) | 21 |
| **D5** | region×path with ≥1 RETRY overlap | **62** |
| **D5** | span×path RETRY rows overlapping delete | **84** |

### Unique-region units

| Unit | Count |
|------|------:|
| Unique delete-tag regions | 636 |
| Unique ref-missing insert regions | 201 |
| Utterances / families with delete region | 489 |
| Unique eligible spans (delete overlap) | 30 |
| Multipath utterances | 611 |
| Total path samples | 2,757 |

**Multipath inflation:** 636 unique delete regions → 1,676 path-expanded observations (~2.6×).

---

## DELETION INTERPRETATION

### D1 — Why 1,676 → 62?

The gap is **not a label bug**. V2 contract supervises only **existing current-text FineSpans**. Alignment `delete`-tag regions (difflib: extra/changed current material vs reference) often:

1. Have **no overlapping FineSpan** → NO_REPAIRABLE_TARGET  
2. Overlap spans that project **KEEP** (region neighbor / non-retry-applicable)  
3. Are **Anchor-masked** (none in the 21 eligible unique set)

Only **62 region×path** cases have overlapping **RETRY** labels (84 span×path RETRY rows with multipath).

### D2 — NO_REPAIRABLE_TARGET

**201 unique** reference-missing insert regions (e.g. missing token has zero current width — Model3 cannot RETRY a non-existent span). Path-expanded: **567**. This is expected PASS behavior per frozen V2 semantics.

### D3 — Eligible repairable deletion

**30 unique spans** / **21 unique regions** with eligible non-Anchor overlap; all project **RETRY** under reprojection (**0 relabel mismatches** across 41,392 span×path rows).

### D4 — Label consistency

Full dataset reprojection vs stored labels: **0 mismatches**. No failure conditions A–F triggered. Training authorized.

---

## TRAINING CONFIG

| Parameter | Value |
|-----------|-------|
| Dataset | `MODEL3_V2_PRODUCTION_CORE_S1` |
| Split families | train 775 / dev 100 / test 124 |
| Epochs | 8 |
| Batch | 64 |
| LR | 1e-3 Adam |
| class_weight_retry | **1.0** (frozen, no tuning) |
| Threshold | argmax |
| Architecture | BiGRU embed 64 / hidden 128 / 6 features |
| Feature contract | `packModel3SpanInferFields` (sealed span features) |
| Label contract | `MODEL3_LABEL_CONTRACT_V2_20260829` |

Shared config: `model3_v2_s1_training_config.json`

---

## RANDOM INIT — `MODEL3_V2_S1_RANDOM_INIT_V1`

| Item | Value |
|------|-------|
| Seed | 2026083007 |
| Best epoch | 8 |
| Weights SHA256 | `5de52645da92f8db8be224b829a8004029541f64aaa66d05bc1f7b1a7ed01dd7` |
| Train time | ~27 s CPU |

**Formal test:**

| Metric | Value |
|--------|------:|
| RETRY F1 | **0.4859** |
| RETRY precision / recall | 0.9139 / 0.3309 |
| KEEP precision / recall | 0.9533 / 0.9977 |
| Pred / true RETRY rate | 2.47% / 6.81% |
| Outcome class | UNDERFIT (vs historical baselines) |

**Margin:** RETRY mean −1.59 · KEEP mean −5.41 (p50 RETRY margin −1.61)

---

## REALDIST INIT — `MODEL3_V2_S1_REALDIST_INIT_V1`

| Item | Value |
|------|-------|
| Seed | 2026083008 |
| Init source | `MODEL3_V2_REALDIST_V1` seed_2026082903 (partial: BiGRU/head only; embed skipped — vocab 790 vs 1668) |
| Best epoch | 8 |
| Train time | ~61 s CPU |

**Formal test:**

| Metric | Value |
|--------|------:|
| RETRY F1 | **0.2455** |
| RETRY precision / recall | 0.7625 / 0.1463 |
| KEEP precision / recall | 0.9410 / 0.9967 |
| Pred / true RETRY rate | 1.31% / 6.81% |
| Outcome class | UNDERFIT |

**Margin:** RETRY mean −1.50 · KEEP mean −3.67

---

## FORMAL TEST COMPARISON

| Model | RETRY F1 | RETRY Rec | Pred RETRY | Protected 13-case RETRY |
|-------|---------:|----------:|-----------:|------------------------:|
| V2 baseline (historical) | 0.9539 | 0.937 | 1.05% | **1/13** |
| RealDist historical | 0.9620 | 0.945 | 1.19% | **7/13** |
| **S1 random-init** | **0.4859** | 0.331 | 2.47% | **0/13** |
| **S1 RealDist-init** | 0.2455 | 0.146 | 1.31% | **1/13** (unrelated) |

S1 models learn formal RETRY signal (not ALL_KEEP) but remain far below historical synthetic-scale models.

---

## ERROR FAMILY BREAKDOWN

On S1 test split, RETRY supervision concentrates in **SUBSTITUTION** and **MULTI_CHAR_REPLACEMENT** paths. **DELETION_WITH_REPAIRABLE_TARGET** spans are sparse (13 labeled RETRY spans in test buckets); models miss most (random recall low on substitution/multichar buckets). Pure NO_REPAIRABLE_TARGET deletions excluded from failure scoring per spec.

---

## PROTECTED REAL

Production trace replay (same features; S1 vocab surface encoding):

| Model | Case-level any RETRY | Target-region | Unrelated RETRY | KEEP false RETRY |
|-------|---------------------:|--------------:|----------------:|-----------------:|
| V2 baseline (historical) | 1/13 | — | — | 0/6 |
| RealDist (historical) | 7/13 | — | — | 0/6 |
| S1 random-init | **0/13** | 0 | 0 | **0/6** |
| S1 RealDist-init | 1/13 | 0 | **1** | **0/6** |

No protected-real regression on KEEP controls. Neither S1 run improves eligible RETRY vs historical RealDist.

---

## SURFACE SHORTCUT

S1 test still contains many one-sided surfaces (e.g. 确/能/点). After training:

- Random-init fires RETRY on some high-support surfaces (pred_retry_rate > 0 on mixed surfaces) but overall pred RETRY rate remains low (2.5%).  
- No token blacklist applied.  
- Expanding 280→999 increased vocabulary/surface diversity in dataset; **shortcut dominance not eliminated** at current model scale — primary limiter is **data scale + real distribution gap**, not surface QA alone.

Detail: `model3_v2_s1_surface_shortcut_analysis.csv`

---

## LATENCY

| Model | span p50 ms | span p95 ms | utt p50 ms | utt p95 ms |
|-------|------------:|------------:|-----------:|-----------:|
| S1 random | 0.18 | 0.24 | 2.91 | 4.03 |
| S1 RealDist-init | 0.18 | 0.22 | 2.89 | 4.05 |

Comparable to prior ~12 ms/utt offline audits (different benchmark subset); no optimization performed.

---

## INIT DECISION

**RANDOM_INIT_PREFERRED**

| Criterion | Random | RealDist-init |
|-----------|--------|---------------|
| Formal RETRY F1 | **0.486** | 0.245 |
| Protected any RETRY | 0 (clean) | 1 (unrelated) |
| KEEP false RETRY | 0 | 0 |

RealDist partial init **does not** help on S1-only data; future S2 default init should be **random-from-scratch** unless full vocab-matched init is engineered.

---

## S1 → S2 DECISION

**Proceed to S2 expansion** — not capacity audit.

Evidence:

- Deletion funnel PASS; labels trustworthy  
- S1 trains stably from random init (learning curve exists)  
- Real generalization weak due to **scale / distribution** (999 families vs RealDist ~119k utterances; protected-real gap)  
- Surface shortcut present but not dominant failure mode vs real-gen gap  
- No architecture/feature change indicated

S1 alone is **not** production acceptance.

---

## REQUIRED DECISIONS (D1–D16)

| ID | Answer |
|----|--------|
| D1 | 1676→62: most delete-tag regions lack eligible FineSpans or project KEEP; only 62 region×path overlap RETRY |
| D2 | NO_REPAIRABLE_TARGET: **201 unique** ref-missing inserts (+ 1161 delete-tag without eligible span) |
| D3 | Eligible FineSpans: **30 unique spans** / 21 unique regions |
| D4 | Anchor masked eligible: **0** in repairable set |
| D5 | KEEP/RETRY/EXCLUDE on eligible delete overlap: RETRY **21** unique-region projections |
| D6 | Deletion projection consistent with V2: **YES** (0 relabel mismatches) |
| D7 | Training authorized: **YES** |
| D8 | Random: `MODEL3_V2_S1_RANDOM_INIT_V1` seed_2026083007 |
| D9 | RealDist-init: `MODEL3_V2_S1_REALDIST_INIT_V1` seed_2026083008 |
| D10 | Random formal F1 **0.486** >> RealDist-init **0.245**; both << historical ~0.95 |
| D11 | Protected: random **0/13**; RealDist-init **1/13** unrelated; historical RealDist **7/13** |
| D12 | Shortcut risk remains; not primary blocker vs scale |
| D13 | **RANDOM_INIT_PREFERRED** |
| D14 | No architecture/feature-capacity concern at this stage |
| D15 | S1 justifies **S2 scale expansion**, not production promotion |
| D16 | Next phase: **MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S2** (not executed) |

---

## GOVERNANCE

| Item | Changed |
|------|---------|
| ASR / ASR training | **NO** |
| TTS / multi-voice | **NO** |
| Model3 architecture | **NO** |
| Features | **NO** |
| Labels / relabel | **NO** |
| Threshold / class weights | **NO** |
| FineSpan / Recall / Tone / Model2 / Domain / Anchor / Retry / JobResult | **NO** |
| Dataset | **NO** (read-only) |

---

## NEXT PHASE

**Exactly one (NOT EXECUTED):**

`MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S2`

Target ~5,000 semantic families; default random-init training policy.

---

## ARTIFACTS (7 files)

1. `Lingua_Model3_V2_S1_Training_Experiment_Report_2026_08_30.md`  
2. `model3_v2_s1_training_summary.json`  
3. `model3_v2_s1_deletion_funnel.csv`  
4. `model3_v2_s1_model_comparison.csv`  
5. `model3_v2_s1_training_config.json`  
6. `model3_v2_s1_surface_shortcut_analysis.csv`  
7. `model3_v2_s1_checkpoint_manifest.json`

Checkpoints: `model3_v2_s1_random_init_v1_ckpts/`, `model3_v2_s1_realdist_init_v1_ckpts/`
