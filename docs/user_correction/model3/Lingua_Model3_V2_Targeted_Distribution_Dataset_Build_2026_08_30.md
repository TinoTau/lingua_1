# Lingua Model3 V2 Targeted Distribution Dataset Build

**Phase:** `MODEL3_V2_TARGETED_DISTRIBUTION_DATASET_BUILD`  
**Date:** 2026-08-30  
**Mode:** FORMAL DATASET MATERIALIZATION — no training · no architecture/feature/threshold change  

Prerequisite: `MODEL3_V2_ACOUSTIC_TRAINING_STATE_GATE0_ACCEPTANCE` → **GATE0_ACCEPTANCE_PASS**

================================
MAIN VERDICT
============

Dataset verdict: **TARGETED_DIST_DATASET_BUILD_PASS_WITH_NONBLOCKING_DISTRIBUTION_WARNINGS**

datasetId: **MODEL3_V2_TARGETED_DIST_CORRECTED_V1**

Dataset build complete: **YES**

Ready for training: **YES**

Architecture drift: **NO**

Nonblocking warnings:
- Natural one-sided high-support surfaces present (not blacklisted / not forced-balanced)
- DOMAIN-only Anchor relatively sparse vs MODEL2 / DOMAIN_AND_MODEL2 (natural coverage)

================================
BUILD IDENTITY
==============

datasetBuildId: `tdist_build_20260830_v1`

pipeline: `MODEL3_V2_ACOUSTIC_TRAINING_STATE_V1` (formal B2)

feature contract: `packModel3SpanInferFields`

label contract: `MODEL3_LABEL_CONTRACT_V2_20260829`

provenance contract: `MODEL3_V2_TRAINING_PROVENANCE_CONTRACT`

source pools: `model3_certified_base_pool_v2`

Gate0 exclusion policy: **EXCLUDE_GATE0_ACCEPTANCE_SOURCES_FROM_TRAINING** (48 refs / families excluded)

shards: **5 × 56 = 280** frozen before outcomes (`s00`…`s04`)

retries: **0**

Model2: enabled (not `MODEL2_RUNTIME_DISABLED`); host available on all shards

================================
DATASET SIZE
============

semantic families: **280**

utterances: **280**

paths: **849**

path-level samples: **849**

span×path samples: **14632**

| split | path samples |
|-------|-------------:|
| TRAIN | 607 |
| DEV | 60 |
| TEST | 182 |

On-disk: `training/model3_dataset/model3_v2_targeted_dist_corrected_v1/{train,dev,test}/shard-000.jsonl`

================================
MATERIALIZATION FUNNEL
======================

attempted: **280**

audio / ASR / Tone / Recall: **280** (all formal fresh)

materialized supervised accepted: **280**

hardRejected: **0**

semanticExcluded: **0**

evidenceSource: **FORMAL_FRESH_MATERIALIZATION only**

================================
LABEL DISTRIBUTION
==================

KEEP: **13259**

RETRY: **865**

MASKED (anchors): **508**

RETRY+cand>0 utterances: **116**

================================
CANDIDATE DISTRIBUTION
======================

cand0: **4957**

cand>0: **9675** (1→9590, 2→85)

KEEP cand0 / gt0: **4661 / 8598**

RETRY cand0 / gt0: **296 / 569**

missing candidate: **0**

================================
FIRST_PASS_CAND FEATURE
=======================

| cell | n | mean | zero | nonzero | max |
|------|--:|-----:|-----:|--------:|----:|
| TRAIN KEEP | 9461 | 0.447 | 3388 | 6073 | 1.099 |
| TRAIN RETRY | 630 | 0.479 | 201 | 429 | 1.099 |
| DEV KEEP | 994 | 0.462 | 331 | 663 | 0.693 |
| DEV RETRY | 42 | 0.413 | 17 | 25 | 0.693 |
| TEST KEEP | 2804 | 0.462 | 942 | 1862 | 1.099 |
| TEST RETRY | 193 | 0.417 | 78 | 115 | 1.099 |

Channel **non-collapsed** (cand0 and cand>0 both present in KEEP and RETRY).

================================
MULTIPATH
=========

single-path utterances: **91**

multipath utterances: **189**

path histogram: 1:91, 2:64, 3:44, 4:24, 5:2, 6:21, 7:6, 8:28

All production path views retained (no primary-path collapse).

================================
ANCHOR DISTRIBUTION
===================

NONE: **14124**

DOMAIN: **29**

MODEL2: **345**

DOMAIN_AND_MODEL2: **134**

(Natural proportions; DOMAIN sparse → nonblocking warning only)

================================
MODEL2
======

shards attempted/completed: **5/5**

host unavailable: **0**

Anchor hits (MODEL2 + DOMAIN_AND_MODEL2): **479**

================================
DOMAIN
======

owner completed: all formal shards

Domain Anchors (DOMAIN + DOMAIN_AND_MODEL2): **163**

================================
SURFACE CONTRAST
================

high-support same-surface KEEP/RETRY contrast surfaces: **27** (top listed in artifact)

one-sided suspicious (support≥40): **40** (natural; not patched)

historical shortcut diagnostics (背/烧/四/温/苏/对/上): low support in this acoustic set; no extreme one-sided high-support recurrence

================================
POSITION / SEQUENCE DISTRIBUTION
================================

KEEP HEAD/MID/TAIL: **3575 / 6067 / 3617**

RETRY HEAD/MID/TAIL: **294 / 406 / 165**

================================
CORRUPTION FAMILY
=================

Diagnostic taxonomy (from label metadata; not a KEEP/RETRY gate):

SUBSTITUTION: **865** (covers RETRY spans without finer family tags)

MULTI_CHAR / INSERTION / DELETION: sparse/unlabeled in this clean B2 route (no pronunciation perturbation)

================================
HOLDOUT / SPLIT
===============

protected collisions: **0**

family split violations: **0**

near-duplicate: family de-dupe within build; Gate0 families excluded

================================
PROVENANCE / QA
===============

invalid text identity: **0**

cross-run provenance: **0**

candidate invalid: **0**

packer invalid: **0**

fixture/legacy evidence: **0**

QA matrix: all required checks **PASS**

================================
DISTRIBUTION COMPARISON
=======================

| signal | prior synthetic/RealDist V2 | Gate0 fresh (N=48) | this dataset (N=280) |
|--------|----------------------------:|-------------------:|---------------------:|
| candidate channel | historically collapsed risk | non-collapse | **non-collapse** |
| RETRY+cand>0 utt | engineered/synthetic mix | 17 | **116** |
| multipath utt | often primary-path | 30 | **189** |
| Anchor 4-way | Domain-heavy offline historically | present | **all four present** |

No model-accuracy comparison.

================================
GOVERNANCE
==========

Model3 changed: **NO**  
feature changed: **NO**  
threshold changed: **NO**  
Tone semantics changed: **NO**  
Recall semantics changed: **NO**  
FineSpan changed: **NO**  
Model2 responsibility changed: **NO**  
Domain Vote changed: **NO**  
Anchor ownership changed: **NO**  
Retry changed: **NO**  
JobResult changed: **NO**  
pronunciation perturbation: **NO**  
model training: **NO**

================================
NEXT PHASE
==========

Exactly one: **MODEL3_V2_TARGETED_DIST_CORRECTED_TRAINING**

Do not execute.
