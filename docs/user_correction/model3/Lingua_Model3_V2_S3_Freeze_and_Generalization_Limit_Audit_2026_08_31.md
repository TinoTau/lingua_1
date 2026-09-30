# Lingua — Model3 V2 S3 Freeze + Generalization Limit Audit

Date: 2026-08-31

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|------|
| S3 freeze verdict | `S3_FREEZE_PASS_WITH_DOCUMENTATION_CORRECTIONS` |
| generalization verdict | `S3_GENERALIZATION_LIMIT_ACCEPTABLE_READY_FOR_MAINLINE_ACCEPTANCE` |
| dominant limitation | ACCEPTABLE_WITH_MIXED_RESIDUAL_LIMITS |
| architecture change required | **NO** |
| complexity increase justified | **NO** |
| further scale justified | `NO_FURTHER_SCALE_JUSTIFIED` |
| mainline acceptance readiness | `READY_FOR_MAINLINE_ACCEPTANCE_AUDIT` |
| next phase | `MODEL3_V2_S3_MAINLINE_ACCEPTANCE_AUDIT` |

================================
PART A — S3 FREEZE
==================

## Dataset / checkpoint
- datasetId: `MODEL3_V2_PRODUCTION_CORE_S3`
- buildId: `prod_core_s3_build_20260830_v1`
- families/paths/span×path: 10000 / 30354 / 483957
- modelId: `MODEL3_V2_S3_RANDOM_INIT_V1`
- SHA256: `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1`
- contracts: `packModel3SpanInferFields` / `MODEL3_LABEL_CONTRACT_V2_20260829` / `MODEL3_V2_ACOUSTIC_TRAINING_STATE_V1`
- protection registry: `MODEL3_V2_PROTECTION_REGISTRY`
- S2 mutation: **NO**

## Architecture ownership
Frozen role: `ASR_POSTPROCESSING_TEXT_REPAIR_TRIGGER` → actionable KEEP/RETRY on eligible non-Anchor FineSpans only.

## Anchor semantics (SSOT wording correction, not architecture change)
- `isAnchor`: ownership flag
- `anchorRelation`: audit/context spatial relation
- Anchor **may** participate in sequence encoding / internal logits
- Effective RETRY on `isAnchor==true` = **0** (verified S2/S3)

## L3 evaluation SSOT
- evaluator: `MODEL3_V2_L3_EVALUATOR_V1` / `20260831_v1`
- WEAK: 0&lt;m&lt;1; MODERATE: 1≤m&lt;3; STRONG: m≥3
- dedup: logical (caseId,start,end,surface) max margin
- historical S2 STRONG **10** vs authoritative recompute **11**: HISTORICAL_CSV_VS_AUTHORITATIVE_REPLAY, ONE_SPAN_MARGIN_CROSSED_OR_REPLAYED_ABOVE_3, SAME_LOGICAL_CLEAR_COUNT_EXPECTED_24
- resolved: **True**

### Authoritative protected baselines
| | L1 | L2 | L3 logical | L3 STRONG | L4 |
|--|----|----|------------|-----------|-----|
| S2 | 6/13 | 13/13 | 24 | 11 | 0/6 |
| S3 | 6/13 | 13/13 | 17 | 12 | 0/6 |

## Learning-curve freeze
S1 F1≈0.486 → S2≈0.857 → S3≈0.868 (**diminishing returns, weakly productive**)

## Complexity / scale freeze
- no runtime filter / threshold / class-weight / new feature / larger model
- **no automatic 19k expansion**

## Freeze verification
PASS=True

================================
PART B — GENERALIZATION LIMIT
=============================

## Q1 Why S1→S2 large, S2→S3 small?
S1→S2 filled major coverage/separability gaps (recall 0.33→0.83). S3 added 5006 families but only +25 chars / +586 bigrams / +1621 trigrams (10.25% / 17.05% growth). **Raw scale ≠ effective new information.**

## Q2 Why L3 breadth ↓ while remaining margins stronger?
Authoritative: S2 L3 logical 24 → S3 17; STRONG 11→12. Fewer distant FPs overall; survivors are high-margin isolated mistakes (pattern `ISOLATED_DIVERSE_ERRORS`), not a new systematic over-trigger regime. Precision↑ (0.884→0.947) with recall slightly↓ (0.831→0.801) = sharper but slightly more conservative trigger.

## Q3 Dominant limitation?
**ACCEPTABLE_WITH_MIXED_RESIDUAL_LIMITS** — see root-cause matrix. Primary practical reading: data-scale saturation of effective information + residual same-state feature conflicts; **not** capacity/training-dynamics first.

## Q4 Does unused pool justify more scale?
Remaining families ≈ 8994; new bigrams/trigrams vs S3 = 217 / 722. **No demonstrated failure cluster** mapped to that residual coverage → `NO_FURTHER_SCALE_JUSTIFIED`.

## Training dynamics
Classification: `TRAINING_DYNAMICS_POSSIBLE`. S3 bestEpoch=8; not undertrained as primary limit.

## Feature separability / same-state contrast
High-support mixed-label surfaces: **170**. Indicates current frozen inputs often lack disambiguating signal for residual errors.

## FN / strong distant FP
- FN n=639 cluster=surface_concentrated
- FP n=152 strong=33 cluster=surface_concentrated
- Strong distant pattern: `ISOLATED_DIVERSE_ERRORS` (uniqueSurfaces=12/12)

## Path weighting
paths/family p50=2.0, p90=8.0, topDecileShare=0.264 — secondary, not primary.

## Model capacity
`CURRENT_MODEL_CAPACITY_ADEQUATE` — conflicting labels under similar states argue information limit over width/depth first.

## Protected set
Treat L1–L4 as **regression sentinel**, not population precision.

================================
ROOT CAUSE MATRIX
=================

See `model3_v2_s3_generalization_root_cause_matrix.csv`.

================================
COMPLEXITY DECISION
===================

| Action | Justified? |
|--------|------------|
| more broad data | **NO** |
| targeted natural data | audit-only later if cluster proven; not now |
| new feature | **NO** (separability audit first) |
| larger model | **NO** |
| training-policy change | **NO** |
| label change | **NO** |
| runtime filter / threshold | **NO** |
| architecture change | **NO** |

================================
GOVERNANCE
==========

S3 dataset/checkpoint/ASR/TTS/Model3 runtime/architecture/features/labels/FineSpan/Recall/Tone/Model2/Domain/Anchor/Retry/Assembly/KenLM/JobResult/protected registry: **unchanged**.  
No training, no 19k expansion, no threshold/class-weight tuning.

================================
NEXT PHASE
==========

`MODEL3_V2_S3_MAINLINE_ACCEPTANCE_AUDIT`

Do not execute.
