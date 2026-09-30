# Lingua Model3 V2 Acoustic Training-State Implementation

**Phase:** `MODEL3_V2_ACOUSTIC_TRAINING_STATE_IMPLEMENTATION`  
**Date:** 2026-08-30  
**Mode:** CONTROLLED IMPLEMENTATION — no formal dataset · no training · no runtime business-architecture change  

================================
MAIN VERDICT
============

Implementation verdict: **IMPLEMENTATION_PASS_WITH_NONBLOCKING_WARNINGS**

Formal B2 materializer: **YES** (`acoustic_b2_formal_materialize.cjs` + `acoustic_training/` orchestrator)

Runtime architecture changed: **NO**

Ready for Gate0: **YES** (checker implemented; acceptance run not executed as next phase)

Formal Dataset Build: **NOT EXECUTED**

Nonblocking warnings:
1. **MODEL2_ANCHOR_PATH_NOT_VALIDATED** — owner wired+executed; smoke used `MODEL2_RUNTIME_DISABLED=1` → host unavailable / UNAVAILABLE truthful (not forge). Gate0 acceptance must run with Model2 host available to clear this warning.
2. **Domain Anchor hit coverage** — owner wired+executed; no DOMAIN hit on smoke general text (coverage, not owner skip).

================================
CODE CHANGES
============

**reuse:**  
`normalizeForFwRepairInput`, `runLatticeFineSpanGeneration`, `expandActiveCandidatesWithModel2`, `voteUtteranceDomainFromPool`, `materializeModel3Anchors`, `model3FirstPassCandidateCount`, `packModel3SpanInferFields`, Piper/FW clients, `bank._float_audio_to_pcm16`, V2 `derive_malformed_regions` / `label_spans_v2`, `MODEL3_TRAINING_SAMPLE_V1`

**modify:**  
- Probe scripts point at formal harness  
- Legacy `acoustic_b2_materialize.cjs` marked LEGACY  
- Provenance contract promoted to AUTHORITATIVE  

**new:**  
- `training/model3_dataset/acoustic_training/*` (holdout, family, pcm re-export, reference, audio, provenance, serializer, manifest, orchestrator, gate0)  
- `offline_harness/acoustic_b2_formal_materialize.cjs`  
- `tests/test_acoustic_training_state.py`  
- `docs/.../model3_v2_protection_registry.json`  

**removed:**  
- No hard delete of legacy probe harness (retained as labeled LEGACY; probes redirected to formal owner)

================================
TEXT IDENTITY
=============

rawActualAsrText: ASR `/utterance` text (audit)

model3CurrentText: `normalizeForFwRepairInput(raw).repairText` (FineSpan/label/pack SSOT)

tests: OpenCC raw≠current allowed when harness matches; harness mismatch → HARD_REJECT

================================
PROVENANCE
==========

Implemented: `LABEL_FEATURE_PROVENANCE_COHERENT` + `MODEL3_CURRENT_TEXT_IDENTITY_VALID`  
Contract file status: **AUTHORITATIVE_FOR_TRAINING_MATERIALIZATION**  
Silent Anchor NONE when owners skipped → `ANCHOR_MATERIALIZATION_BLOCKED`

================================
SEMANTIC FAMILY / RUN ID
========================

semanticFamilyId: hash(referenceId|normalizedText) — **split lock**

materializationRunId: includes audio/ASR/Tone run — **not** for split

split locking: same family → same split across acoustic variants (tested)

================================
AUDIO / ASR / TONE
==================

Piper audio materializer orchestration; PCM SSOT via bank encoder re-export  
ASR/Tone via production `/utterance` (orchestrator `materialize_fresh_batch`)  
VAD env: record `asrEnvIdentity`; may use `TONE_P10_VAD_CPU=1` without business hardcode

================================
RECALL / FINESPAN / PACK
========================

Mandatory Tone Recall via lattice; all natural paths retained  
Serialize exact `packModel3SpanInferFields` outputs (policy B)

================================
ANCHOR
======

Domain owner wired: **YES**  
Domain owner executed: **YES** (smoke + tests)  
Model2 owner wired: **YES**  
Model2 owner executed: **YES** (smoke)  
Model2 host status: **unavailable** in smoke (`MODEL2_RUNTIME_DISABLED`) → `model2AnchorStatus=UNAVAILABLE`  
Anchor hits observed: Domain **no**; Model2 **no** (coverage warnings)

================================
LABEL / EXCLUDE
===============

KEEP/RETRY via V2 labeler  
SEMANTIC_EXCLUDE: `NO_REPAIRABLE_TARGET` (tested)  
HARD_REJECT: provenance / holdout / anchor-skip / ASR/Tone/FineSpan failures (separated in manifest accounting)

================================
SAMPLE CONTRACT
===============

Extends `MODEL3_TRAINING_SAMPLE_V1` with `semanticFamilyId`, `materializationRunId`, `rawActualAsrText`, exact `packedInferFields` — see `model3_v2_training_sample_contract_final.json`

================================
MANIFEST / RESUME
=================

`manifest.py`: attempted / materialized / hardRejected / semanticExcluded / supervisedAccepted + reason maps; resume keys `semanticFamilyId::materializationRunId` (no silent overwrite)

================================
GATE0 CHECKER
=============

`acoustic_training/gate0.py` + readiness artifact  
Distinguishes owner parity vs coverage; Model2 host-unavailable → NOT_VALIDATED (not fake PASS)

================================
TESTS
=====

passed: **13/13** (`test_acoustic_training_state.py`)  
failed: **0**  
plus formal harness smoke: ok=true, owners executed

================================
CLEANUP
=======

probe duplicates: redirected to formal harness; legacy file labeled LEGACY (not deleted — historical repro)

================================
GOVERNANCE
==========

Model3 / feature / threshold / Tone / Recall / FineSpan / Anchor ownership / Retry / JobResult changed: **NO**  
pronunciation perturbation: **NO**  
formal dataset: **NO**  
training: **NO**

================================
NEXT PHASE
==========

Exactly one: **`MODEL3_V2_ACOUSTIC_TRAINING_STATE_GATE0_ACCEPTANCE`**

Do not execute.
