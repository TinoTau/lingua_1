# Lingua Model3 V2 Acoustic Materialization Yield Probe Extension

**Phase:** `MODEL3_V2_ACOUSTIC_MATERIALIZATION_YIELD_PROBE_EXTENSION`  
**Date:** 2026-08-30  
**Mode:** BOUNDED FRESH-PIPELINE VALIDATION + PROVENANCE ACCOUNTING CORRECTION  
**No formal dataset · No training · No feature/threshold/runtime business change · No pronunciation perturbation**

================================
MAIN VERDICT
============

Extension verdict: **B2_EXTENSION_PASS**

Fresh B2 exercised: **YES**

Attempted N: **55**

Provenance accepted: **55**

Provenance rejected: **0**

Architecture signal: **POSITIVE**

Ready for implementation plan: **YES**

Dataset Build: **BLOCKED**

================================
PREVIOUS ACCOUNTING CORRECTION
==============================

Previous contradiction:
- Primary report claimed: accepted coherent = 12, rejected = 0, CROSS_SAMPLE_PROVENANCE_MISMATCH = 0
- Structured provenance artifact: coherent_ok = 10, coherent_fail = 2 (d055, d190 = `CROSS_SAMPLE_PROVENANCE_MISMATCH_TEXT`)

Correct interpretation:
- Recorded as **`PREVIOUS_PROBE_PROVENANCE_ACCOUNTING_ERROR`**
- Structured artifact is authoritative for the previous probe; the primary report aggregation silently dropped rejects

Old 66.7% status: **DIRECTIONAL_ONLY_NOT_ACCEPTED**

Historical sentinel (d055/d190): new aggregator **would still reject** both (raw dump currentText ≠ harness repairText). Not used in fresh supervised stats.

================================
FRESH PIPELINE
==============

TTS: **existing Piper** (`:5009`) → 16 kHz mono WAV

ASR/FW: **existing production faster-whisper-vad** (`:6007/utterance`) — fresh run

Tone: **same `/utterance` production ToneModule** → `AcousticToneSlice[]` (no synthesis)

Recall: **Mandatory Tone Recall** via `acoustic_b2_materialize.cjs` / `runLatticeFineSpanGeneration` (no Plain Recall)

FineSpan: **production multipath lattice** (all emitted paths retained)

Label: frozen **`derive_malformed_regions` + `label_spans_v2`**

`currentText` for FineSpan/labels = production `normalizeForFwRepairInput(actualAsrText).repairText`  
Raw ASR preserved as `actualAsrText` (often traditional script before OpenCC).

================================
ASR ENVIRONMENT RECOVERY
========================

Failure 1: Silero VAD CUDA EP crash (`cudnnGetLibConfig`, exit 3221226505)  
Restored: **`TONE_P10_VAD_CPU=1`** (authorized option; VAD on CPU EP; Whisper remains CUDA)

Failure 2: probe client `wav_bytes_pcm16` cast float[-1,1]→int16 **without scale** → all-zero PCM → ASR empty  
Restored: `training/model2/corruption/bank.py:_float_audio_to_pcm16` (**encode tooling only**)

ASR business semantics changed: **NO**  
VAD business behavior changed: **NO**

================================
PROVENANCE
==========

accepted: **55**

rejected: **0**

reject reasons: *(none in this run)*

Gate: `LABEL_FEATURE_PROVENANCE_COHERENT` fail-closed — same-run audio/ASR/Tone/lattice identity; empty FineSpan surface rejects as `CROSS_SAMPLE_PROVENANCE_MISMATCH_TEXT`. OpenCC t→s is production normalize, not a fresh-run reject.

Two-layer accounting: **RAW_ATTEMPTED** funnel N0–N3; supervised cand/label/family/same-surface = **PROVENANCE_ACCEPTED ONLY**.

================================
YIELD FUNNEL
============

| stage | count | /N0 |
|-------|------:|----:|
| N0_ATTEMPTED | 55 | 1.000 |
| N1_AUDIO_OK | 55 | 1.000 |
| N2_ASR_OK | 55 | 1.000 |
| N3_ASR_MISMATCH | 50 | 0.909 |
| N4_ALIGNMENT_REGION | 47 | 0.855 |
| N5_REPAIRABLE_NONANCHOR_REGION | 47 | 0.855 |
| N6_FINESPAN_OVERLAP | 33 | 0.600 |
| N7_TONE_READY | 55 | 1.000 |
| N8_CAND_STATE_VALID | 55 | 1.000 |
| N9_HAS_RETRY | 33 | 0.600 |
| N10_PROVENANCE_COHERENT_AND_HAS_RETRY | 33 | 0.600 |
| N11_PROVENANCE_COHERENT_AND_HAS_RETRY_CAND_GT0 | 29 | 0.527 |

RAW_ASR_MISMATCH_YIELD: **0.909** (50/55)

REPAIRABLE_REGION_YIELD: **0.855** (47/55)

COHERENT_RETRY_YIELD: **0.600** (33/55)

COHERENT_RETRY_CAND_GT0_YIELD: **0.527** (29/55)

Conditioned on accepted (accepted=N0 here):
- N10 / PROVENANCE_ACCEPTED = **0.600**
- N11 / PROVENANCE_ACCEPTED = **0.527**

================================
CANDIDATE STATE — ACCEPTED ONLY
===============================

KEEP cand=0: **1059**

KEEP cand>0: **1675**

RETRY cand=0: **69**

RETRY cand>0: **140**

rawCand histogram (accepted non-Anchor KEEP|RETRY):
- 0: **1128**
- 1: **1803**
- 2: **12**

Critical B2 signal: cand=0, cand>0, RETRY, RETRY+cand>0 all occur **naturally across many independent utterances** (not isolated singles).

================================
INDEPENDENCE / DUPLICATION
==========================

RETRY utterances: **33**

RETRY regions: **94**

RETRY span×path: **209**

RETRY+cand>0 utterances: **29**

multipath duplication effect: span×path (209) ≫ utterance (33); **utterance-level yield is the primary numerator/denominator**. Multipath does not inflate N10/N11.

================================
TONE READINESS
==============

ready: **2909** span observations  
no_pattern: **34**  
(utterance-level N7_TONE_READY = 55/55)

================================
LABELS / ERROR FAMILIES
=======================

KEEP: **2734**

RETRY: **209**

MASKED / EXCLUDE: **0** (none naturally emitted in this sample)

Opcode → report taxonomy (SequenceMatcher; current vs reference):
- `replace` same-length → **SUBSTITUTION**: **36**
- `replace` length-changing → **MULTI_CHAR_REPLACEMENT**: **13**
- `delete` (extra chars in current vs ref) → **INSERTION**: **48**
- `insert` (chars in ref missing from current) → **DELETION**: **20**

No ambiguous “deletion/insert handling” wording — counts are explicit.

================================
SAME-SURFACE
============

independent contrast (KEEP and RETRY on **different utterances**): many surfaces, e.g. 的 / 这 / 边 / 不 / 他 / 就 / 现 / …

path-only duplicate contrast: **0** (no surface that only contrasts via multipath copies without independent utterances)

================================
MULTIPATH
=========

utterances with >1 path: **40 / 55**

path_hist: 1→15, 2→12, 3→11, 4→5, 5→1, 6→7, 8→4

total paths ≈ sum(k×count): natural multipath present; not forced.

================================
ANCHOR
======

Observed anchorSource: **NONE** only (2943)

DOMAIN / MODEL2 / DOMAIN_AND_MODEL2: **0** in this sample  
Model2 Anchor absence does **not** fail this probe (primary acceptance = B2 cand-state + coherent labels).

================================
FRESH VS HISTORICAL
===================

| signal | historical probe (N=12 dumps) | fresh extension (N=55) |
|--------|-------------------------------|-------------------------|
| pipeline | EXISTING_WAV + HISTORICAL FW/Tone | Piper→fresh ASR/FW/Tone |
| provenance accounting | report said 12/0; structured 10/2 | accepted 55 / rejected 0 (SSOT corrected) |
| RETRY+cand>0 (utt) | directional strong (~8/12 raw) | **29/55** coherent |
| cand 0 and >0 | both present | both present at scale |
| Tone ready | high | 55/55 utt |
| multipath | 4/12 | **40/55** |
| error families | mixed | INSERTION/SUBSTITUTION/DELETION/MULTI_CHAR all present |

Diagnostic only — no exact parity required. No obvious fresh/historical semantic divergence that would invalidate B2.

Route A: reference-only; **not** used as supervised train source.

================================
COMPUTE
=======

SSOT: `model3_v2_acoustic_extension_compute.json`

| stage | sec |
|-------|----:|
| TTS | 16.518 |
| ASR/FW+Tone (`/utterance` client) | 137.723 |
| Recall/lattice/label (Electron harness wall) | 14.687 |
| **total wall** | **170.197** |
| per-utt wall | 3.094 |

Previous compute discrepancy resolved: harness-only ~3s ≠ full wall 25–30s because primary report mixed cold-start/lexicon wall with lattice-only timer. This extension separates stage elapsed vs wall.

================================
HOLDOUT
=======

collisions: **0**  
Protected ids/texts excluded; source pool `model3_certified_base_pool_v2` with dialog_200 source filtered out.

================================
GOVERNANCE
==========

Model3 changed: **NO**

feature changed: **NO**

threshold changed: **NO**

Recall changed: **NO**

Tone changed: **NO**

FineSpan changed: **NO**

Anchor changed: **NO**

Retry changed: **NO**

JobResult changed: **NO**

pronunciation perturbation: **NO**

formal dataset: **NO**

training: **NO**

Tooling-only fix: `wav_bytes_pcm16` float→PCM scale (probe audio encode). ASR/VAD business semantics unchanged.

================================
NEXT PHASE
==========

Exactly one: **`MODEL3_V2_ACOUSTIC_TRAINING_STATE_IMPLEMENTATION_PLAN`**

Do not execute.

================================
CHECKLIST
==========

[x] previous provenance contradiction explicitly corrected  
[x] old 66.7% not treated as accepted SSOT  
[x] raw vs accepted statistics separated  
[x] rejected samples excluded from accepted aggregates  
[x] fresh ASR environment restored  
[x] fresh TTS/audio materialization run  
[x] fresh ASR/FW run  
[x] actualAsrText preserved  
[x] fresh Tone run  
[x] same-run Tone identity persisted  
[x] Mandatory Tone Recall used  
[x] no Plain Recall  
[x] no fake Tone / fake cand  
[x] production FineSpan/path used  
[x] V2 alignment/labels reused  
[x] mismatch != automatic RETRY  
[x] provenance gate fail-closed  
[x] 50–100 attempted (55)  
[x] N0–N11 reported  
[x] accepted-only cand cells + histogram  
[x] utterance/region/span×path separated  
[x] multipath inflation prevented  
[x] insertion/deletion counts explicit  
[x] same-surface independence distinguished  
[x] Route A not used for supervised train  
[x] compute SSOT corrected  
[x] protected holdout excluded  
[x] no pronunciation perturbation / dataset ID / Model3 training  
[x] exactly one verdict + one next phase  
[x] next phase not executed  

================================
ARTIFACTS
=========

1. `Lingua_Model3_V2_Acoustic_Materialization_Yield_Probe_Extension_2026_08_30.md` (this file)  
2. `model3_v2_acoustic_extension_funnel.csv`  
3. `model3_v2_acoustic_extension_candidate_distribution.csv`  
4. `model3_v2_acoustic_extension_provenance_rejects.csv`  
5. `model3_v2_acoustic_extension_compute.json`  
6. `model3_v2_acoustic_extension_summary.json`  
