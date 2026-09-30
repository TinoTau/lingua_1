# Lingua — Model3 V2 S3 Provenance Freeze + Target Scope Audit

Date: 2026-09-03  
Phase: `MODEL3_V2_S3_PROVENANCE_FREEZE_AND_TARGET_SCOPE_AUDIT`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|-------|
| **verdict** | `MODEL3_S3_TARGET_SCOPE_CORRECTION_PASS_PRIORITY_RESOLVED` |
| runtime provenance | 200/200 FROZEN |
| target causal eligible | 172/200 |
| FIRST_CAUSAL_OWNER | NOT_YET_ISOLATED |
| A1_PROMOTION_READY | FALSE |
| ACP | NO |
| next phase | `MODEL3_V2_S3_LEXICON_COVERAGE_GENERALIZATION_CORRECTION_DESIGN_AUDIT` |

================================
PREVIOUS SEMANTIC CORRECTION
============================

| Old | Superseded by |
|-----|---------------|
| NO_REPAIRABLE_TARGET = 154 (from NO_PRIMARY_TARGET_MAP) | TARGET_SCOPE_NOT_EVALUATED → automated re-evaluation |
| INSUFFICIENT_EVIDENCE_AFTER = 0 as 200/200 target-causal | RUNTIME_TRACE_COMPLETENESS vs TARGET_CAUSAL_COMPLETENESS |

Raw JSONL **not rewritten**.

================================
FROZEN FINDINGS
===============

- LEXICON_COVERAGE = PROVEN_GENERAL_MECHANISM
- RETRY_QUERY_GEOMETRY = PROVEN_GENERAL_MECHANISM
- RECALL_MISS = PROVEN_LOCAL
- POST_RECALL / ASSEMBLY / CROSS_PATH / KENLM = NOT_SUPPORTED_CURRENT_EVIDENCE (unless new eligible evidence above)
- FIRST_CAUSAL_OWNER = NOT_YET_ISOLATED

================================
TRACE INFRASTRUCTURE FREEZE
===========================

TRACE_RUNTIME_PROVENANCE=COMPLETE_200_OF_200; mutation/leakage/gaming/JobResult=NO.  
Collector retained; no redesign.

================================
EVALUATOR FIX
=============

Audit-only scripts:
- `s3_target_scope_derivation.py`
- `emit_s3_provenance_freeze_target_scope_audit.py`

NO_PRIMARY_TARGET_MAP is **never** emitted as NO_REPAIRABLE_TARGET.

================================
REFERENCE FIREWALL
==================

Pipeline → capture trace (frozen) → load reference → align → derive target → classify.  
No reverse flow. No production import of derivation.

================================
AUTOMATIC TARGET DERIVATION
===========================

`derive_malformed_regions` / SequenceMatcher unequal-length opcodes.  
No case IDs. No known expected strings. Anchor subtract supported.

================================
TARGET SCOPE COVERAGE
=====================

| Metric | Count |
|--------|-------|
| totalCases | 200 |
| runtimeTraceComplete | 200 |
| finalAlreadyEquivalent | 28 |
| referenceDiffCases | 172 |
| highConfidenceRepairTargets | 470 |
| mediumConfidenceRepairTargets | 8 |
| lowOrUnresolvedTargets | 1 |
| noRepairableTargets | 0 |
| outsideRetryContract | 0 |
| targetScopeNotEvaluated | 0 |
| targetCausalClassified | 200 |
| targetCausalUnresolved | 0 |
| eligibleTargetCases | 172 |

================================
LEXICON COVERAGE MECHANISM
==========================

reliability=PROVEN_GENERAL; cases=148; families=101; eligibleShare=0.8605; developmentReady=YES

================================
RETRY QUERY GEOMETRY
====================

reliability=PROVEN_GENERAL; cases=14; families=8; eligibleShare=0.0814; submechanisms={'RETRY_REGION_PARTIAL_COVERAGE': 12, 'NO_RAW_RECALL_REGION': 2}; historical compared not merged ({'QUERY_PARITY_PASS': '8/84', 'boundary_mismatch_provisional': 61, 'OLD_BOUNDARY_LOCK_confirmed': 13, 'RETRY_QUERY_BOUNDARY_48': 48, 'cohort': 'query_parity_audit_2026_09_01'}); developmentReady=YES

================================
RECALL MISS
===========

Still PROVEN_LOCAL; cases=10; families=5; developmentReady=NO

================================
POST-RECALL / ASSEMBLY
======================

post_supported=False; assembly_supported=False

================================
CROSS-PATH / KENLM
==================

cross_path=False; kenlm_owner=False (expected NO)

================================
TARGET-KENLM ANOMALY
====================

[
  {
    "caseId": "d001",
    "refSurface": "一杯热",
    "asrSurface": "一杯熱",
    "kenlmPoolSize": 3,
    "kenlmSample": "你好,我想点一杯热拿铁中贝少糖 今天有蓝没马分吗? | 你好,我想点一杯热拿铁中贝少糖 今天有蓝莓马分吗? | 你好,我想点一杯热拿铁中贝少糖 今天有兰梅马分吗?",
    "final": "你好,我想点一杯热拿铁中贝少糖 今天有蓝没马分吗?",
    "baseline": "你好,我想点一杯热拿铁中贝少糖 今天有蓝没马分吗?",
    "finalHasTarget": true,
    "baselineHasTarget": true,
    "explanation": "Target substring present in KenLM pool sentence(s) and/or final, but final not counted as improvement vs baseline (target already in baseline, or other local errors remain).",
    "kenlmIsOwner": "NO"
  },
  {
    "caseId": "d014",
    "refSurface": "不合适",
    "asrSurface": "不合适司时码 ",
    "kenlmPoolSize": 1,
    "kenlmSample": "请问这双鞋有司时码吗? 不合适司时码 三天内可以退换吧",
    "final": "请问这双鞋有司时码吗? 不合适司时码 三天内可以退换吧",
    "baseline": "请问这双鞋有司时码吗? 不合适司时码 三天内可以退换吧",
    "finalHasTarget": true,
    "baselineHasTarget": true,
    "explanation": "Target substring present in KenLM pool sentence(s) and/or final, but final not counted as improvement vs baseline (target already in baseline, or other local errors remain).",
    "kenlmIsOwner": "NO"
  }
]

================================
STRUCTURAL FAMILY ANALYSIS
==========================

Families keyed by `mechanism:norm(refSurface)` — SIJIAO-like repeats share one family. Dedup YES.

================================
MECHANISM PREVALENCE
====================

Denominator = eligible target cases only (172), **not** 200.  
See `model3_v2_s3_mechanism_scope_and_prevalence.csv`.

================================
DEVELOPMENT READINESS
=====================

Lexicon=YES; RetryQuery=YES; Recall=NO; Assembly=NO.  
Priority not from raw count alone. next_design=MODEL3_V2_S3_LEXICON_COVERAGE_GENERALIZATION_CORRECTION_DESIGN_AUDIT

================================
ANTI-OVERFIT GOVERNANCE
=======================

No dialog_200 lexicon inserts. No Retry string special-cases. No A1 promotion. No retrain. No manual 200 map.

================================
FREEZE STATE
============

See `model3_v2_s3_authoritative_freeze_state.csv` (no duplicate keys).

================================
D1–D50
======

| D1 | YES (200/200) |
| D2 | NO |
| D3 | NO |
| D4 | YES |
| D5 | YES |
| D6 | 200/200 |
| D7 | 172/200 HIGH-confidence substantive eligible (0.86) |
| D8 | 0 |
| D9 | 172 |
| D10 | 470 |
| D11 | 8 |
| D12 | 1 |
| D13 | 0 |
| D14 | 0 |
| D15 | NO |
| D16 | NO |
| D17 | NO |
| D18 | NO |
| D19 | YES |
| D20 | 101 |
| D21 | 0.8605 |
| D22 | YES |
| D23 | 8 |
| D24 | 0.0814 |
| D25 | {'RETRY_REGION_PARTIAL_COVERAGE': 12, 'NO_RAW_RECALL_REGION': 2} |
| D26 | NO_IN_THIS_COHORT_OR_UNSEEN |
| D27 | YES |
| D28 | YES |
| D29 | NO |
| D30 | NO_NOT_SUPPORTED_CURRENT_EVIDENCE |
| D31 | NO |
| D32 | NO_NOT_SUPPORTED_CURRENT_EVIDENCE |
| D33 | NO |
| D34 | NO_NOT_SUPPORTED_CURRENT_EVIDENCE |
| D35 | d001 |
| D36 | Target substring present in KenLM pool sentence(s) and/or final, but final not counted as improvement vs baseline (target already in baseline, or other local errors remain). |
| D37 | NO |
| D38 | YES |
| D39 | YES |
| D40 | NO |
| D41 | YES |
| D42 | YES |
| D43 | NO |
| D44 | NO |
| D45 | MODEL3_V2_S3_LEXICON_COVERAGE_GENERALIZATION_CORRECTION_DESIGN_AUDIT |
| D46 | NO |
| D47 | NO |
| D48 | NO |
| D49 | NO |
| D50 | MODEL3_V2_S3_LEXICON_COVERAGE_GENERALIZATION_CORRECTION_DESIGN_AUDIT |

================================
NEXT PHASE
==========

Exactly one: `MODEL3_V2_S3_LEXICON_COVERAGE_GENERALIZATION_CORRECTION_DESIGN_AUDIT`
