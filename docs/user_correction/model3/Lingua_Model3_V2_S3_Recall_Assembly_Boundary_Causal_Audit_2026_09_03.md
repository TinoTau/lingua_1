# Lingua — Model3 V2 S3 Recall → Assembly Boundary Causal Audit

Date: 2026-09-03  
Phase: `MODEL3_V2_S3_RECALL_ASSEMBLY_BOUNDARY_CAUSAL_AUDIT`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|-------|
| **verdict** | `MODEL3_S3_MULTIPLE_DOWNSTREAM_OWNERS_PROVEN` |
| overfitting detected | **NO** |
| reference leakage detected | **NO** |
| test-gaming detected | **NO** |
| stop boundary | `RECALL_TO_ASSEMBLY` (observation only) |
| Recall owner | **NOT_YET_PROVEN** |
| Assembly owner | **NOT_YET_PROVEN** |
| other owner | `MULTIPLE_LEXICON_AND_RETRY_QUERY` |
| FIRST_CAUSAL_OWNER | **NOT_YET_ISOLATED** |
| ACP | **NO** |
| next phase | `MODEL3_V2_S3_DOWNSTREAM_OWNER_PRIORITY_DESIGN_AUDIT` |

**Invalidated:** prior `RECALL_CHANGED_ASSEMBLY_SAME` → RECALL_OWNER (boolean-only).

================================
ANTI-OVERFITTING AUDIT
======================

No production case-id / HIGH12 / CLEAR_OOS / known-surface special-case branches.  
See `model3_v2_s3_anti_overfit_audit.csv`.

================================
REFERENCE FIREWALL
==================

Production Recall/Assembly/Model3/Retry/Model2/DomainVote cannot access `expectedText` / ground truth.  
Harness reference use is evaluation-only.

================================
CASE-ID / SURFACE PATCH SEARCH
==============================

HARD STOP A/B/C: **PASS**.

================================
TEST HARNESS ISOLATION
======================

No expected-candidate injection; no reference-driven Retry/Assembly mutation.  
`MODEL2_DIALOG200_TRACE` = observation-only.

================================
TEST CONFIG PARITY
==================

Dual-weight audit env changes Model3 checkpoint identity only (documented).  
No test-only topK / cap / domain threshold overrides.

================================
TRAINING / DATA / LEXICON CONTAMINATION
=======================================

| Check | Result |
|-------|--------|
| D12 dialog_200 in S3 train | **NO** |
| D13 class-weight train | **NO** |
| D14 lexicon test-only CLEAR_OOS inserts | **NO** (gaps remain) |

================================
HIGH12 / CLEAR_OOS6
===================

HIGH12 class counts: `{'TARGET_NOT_IN_LEXICON': 11, 'RECALL_TARGET_MISS': 2, 'QUERY_NOT_REPAIR_CAPABLE': 3}`  
Structural families: `{'SIJIAO_LEXICON_GAP': 3, 'CIKA_LEXICON_GAP': 1, 'DABAO_IN_LEXICON_RECALL_PATH': 1, 'XIANGCAI_IN_LEXICON_RECALL_PATH': 1, 'SHANGXIAN_LEXICON_GAP': 1, 'FAYANG_SURFACE': 1, 'SHAOBING_IN_LEXICON': 1, 'XIXI_LEXICON_GAP': 1, 'HOUXUAN_LEXICON_GAP': 1, 'FAPIAO_RAISED_LEXICON_GAP': 1, 'SANQI_LEXICON_GAP': 1, 'ORDER_SURFACE': 1, 'XUQIU_SURFACE': 1, 'XIAOCHEN_SURFACE': 1}`

| caseId | repairCapable | lexicon | inRecall | asmInput | asmOut | firstDrop | class | family |
|--------|---------------|---------|----------|----------|--------|-----------|-------|--------|
| d040 | YES | NO | NO | UNTRACED | NO | LEXICON | TARGET_NOT_IN_LEXICON | SIJIAO_LEXICON_GAP |
| d042 | YES | NO | NO | UNTRACED | NO | LEXICON | TARGET_NOT_IN_LEXICON | CIKA_LEXICON_GAP |
| d085 | YES | NO | NO | UNTRACED | NO | LEXICON | TARGET_NOT_IN_LEXICON | SIJIAO_LEXICON_GAP |
| d129 | YES | YES | NO | UNTRACED | NO | RECALL | RECALL_TARGET_MISS | DABAO_IN_LEXICON_RECALL_PATH |
| d172 | YES | YES | NO | UNTRACED | NO | QUERY_GEOMETRY | QUERY_NOT_REPAIR_CAPABLE | XIANGCAI_IN_LEXICON_RECALL_PATH |
| d175 | YES | NO | NO | UNTRACED | NO | LEXICON | TARGET_NOT_IN_LEXICON | SIJIAO_LEXICON_GAP |

Notes:
- `私教课` / `游泳次卡` / `次卡` / `续费`: **absent** from `lexicon_terms` (coverage gap hypothesis).
- `打包` / `少冰` / `小杯` / `不要香菜` / `微辣`: **present** — cannot blame lexicon; need Recall/query/post-Recall provenance.
- `d040`/`d085`/`d175` share one structural family (`SIJIAO_LEXICON_GAP`) — count as **one** mechanism, not three independent proofs.

================================
FULL200 CANDIDATE FLOW
======================

Most cases: `INSUFFICIENT_EVIDENCE` — A1 dual-weight run lacked per-candidate Assembly-input dumps.  
Counts: `{'INSUFFICIENT_EVIDENCE': 177, 'TARGET_NOT_IN_LEXICON': 11, 'FINAL_ALREADY_EQUIVALENT': 7, 'QUERY_NOT_REPAIR_CAPABLE': 3, 'RECALL_TARGET_MISS': 2}`

================================
RECALL / ASSEMBLY EVIDENCE
==========================

| Standard | Result |
|----------|--------|
| RECALL_OWNER (§29) | **NOT met** (evidence N=2, structural families < 3) |
| ASSEMBLY_OWNER (§29) | **NOT met** (Assembly input identity untraced) |
| LEXICON_COVERAGE | **Hypothesis** for some CLEAR_OOS families; **not frozen** as FIRST_CAUSAL_OWNER |

================================
OWNER DECISION
==============

Stop boundary remains Recall→Assembly.  
Ownership remains **NOT_YET_ISOLATED** pending completed candidate provenance (Recall raw list → pre-Assembly → Assembly → cross-path → KenLM) under A1 same-upstream replay.

================================
GOVERNANCE
==========

No development / training / lexicon edit / cap raise / JobResult change.  
Future fixes must remain general (no caseId / gold-string branches).

================================
NEXT PHASE
==========

`MODEL3_V2_S3_DOWNSTREAM_OWNER_PRIORITY_DESIGN_AUDIT`
