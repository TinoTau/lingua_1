# Lingua Model3 V2 Acoustic Training-State Gate0 Acceptance

**Phase:** `MODEL3_V2_ACOUSTIC_TRAINING_STATE_GATE0_ACCEPTANCE`  
**Date:** 2026-08-30  
**Mode:** BOUNDED FRESH ACCEPTANCE RUN — no dataset · no training · no architecture change  

================================
MAIN VERDICT
============

Gate0 verdict: **GATE0_ACCEPTANCE_PASS**

Fresh formal evidence: **YES**

Frozen source batch: **YES** (`gate0_src_20260830_v1`, N=48, frozen before outcomes)

Formal dataset build authorized: **YES** (next phase only; **not executed**)

Architecture drift: **NO**

================================
RUN IDENTITY
============

formalRunId: `gate0_accept_20260830_v1`

sourceBatchId: `gate0_src_20260830_v1`

source count: **48**

run attempts: **1**

infrastructure retries: **0**

elapsed: **230.9 s**

Model2: **NOT** run with `MODEL2_RUNTIME_DISABLED=1` (cleared for acceptance)

================================
SOURCE FREEZE
=============

source list frozen before outcomes: **YES**

protected collisions: **0**

near-duplicate handling: family de-dupe in batch; supplied `near_dup_key` consumed when present (none in this freeze)

outcome-driven additions: **0**

outcome-driven removals: **0**

================================
MATERIALIZATION FUNNEL
======================

attempted: **48**

audio: **48**

ASR: **48**

Tone: **48**

Recall/FineSpan: **48**

materialized: **48**

hardRejected: **0** (contract **NOT_EXERCISED** in this batch)

semanticExcluded: **0** (contract **NOT_EXERCISED** in this batch)

supervisedAccepted: **48** (all `FORMAL_FRESH_MATERIALIZATION`)

================================
TEXT / PROVENANCE
=================

raw/current identity: **PASS** (0 `MODEL3_CURRENT_TEXT_IDENTITY_INVALID`)

same-run provenance: **PASS** (0 `CROSS_SAMPLE_PROVENANCE_MISMATCH`)

================================
TONE / RECALL
=============

Tone ready spans: **2582**

Tone invalid: **0**

Mandatory Tone Recall: **YES** (formal harness; no Plain Recall)

================================
CANDIDATE CHANNEL
=================

valid spans (KEEP/RETRY cand tallies): cand0=**943**, cand>0=**1573**

histogram (all serialized spans): 0→943, 1→1625, 2→14

missing candidate rejects: **0**

================================
RETRY CHANNEL
=============

KEEP: **2404**

RETRY: **112**

RETRY cand0: **40**

RETRY cand>0: **72**

RETRY+cand>0 utterances: **17**

================================
MULTIPATH
=========

single-path utterances: **18**

multipath utterances: **30**

path histogram: 1:18, 2:5, 3:11, 4:3, 6:4, 8:7

generated vs serialized parity: retained multipath where generated pathCount>1

================================
MODEL2
======

WIRED: **YES**

ATTEMPTED: **48/48**

COMPLETED: **48/48**

HOST_AVAILABLE: **48/48**

hits (serialized MODEL2 + DOMAIN_AND_MODEL2): **64**

================================
DOMAIN
======

WIRED: **YES**

ATTEMPTED: **48/48**

COMPLETED: **48/48**

Domain Anchors (DOMAIN + DOMAIN_AND_MODEL2): **34**

================================
ANCHOR HISTOGRAM
================

NONE: **2516**

DOMAIN: **2**

MODEL2: **32**

DOMAIN_AND_MODEL2: **32**

================================
PACKER / FEATURES
=================

exact packer: **packModel3SpanInferFields** (missing packed fields: **0**)

six-feature observed (partial):  
- `first_pass_cand_log1p` n=2582 mean≈0.44 max≈1.10 (non-collapsed)  
- `span_rel_position` n=2582 mean≈0.47  

================================
LABEL / ACCOUNTING
==================

KEEP / RETRY as above; SEMANTIC_EXCLUDE=0; HARD_REJECT=0  
(NOT_EXERCISED — absence not fabricated)

================================
HOLDOUT / SPLIT
===============

protected accepted: **0**

semantic-family violations: **0**

split leakage: **0**

================================
HISTORICAL B2 COMPARISON
========================

candidate channel: fresh cand>0 present (prior extension also present)

RETRY+cand>0: fresh **17**/48 vs prior **29**/55 (directional)

multipath: fresh **30**/48 vs prior **40**/55 (directional)

classification: **CONSISTENT**

================================
GATE MATRIX
===========

| Gate | Status |
|------|--------|
| G1 formal evidence | PASS |
| G2 nonempty accepted | PASS |
| G3 text identity | PASS |
| G4 same-run provenance | PASS |
| G5 production Tone | PASS |
| G6 Mandatory Tone Recall | PASS |
| G7 cand>0 | PASS |
| G8 RETRY+cand>0 | PASS |
| G9 multipath | PASS |
| G10 Model2 host | PASS |
| G11 Domain owner | PASS |
| G12 exact packer | PASS |
| G13 V2 labels | PASS |
| G14 holdout | PASS |
| G15 family/split | PASS |
| G16 no fixture/legacy/probe | PASS |
| G17 source frozen | PASS |
| G18 no architecture drift | PASS |

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
formal dataset built: **NO**  
training: **NO**  
dataset ID: **NOT_ASSIGNED**

Infrastructure-only notes (non-business): formal harness disposes Model2 host after stdin EOF; same-run formal lattice attestation flag so batched harness output is not marked `TEST_FIXTURE`.

================================
NEXT PHASE
==========

Exactly one: **MODEL3_V2_TARGETED_DISTRIBUTION_DATASET_BUILD**

Do not execute.
