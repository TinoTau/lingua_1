# Lingua — Model3 V2 S3 Class Weight Downstream Utility Causal Audit

Date: 2026-09-03  
Phase: `MODEL3_V2_S3_CLASS_WEIGHT_DOWNSTREAM_UTILITY_CAUSAL_AUDIT`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|-------|
| **verdict** | `MODEL3_S3_CLASS_WEIGHT_DOWNSTREAM_OWNER_IDENTIFIED` |
| baseline checkpoint | `MODEL3_V2_S3_RANDOM_INIT_V1` |
| A1 checkpoint | `MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1` (cw=2.0) |
| full replay complete | TRUE |
| final unknown count | 0 |
| Model3 changed | 192 |
| Retry changed | 192 |
| Recall changed | 192 |
| Assembly changed | 0 |
| KenLM changed | 0 |
| final improved | 0 |
| final regressed | 0 |
| net utility | 0 |
| dominant downstream owner | RECALL |
| FIRST_CAUSAL_OWNER | NOT_YET_ISOLATED |
| promotion readiness | FALSE |
| ACP | NO |
| next phase | `MODEL3_V2_S3_RECALL_CORRECTION_DESIGN_AUDIT` |

================================
SSOT CORRECTION
===============

Prior freeze `CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY=INTERNAL_ONLY_NO_FINAL_UTILITY` was premature (Model3-only replay).  
After full same-upstream downstream replay: **`INTERNAL_ONLY_NO_FINAL_UTILITY`**.

================================
CHECKPOINT IDENTITY
===================

| Branch | SHA256 | Verified |
|--------|--------|----------|
| Baseline S3 | `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1` | YES |
| A1 RERUN1 | `2d1c763249d5fca5c7586ea41868e391cc70e495069b5bab5f2e5905982e1bd0` | YES |
| Training this phase | NO | — |

================================
UPSTREAM SNAPSHOT PARITY
========================

- valid causal cases: **200/200**
- invalid causal cases: **0**
- upstream parity pass: **TRUE**
- Model3 unchanged parity controls (8): `d011, d023, d038, d044, d078, d102, d147, d168` — all downstream identical to baseline branch.

================================
FULL 200-CASE REPLAY
====================

Both branches executed from **one frozen upstream snapshot per path** via `runModel3PathStepDualWeightCausalFork`.

================================
MODEL3 DECISION DELTA
=====================

- changed: **192**
- unchanged: **8**
- prior offline packed-only delta (reference): 158 changed

================================
RETRY / RECALL / ASSEMBLY / KENLM DELTA
=======================================

| Stage | Changed cases |
|-------|---------------|
| Retry region | 192 |
| Retry query | 192 |
| Recall candidate set | 192 |
| Assembly pool | 0 |
| KenLM winner | 0 |
| Final text | 0 |

Dominant decomposition: **RECALL_CHANGED_ASSEMBLY_SAME** (192/200).

================================
FINAL TEXT UTILITY
==================

| Class | Count |
|-------|-------|
| IMPROVED | 0 |
| REGRESSED | 0 |
| NEUTRAL | 0 |
| UNCHANGED | 200 |
| **net** | **0** |

A1 triggers more RETRY and changes Recall outputs, but **zero** final-text utility on dialog_200.

================================
FALSE RETRY CONSEQUENCE
=======================

See `model3_v2_s3_false_retry_consequence.csv`. Baseline-correct cases with extra downstream work: **27**; regressions: **0**.

================================
CLEAR OOS 6
===========

- localization Model3 improved (decision delta): **6/6** have Model3 change
- final improved: **0/6**

================================
LOCAL_FIT_WEAK 3 / SURFACE 3 / UNRESOLVED4
==========================================

- LOCAL_FIT final improved: **0/3**
- SURFACE final improved: **0/3**
- UNRESOLVED4: diagnostic only (not used for promotion)

================================
DOWNSTREAM OWNER ANALYSIS
=========================

Repeated causal stop: **repair-capable Retry query reaches Recall → candidate set changes → Assembly pool unchanged → final unchanged**.

Per query-parity rule: Recall **may** own when query reaches Recall and needed repair candidate absent from merged pool.  
Evidence supports **`RECALL`** as dominant stop stage (**192/192** Model3-changed cases), not proven global FIRST_CAUSAL_OWNER.

================================
ARCHITECTURE INVARIANTS
=======================

| Invariant | Result |
|-----------|--------|
| second Domain Vote | NO |
| second Model3 stage | NO |
| recursive Retry | NO |
| ASR rerun | NO |
| candidate cap ≤16 | YES |
| JobResult changed | NO |

================================
FREEZE DECISION
===============

- `CLASS_WEIGHT_MODEL_LEVEL_SIGNAL`: SUPPORTED
- `CLASS_WEIGHT_MAINLINE_CAUSAL_UTILITY`: INTERNAL_ONLY_NO_FINAL_UTILITY
- `FIRST_CAUSAL_OWNER`: NOT_YET_ISOLATED
- `PROMOTION_READY`: FALSE

================================
REQUIRED Q&A (selected)
=======================

- D3 training skipped: **YES**
- D4 all 200 replayed: **YES**
- D8 finalUnknown=0: **YES**
- D9 Model3 changed: **192**
- D16–D19 improved/regressed/neutral/unchanged: **0/0/0/200**
- D20 net: **0**
- D21 prior new RETRY events (offline): **384** new / **145** removed — full replay shows Recall churn without Assembly/final movement
- D42 dominant stop: **RECALL→ASSEMBLY boundary**
- D43 Recall causally proven owner: **PARTIAL** (dominant stop, not FIRST_CAUSAL_OWNER)
- D50 A1 final utility: **INTERNAL_ONLY_NO_FINAL_UTILITY**
- D51 FIRST_CAUSAL_OWNER change: **NO**
- D52 promotion-ready: **FALSE**
- D54 retraining required: **NO**

================================
NEXT PHASE
==========

`MODEL3_V2_S3_RECALL_CORRECTION_DESIGN_AUDIT`
