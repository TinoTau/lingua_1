# Lingua — Model3 V2 Production Core S3 Report

Date: 2026-08-30  
Phase: `MODEL3_V2_PRODUCTION_CORE_S3`

================================
MAIN VERDICT
============

**verdict:** `S3_BUILD_AND_TRAIN_PASS_DIMINISHING_RETURNS`

| Field | Value |
|------|------|
| S3 family count | **10000** (4994 S2 reuse + 5006 new) |
| training completed | YES |
| architecture drift | NO |
| S3 model | `MODEL3_V2_S3_RANDOM_INIT_V1` |
| weights SHA256 | `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1` |
| S3 authorized beyond scale | NO automatic 19k expansion |
| next phase | `MODEL3_V2_S3_GENERALIZATION_LIMIT_AUDIT` (not executed) |

5k→10k still trains cleanly and keeps localization healthy, but **formal gain is small** vs S1→S2. Do **not** auto-continue toward full ~19k pool.

================================
ARCHITECTURE / SSOT PRECHECK
============================

| Check | Result |
|------|--------|
| Model3 role | `ASR_POSTPROCESSING_TEXT_REPAIR_TRIGGER` KEEP/RETRY |
| feature contract | `packModel3SpanInferFields` |
| label contract | `MODEL3_LABEL_CONTRACT_V2_20260829` |
| S2 SHA | `54322a26…04161d9` verified |
| protected registry | `MODEL3_V2_PROTECTION_REGISTRY` immutable |
| SSOT conflict | NO |
| architecture drift | NO |

================================
ANCHOR SEMANTICS CHECK
======================

| Concept | Definition |
|---------|------------|
| `isAnchor` | Ownership flag — Anchor FineSpan; Model3 must not own **effective** RETRY |
| `anchorRelation` | Audit-only spatial relation (inside/adjacent/between/far); **not** ownership |

| Assertion | Result |
|-----------|--------|
| runtime Anchor post-mask present | YES |
| S2 supervised isAnchor RETRY labels | **0** / 7267 Anchor spans |
| live-trace effective Anchor RETRY | **0** |
| verdict | **PASS** |

Note: BiGRU path packing may include `isAnchor` as a **context feature**; ownership is enforced at effective decision (forced KEEP). This is not an ownership violation.

================================
S2 LINEAGE
==========

| Item | Value |
|------|------|
| reused families | 4994 |
| rematerialized S2 | NO |
| S2 mutation | NO |

================================
S3 SOURCE FREEZE
================

| Item | Value |
|------|------|
| selection seed | `2026083012` |
| remaining pool after S2 | 14000 |
| new frozen | 5006 |
| total frozen | 10000 |
| outcome replacement | 0 |
| hard-case / protected mining | NO |
| Gate0 excluded | 48 |

================================
S3 DATASET
==========

| Metric | Value |
|--------|------|
| families | 10000 |
| utterances | 10000 |
| paths | 30354 |
| span×path | 483957 |
| KEEP / RETRY / MASKED | 437146 / 30410 / 16401 |
| new dispositions | SUPERVISED_ACCEPTED **5006** (HARD_REJECT 0) |
| materialization wall | ~19275 s (~5.35 h), 105 shards |

================================
COVERAGE
========

| Scale | Families | unique CJK / bigrams / trigrams (freeze texts) |
|-------|----------|-----------------------------------------------|
| S1 | 999 | (prior) |
| S2 | 4994 | ~97.6% / 87.8% / 80.3% pool chars (prior profile) |
| S3 | 10000 | context/sequence diversity primary; not vocab-first |

================================
PRE-TRAIN QA
============

All hard gates **PASS**. Label reprojection mismatch **0/483957**. Training authorized.

================================
S3 TRAINING
===========

| Field | Value |
|------|------|
| model | `MODEL3_V2_S3_RANDOM_INIT_V1` |
| init | random_from_scratch |
| seed | `2026083013` |
| config | BiGRU emb64 hid128 feat6 Adam lr=0.001 batch64 epochs8 cw_retry=1.0 argmax |
| best epoch | 8 |
| train path samples | 24296 / 2877 / 3181 |
| train wall | ~360 s |

================================
FORMAL LEARNING CURVE
=====================

| Scale | RETRY P | RETRY R | RETRY F1 | KEEP P | KEEP R | pred RETRY rate |
|-------|---------|---------|----------|--------|--------|-----------------|
| S1 ~1k | 0.914 | 0.331 | **0.486** | 0.953 | 0.998 | 0.025 |
| S2 ~5k | 0.884 | 0.831 | **0.857** | 0.986 | 0.991 | 0.070 |
| S3 ~10k | 0.947 | 0.801 | **0.868** | 0.987 | 0.997 | 0.054 |

S1→S2: large F1 gain (+0.37).  
S2→S3: small F1 gain (+0.011); precision↑, recall slightly↓.

================================
PROTECTED LOCALIZATION
======================

Same production-equivalent live traces; L1–L4 reported separately.

| Metric | S2 (same eval) | S3 |
|--------|----------------|----|
| L1 EXACT_TARGET_OVERLAP | 6/13 | **6/13** |
| L2 LOCAL_ERROR_REGION (primary) | **13/13** | **13/13** |
| L3 CLEAR_DISTANT logical spans | 24 | **17** |
| L3 STRONG | 11 | **12** |
| L4 KEEP-control false RETRY | 0/6 | **0/6** |

L2 remains perfect at case level. L3 logical count **decreased**; STRONG nearly flat (+1). Exact probe overlap not required and unchanged.

================================
DISTANT FP ANALYSIS
===================

| Item | S3 |
|------|----|
| affected cases | 8/13 |
| logical unique CLEAR_FP | 17 |
| STRONG / MODERATE / WEAK | 12 / 3 / 2 |
| mean / median / max margin | 5.84 / 5.26 / 13.26 |
| repeated surface shortcut | **NO** (top strong surfaces each appear once) |
| systematic pattern | isolated/diverse natural FPs; **no** repeated-surface filter justified |

================================
SURFACE SHORTCUT
================

S3 predicted RETRY rate lower than S2 (0.054 vs 0.070) with higher precision. No blacklist / penalty applied.

================================
LATENCY
=======

| Model | per-span p50 (ms) |
|-------|-------------------|
| S1 | 0.174 |
| S2 | 0.177 |
| S3 | 0.172 |

No runtime optimization performed.

================================
DIMINISHING RETURNS
===================

**YES — visible.**

Further pure data scale toward ~19k is **not** justified as the default next step. Prefer a generalization-limit audit (capacity / distribution / dynamics) before more materialization.

================================
COMPLEXITY AUDIT
================

| Change | Required? |
|--------|-----------|
| new runtime logic | **NO** |
| new feature | **NO** |
| new filter / threshold / class weight | **NO** |
| new compatibility path | **NO** |
| unnecessary complexity added | **NO** |

================================
REQUIRED DECISIONS (D1–D30)
===========================

| ID | Answer |
|----|--------|
| D1 | YES — SSOT/architecture precheck PASS |
| D2 | YES — isAnchor ≠ anchorRelation |
| D3 | NO — no effective isAnchor=true RETRY |
| D4 | YES — S2 reused without mutation |
| D5 | 5006 new frozen |
| D6 | 5006 materialized SUPERVISED_ACCEPTED |
| D7 | 10000 final families |
| D8 | YES — context/sequence coverage expanded |
| D9 | YES — candidate state valid |
| D10 | YES — multipath preserved |
| D11 | YES — Model2/Domain/Anchor ownership unchanged |
| D12 | YES — reprojection mismatch 0 |
| D13 | YES — pretrain QA authorized training |
| D14 | `MODEL3_V2_S3_RANDOM_INIT_V1` / `f1e41969…81cbbb1` |
| D15 | F1 0.857→0.868; P↑ R slightly↓ |
| D16 | L1 = 6/13 |
| D17 | L2 = 13/13 |
| D18 | L3 logical = 17 |
| D19 | L3 STRONG = 12 |
| D20 | L4 = 0/6 |
| D21 | NO strong repeated-surface pattern |
| D22 | shortcut risk stable/improved (lower pred RETRY rate, higher P) |
| D23 | weakly productive formally; localization already strong |
| D24 | **YES** — diminishing returns vs S1→S2 |
| D25 | NO architecture change |
| D26 | NO runtime filtering |
| D27 | NO threshold/class-weight tuning |
| D28 | **NO** — do not auto-scale beyond S3 |
| D29 | NO unnecessary complexity |
| D30 | `MODEL3_V2_S3_GENERALIZATION_LIMIT_AUDIT` |

================================
GOVERNANCE
==========

ASR / TTS policy / Model3 architecture / features / labels / FineSpan / Recall / Tone / Model2 / Domain / Anchor / Retry / Assembly / KenLM / JobResult / S2 / protected registry / threshold / class weight / hard-case mining: **all unchanged / NO**.

================================
NEXT PHASE
==========

**Exactly one:** `MODEL3_V2_S3_GENERALIZATION_LIMIT_AUDIT`

Do **not** execute in this phase.  
Do **not** expand to ~19k.  
Do **not** add filters for residual L3 FPs.

Wait for user review.
