# Lingua — Model3 V2 S3 Mainline Acceptance Audit

Date: 2026-08-31  
Phase: `MODEL3_V2_S3_MAINLINE_ACCEPTANCE_AUDIT`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|------|
| verdict | `S3_MAINLINE_ACCEPTANCE_BLOCKED_BY_ASSEMBLY_OR_KENLM` |
| freeze identity | PASS |
| executable cases | **200** / 200 |
| IMPROVED | 28 |
| REGRESSED | 18 |
| UNCHANGED_NO_RETRY | 10 |
| UNCHANGED_RETRY_NO_EFFECT | 127 |
| INDETERMINATE | 17 |
| architecture invariants | PASS |
| latency Δp50 (ms) | 999.0 |
| promotion readiness | NO |
| next phase | `MODEL3_V2_ASSEMBLY_KENLM_BLOCKER_AUDIT` |

================================
SSOT / IDENTITY
===============

- dataset: `MODEL3_V2_PRODUCTION_CORE_S3` / `prod_core_s3_build_20260830_v1` / 10000 families
- checkpoint: `MODEL3_V2_S3_RANDOM_INIT_V1`
- SHA256: `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1`
- feature/label: `packModel3SpanInferFields` / `MODEL3_LABEL_CONTRACT_V2_20260829`
- L3 evaluator: `MODEL3_V2_L3_EVALUATOR_V1` / `20260831_v1`
- Model3 role: ASR_POSTPROCESSING_TEXT_REPAIR_TRIGGER

================================
ACCEPTANCE HARNESS
==================

| Mode | Mechanism |
|------|-----------|
| BASELINE | same S3 identity + harness `MODEL3_HARNESS_KEEP_ALL=1` (actionable RETRY off) |
| S3 | same S3 identity + actionable RETRY |
| corpus | dialog_200 via `/run-pipeline-with-audio` |
| permanent dual-chain | **NO** |

Denominator: intersection executable = 200. reportedAsDialog200=True.

================================
MAINLINE INVARIANTS
===================

| Check | Result |
|------|--------|
| Domain Vote second violations | 0 |
| effective Anchor RETRY | 0 |
| KenLM pool >16 | 0 |
| Anchor mutation | 0 |
| JobResult changed | NO |
| multipath | preserved (orchestrator unchanged) |

================================
RETRY FUNNEL
============

| Stage | Count |
|------|------:|
| utterances | 200 |
| actionable Model3 RETRY cases | 188 |
| cases with Retry regions | 188 |
| regions with new candidates | 172 |
| Assembly pool changed | 30 |
| KenLM winner changed (proxy) | 56 |
| final IMPROVED | 28 |
| final REGRESSED | 18 |

================================
FINAL OUTPUT QUALITY
====================

Primary classification uses **baseline final vs S3 final vs reference** (not Model3 decision alone).

| Class | N |
|------|--:|
| IMPROVED | 28 |
| UNCHANGED_NO_RETRY | 10 |
| UNCHANGED_RETRY_NO_EFFECT | 127 |
| REGRESSED | 18 |
| INDETERMINATE | 17 |

================================
FALSE RETRY BUSINESS IMPACT
===========================

Retry-span final-effect proxy (dialog_200 lacks full protected targets):

| Impact | N |
|------|--:|
| NO_FINAL_EFFECT | 1022 |
| FINAL_REGRESSION | 223 |
| FINAL_IMPROVEMENT_SIDE_EFFECT | 310 |
| INDETERMINATE | 146 |

NO_FINAL_EFFECT fraction ≈ 0.601; FINAL_REGRESSION fraction ≈ 0.131.

================================
REGRESSION OWNERSHIP
====================

See `model3_v2_s3_regression_ownership.csv`. Owner counts: {'ASSEMBLY_OR_KENLM': 17, 'EVALUATION': 1}.

================================
PROTECTED SENTINEL
==================

| L1 | L2 | L3 logical | L3 STRONG | L4 |
|----|----|------------|-----------|-----|
| 6/13 | 13/13 | 17 | 12 | 0/6 |

Role: **REGRESSION SENTINEL** only.

================================
LATENCY
=======

| | baseline | S3 | Δ |
|--|----------|----|---|
| p50 | 7029.0 | 8028.0 | 999.0 |
| p90 | 12355.0 | 12851.0 | |
| p95 | 15090.0 | 15328.0 | 238.0 |
| max | 24050.0 | 25866.0 | |

Unit: end-to-end `pipeline_ms` (includes ASR). No new latency threshold invented.

================================
CANDIDATE PRESSURE
==================

KenLM pool >16 violations: 0. Cap remains 16. No pruning added.

================================
GENERALIZATION AUDIT CAVEAT
===========================

FEATURE_SEPARABILITY = **UNRESOLVED_NONBLOCKING**  
MODEL_CAPACITY = **NOT_PROVEN_LIMITING**  
No feature/model/training changes authorized from that defective evidence.

================================
COMPLEXITY / GOVERNANCE
=======================

No runtime filter, feature, threshold, class-weight, model, dataset, ASR, FineSpan, Recall, Tone, Model2, Domain, Anchor, Retry, Assembly, KenLM, or JobResult changes.  
No training. No 19k expansion. **No automatic promotion.**

================================
NEXT PHASE
==========

`MODEL3_V2_ASSEMBLY_KENLM_BLOCKER_AUDIT`

Do not execute. Wait for user review.
