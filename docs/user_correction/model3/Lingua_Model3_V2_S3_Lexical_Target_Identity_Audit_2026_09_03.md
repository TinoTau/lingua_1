# Lingua — Model3 V2 S3 Lexical Repair Target Identity Audit

Date: 2026-09-03  
Phase: `MODEL3_V2_S3_LEXICAL_REPAIR_TARGET_IDENTITY_CORRECTION`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|-------|
| **verdict** | `MODEL3_S3_LEXICAL_TARGET_IDENTITY_PASS_PRIORITY_UNRESOLVED` |
| prevalence gate | 100.0% (PASS) |
| LEXICON existence | PROVEN_GENERAL (frozen) |
| LEXICON prevalence | targetShare=0.2458 caseAffected=0.5 fam=56 |
| QUERY existence | PROVEN_GENERAL (frozen) |
| QUERY prevalence | targetShare=0.5042 caseAffected=0.7202 fam=89 |
| MECHANISM_PRIORITY | NOT_YET_RESOLVED |
| FIRST_CAUSAL_OWNER | NOT_YET_ISOLATED |
| next phase | `MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT` |

================================
PREVIOUS PREVALENCE SUPERSESSION
================================

148 / 0.8605 Lexicon and 14 / 0.0814 Query shares from prior phase are **SUPERSEDED**.

================================
FROZEN VALID FINDINGS
=====================

Runtime provenance 200/200; mutation/leakage/gaming/JobResult=NO; region localization valid; mechanism **existence** unchanged.

================================
REGION VS LEXICAL TARGET CONTRACT
=================================

REFERENCE_DIFF_REGION localizes differences.  
LEXICAL_REPAIR_TARGET is a Recall-contract lexical unit (lexicon-anchored or structural composition).  
Arbitrary fragments are never auto `TARGET_NOT_IN_LEXICON`.

================================
LEXICON OWNERSHIP POLICY
========================

{
  "authoritativeBundle": "node_runtime/lexicon/v3",
  "schema": "lexicon-v3-runtime-v3",
  "termLengthPolicy": "base/term lengths 1–4 observed; runtime base lookup allows 1–5; idiom fixed length 4",
  "singleCharPolicy": "ALLOWED in base_lexicon by frozen design (IME fill; not sole repair owner)",
  "domainTagging": "term_domain_tags multi-tag SSOT",
  "phrasePolicy": "arbitrary syntactic phrases NOT required; Lexicon owns repairable lexical terms/idioms/domain terms",
  "termLenHistogram": {
    "1": 1125,
    "2": 7553,
    "3": 1696,
    "4": 7
  },
  "domainLexiconCount": 655,
  "idiomCount": 22192,
  "termDomainTagRows": 655,
  "legacyCurrentNotAuthoritative": true
}

================================
NORMALIZATION FILTER
====================

Normalization-equivalent regions: **0**

================================
LEXICAL TARGET DERIVATION
=========================

Sources: EXISTING_LEXICON_TERM | STRUCTURAL_COMPOSITION_SUPPORTED | OUTSIDE_LEXICON_CONTRACT.  
Authoritative DB: V3 (not legacy current).

================================
TARGET IDENTITY CONFIDENCE
==========================

HIGH=476 MEDIUM=0 unresolved≈0

================================
MULTI-TARGET CASES
==================

125 cases with >1 lexical target. Case summary uses mechanisms[] (not forced single primary).

================================
PREVIOUS LEXICON148 REVALIDATION
================================

{"previousN": 148, "valid": 79, "normalization": 0, "outsideContract": 0, "unresolved": 4, "reclassified": 65}

================================
PREVIOUS QUERY14 REVALIDATION
=============================

{"previousN": 14, "valid": 13, "normalization": 0, "outsideContract": 0, "unresolved": 0, "reclassified": 1}

================================
PREVIOUS RECALL10 REVALIDATION
==============================

{"previousN": 10, "valid": 10, "normalization": 0, "outsideContract": 0, "unresolved": 0, "reclassified": 0}  
Recall remains PROVEN_LOCAL.

================================
TARGET-LEVEL MECHANISM PREVALENCE
=================================

Denominator = eligible HIGH lexical targets (476).  
See `model3_v2_s3_corrected_mechanism_prevalence.csv`.

================================
CASE-LEVEL AFFECTED RATE
========================

Denominator = cases with ≥1 eligible HIGH lexical target (168).  
Not “% of all errors caused by”.

================================
STRUCTURAL FAMILY ANALYSIS
==========================

Families = mechanism:norm(lexicalTarget); repeats deduped.

================================
POST-RECALL / ASSEMBLY / KENLM
==============================

post=0 asm=0 kenlm=3

================================
ANTI-OVERFIT / REFERENCE FIREWALL
=================================

No case map; no heldout strings in derivation; reference after frozen trace only. Tests OK=True.

================================
DEVELOPMENT READINESS
=====================

{
  "LEXICON_COVERAGE": {
    "EXISTENCE_RELIABILITY": "PROVEN_GENERAL",
    "PREVALENCE_RELIABILITY": "VALID",
    "targetShare": 0.2458,
    "caseAffectedRate": 0.5,
    "structuralFamilyCount": 56,
    "OWNER_CLARITY": "YES",
    "DEVELOPMENT_READY": "YES"
  },
  "RETRY_QUERY_GEOMETRY": {
    "EXISTENCE_RELIABILITY": "PROVEN_GENERAL",
    "PREVALENCE_RELIABILITY": "VALID",
    "targetShare": 0.5042,
    "caseAffectedRate": 0.7202,
    "structuralFamilyCount": 89,
    "OWNER_CLARITY": "YES",
    "DEVELOPMENT_READY": "YES"
  },
  "RECALL_MISS": {
    "EXISTENCE_RELIABILITY": "PROVEN_GENERAL",
    "PREVALENCE_RELIABILITY": "VALID",
    "targetShare": 0.2395,
    "caseAffectedRate": 0.4464,
    "structuralFamilyCount": 52,
    "OWNER_CLARITY": "YES",
    "DEVELOPMENT_READY": "YES"
  },
  "POST_RECALL": {
    "EXISTENCE_RELIABILITY": "NOT_SUPPORTED_CURRENT_EVIDENCE",
    "PREVALENCE_RELIABILITY": "VALID",
    "targetShare": 0.0,
    "caseAffectedRate": 0.0,
    "structuralFamilyCount": 0,
    "OWNER_CLARITY": "NO",
    "DEVELOPMENT_READY": "NO"
  },
  "ASSEMBLY": {
    "EXISTENCE_RELIABILITY": "NOT_SUPPORTED_CURRENT_EVIDENCE",
    "PREVALENCE_RELIABILITY": "VALID",
    "targetShare": 0.0,
    "caseAffectedRate": 0.0,
    "structuralFamilyCount": 0,
    "OWNER_CLARITY": "NO",
    "DEVELOPMENT_READY": "NO"
  },
  "CROSS_PATH": {
    "EXISTENCE_RELIABILITY": "NOT_SUPPORTED_CURRENT_EVIDENCE",
    "PREVALENCE_RELIABILITY": "VALID",
    "targetShare": 0,
    "caseAffectedRate": 0,
    "structuralFamilyCount": 0,
    "OWNER_CLARITY": "NO",
    "DEVELOPMENT_READY": "NO"
  },
  "KENLM": {
    "EXISTENCE_RELIABILITY": "NOT_SUPPORTED_CURRENT_EVIDENCE",
    "PREVALENCE_RELIABILITY": "VALID",
    "targetShare": 0.0063,
    "caseAffectedRate": 0.0179,
    "structuralFamilyCount": 3,
    "OWNER_CLARITY": "NO",
    "DEVELOPMENT_READY": "NO"
  }
}

================================
AUTHORITATIVE FREEZE STATE
==========================

`model3_v2_s3_corrected_freeze_state.csv`

================================
D1–D52
======

| D1 | NO |
| D2 | NO |
| D3 | NO |
| D4 | NO |
| D5 | NO |
| D6 | NO |
| D7 | YES (frozen raw JSONL 200/200) |
| D8 | YES |
| D9 | NO |
| D10 | YES |
| D11 | 0 |
| D12 | 483 |
| D13 | 476 |
| D14 | 476 |
| D15 | 0 |
| D16 | 0 |
| D17 | 125 |
| D18 | ['EXISTING_LEXICON_TERM', 'STRUCTURAL_COMPOSITION_SUPPORTED', 'OUTSIDE_LEXICON_CONTRACT', 'NORMALIZATION_EQUIVALENT'] |
| D19 | NO |
| D20 | NO |
| D21 | NO |
| D22 | NO |
| D23 | 79 |
| D24 | 0 |
| D25 | 0 |
| D26 | 4 |
| D27 | 65 |
| D28 | 13 |
| D29 | {'RETRY_REGION_PARTIAL_COVERAGE': 230, 'NO_RAW_RECALL_REGION': 10} |
| D30 | 10 |
| D31 | NO_NOW_PROVEN_GENERAL |
| D32 | NO |
| D33 | NO_NOT_SUPPORTED_CURRENT_EVIDENCE |
| D34 | NO_NOT_SUPPORTED_CURRENT_EVIDENCE |
| D35 | NO_NOT_SUPPORTED_CURRENT_EVIDENCE |
| D36 | YES |
| D37 | 0.2458 |
| D38 | 0.5 |
| D39 | 56 |
| D40 | 0.5042 |
| D41 | 0.7202 |
| D42 | 0.2395 |
| D43 | YES |
| D44 | YES |
| D45 | YES |
| D46 | YES |
| D47 | NO |
| D48 | NONE |
| D49 | NO |
| D50 | NO |
| D51 | MODEL3_S3_LEXICAL_TARGET_IDENTITY_PASS_PRIORITY_UNRESOLVED |
| D52 | MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT |

================================
NEXT PHASE
==========

Exactly one: `MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT`
