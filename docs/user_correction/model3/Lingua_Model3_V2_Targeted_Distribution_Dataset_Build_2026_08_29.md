# Lingua Model3 V2 Targeted Distribution Dataset Build

**Phase:** `MODEL3_V2_TARGETED_DISTRIBUTION_DATASET_BUILD`  
**Date:** 2026-08-29  
**Mode:** CONTROLLED DATASET BUILD — stopped at Gate 0 (no bulk build, no training)

================================
MAIN VERDICT
============

Dataset build: **TRAINING_FEATURE_STATE_PIPELINE_BLOCKED**

Gate 0: **FAIL**

Dataset ID: **NOT_ASSIGNED** (bulk build not authorized)

Ready for controlled training: **NO**

================================
GATE 0 PRODUCTION PARITY
========================

FineSpan: **PASS** — `runLatticeFineSpanGeneration` (production lattice owner)

Candidate state: **FAIL** — owner wired (`model3FirstPassCandidateCount` / `!isCovered`) but **all probe spans collapsed to rawCand=0** (90/90). No natural cand>0. Semantic fail-closed.

Anchor: **PASS** — `materializeModel3Anchors` → classification `PRODUCTION_EQUIVALENT_ANCHOR` (Domain path; Model2 acoustic UNAVAILABLE offline, same as text-only Domain anchors)

Feature packing: **PASS** — `packModel3SpanInferFields` + shared six-feature formulas (`bigru_v1.span_features` equivalents). Probe pinyin_channel_avail=1 via text-derived syllable coordinate.

Multipath: **PASS (source)** — paths from production lattice enumeration; probe texts naturally produced **single path only** (not forced). Multipath retention not exercised on these utterances.

Any duplicated business logic: **NO** (cand count / FineSpan / Anchor owners reused from dist)

Protected holdout leakage: **NO** (synthetic/clean probe texts only)

================================
ROOT CAUSE (GATE 0 FAIL)
========================

**Code:** `MANDATORY_TONE_RECALL_BLOCKS_TEXT_ONLY_CANDIDATE_STATE`

Production Batch **1.1C Mandatory Tone Recall** is fail-closed without `acousticTonePattern`:

- `resolveToneRecallReadiness` → `no_pattern` / `caller_disabled`
- Plain lexicon fill removed
- Text-only offline lattice → `lexicalEdgeCount=0`, all **fallback** FineSpans, **empty** `candidates[]`
- Therefore `model3FirstPassCandidateCount` ≡ 0 for every span

Live SSOT (`model3_v2_live_input_trace.jsonl`) shows rawCand ≈ 0/1 variation because ASR tone evidence unlocks recall.

This is **not** a Model3 feature-formula bug. It is a **training feature-state pipeline gap**: honest production-shaped cand cannot be produced from text-only training utterances under current Recall contract without a frozen acoustic/tone training simulation (which does **not** exist and must not be invented here).

Forbidden patches (not applied):

- fake `acousticTonePattern` without contract
- Python approximate cand
- random 0/1
- treating RealDist hardcoded cand=0 as honest `REAL_CAND_0`

================================
DATASET PROVENANCE
==================

new production-shaped: **0** (bulk not started)

legacy reused: **0**

legacy excluded: **N/A** (would exclude `LEGACY_DEFAULTED_CAND_0` from RealDist if build resumed after pipeline fix)

================================
FEATURE STATE
=============

KEEP cand=0: **N/A** (no supervised bulk set)

KEEP cand>0: **N/A**

RETRY cand=0: **N/A**

RETRY cand>0: **N/A**

Gate 0 probe (all spans, unlabeled materialize):

- cand=0: **90**
- cand>0: **0**
- exact histogram: `{0: 90}`

pinyin (probe utterances): all `pinyinTextDerived=true` → packed avail=1 → report as **LOW_INFORMATION_FEATURE** for this probe set (honest; no fake pinyin=0)

================================
SURFACE CONTRAST
================

supported surfaces: **N/A** (bulk not built)

high-risk leakage: **N/A**

moderate-risk: **N/A**

evidence of generator-induced token shortcut: **NO** (no bulk generator run; no token/case branches added)

================================
MULTIPATH
=========

utterances (probe): **6**

multipath: **0**

ratio: **0%** (natural for these texts)

paths/utterance: **1**

contrast families: **0**

================================
SEQUENCE SUPPORT
================

baseline protected-family OOD: **not remeasured** (dataset not built)

new dataset OOD: **N/A**

direction: **N/A**

================================
POSITION
========

p10 / p50 / p90: **N/A** (no supervised RETRY set)

status: **NOT_APPLICABLE**

================================
SPLIT / HOLDOUT
===============

family leakage: **N/A**

protected collisions: **NONE** (no supervised dataset written)

d160: **STALE_TARGET_NOT_COMPARABLE** (preserved; not used as RETRY train source)

d131/d176: **PROTECTED** (not used as case-specific RETRY templates)

================================
PROVISIONAL TARGETS
===================

| target | actual | status | blocking? |
|--------|--------|--------|-----------|
| cand support floors (800/…) | not collected | SKIPPED | NO (provisional) |
| multipath ≥15% / ≥200 | not collected | SKIPPED | NO (provisional) |
| natural KEEP/RETRY × cand 0/>0 | Gate0 cand>0 = 0 | FAIL | **YES — semantic** |

================================
SEMANTIC FAIL-CLOSED GATES
==========================

| gate | class | result |
|------|-------|--------|
| Production FineSpan owner | SEMANTIC_FAIL_CLOSED | PASS |
| Production cand owner (`!isCovered`) | SEMANTIC_FAIL_CLOSED | PASS (wired) |
| Natural two-sided cand support | SEMANTIC_FAIL_CLOSED | **FAIL** |
| No silent / approximate cand | SEMANTIC_FAIL_CLOSED | PASS (stopped; no approx) |
| Anchor ownership | SEMANTIC_FAIL_CLOSED | PASS |
| Shared feature packing | SEMANTIC_FAIL_CLOSED | PASS |
| No protected holdout in supervised data | SEMANTIC_FAIL_CLOSED | PASS |
| No token/case patch | SEMANTIC_FAIL_CLOSED | PASS |
| No Model3/feature/threshold/architecture change | SEMANTIC_FAIL_CLOSED | PASS |
| No training executed | SEMANTIC_FAIL_CLOSED | PASS |

================================
GOVERNANCE
==========

case-specific rules: **NONE**

token-specific rules: **NONE**

Model3 changed: **NO**

features changed: **NO**

threshold changed: **NO**

FineSpan changed: **NO**

Anchor ownership changed: **NO**

Retry changed: **NO**

Recall changed: **NO**

JobResult changed: **NO**

training executed: **NO**

dataset `MODEL3_V2_TARGETED_DIST_CORRECTED_V1` written: **NO**

prior `MODEL3_V2_REALDIST_EXPANDED_V1` overwritten: **NO**

================================
ARTIFACTS
=========

1. `docs/user_correction/model3/Lingua_Model3_V2_Targeted_Distribution_Dataset_Build_2026_08_29.md` (this report)
2. `docs/user_correction/model3/model3_v2_targeted_dist_gate0_probe.json`
3. `docs/user_correction/model3/model3_v2_targeted_dist_corrected_v1_gate_summary.json`
4. Harness (tooling, not dataset): `training/model3_dataset/offline_harness/targeted_dist_materialize.cjs`
5. Probe runner: `training/model3_dataset/scripts/gate0_targeted_dist_probe.py`

Coverage / surface / sequence CSVs and dataset manifest: **not generated** (bulk unauthorized).

================================
CHECKLIST
=========

[x] Gate 0 executed first  
[x] FineSpan production parity proven  
[x] candidate-state production parity proven — **FAIL (collapse)**  
[x] Anchor semantics proven  
[x] shared feature packing proven  
[x] production multipath source proven (enumeration owner)  
[x] no duplicate candidate heuristic  
[x] no duplicate segmenter  
[x] cand field fail-closed (stopped; no approx fill)  
[ ] legacy defaulted cand identified (deferred; bulk not run)  
[ ] KEEP/RETRY × cand cells (deferred)  
[x] no token blacklist / case-specific generation  
[x] protected inventory absent from supervised data  
[x] d160 stale preserved  
[x] d131/d176 protected  
[x] provisional gates marked  
[x] no quota-driven artificial generation  
[x] no Model3 training  
[x] no feature / threshold / architecture changes  
[x] next phase not executed  

================================
NEXT PHASE
==========

**MODEL3_V2_TRAINING_FEATURE_STATE_PIPELINE_AUDIT**

Do **not** execute in this phase.

Audit must answer how training can obtain production-equivalent `rawFirstPassCandidateCount` under Mandatory Tone Recall without inventing cand, changing Model3, or silently defaulting — e.g. acoustic provenance for training texts, frozen tone-simulation contract, or an authorized shared packaging path that matches live SSOT.

After that pipeline is proven, resume:

`MODEL3_V2_TARGETED_DISTRIBUTION_DATASET_BUILD`

Then, only if dataset acceptance passes:

`MODEL3_V2_TARGETED_DISTRIBUTION_CONTROLLED_TRAINING`

(comparison baseline remains `MODEL3_V2_REALDIST_V1`; candidate dataset id reserved: `MODEL3_V2_TARGETED_DIST_CORRECTED_V1`).
