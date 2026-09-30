# Lingua Model3 V2 Acoustic Training-State Implementation Plan

**Phase:** `MODEL3_V2_ACOUSTIC_TRAINING_STATE_IMPLEMENTATION_PLAN`  
**Date:** 2026-08-30  
**Mode:** IMPLEMENTATION PLANNING ONLY — no code execution of next phase · no dataset · no training  

Authoritative prior: `MODEL3_V2_ACOUSTIC_MATERIALIZATION_YIELD_PROBE_EXTENSION` → **`B2_EXTENSION_PASS`** (N=55, accepted=55, RETRY+cand>0 utt=29). Architecture selection **not reopened**.

================================
MAIN VERDICT
============

Implementation-plan verdict: **IMPLEMENTATION_PLAN_READY_WITH_NONBLOCKING_WARNINGS**

B2 accepted architecture: **YES**

Runtime architecture change required: **NO**

Ready for implementation: **YES**

Dataset Build: **BLOCKED** (until Stage V Gate 0 after implementation)

Nonblocking warnings (coverage / ops — not architecture gates):
1. **Domain Anchor rarity on general certified pool** — B2 extension observed Anchor=NONE only; Domain owner is wired and correct, but Gate 0 must exercise DOMAIN on domain-bearing references (not force %).
2. **Model2 Anchor needs production expand owner wired into formal offline orchestrator** — owner exists (`expandActiveCandidatesWithModel2`); current probe harness skips it. Formal Stage III must invoke it; if Model2 host load fails, status=`UNAVAILABLE` (no forge) — Gate 0 checks path availability, not batch %.
3. **Training ASR env may use `TONE_P10_VAD_CPU=1`** when Silero CUDA EP is broken locally — authorized execution option; not a business-semantic change; do not hardcode into Model3/Recall/Tone logic.

================================
TARGET ARCHITECTURE
===================

```
ReferenceSource
  → AudioMaterializer (Piper first; pluggable TTS_ASR | HUMAN_ASR)
  → Production ASR/FW/Tone (/utterance same-run)
  → Formal B2 Upstream Runner (Electron harness)
       normalizeForFwRepairInput → model3CurrentText
       runLatticeFineSpanGeneration
       expandActiveCandidatesWithModel2   ← Stage III (missing in probe)
       compatibility coverage
       voteUtteranceDomainFromPool
       materializeModel3Anchors
       packModel3SpanInferFields
  → TrainingProvenanceValidator (fail-closed)
  → V2 LabelProjector (derive_malformed_regions + label_spans_v2)
  → SampleSerializer → MODEL3_TRAINING_SAMPLE_V1 (+ acoustic provenance sidecar fields)
  → Manifest / reject ledger / aggregates
```

Core principle: **orchestration of existing owners** — training code must **not** reimplement Tone/Recall/FineSpan/cand/Anchor/align/label formulas.

Model3 **runtime remains TEXT-ONLY**. Acoustic state is **training upstream materialization only**.

No second business pipeline. Prefer extending one formal harness over promoting probe scripts.

Relation to targeted-dist: B2 supplies truthful `TTS_ASR` samples for prior goals (cand contrast, multipath, same-surface, holdout) — does not replace those goals. Dataset ID `MODEL3_V2_TARGETED_DIST_CORRECTED_V1` remains reserved; **not assigned in this phase**.

================================
TEXT IDENTITY CONTRACT
======================

**Verified in code** (`acoustic_b2_materialize.cjs`, `targeted_dist_materialize.cjs`, `normalize-for-fw-repair.ts`):

| Identity | Definition | Owner |
|----------|------------|--------|
| `rawActualAsrText` | Raw text field from ASR `/utterance` (`text`) | ASR service |
| `model3CurrentText` | `normalizeForFwRepairInput(rawActualAsrText).repairText` | `normalizeForFwRepairInput` (NFKC + OpenCC t→s) |

Freeze:
- `rawActualAsrText` → provenance / audit only
- `model3CurrentText` → FineSpan `rawText`, Recall/path identity, alignment current-side, label projection current-side, Model3 pack `rawText`, surface slices

Gate **`MODEL3_CURRENT_TEXT_IDENTITY_VALID`**: PASS iff FineSpan/path/offsets/labels all refer to the same `model3CurrentText` produced by that run’s normalize of that run’s ASR. Legitimate OpenCC/NFKC ≠ cross-sample mismatch.

Reject stale/unrelated text as `CROSS_SAMPLE_PROVENANCE_MISMATCH` / `MODEL3_CURRENT_TEXT_IDENTITY_INVALID`.

================================
PROVENANCE CONTRACT
===================

Promote draft `MODEL3_V2_TRAINING_PROVENANCE_CONTRACT_DRAFT` → authoritative training materialization contract (still **training-artifact only**).

Required identity fields (training types / dataset metadata — **not JobResult**):

| Field | Role |
|-------|------|
| referenceText | reference (normalized for align as today) |
| rawActualAsrText | ASR raw |
| model3CurrentText | FineSpan/label current |
| audioAssetId / audioSourceProvenance | audio |
| ttsRunIdentity | if TTS |
| asrRunIdentity | ASR config/endpoint |
| fwTimestampIdentity | segments / word times |
| toneRunIdentity | AcousticToneSlice run |
| recallLexiconIdentity | lexicon bundle / scope |
| pathId / FineSpan offsets | path geometry on model3CurrentText |
| candidate state | from pack / model3FirstPassCandidateCount |
| Anchor state/source | materializeModel3Anchors |
| malformedRegion | align(reference, model3CurrentText) |
| label provenance | V2 labeler |
| evidenceLevel | TTS_ASR \| HUMAN_ASR |
| familyId / runId | split locking |

**`LABEL_FEATURE_PROVENANCE_COHERENT`** (fail-closed dataset gate):
- model3CurrentText = FineSpan text
- malformedRegion = align(referenceText, model3CurrentText)
- features + Anchor from same ASR/FW/Tone/Recall/materialization run

Fail → `CROSS_SAMPLE_PROVENANCE_MISMATCH` → sample **never** enters supervised train/dev/test aggregates.

JobResult: **unchanged**; no training provenance blob.

================================
MODULE OWNERSHIP
================

| Module | Responsibility | Must NOT own |
|--------|----------------|--------------|
| `reference_source` adapter | referenceId, text, sourcePoolId, holdout flags | corpus design / TTS |
| `audio_materializer` | materializeAudio(ref)→asset+provenance; Piper client orchestration | Piper synthesis internals |
| `pcm_encode` | single `_float_audio_to_pcm16` / `wav_bytes_pcm16` | ASR semantics |
| `production_upstream_runner` (Electron) | normalize→lattice→Model2 expand→vote→anchors→pack | new Recall/Tone/FineSpan |
| `training_provenance_validator` | coherence + text identity + holdout | business decisions |
| `v2_label_projector` | derive_malformed_regions + label_spans_v2 per path | new label heuristics |
| `sample_serializer` | MODEL3_TRAINING_SAMPLE_V1 + provenance | feature formulas |
| `dataset_build_orchestrator` | batch/resume/manifest (future Gate0 consumer) | case-specific rules |

Probe scripts (`run_acoustic_b2_yield_probe*.py`, temporary work dirs) remain **evidence tooling** — not formal owners.

================================
AUDIO / ASR / TONE
==================

**Audio interface:** `materializeAudio(reference) → { audioAssetId, bytes/path, audioSourceProvenance, evidenceLevel }`  
First source: existing Piper TTS (port/tooling reuse). Pluggable HUMAN_ASR later without changing downstream owners.

**PCM encoder SSOT:** reuse `training/model2/corruption/bank.py:_float_audio_to_pcm16` / `wav_bytes_pcm16` (behavior-preserving float[-1,1] scale). Do not fork encoders per script. Optional thin re-export under `training/model3_dataset/` only if import path clarity requires it — **no second implementation**.

**ASR/FW:** production faster-whisper-vad `/utterance`. Capture raw text, segments, timestamps, run identity. Never overwrite ASR with referenceText.

**VAD env policy:** Prefer production CUDA VAD when healthy. If Silero CUDA EP fails with known cuDNN load error, training runners may set **`TONE_P10_VAD_CPU=1`** (existing authorized option in `models.py` / `tone_p10_start_fw.ps1` / prior acceptance envs). Document in run manifest `asrEnvIdentity`. **Do not** embed recovery inside Tone/Recall/Model3 business code. Whisper remains CUDA.

**Tone:** production ToneModule on same utterance → `AcousticToneSlice[]` + word times. No synthetic tone.

================================
RECALL / FINESPAN / CAND
========================

| Concern | Owner (reuse) |
|---------|----------------|
| Mandatory Tone Recall | production lattice + `resolveToneRecallReadiness` + Tone SQL |
| FineSpan / paths | `runLatticeFineSpanGeneration` — **retain all natural paths** |
| Cand count | `model3FirstPassCandidateCount` on PathFineSpan |
| Pack | `packModel3SpanInferFields` |

No Plain Recall restore. No training-only candidate lookup. No primary-path-only serialization.

================================
ANCHOR MATERIALIZATION
======================

Model3 remains **Anchor-conditioned**. Formal pipeline must **not** freeze Anchor=NONE.

**Domain:**
- Owner: `voteUtteranceDomainFromPool` + `materializeModel3Anchors` (already called in B2 harness)
- Design: run after lattice (+ Model2 expand) on same path candidates; persist `retainedDomains`, `anchorSource`, `domainEvidence.anchorMaterialization=RUNTIME_CONFIRMED` when vote+adapter used
- Do not invent Domain Anchor from reference labels

**Model2:**
- Owner: `expandActiveCandidatesWithModel2` → candidates with `retrievalProvenance` ∈ {PROFILE_RETRIEVAL, PROFILE_PRONUNCIATION, PROFILE_DOMAIN} → `materializeModel3Anchors` → MODEL2 / DOMAIN_AND_MODEL2
- Dependencies: Model2 inference host + lexicon runtime + profile snapshot (empty profile still allowed by owner); graceful no-op on load fail (production behavior)
- Probe harness **omitted** this step → NONE-only observation is **orchestration gap**, not frozen architecture
- Formal Stage III **must** call expand before vote/anchors
- If host unavailable: `model2AnchorStatus=UNAVAILABLE`, **never forge**; Gate 0 records `MODEL2_ANCHOR_PATH_AVAILABLE` / blocked ops separately

**Full:** DOMAIN_AND_MODEL2 when both evidences present (existing adapter).

**Do not silently default NONE** when Domain/Model2 owners were skipped.

================================
ALIGNMENT / LABEL
=================

- Align: `derive_malformed_regions(model3CurrentText, referenceText)` (current vs ref order per existing V2)
- Label: `label_spans_v2` — KEEP / RETRY / EXCLUDE|MASKED; mismatch ≠ automatic RETRY
- Multipath: project labels **per path using that path’s FineSpan offsets**; shared `familyId` for all paths of one utterance → **same split** (no path leakage)

================================
SAMPLE CONTRACT
===============

Extend existing **`MODEL3_TRAINING_SAMPLE_V1`** (do not invent a parallel schema). Add/clarify acoustic fields (names illustrative in JSON artifact):

Required conceptual fields:
- sampleId, familyId, referenceId, pathId, seqIndex
- referenceText, rawActualAsrText, model3CurrentText (= `currentText` SSOT for spans)
- evidenceLevel=TTS_ASR|HUMAN_ASR, audioRef / audio provenance
- spans[] with offsets on model3CurrentText, surface, isAnchor, anchorSource
- exact packed infer fields (six features) from packer
- rawFirstPassCandidateCount (diagnostic = packer input)
- malformedRegion relation, label, labelReason
- provenance identity block, model2AnchorStatus, domainEvidence
- split + groupKeys (family lock)

Trainer consumes **serialized packer outputs** (see Feature Serialization).

================================
FEATURE SERIALIZATION
=====================

**Decision: Option B — serialize exact `packModel3SpanInferFields` outputs**

Justification: prior offline/live parity failures came from reconstructing features differently. Packer remains single formula owner; dataset stores what inference would see; trainer does not re-derive from ad-hoc fields.

Raw semantic inputs (ASR text, slices, spans) retained for **audit**, not as a competing training feature path.

================================
SPLIT / HOLDOUT
===============

- `familyId` = hash(referenceId + audioRunId + asrRunId) — all paths/spans share it
- Split assignment by familyId only
- Near-duplicate references: same family or exclude per existing dataset policy
- Holdout: consume a **protection registry** (central list of protected case ids + exact protected texts); do not scatter hardcoded d00x branches in generators
- Known protected inventory remains authoritative until governance update

================================
FAIL-CLOSED GATES
=================

**Semantic fail-closed (reject sample / stop build):**
- CROSS_SAMPLE_PROVENANCE_MISMATCH
- MODEL3_CURRENT_TEXT_IDENTITY_INVALID
- fake cand / fake Tone
- different-run feature state
- PROTECTED_HOLDOUT_COLLISION
- duplicate business implementation of owners
- Anchor owner skipped while claiming RUNTIME_CONFIRMED

**Nonblocking coverage (report, do not architecture-fail):**
- low rare error-family count
- low Model2 Anchor rate in a small batch
- low same-surface contrast count

Reject-code set (stable, small):  
`CROSS_SAMPLE_PROVENANCE_MISMATCH` · `MODEL3_CURRENT_TEXT_IDENTITY_INVALID` · `AUDIO_MATERIALIZATION_FAILED` · `ASR_FAILED` · `TONE_STATE_MISSING` · `RECALL_STATE_INVALID` · `FINESPAN_MATERIALIZATION_FAILED` · `ANCHOR_MATERIALIZATION_BLOCKED` · `ALIGNMENT_FAILED` · `NO_REPAIRABLE_TARGET` · `PROTECTED_HOLDOUT_COLLISION`

================================
IMPLEMENTATION STAGES
=====================

| Stage | Scope |
|-------|--------|
| **I** | Contracts/types: provenance promote, text identity, training types, reject codes, holdout registry adapter |
| **II** | Formal B2 orchestrator (audio→ASR/Tone→lattice→pack) replacing probe as owner; PCM SSOT; env policy in runner docs/manifest |
| **III** | Anchor integration: ensure Domain vote path; wire `expandActiveCandidatesWithModel2` before vote |
| **IV** | Provenance validator + V2 label projector + sample serializer + manifest/idempotency |
| **V** | Future Gate 0 acceptance harness (not Dataset Build itself) |

No pronunciation perturbation in v1.

Compute: ~3.1 s/utt planning evidence; sequential/bounded batches + checkpointable manifest; no premature worker pools.

Idempotency: same (reference, audio config, ASR, Tone, lexicon) → reuse valid materialization **or** explicit new `runId`; never silent overwrite.

================================
CODE CHANGE INVENTORY
=====================

**REUSE AS-IS:**  
`normalizeForFwRepairInput`, ToneModule/`/utterance`, `runLatticeFineSpanGeneration`, `resolveToneRecallReadiness`, `model3FirstPassCandidateCount`, `packModel3SpanInferFields`, `voteUtteranceDomainFromPool`, `materializeModel3Anchors`, `expandActiveCandidatesWithModel2`, `derive_malformed_regions`, `label_spans_v2`, Piper client, FasterWhisper client, `MODEL3_TRAINING_SAMPLE_V1` schema, bank PCM encoder.

**MODIFY:**  
- Formal Electron harness (evolve from `acoustic_b2_materialize.cjs` patterns — add Model2 expand; emit training-shaped JSON)  
- Possibly thin Python orchestrator under `training/model3_dataset/` (not probe rename)  
- Provenance contract JSON status → AUTHORITATIVE_FOR_TRAINING_MATERIALIZATION  
- Holdout registry module (centralize protected ids/texts)

**NEW:**  
- Training types (MaterializedUtterance/Path/Span, TrainingProvenance, serializer)  
- Provenance validator  
- Dataset build orchestrator skeleton + manifest writer  
- Gate 0 checker (future)

**REMOVE LATER (after formal owner lands):**  
- Duplicate probe materialize paths that only differ by hardcodes  
- Keep probe scripts as **regression tooling** only if they call formal owners; otherwise delete obsolete forks

Probe-specific (do not promote): sample-size caps, historical d055/d190 sentinels as main path, temporary `_b2_ext_work` dumps as dataset, diagnostic-only branches.

Business-semantics impact of planned changes: **NONE** (orchestration + training artifacts only).

================================
TEST PLAN
=========

Focused integration (prefer real owners over mocks):
1. raw ASR → model3CurrentText identity (OpenCC case)  
2. same-run provenance PASS/FAIL  
3. PCM encode non-zero / ASR non-empty  
4. Tone slices present same-run  
5. Mandatory Tone Recall readiness path  
6. cand owner non-collapse when Tone ready  
7. multipath all paths serialized + shared familyId  
8. Domain Anchor when retainedDomains evidence exists  
9. Model2 expand invoked; MODEL2 source when profile hits present; UNAVAILABLE without forge on load fail  
10. align+label V2 on model3CurrentText  
11. protected holdout collision reject  
12. family split lock across paths  
13. reject codes  
14. idempotent resume by sample/run identity  

================================
FUTURE GATE 0
=============

Before `MODEL3_V2_TARGETED_DISTRIBUTION_DATASET_BUILD` resumes, Gate 0 must verify:
- fresh same-run materialization  
- text identity  
- Tone state present  
- cand=0 and cand>0 natural  
- RETRY+cand>0 present  
- Domain Anchor owner parity (exercised when data supports)  
- Model2 Anchor path availability (expand invoked; status truthful)  
- multipath retention  
- feature pack parity (packer outputs)  
- label provenance coherent  
- holdout isolation  
- family split identity  

Do **not** execute Gate 0 or Dataset Build in this phase.

================================
GOVERNANCE
==========

Model3 change: **NO**  
feature change: **NO**  
threshold change: **NO**  
Tone change: **NO**  
Recall change: **NO**  
FineSpan change: **NO**  
Anchor ownership change: **NO** (reuse owners; wire missing expand call)  
Retry change: **NO**  
JobResult change: **NO**  
pronunciation perturbation: **NO**  
formal dataset: **NO**  
training: **NO**

================================
NEXT PHASE
==========

Exactly one: **`MODEL3_V2_ACOUSTIC_TRAINING_STATE_IMPLEMENTATION`**

Do not execute.

================================
CHECKLIST
==========

[x] B2 accepted SSOT; architecture not reopened  
[x] rawActualAsrText / model3CurrentText frozen; normalize owner verified  
[x] provenance + same-run gate formalized; out of JobResult  
[x] reference/audio interfaces; Piper/ASR/Tone/Recall/FineSpan/cand reuse  
[x] VAD env policy; one PCM encoder  
[x] Domain + Model2 Anchor integration designed; no silent NONE freeze  
[x] V2 align/label; multipath; family/holdout  
[x] sample + feature serialization SSOT (packer outputs)  
[x] reject codes; Gate0; tests; probe cleanup plan  
[x] no Model3/Recall/Tone/FineSpan/JobResult change; no dataset/training  
[x] exactly one verdict + next phase; next not executed  
