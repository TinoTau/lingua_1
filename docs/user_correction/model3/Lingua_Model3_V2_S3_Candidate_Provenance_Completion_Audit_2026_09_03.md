# Lingua — Model3 V2 S3 Candidate Provenance Completion Audit

Date: 2026-09-03  
Phase: `MODEL3_V2_S3_DOWNSTREAM_CANDIDATE_PROVENANCE_COMPLETION`  
Mode: TRACE-ONLY / same-upstream A1 dual-weight / post-runtime reference match

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|-------|
| **verdict** | `MODEL3_S3_MULTIPLE_PROVEN_GENERAL_MECHANISMS` |
| trace completeness | provenance=200/200 |
| insufficient before | 177 |
| insufficient after | **0** (0.0%) |
| trace mutation | NO |
| overfitting | NO |
| reference leakage | NO |
| proven mechanisms | general=['LEXICON_COVERAGE', 'RETRY_QUERY_GEOMETRY']; local=['RECALL_MISS'] |
| unresolved mechanisms | POST_RECALL_FILTER / ASSEMBLY / CROSS_PATH / KENLM (no target-level drops observed) |
| FIRST_CAUSAL_OWNER | NOT_YET_ISOLATED (multiple PROVEN_GENERAL; needs priority) |
| ACP | NO |
| next phase | `MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT` |

================================
TRACE IMPLEMENTATION
====================

- Env gate: `MODEL3_CANDIDATE_PROVENANCE_TRACE=1` (explicit `1` only)
- Module: `model3-candidate-provenance-trace.ts` (side-channel collector)
- Wire points: `model3-retry-router.ts`, `run-model3-path-step.ts`, `span-assembly-v4-orchestrator.ts`
- Stages captured: RAW_RECALL → MATERIALIZED → MERGE_PER_SPAN → POST_RETRY_WORKING → PRE_ASSEMBLY_POOL → ASSEMBLY_INPUT_SELECTED → ASSEMBLY_SENTENCES → CROSS_PATH_MERGE → KENLM_POOL
- Exported on path diagnostics / utterance extra only — **not** JobResult
- Candidate identity: runtime `candidateId` + stage ordinal snapshots; diagnostic IDs for assembly picks

================================
TRACE ON/OFF PARITY
===================

Harness: `--parity-check` (dual-weight same-upstream gate = baseline_final equality).

| Check | Result |
|-------|--------|
| TRACE_MUTATION_DETECTED | false |
| SAME_UPSTREAM_PARITY_PASS | 5/5 (d001,d023,d040,d129,d172) |
| TRACE_ON has provenance | true |
| TRACE_OFF no provenance | true |
| Unit collector non-mutation | 4/4 jest PASS |

See `model3_v2_s3_trace_parity_and_anti_overfit.csv`.

================================
REFERENCE FIREWALL
==================

- Runtime JSONL dump contains caseId/raw/final/provenance only from pipeline extras
- `expected` / gold matching runs **only** in `emit_s3_candidate_provenance_completion.py`
- No lexicon insert/update; no gold injection into Recall/Assembly

================================
RETRY QUERY TRACE
=================

Per retry region RAW_RECALL meta records: ownerSpanId, windowText, windowPinyinKey, syllables, retainedDomains, perSpanLimit, localRawStart/End.  
CLEAR_OOS example: d172 issued **no** RAW_RECALL (retry query absent for repair region) → QUERY_NOT_REPAIR_CAPABLE.

================================
LEXICON / RAW RECALL TRACE
==========================

Canonical RAW_RECALL_OUTPUT captured immediately after Recall hits return (before merge).  
Lexicon presence checked read-only against `lexicon.sqlite` post-runtime.

================================
POST-RECALL TRANSFORMATIONS
===========================

Observed real stages (not assumed names):

1. MATERIALIZED (hit → WindowCandidate)
2. MERGE_PER_SPAN (existing-first dedup + score sort + perSpanCap) — drop reasons DEDUP_EQUIVALENT / RANK_LIMIT
3. POST_RETRY_WORKING
4. PRE_ASSEMBLY_POOL
5. ASSEMBLY_INPUT_SELECTED (domain/span pick)

No raw-present reference target was later dropped in DIAG16 (post-filter owner not supported at target level).

================================
PRE-ASSEMBLY TRACE
==================

Mandatory `preAssembly` snapshot on every traced path (200/200).

================================
ASSEMBLY TRACE
==============

`assemblyInputSelected` + `assemblySentences` recorded. No Assembly business change.

================================
CROSS-PATH TRACE
================

Utterance `CROSS_PATH_MERGE` with input/output texts + removal reasons. Path-local Domain Vote preserved.

================================
KENLM TRACE
===========

`KENLM_POOL` = post-merge sentence texts (scores unchanged).

================================
FULL200 WATERFALL
=================

See `model3_v2_s3_candidate_drop_waterfall.csv`.

Class counts: `{'NO_REPAIRABLE_TARGET': 154, 'TARGET_NOT_IN_LEXICON': 11, 'FINAL_ALREADY_EQUIVALENT': 30, 'QUERY_NOT_REPAIR_CAPABLE': 4, 'RECALL_TARGET_MISS': 1}`

Stage counts: `{"validCases": 200, "repairCapableQueries": 8, "targetInLexicon": 5, "targetAbsentLexicon": 11, "recallMiss": 1, "postRecallDrops": 0, "targetPreAssembly": 0, "targetAsmInput": 0, "assemblyDrops": 0, "crossPathDrops": 0, "targetKenlm": 1, "kenlmNonSelect": 0, "finalImprovements": 0}`

================================
HIGH12
======

CLEAR_OOS6 + LOCAL_FIT3 + SURFACE3 (12). Kept separate from UNRESOLVED4.  
See `model3_v2_s3_high12_candidate_trace.csv` (includes UNRESOLVED4 rows marked).

================================
UNRESOLVED4
===========

d008,d022,d051,d094 — traced; not labeled HIGH12.

================================
CLEAR_OOS6
==========

| caseId | repairQ | lexicon | rawRecall | asmIn | kenlm | firstDrop | class |
|--------|---------|---------|-----------|-------|-------|-----------|-------|
| d040 | YES | NO | NO | NO | NO | LEXICON | TARGET_NOT_IN_LEXICON |
| d042 | YES | NO | NO | NO | NO | LEXICON | TARGET_NOT_IN_LEXICON |
| d085 | YES | NO | NO | NO | NO | LEXICON | TARGET_NOT_IN_LEXICON |
| d129 | YES | YES | NO | NO | NO | RAW_RECALL | RECALL_TARGET_MISS |
| d172 | NO | YES | NO | NO | NO | QUERY_GEOMETRY | QUERY_NOT_REPAIR_CAPABLE |
| d175 | YES | NO | NO | NO | NO | LEXICON | TARGET_NOT_IN_LEXICON |

================================
STRUCTURAL FAMILIES
===================

See `model3_v2_s3_structural_mechanism_families.csv`.  
Same-family repeats (e.g. SIJIAO d040/d085/d175) count as **one** structural family.

================================
MECHANISM RELIABILITY
=====================

`{"LEXICON_COVERAGE": "PROVEN_GENERAL", "RETRY_QUERY_GEOMETRY": "PROVEN_GENERAL", "RECALL_MISS": "PROVEN_LOCAL"}`

- LEXICON_COVERAGE: ≥3 independent missing-term families with repair-capable query + absent lexicon + absent RAW_RECALL → **PROVEN_GENERAL**
- RETRY_QUERY_GEOMETRY: ≥3 families with target in lexicon but query not repair-capable → **PROVEN_GENERAL**
- RECALL_MISS: 1 family (d129; target in lexicon, query repair-capable, absent RAW_RECALL) → **PROVEN_LOCAL**
- POST_RECALL / ASSEMBLY / CROSS_PATH / KENLM target-level owners → **NOT_SUPPORTED** (no direct evidence)

================================
ANTI-OVERFIT RECHECK
====================

| Item | Result |
|------|--------|
| caseSpecificRuntimeBranches | NONE |
| surfaceSpecificRuntimeBranches | NONE |
| referenceLeakage | NONE |
| candidateInjection | NONE |
| testConfigOverride | NONE |
| testAwareLexiconMutation | NONE |
| traceBehaviorMutation | NO |

================================
OWNER DECISION
==============

Multiple PROVEN_GENERAL mechanisms (lexicon + retry query). Counts do not alone assign FIRST_CAUSAL_OWNER.  
RECALL / ASSEMBLY still NOT_YET_PROVEN as global owners.

================================
GOVERNANCE
==========

| Gate | Status |
|------|--------|
| JobResult unchanged | YES |
| No lexicon edit | YES |
| No Recall/Assembly/Retry/Model3/KenLM/cap change | YES |
| No training | YES |
| Trace observational only | YES |
| ACP | NO |

================================
D1–D50
======

| Q | A |
|---|---|
| D1 | NO |
| D2 | YES (5/5 same-upstream TRACE_ON==TRACE_OFF) |
| D3 | NO |
| D4 | NO |
| D5 | NO |
| D6 | NO |
| D7 | NO |
| D8 | NO |
| D9 | NO |
| D10 | YES |
| D11 | YES (MATERIALIZED|MERGE_PER_SPAN|POST_RETRY_WORKING|ASSEMBLY_INPUT_SELECTED) |
| D12 | YES |
| D13 | YES |
| D14 | YES |
| D15 | YES |
| D16 | YES (candidateId + stage snapshots) |
| D17 | 0 |
| D18 | 0.0 |
| D19 | 8 |
| D20 | 11 |
| D21 | 1 |
| D22 | 0 |
| D23 | MERGE_PER_SPAN|ASSEMBLY_INPUT_SELECTED (0 observed drops of raw-present targets) |
| D24 | 0 |
| D25 | 0 |
| D26 | 0 |
| D27 | 1 |
| D28 | 0 |
| D29 | 0 |
| D30 | 0 |
| D31 | PROVEN_GENERAL |
| D32 | PROVEN_GENERAL |
| D33 | PROVEN_LOCAL |
| D34 | NOT_SUPPORTED |
| D35 | NOT_SUPPORTED |
| D36 | NOT_SUPPORTED |
| D37 | NOT_SUPPORTED |
| D38 | ['RECALL_MISS'] |
| D39 | ['POST_RECALL_FILTER', 'ASSEMBLY', 'CROSS_PATH', 'KENLM'] |
| D40 | {'LEXICON_COVERAGE': True, 'RETRY_QUERY_GEOMETRY': True, 'RECALL_MISS': False} |
| D41 | NO |
| D42 | NO |
| D43 | YES |
| D44 | LEXICON_COVERAGE |
| D45 | NO |
| D46 | YES (priority audit / design) |
| D47 | NO (not yet) |
| D48 | NO |
| D49 | MODEL3_S3_MULTIPLE_PROVEN_GENERAL_MECHANISMS |
| D50 | MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT |

================================
NEXT PHASE
==========

Exactly one: `MODEL3_V2_S3_DOWNSTREAM_MECHANISM_PRIORITY_AUDIT`
