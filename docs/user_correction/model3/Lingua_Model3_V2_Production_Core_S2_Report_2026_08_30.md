# Lingua — Model3 V2 Production Core S2 Report

**Phase:** `MODEL3_V2_PRODUCTION_CORE_S2`  
**Date:** 2026-08-30  
**Primary causal variable:** DATA SCALE (~1k → ~5k semantic families)

---

## MAIN VERDICT

| Field | Value |
|-------|-------|
| **verdict** | **S2_BUILD_AND_TRAIN_PASS_CONTINUE_S3** |
| **S2 dataset built** | **YES** |
| **training authorized** | **YES** |
| **training completed** | **YES** |
| **final semantic families** | **4,994** |
| **architecture drift** | **NO** |
| **SSOT conflict** | **NO** |
| **next phase** | **MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S3** (not executed) |

**Learning-curve summary:** S1→S2 random-init shows material improvement — formal RETRY F1 **0.486 → 0.857**, recall **0.331 → 0.831**, protected target RETRY **0/13 → 9/13**. KEEP-control false RETRY remains **0/6**. Nonblocking: protected unrelated RETRY **4/13** (monitor in S3).

---

## ARCHITECTURE / SSOT PRECHECK

| Contract | Identity |
|----------|----------|
| Label | `MODEL3_LABEL_CONTRACT_V2_20260829` |
| Feature | `packModel3SpanInferFields` |
| Pipeline | `MODEL3_V2_ACOUSTIC_TRAINING_STATE_V1` |
| Protection | `MODEL3_V2_PROTECTION_REGISTRY` |

Ownership files present: feature-pack, path-step, formal B2 harness, holdout registry, family-split owner, V2 label, serializer.

Model3 remains **ASR_POSTPROCESSING_TEXT_REPAIR_TRIGGER** (KEEP/RETRY). No ownership conflict. Precheck **PASS** — HARD STOP A not triggered.

---

## S1 LINEAGE

| Item | Value |
|------|-------|
| Parent | `MODEL3_V2_PRODUCTION_CORE_S1` / `prod_core_s1_build_20260830_v1` |
| Reused supervised families | **999** |
| Mutation | **NO** (sealed rows reused; not rematerialized) |
| S1 after S2 | still 999 families / immutable |

---

## S2 SOURCE FREEZE

| Item | Value |
|------|-------|
| Selection seed | `2026083010` |
| Frozen before outcomes | **YES** |
| Remaining pool after S1 | 17,995 |
| New frozen families | **4,001** |
| Total frozen | **5,000** (999 S1 + 4,001 new) |
| Hard-case mining | **NO** |
| Gate0 excluded | 48 |

**Source (frozen list):** lineage_reuse_s1 999 · prior_certified_v1 1,334 · SUPPLEMENT 2,667  
**Length:** short 1,681 · medium 3,059 · long 260  
Taxonomy used offline only (not runtime Domain/features).

---

## S2 DATASET

| Metric | Count |
|--------|------:|
| **semantic families** | **4,994** |
| utterances | 4,994 |
| paths | 14,414 |
| span×path | 208,073 |
| KEEP | 185,257 |
| RETRY | 15,549 |
| MASKED | 7,267 |

**Materialization (new only):** SUPERVISED_ACCEPTED **3,995** · HARD_REJECT **6** (no outcome-based replacement).  
Total families = 999 + 3,995 = **4,994** (~5k target; infra rejects nonblocking).

Path samples: train 11,513 / dev 1,351 / test 1,550.

---

## VOCABULARY / COVERAGE

| Scope | CJK chars | Bigrams | Trigrams |
|-------|----------:|--------:|---------:|
| S1 | 680 | 2,337 | 3,532 |
| **S2** | **1,034** | **5,724** | **9,521** |
| Full pool (prior) | 1,059 | 6,520 | 11,850 |

S2 chars ≈ **97.6%** of pool char space. Material breadth expansion confirmed.

---

## PRE-TRAIN QA

All critical gates **PASS** (training authorized):

dataset identity · family scale · S1 lineage · freeze-before-outcomes · holdout=0 · Gate0=0 · split leak=0 · provenance · candidate missing=0 · packer · label contract · **label reprojection mismatch=0** (208,073 checked) · Tone Recall · Model2 · Domain · Anchor · multipath · evidence · candidate non-collapsed · no architecture drift.

HARD STOP B not triggered.

---

## CANDIDATE / MULTIPATH

| Channel | Count |
|---------|------:|
| cand=0 | 70,178 |
| cand=1 | 136,262 |
| cand=2 | 1,633 |
| Multipath utterances | 3,074 |

Candidate non-collapsed **PASS**. All multipaths retained.

---

## MODEL2 / DOMAIN / ANCHOR

Owners unchanged. Model2 completed OK on all shards. Domain once/utterance.

| Anchor | Count |
|--------|------:|
| NONE | 200,806 |
| MODEL2 | 3,943 |
| DOMAIN_AND_MODEL2 | 2,091 |
| DOMAIN | 1,233 |

---

## LABEL / DELETION

V2 contract unchanged. Reprojection mismatch **0**. Deletion semantics not reopened (S1 deletion PASS frozen).

---

## S2 TRAINING

| Item | Value |
|------|-------|
| Model | **MODEL3_V2_S2_RANDOM_INIT_V1** |
| Seed | `2026083011` |
| Init | **random_from_scratch** (no RealDist) |
| Config | BiGRU 64/128 · Adam 1e-3 · batch 64 · 8 epochs · class_weight_retry **1.0** · argmax |
| Best epoch | **8** |
| Weights SHA256 | `54322a2670eabd1fbcb7c2b36f24ef62c6413c9bea57d64eda61f81fd04161d9` |
| Train time | ~163 s CPU |

No threshold / class-weight / architecture search.

---

## S1 VS S2 LEARNING CURVE

| Metric | S1 random | S2 random | Δ |
|--------|----------:|----------:|--:|
| Families | 999 | 4,994 | +3,995 |
| RETRY F1 | 0.4859 | **0.8565** | **+0.371** |
| RETRY precision | 0.9139 | 0.8837 | −0.030 |
| RETRY recall | 0.3309 | **0.8309** | **+0.500** |
| KEEP precision | 0.9533 | 0.9864 | +0.033 |
| KEEP recall | 0.9977 | 0.9912 | −0.007 |
| Pred RETRY rate | 2.47% | 7.01% | (true ~6.8–7.5%) |

**Conclusion:** Scale alone (same architecture/config) produces a clear learning curve. S1 underfit diagnosis confirmed.

---

## PROTECTED REAL

Production-equivalent live-trace replay (S1 vocab / S2 vocab surface encoding; no historical reconstructed features).

| Model | Target RETRY | Case any RETRY | Unrelated | KEEP false RETRY |
|-------|-------------:|---------------:|----------:|-----------------:|
| S1 random | **0/13** | 0/13 | 0 | **0/6** |
| **S2 random** | **9/13** | **13/13** | **4** | **0/6** |

Historical RealDist 7/13 remains **HISTORICAL_NON_EQUIVALENT_BASELINE** only (not current SSOT).

Nonblocking: 4 unrelated RETRY — do not tune; monitor at S3.

---

## SURFACE SHORTCUT

Scale reduced underfit; S2 fires RETRY more often with better formal precision/recall balance. One-sided surfaces persist in corpus (natural); no blacklist / relabel. Shortcut risk **improved vs S1 underfit**, not eliminated — scale remains primary lever.

---

## LATENCY

| Model | span p50 ms | utt p50 ms |
|-------|------------:|-----------:|
| S1 | 0.18 | 3.05 |
| S2 | 0.18 | 2.94 |

No regression. Architecture unchanged.

---

## COMPLEXITY AUDIT

| Item | Status |
|------|--------|
| New runtime logic | **NONE** |
| New features | **NONE** |
| New gates / thresholds | **NONE** |
| New compatibility paths | **NONE** |
| RealDist remapping | **REJECTED** |
| Unnecessary complexity | **NO** |

Offline orchestration only (`run_production_core_s2_build.py`, train/eval scripts).

---

## REQUIRED DECISIONS (D1–D22)

| ID | Answer |
|----|--------|
| D1 | Architecture/SSOT precheck **PASS** |
| D2 | No ownership contradiction |
| D3 | S1 reused without mutation **YES** |
| D4 | New families frozen **4,001** |
| D5 | Successfully materialized **3,995** |
| D6 | Final S2 families **4,994** |
| D7 | Vocabulary/context expanded materially **YES** |
| D8 | Candidate non-collapsed **YES** |
| D9 | Multipath preserved **YES** |
| D10 | Model2/Domain/Anchor unchanged **YES** |
| D11 | Label reprojection exact **YES** (0 mismatch) |
| D12 | Pre-train QA authorized training **YES** |
| D13 | `MODEL3_V2_S2_RANDOM_INIT_V1` seed_2026083011 |
| D14 | Formal: large gain (F1 +0.37, recall +0.50) |
| D15 | Protected: target 0→9/13 |
| D16 | KEEP false RETRY controlled (0); unrelated 4 — nonblocking |
| D17 | Shortcut risk improved vs S1 underfit |
| D18 | Learning curve **useful / material** |
| D19 | Feature-capacity audit **NOT** justified now |
| D20 | S3 **authorized** (not started) |
| D21 | Unnecessary complexity **NO** |
| D22 | Next: `MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S3` |

---

## GOVERNANCE

| Item | Changed |
|------|---------|
| ASR / ASR training | **NO** |
| TTS / multi-voice | **NO** |
| Model3 architecture | **NO** |
| Feature / label contract | **NO** |
| FineSpan / Recall / Tone | **NO** |
| Model2 / Domain / Anchor / Retry / Assembly / KenLM | **NO** |
| JobResult | **NO** |
| S1 mutated | **NO** |
| Threshold / class weight tuned | **NO** |
| Hard-case mining | **NO** |

---

## NEXT PHASE

**Exactly one (NOT EXECUTED — await review):**

`MODEL3_V2_PRODUCTION_DATASET_EXPANSION_S3`

Target ~10,000 **total** semantic families. Default init: random-from-scratch. Monitor protected unrelated RETRY.

---

## ARTIFACTS (8 files)

1. `Lingua_Model3_V2_Production_Core_S2_Report_2026_08_30.md`
2. `model3_v2_production_core_s2_summary.json`
3. `model3_v2_production_core_s2_manifest.json`
4. `model3_v2_production_core_s2_qa.csv`
5. `model3_v2_s1_vs_s2_learning_curve.csv`
6. `model3_v2_s2_distribution.csv`
7. `model3_v2_s2_checkpoint_manifest.json`
8. `model3_v2_s1_vs_s2_surface_shortcut.csv`

Dataset: `training/model3_dataset/model3_v2_production_core_s2/`  
Checkpoint: `training/model3_dataset/model3_v2_s2_random_init_v1_ckpts/seed_2026083011/`
