# Lingua Model3 V2 Acoustic Materialization Yield Probe

**Phase:** `MODEL3_V2_ACOUSTIC_MATERIALIZATION_YIELD_PROBE`  
**Date:** 2026-08-30  
**Mode:** BOUNDED EXPERIMENT — no formal dataset, no training, no runtime change

================================
MAIN VERDICT
============

Probe verdict: **B2_YIELD_PROMISING_MORE_PROBE_NEEDED**

Yield classification: **INSUFFICIENT_SAMPLE**  
(directional yield strong; N too small for scale confidence)

N: **12** (non-holdout existing Piper→ASR→Tone dumps after protected-text filter)

B2 architecture technically valid: **YES**

Ready for implementation plan: **NO** (need larger N / live ASR extension)

Dataset Build can resume: **NO**

================================
PIPELINE PARITY
===============

Audio: **EXISTING_PIPER_WAV** (dialog_200 restored Piper; no new TTS this run)

ASR/FW: **HISTORICAL_PRODUCTION_DUMP** (`*.fw.json` from tone full-chain probe)  
Note: live faster-whisper-vad **failed to start** (cuDNN `cudnnGetLibConfig` crash on Silero VAD). Fresh TTS→ASR blocked; dumps reused.

Tone: **HISTORICAL `AcousticToneSlice[]`** fed into production lattice

Recall: **Mandatory Tone Recall** via `runLatticeFineSpanGeneration` (no Plain restore)

FineSpan / paths: **production** `runLatticeFineSpanGeneration`

Feature packing: **`model3FirstPassCandidateCount` + pack formulas**

Lexical edges unlocked: **YES** (10/12 utt with cand>0 channel)

================================
PROVENANCE COHERENCE
====================

accepted (coherent): **12**

rejected: **0**

CROSS_SAMPLE_PROVENANCE_MISMATCH: **0**

`currentText` = dump `rawText` (actual ASR); features from same lattice run on that text + same tone slices; labels from `derive_malformed_regions(asr, reference)` + `label_spans_v2`.

================================
YIELD FUNNEL
============

| stage | count | /N0 |
|-------|------:|----:|
| N0 reference | 12 | 1.00 |
| N1 audio | 12 | 1.00 |
| N2 ASR success | 12 | 1.00 |
| N3 ASR mismatch | 12 | 1.00 |
| N4 aligned mismatch | 10 | 0.83 |
| N5 repairable region | 8 | 0.67 |
| N6 FineSpan overlap | 8 | 0.67 |
| N7 Tone ready | 10 | 0.83 |
| N8 valid cand state | 10 | 0.83 |
| N9 RETRY | 8 | 0.67 |
| N10 coherent usable (RETRY+cand>0 utt) | 8 | 0.67 |

**USABLE_MODEL3_RETRY_YIELD = 0.667** (N10/N0)

ASR mismatch rate = 1.0 (not used as primary success).

================================
CANDIDATE STATE
===============

| cell | count |
|------|------:|
| KEEP cand=0 | 171 |
| KEEP cand>0 | 461 |
| RETRY cand=0 | 25 |
| RETRY cand>0 | **78** |

rawCand exact histogram: **{0: 196, 1: 539}**

**RETRY + cand>0 present** — text-only Gate0 collapse **resolved** under acoustic B2.

Not `B2_CANDIDATE_STATE_INSUFFICIENT`.

================================
TONE READINESS
==============

All supervised span observations in this probe: **ready = 747** (including RETRY readiness **ready = 103**).

No `no_pattern` / `caller_disabled` on these acoustic dumps — contrast Gate0 text-only.

================================
LABEL DISTRIBUTION
==================

KEEP: **632**  
RETRY: **103**  
MASKED: **12**  
EXCLUDE: **0** (as labeled class; V2 EXCLUDE may fold elsewhere)

Mismatch ≠ auto-RETRY preserved (KEEP ≫ RETRY).

================================
ERROR FAMILIES
==============

(aligned region tags)

SUBSTITUTION: 29  
MULTI_CHAR_REPLACEMENT: 13  
DELETION: 4  
INSERTION: (in DELETION/insert handling; see family hist)

================================
MULTIPATH
=========

multipath utterances: **4 / 12**  
paths/utt hist: 1×6, 3×1, 4×1, 8×2  

Labels projected per path via offsets (V2).

================================
ANCHOR
======

NONE: 735  
DOMAIN: 12  
MODEL2: **0** (not exercised on this offline path)

Secondary; did not block RETRY.

================================
SAME-SURFACE OBSERVATION
========================

Natural KEEP+RETRY surfaces (not forced): 站, 要, 先 (and possibly more beyond sample list).

================================
HOLDOUT
=======

protected collisions: **NONE**  
Excluded protected IDs and exact protected `expectedText` duplicates (e.g. near-dup of d019 team-discussion text).

================================
COMPUTE
=======

lattice harness wall: ~25–30s for 12 utt (~2–2.5s/utt)  
TTS/ASR this run: **N/A** (existing dumps)  
Fresh ASR service: **blocked** (cuDNN crash)

================================
SYNTHETIC BIAS OBSERVATION
==========================

Single Piper voice (huayan); dialog_200 cafe/tech/medical mix; TTS-ASR errors (not live user).  
Directional vs Route A live: cand 0/1 unlocked similarly; full distribution comparison deferred to extension.

================================
LIMITATIONS (why not PASS)
==========================

1. **N=12** after holdout filter — below preferred 50–150; yield rate unstable as scale estimator.  
2. **No live ASR** this session — cannot generate new Piper references from certified pool.  
3. Sample set still dialog_200-adjacent (non-protected only) — extension should use certified base pool + live ASR once service healthy.

Architecture signal itself is **positive**.

================================
GOVERNANCE
==========

Model3 changed: **NO**  
feature contract changed: **NO**  
threshold changed: **NO**  
Recall changed: **NO**  
Tone changed: **NO**  
FineSpan changed: **NO**  
Anchor ownership changed: **NO**  
JobResult changed: **NO**  
pronunciation perturbation enabled: **NO**  
formal dataset built: **NO**  
training executed: **NO**  
dataset ID assigned: **NO**

================================
NEXT PHASE
==========

**MODEL3_V2_ACOUSTIC_MATERIALIZATION_YIELD_PROBE_EXTENSION**

Goals: repair/restart ASR (or alternate production-equivalent utterance path), extend to ~50–100 **non-dialog-holdout** certified-pool Piper utterances, remeasure funnel + RETRY+cand>0, then decide implementation plan vs yield enhancement.

Do **not** execute in this phase.  
Do **not** enable pronunciation perturbation yet.
