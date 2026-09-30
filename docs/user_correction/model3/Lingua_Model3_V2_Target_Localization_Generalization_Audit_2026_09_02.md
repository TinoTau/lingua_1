# Lingua — Model3 V2 Target Localization Generalization Audit

Date: 2026-09-02  
Phase: `MODEL3_V2_TARGET_LOCALIZATION_GENERALIZATION_AUDIT`  
Mode: FREEZE CONFIRMED ARCHITECTURE / READ-ONLY / AUDIT-ARTIFACT CORRECTION ONLY

================================
EXECUTIVE VERDICT
=================

| Item | Result |
|------|--------|
| **Verdict** | **`MODEL3_TARGET_LOCALIZATION_AUDIT_PASS_MIXED`** |
| **16-case root causes** | MODEL_GENERALIZATION_FAILURE=11, TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH=4, TRAINING_COVERAGE_GAP=1 |
| **5 no-FineSpan owners** | FINESPAN_PRESENT_OTHER_PATH=5 |
| **Largest production owner** | **MODEL_GENERALIZATION_FAILURE** (11/16) |
| **Second owner** | **TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH** (4/16) |
| **Prior audit corrections** | Coverage table 32→34; funnel prose 29/5→27/7; D37 metadata reconciled |
| **ACP** | **NO** |
| **Next phase** | **`MODEL3_V2_LOCALIZATION_MINIMAL_CORRECTION_DESIGN_AUDIT`** (not executed) |

================================
FROZEN ARCHITECTURE
===================

Path-local Domain Vote、Model3 KEEP/RETRY-only、deriveRetryRegions contract、KEEP/Anchor barrier、S3 `MODEL3_V2_S3_RANDOM_INIT_V1`、0/0/200 acceptance — **全部冻结，未改动**。

================================
PREVIOUS AUDIT CORRECTIONS
==========================

| Bug | Before | After | Root cause |
|-----|--------|-------|------------|
| Coverage table | NO_RETRY19+PARTIAL8+FULL0+NO_SPANS5=**32** | +TARGET_NOT_MODEL3_ELIGIBLE **7** = **34** | Report used `NO_REPAIRABLE_TARGET(5)` only; omitted **d101,d118** |
| Funnel prose | 29/5 spans found | **27/7** | Manual report typo; JSON funnel already 27/7 |
| D37 vs model3LocalizationPrimary | inconsistent | **production count=16; primary blocker=false** | Compared count≥13 vs count≥20 |

`model3_v2_retry_region_trigger_summary.json` updated with `CORRECTED_METADATA`.

================================
16-CASE POPULATION
==================

| Class | Cases |
|-------|-------|
| SHIFTED_NEARBY (8) | d008, d040, d042, d051, d054, d085, d172, d175 |
| FALSE_NEGATIVE (4) | d065, d109, d114, d138 |
| PARTIAL_COVERAGE (4) | d022, d094, d102, d129 |

================================
ROOT CAUSES (16)
================

- **MODEL_GENERALIZATION_FAILURE**: 11 (68.8%) — d022|d040|d065|d085|d094|d102|d109|d114|d129|d138|d175
- **TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH**: 4 (25.0%) — d008|d042|d051|d172
- **TRAINING_COVERAGE_GAP**: 1 (6.3%) — d054

================================
5 NO-FINESPAN CASES
===================

- **d056**: FINESPAN_PRESENT_OTHER_PATH (currentPathOverlap=NO, otherPathOverlap=YES)
- **d060**: FINESPAN_PRESENT_OTHER_PATH (currentPathOverlap=NO, otherPathOverlap=YES)
- **d073**: FINESPAN_PRESENT_OTHER_PATH (currentPathOverlap=NO, otherPathOverlap=YES)
- **d132**: FINESPAN_PRESENT_OTHER_PATH (currentPathOverlap=NO, otherPathOverlap=YES)
- **d161**: FINESPAN_PRESENT_OTHER_PATH (currentPathOverlap=NO, otherPathOverlap=YES)

**No case frozen as ARCHITECTURE_GAP.** Status remains **EXPRESSIBILITY_STATUS_UNRESOLVED** cohort-wide until path-provenance realignment.

**Interpretation:** 5/5 在 **audit 绑定的 pathId** 上无 overlapping FineSpan，但在 **另一 retained path** 上存在可覆盖 target 的 span（例如 d056「挂」在 path `8abbc…` 的 `:0`）。这是 **path-provenance / audit harness 路径绑定** 问题，不是 FineSpan 架构不可表达。

================================
FALSE NEGATIVE 4
================

| caseId | surface | margin | trainingSupport | rootCause |
|--------|---------|--------|-----------------|-----------|
| d065 | 这 | -5.94 (strong KEEP) | TRAIN_SUPPORT_MODERATE | MODEL_GENERALIZATION_FAILURE |
| d109 | 候 | -11.15 (strong KEEP) | TRAIN_SUPPORT_WEAK | MODEL_GENERALIZATION_FAILURE |
| d114 | 发 | -11.07 (strong KEEP) | TRAIN_SUPPORT_MODERATE | MODEL_GENERALIZATION_FAILURE |
| d138 | 病 | -1.32 (near boundary) | TRAIN_SUPPORT_WEAK | MODEL_GENERALIZATION_FAILURE |

**D9–D12:** EXPECTED_RETRY_CONFIRMED **4/4**；strong/moderate training support **4/4**；generalization failure **4**；training coverage gap **0**。

================================
PARTIAL COVERAGE 4
==================

Pattern: RETRY + KEEP (+ KEEP) on contiguous repair unit — KEEP barrier downstream **correct**; Model3 未对全部 required span 标 RETRY。

| caseId | pattern | rootCause |
|--------|---------|-----------|
| d022 | RETRY「定」+ KEEP「但/显」 | MODEL_GENERALIZATION_FAILURE |
| d094 | KEEP「成」+ RETRY「科互」 | MODEL_GENERALIZATION_FAILURE |
| d102 | KEEP「这/个」+ RETRY「检」 | MODEL_GENERALIZATION_FAILURE |
| d129 | RETRY「爆」+ KEEP「马」 | MODEL_GENERALIZATION_FAILURE |

================================
SHIFTED NEARBY 8 — FEATURE ANALYSIS
===================================

Primary discriminant: **`span_rel_position`**（neighbor 往往更靠近 training RETRY 常见的 utterance-tail 分布）。

| caseId | target rel_pos | neighbor rel_pos | delta | rootCause |
|--------|---------------|------------------|-------|-----------|
| d008 | 0.27 | 0.42 | +0.15 | TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH |
| d042 | 0.13 | 0.33 | +0.20 | TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH |
| d051 | 0.04 | 0.21 | +0.17 | TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH |
| d172 | 0.00 | 0.20 | +0.20 | TRAIN_RUNTIME_FEATURE_DISTRIBUTION_MISMATCH |
| d040/d085/d175 | 0.00 | 0.06 | +0.06 | MODEL_GENERALIZATION_FAILURE (overlap-adjacent) |
| d054 | 0.18 | 0.12 | -0.06 | TRAINING_COVERAGE_GAP |

**D16–D20:** feature delta 以 rel_position 为主；`first_pass_cand_log1p` 在 margin dump 中 **缺省为 0**（与 training 一致）；**FEATURE_INFORMATION_LIMITATION 未证明**（0/8 indistinguishable pairs）。

================================
RUNTIME PACKER PARITY
=====================

- 六特征按 `bigru_v1.span_features` / `model3-feature-pack.ts` 公式打包：**MATCH**
- `first_pass_cand_log1p`: margin CSV **无** candidate count → audit 使用 **0**（与 training 默认一致，见 `model3_v2_training_feature_provenance_matrix.csv`）
- **D23: YES** — 无 packer 实现偏差证据
- **D24/D25: NO** — 无 collapsed runtime/training feature（除 training 中 cand=0 的已知分布）

================================
STRICT CAUSAL FUNNELS
=====================

**16-case:** 16→16 repair valid → 16 path valid → 16 FineSpan → 16 eligible → 16 packed → 16 V2 RETRY expected → 16 training support → 16 runtime decision captured.

**5 no-FineSpan:** 5→5 repair valid → 5 offsets valid → 5 all paths inspected → **0 on audit path / 5 on other path** → owner assigned.

================================
FREEZE UPDATE
=============

| Item | Status |
|------|--------|
| deriveRetryRegions | **FROZEN CORRECT** |
| Model3 localization 16 | **FROZEN** (shift8+fn4+partial4) |
| no-FineSpan 5 | **EXPRESSIBILITY_STATUS_UNRESOLVED** |
| S3 / threshold / 6 features | **FROZEN** |
| Prior RETRY_REGION_DERIVATION=34 | **RETIRED** (unchanged) |

================================
GOVERNANCE
==========

All production components: **NO CHANGE**. Audit script corrected: **YES**.

================================
NEXT PHASE
==========

**`MODEL3_V2_LOCALIZATION_MINIMAL_CORRECTION_DESIGN_AUDIT`** — await user review.
