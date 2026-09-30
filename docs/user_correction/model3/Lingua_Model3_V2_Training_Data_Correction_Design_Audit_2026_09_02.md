# Lingua Model3 V2 Training Data Correction Design Audit (2026-09-02)

Phase: `MODEL3_V2_LOCALIZATION_TRAINING_DATA_CORRECTION_DESIGN_AUDIT`

## EXECUTIVE VERDICT

| Field | Value |
|---|---|
| **verdict** | `MODEL3_TRAINING_DATA_CORRECTION_DESIGN_EVIDENCE_INSUFFICIENT` |
| **position bias first owner** | `PRIOR_AUDIT_DATASET_IDENTITY_MISMATCH` (measured `model3_v2_labeled`, not S3) |
| **candidate-feature first owner** | `PRIOR_AUDIT_DATASET_IDENTITY_MISMATCH` (+ labeled/realdist builders for that alt path) |
| **minimal correction boundary** | Bind audits/training SSOT to `MODEL3_V2_PRODUCTION_CORE_S3`; add HARD gates; quarantine labeled/realdist — **do not rebuild S3 for claimed P0** |
| **full vs partial rebuild** | **NO_REBUILD** for claimed P0-A/P0-B |
| **training gates** | G0–G8 designed (not implemented) |
| **ACP** | **NO** |
| **next phase** | `MODEL3_V2_TRAINING_DATA_PIPELINE_TRACE_COMPLETENESS_AUDIT` (**NOT EXECUTED**) |

### Why evidence is insufficient for an S3 data-correction development phase

Authoritative S3 train (`model3_v2_production_core_s3`, datasetBuildId `prod_core_s3_build_20260830_v1`) does **not** reproduce the frozen claimed defects:

| Claimed P0 | Prior (labeled) | Authoritative S3 |
|---|---:|---:|
| RETRY share in `[0.9,1.0)` | ≈64.38% | **5.85%** |
| `first_pass_cand_log1p` nonzero | 0% | **64.91%** (0/1/2 present) |

`MODEL3_V2_S3_RANDOM_INIT_V1` was trained by `train_s3_random.py` on **production_core_s3**, not `model3_v2_labeled`. The causality audit indexed the wrong directory. Designing an S3 regeneration to “fix” nonexistent S3 collapses would violate HARD STOP C/D and waste the clean B2 pipeline.

## FROZEN ARCHITECTURE

Production chain, path-local Domain Vote, Model3 KEEP/RETRY role, six features, S3 checkpoint, deriveRetryRegions, JobResult: **unchanged**. This phase made **no** code/data/model mutations.

## CURRENT S3 DATA PIPELINE

```
run_production_core_s3_build.py
 → select references (semanticFamilyId split)
 → Piper TTS (fixed)
 → FasterWhisper ASR
 → acoustic_b2_formal_materialize.cjs
      FineSpan+Recall → Model2 expand → Domain Vote → Anchors
      packModel3SpanInferFields
 → label_spans_v2 (corruptions=[], ASR≠ref regions)
 → serializer (fail-closed cand)
 → model3_v2_production_core_s3/{train,dev,test}
 → train_s3_random.py
```

See `model3_v2_training_pipeline_trace.csv`.

## EXPECTED B2 DATA PIPELINE

Matches the frozen B2 production-equivalent materialization. TTS is materialization only. No multi-speaker / accent / prosody augmentation.

## ARCHITECTURE DRIFT CHECK

| Item | Status |
|---|---|
| S3 formal harness vs B2 | **ALIGNED** |
| Treating `model3_v2_labeled` as S3 SSOT | **AUDIT DRIFT** (not architecture) |
| Legacy `acoustic_b2_materialize.cjs` / realdist hardcode-0 | **TRAINING-ONLY DEAD/ALT PATHS** — must not define Model3 SSOT |

## POSITION BIAS CAUSAL TRACE

```
claimed 64% tail
 → NOT in S3 final shard (5.85%)
 → NOT from S3 label/filter/merge
 → NOT from S3 malformed placement (ASR alignment, no synthetic tail inject)
 → FIRST FAILING OWNER = prior audit measured model3_v2_labeled
```

On labeled-only: mid-bin domination + synthetic corruption/templates → `CORRUPTION_PLACEMENT_BIAS` / `SOURCE_TEMPLATE_POSITION_BIAS` — **out of S3 SSOT scope**.

## POSITION BIAS BY FAMILY

S3 train shard samples all carry `evidenceSource=FORMAL_FRESH_MATERIALIZATION` and build id `prod_core_s3_build_20260830_v1`. RETRY positions are **early/mid/late populated**; not generator-tail dominated. Claimed global S3 position bias: **NOT PROVEN**.

## CANDIDATE FEATURE CAUSAL TRACE

```
claimed training cand=0
 → NOT S3 shard (64.9% nonzero; hist 0/1/2)
 → S3 serializer fail-closed preserves packer output
 → S3 formal harness runs Recall+Model2+packer
 → FIRST FAILING OWNER (of the claim) = audit TRAIN_DIR=model3_v2_labeled
 → labeled: no lattice → cand collapsed
 → realdist: explicit hardcode 0 at build_v2_realdist_expanded.py:120
```

Production path: `model3FirstPassCandidateCount` = uncovered candidates — **unchanged**.

## RECALL / MODEL2 PARITY

| Component | S3 formal | labeled |
|---|---|---|
| Recall | YES | NO |
| Model2 | YES | NO |
| Domain Vote / Anchors | YES | NO |

## MODEL3 PACKER SSOT

- Production: `packModel3SpanInferFields` / `model3FirstPassCandidateCount`
- S3 formal reuses production packer for cand/pinyin
- Full 6-D: `bigru_v1.span_features` and `model3_inference_host._pack_spans` (duplicated formulas; future single SSOT preferred, not this phase)

## MINIMAL CORRECTION DESIGN

1. **Do not rebuild S3** for claimed P0-A/P0-B.
2. **Hard-bind** all Model3 V2 causality/training audits to `model3_v2_production_core_s3` + `datasetId` assert (G0).
3. **Quarantine** `model3_v2_labeled` and `build_v2_realdist_expanded` from Model3 SSOT.
4. **Implement gates G0–G5 HARD** before any future train (design only now).
5. **Re-run localization causality** on authoritative S3 before any data-correction development.
6. Optional later: fail-closed `span_features` when cand field missing despite `recallFirstPass`.
7. Forbidden: shard patching, synthetic cand, uniform bin quotas, dialog_200 injection, class-weight/threshold/model changes.

## DATASET REBUILD STRATEGY

| Decision | Value |
|---|---|
| Rebuild for claimed P0 | **NO** |
| Mix old labeled rows | **NO** |
| Old S3 status | **RETAIN as authoritative until new defect proven** |
| Future new build id | only if a *real* S3 defect is proven post re-causality |
| Scale | stay ~10k families |

## DATASET QUALITY GATES

See `model3_v2_training_data_gate_design.csv`.

- **G3**: EXPECTED_VARIABLE only; exempt legitimate constants (e.g. isAnchor=0 on eligible loss spans).
- **G4**: `max_bin_share ≤ 0.35` + early/mid/late ≥ 0.10 each — catches 64% tail; passes current S3.
- **G5**: require both zero and nonzero cand — no exact production histogram match.

## FUTURE TRAINING ACCEPTANCE

**Before train:** G0–G8 HARD pass; datasetId SSOT; no dialog_200 leak.

**After train (not this phase):** synthetic held-out + localization16 geometry (FULL/PARTIAL/FN/SHIFTED) + full dialog_200 causal acceptance + false-RETRY controls + latency. Do not accept on synthetic F1 alone. Do not reward “more RETRY”.

## TARGET FILES

See `model3_v2_training_data_target_files.csv`.

**MUST_MODIFY (future):** causality audit TRAIN_DIR; dataset gates; quarantine realdist hardcode.

**DO_NOT_MODIFY:** production Model3/FineSpan/Retry/Recall/Model2/DomainVote/JobResult; formal harness (for these P0s); in-place S3 feature rewrite.

## TARGET LIST

T1–T41: architecture frozen; claimed P0s traced to measurement mismatch; B2 parity confirmed on S3; gates designed; no rebuild; no production change; one verdict; one next phase; ≤8 artifacts.

## CHECKLIST

[x] frozen architecture preserved  
[x] S3 model unchanged  
[x] 6-feature contract unchanged  
[x] position bias traced — first owner = prior audit wrong dataset  
[x] candidate collapse traced — first owner = prior audit wrong dataset  
[x] Recall/Model2/packer parity checked on S3  
[x] no uniform-bin / shard-patch / dialog_200 / acoustic aug  
[x] gates designed  
[x] rebuild = NO for claimed P0  
[x] ACP = NO  
[x] no production/training/dataset/model changes this phase  
[x] exactly one verdict / next phase  
[x] ≤8 artifacts  

## GOVERNANCE

| Item | Status |
|---|---|
| production code changed | NO |
| training executed | NO |
| dataset rebuilt | NO |
| model changed | NO |
| threshold changed | NO |
| feature contract changed | NO |
| FineSpan / Retry / Recall / Model2 / Domain Vote / JobResult | NO |

## NEXT PHASE

Exactly one: `MODEL3_V2_TRAINING_DATA_PIPELINE_TRACE_COMPLETENESS_AUDIT`

Purpose: complete training-pipeline SSOT / measurement identity before any correction development. Expected follow-on after that (user-authorized): re-run `MODEL3_V2_LOCALIZATION_TRAINING_CAUSALITY_AUDIT` against `MODEL3_V2_PRODUCTION_CORE_S3`.

**Do not execute.**

## ARTIFACTS (8)

1. `Lingua_Model3_V2_Training_Data_Correction_Design_Audit_2026_09_02.md`
2. `model3_v2_training_pipeline_trace.csv`
3. `model3_v2_position_bias_sources.csv`
4. `model3_v2_candidate_feature_trace.csv`
5. `model3_v2_training_data_gate_design.csv`
6. `model3_v2_training_data_correction_summary.json`
7. `model3_v2_training_data_target_files.csv`
8. `model3_v2_training_data_freeze_state.csv`
