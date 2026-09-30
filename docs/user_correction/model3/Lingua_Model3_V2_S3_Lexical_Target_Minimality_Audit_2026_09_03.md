# Lingua Model3 V2 S3 — Lexical Target Minimality / Necessity Audit

Generated: 2026-09-03T10:39:17Z  
Phase: `MODEL3_V2_S3_LEXICAL_TARGET_MINIMALITY_NECESSITY_AUDIT`

================================
EXECUTIVE VERDICT
=================

**MODEL3_S3_TARGET_MINIMALITY_PASS_PRIORITY_RESOLVED**

Next phase: `MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CORRECTION_DESIGN_AUDIT`

Primary metric shifted from raw target share (476) → **repair-event share** after minimality.  
Provisional prevalence 0.5042 / 0.2458 / 0.2395 and surface families 89/56/52 are **SUPERSEDED**.  
Recall SSOT corrected to **PROVEN_LOCAL** (was contradictory PROVEN_LOCAL vs PROVEN_GENERAL).

================================
FROZEN INPUT STATE
==================

| Item | State |
|------|-------|
| TRACE_RUNTIME_PROVENANCE | COMPLETE_200_OF_200 (unchanged) |
| TRACE_BEHAVIOR_MUTATION | NO |
| REFERENCE_LEAKAGE | NO |
| TEST_GAMING | NO |
| JOBRESULT_CHANGED | NO |
| REFERENCE_DIFF_REGION ≠ LEXICAL_TARGET | FROZEN |
| LEXICAL_TARGET_THREE_LEVEL_MODEL | FROZEN |
| MULTI_TARGET_CASE_ALLOWED | FROZEN |
| Authoritative inputs | lexical_targets.csv + corrected_* + frozen raw jsonl |

================================
SSOT CONFLICT CORRECTION
========================

| Key | OLD | NEW |
|-----|-----|-----|
| RECALL_MISS_EXISTENCE | PROVEN_GENERAL (freeze) vs PROVEN_LOCAL (narrative) | **PROVEN_LOCAL** |
| Prevalence 0.5042/0.2458/0.2395 | VALID | SUPERSEDED_BY_REPAIR_EVENT_MINIMALITY |
| Families 89/56/52 | surface mechanism:norm(target) | SUPERSEDED; corrected Q=3 L=0 R=2 |

Reason for Recall contradiction: identity-phase freeze/summary set EXISTENCE_RELIABILITY=PROVEN_GENERAL from inflated surface families while the report body retained historical PROVEN_LOCAL. This audit does not silently pick either; authoritative pending minimality was PROVEN_LOCAL; after revalidation: **PROVEN_LOCAL**.

================================
TARGET MINIMALITY CONTRACT
==========================

Prevalence-eligible targets must be **MINIMAL NECESSARY LEXICAL REPAIR UNITS** (A–G).  
Roles assigned: PRIMARY_MINIMAL | ALTERNATIVE_MINIMAL | CONTEXT_SUPPORT | SUPERSET_REDUNDANT | PARTIAL_INSUFFICIENT | AMBIGUOUS | INVALID_LEXICAL_TARGET.

Only PRIMARY_MINIMAL enters primary prevalence denominator; ALTERNATIVE_MINIMAL counted once per repair event.

Role counts: `{'PRIMARY_MINIMAL': 210, 'PARTIAL_INSUFFICIENT': 290, 'SUPERSET_REDUNDANT': 8, 'INVALID_LEXICAL_TARGET': 117, 'ALTERNATIVE_MINIMAL': 60, 'CONTEXT_SUPPORT': 85}`

Zero changed-element overlap targets: **85** (cannot be PRIMARY_MINIMAL).

================================
REPAIR EVENT DERIVATION
=======================

| Metric | Count |
|--------|------:|
| rawCandidateTargetCount | 476 |
| primaryMinimalTargetCount | 210 |
| alternativeMinimalTargetCount | 60 |
| repairEventCount (mechanism-bearing) | 237 |
| eligibleCases | 125 |

`repairEventId` = `{regionId}:e{clusterIndex}` from clustered unequal opcodes inside the region core. Audit-only; no runtime type change.

================================
STRUCTURAL_COMPOSITION AUDIT
============================

Implementation: `training/model3_dataset/scripts/s3_lexical_target_identity.py::_structural_units`

Exact rule: ['If norm(diffCoreRef) length in [2,4], no outside-contract, no leading/trailing function char → emit exact core surface', 'Else emit shortest substring L in [max(2,coreLen),4] that fully covers the core within punctuation-bounded run']

| Question | Answer |
|----------|--------|
| Independent lexical evidence? | NONE beyond contiguous CJK/window substring covering the diff |
| Function words? | Partial — leading/trailing function chars blocked for exact-core path; interior function chars may remain |
| Punctuation? | NO — runs clipped at punctuation; outside_lexicon_contract rejects punct-bearing units |
| Unchanged context? | YES — shortest full cover may include unchanged neighbors |
| Arbitrary 2–5 windows? | YES — any 2–4 char cover of the core can be emitted |
| Half-words? | YES — fragments without lexicon membership |
| Diff-overlap alone? | YES — covering the diff core is the primary condition |
| Lexical vs syntactic fragment? | NO |
| Hard standard | **FAILS_INDEPENDENT_LEXICAL_IDENTITY_STANDARD** |
| PRIMARY_MINIMAL from structural | **0** (required 0) |

Therefore STRUCTURAL → **INVALID_LEXICAL_TARGET** / OUTSIDE_CURRENT_CONTRACT for prevalence; **not** TARGET_NOT_IN_LEXICON (circular gap prevention).

================================
EXISTING LEXICON TARGET AUDIT
=============================

Existing Lexicon membership ⇒ lexical validity, **not** repair necessity.  
Targets with zero changed-element overlap → CONTEXT_SUPPORT.  
Overlapping supersets → SUPERSET_REDUNDANT when a smaller covering term exists.

Raw EXISTING_LEXICON_TERM candidates: 359

================================
MULTI-TARGET REDUCTION
======================

| | Before (raw targets/case) | After (repair events/case) |
|--|---------------------------:|---------------------------:|
| multi cases | 125 | 76 |
| distribution | {'4+': 58, '1': 43, '3': 27, '2': 40} | {'4+': 9, '1': 49, '3': 16, '2': 51, '0_primary_events_but_had_candidates': 43} |

Large reduction expected; not a failure.

================================
LEXICON117 REVALIDATION
=======================

Previous TARGET_NOT_IN_LEXICON N=117

Buckets: `{'INVALID_LEXICAL_TARGET': 117}`

Valid minimal lexicon gaps (PRIMARY): **0**  
Repair-event share after minimality: **0.0** (events=0)

================================
QUERY240 REVALIDATION
=====================

Previous QUERY_NOT_REPAIR_CAPABLE N=240

Buckets: `{'SUPERSET_REDUNDANT': 3, 'VALID_MINIMAL': 150, 'UNRESOLVED': 3, 'ALTERNATIVE_MINIMAL': 30, 'CONTEXT_SUPPORT': 54}`

Surviving repair events: **166**  
repairEventShare: **0.7004**  
caseAffectedRate: **0.848**  
Submechanisms: `{'RETRY_REGION_PARTIAL_COVERAGE': 159, 'NO_RAW_RECALL_REGION': 7}`

================================
RECALL114 REVALIDATION
======================

Previous RECALL_TARGET_MISS N=114

Buckets: `{'VALID_MINIMAL': 50, 'SUPERSET_REDUNDANT': 5, 'ALTERNATIVE_MINIMAL': 28, 'CONTEXT_SUPPORT': 30, 'UNRESOLVED': 1}`

Surviving repair events: **67**  
Query parity: required by classifier before RECALL_TARGET_MISS (directly observed repair-capable query + RAW miss).

================================
RECALL GENERALIZATION
=====================

Structural families (corrected): **2**  
Gate ≥3 independent minimal families: **FAIL**  
Authoritative: **RECALL_MISS_EXISTENCE = PROVEN_LOCAL**

================================
STRUCTURAL FAMILY REVALIDATION
==============================

Old rule `mechanism:norm(lexicalTarget)` → **SUPERSEDED_PENDING_STRUCTURAL_FAMILY_REVALIDATION**.

New key: `mechanism|queryPattern|lenBucket|geom|identitySource|role`

| Mechanism | Old surface families | Corrected structural families |
|-----------|---------------------:|------------------------------:|
| Query | 89 | 3 |
| Lexicon | 56 | 0 |
| Recall | 52 | 2 |

================================
CORRECTED MECHANISM PREVALENCE
==============================

Denominator: eligibleRepairEvents=237, eligibleCases=125, primaryMinimalTargets=210

| Mechanism | repairEventCount | repairEventShare | caseAffectedRate | structuralFamilies |
|-----------|-----------------:|-----------------:|-----------------:|-------------------:|
| QUERY_NOT_REPAIR_CAPABLE | 166 | 0.7004 | 0.848 | 3 |
| TARGET_NOT_IN_LEXICON | 0 | 0.0 | 0.0 | 0 |
| RECALL_TARGET_MISS | 67 | 0.2827 | 0.488 | 2 |
| KENLM | 3 | 0.0127 | 0.024 | 1 |

Prevalence validity gate (≥90% HIGH events classified): **100.0%** → PASS

================================
POST-RECALL / ASSEMBLY / KENLM
==============================

| Mechanism | Supported after minimality? |
|-----------|----------------------------|
| POST_RECALL | NO |
| Assembly | NO |
| Cross-path | NO |
| KenLM | LIMITED |

================================
ANTI-OVERFIT / REFERENCE FIREWALL
=================================

Anti-overfit scan: `{'caseIdBranchesInAlgo': 0, 'high12SpecialHandling': False, 'dialog200HardcodeInAlgo': False, 'manualTargetMap': False, 'verdict': 'NONE', 'emitFileMentionsCaseIdsForReportingOnly': False}`  
Order preserved: frozen trace → alignment → region → repair event → candidates → minimality → mechanism.  
No reverse flow. Unit tests: 12 run, ok=True.

Normalization boundary: Region-level NORMALIZATION_EQUIVALENT is only counted when a derived region survives case-level filtering. Cases where fold_cjk_variant / norm_text makes full ASR==reference are classified FINAL_ALREADY_EQUIVALENT before region bundles are emitted, so trad/simp-only utterance diffs never enter repairRegions. Within surviving regions, punctuation/digit-style-only diffs set normalizationEquivalent=True; prior cohort had 0 such surviving regions.

================================
DEVELOPMENT READINESS
=====================

| Mechanism | Ready? |
|-----------|--------|
| Retry Query Geometry | True |
| Lexicon Coverage (as gap count) | False |
| Recall Miss | False |

Priority resolved: **True** → QUERY_NOT_REPAIR_CAPABLE  
FIRST_CAUSAL_OWNER: NOT_YET_ISOLATED  
A1_PROMOTION_READY: FALSE  
Retraining: NO  
ACP: NO

================================
AUTHORITATIVE FREEZE STATE
==========================

See `model3_v2_s3_corrected_freeze_state.csv` (explicit OLD→NEW corrections above; historical artifacts not silently rewritten beyond this corrected freeze file which is the phase deliverable).

================================
NEXT PHASE
==========

`MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CORRECTION_DESIGN_AUDIT`

Exactly one.

---

## D1–D56

{
  "D1": "NO",
  "D2": "NO",
  "D3": "NO",
  "D4": "NO",
  "D5": "NO",
  "D6": "NO",
  "D7": "YES_UNCHANGED_COMPLETE_200_OF_200",
  "D8": 476,
  "D9": 237,
  "D10": 210,
  "D11": 60,
  "D12": 85,
  "D13": 8,
  "D14": 290,
  "D15": 0,
  "D16": 117,
  "D17": 85,
  "D18": 125,
  "D19": 76,
  "D20": [
    "If norm(diffCoreRef) length in [2,4], no outside-contract, no leading/trailing function char → emit exact core surface",
    "Else emit shortest substring L in [max(2,coreLen),4] that fully covers the core within punctuation-bounded run"
  ],
  "D21": "YES_ARBITRARY_2_TO_4_CHAR_COVER_FRAGMENTS",
  "D22": 0,
  "D23": 0,
  "D24": {
    "invalid": 117,
    "context": 0,
    "redundant": 0,
    "unresolved": 0,
    "reclassified": 0,
    "alternative": 0
  },
  "D25": 166,
  "D26": {
    "RETRY_REGION_PARTIAL_COVERAGE": 159,
    "NO_RAW_RECALL_REGION": 7
  },
  "D27": 67,
  "D28": "YES_BY_CLASSIFIER_CONTRACT_repair_capable_query_required_before_RECALL_TARGET_MISS",
  "D29": 2,
  "D30": "NO_RETAIN_PROVEN_LOCAL",
  "D31": "Narrative retained historical PROVEN_LOCAL; freeze/summary incorrectly wrote PROVEN_GENERAL from surface-based family counts after lexical-target identity phase — internal contradiction, not silent choice.",
  "D32": "YES_CORRECTION_PROPOSAL_EMITTED",
  "D33": "YES",
  "D34": "YES_SUPERSEDED",
  "D35": {
    "QUERY": 3,
    "LEXICON": 0,
    "RECALL": 2
  },
  "D36": 0.7004,
  "D37": 0.0,
  "D38": 0.2827,
  "D39": {
    "QUERY": 0.848,
    "LEXICON": 0.0,
    "RECALL": 0.488
  },
  "D40": "YES",
  "D41": "YES",
  "D42": "PROVISIONAL_RELIABLE_AT_REPAIR_EVENT_LEVEL",
  "D43": "NOT_SUPPORTED_AS_GAP_COUNT",
  "D44": "LOCAL_ONLY",
  "D45": "NO",
  "D46": "NO",
  "D47": "NO",
  "D48": "LIMITED",
  "D49": "YES",
  "D50": "QUERY_NOT_REPAIR_CAPABLE",
  "D51": "YES",
  "D52": "NO",
  "D53": "NO",
  "D54": "NO",
  "D55": "NO",
  "D56": "MODEL3_V2_S3_RETRY_QUERY_GEOMETRY_CORRECTION_DESIGN_AUDIT"
}
