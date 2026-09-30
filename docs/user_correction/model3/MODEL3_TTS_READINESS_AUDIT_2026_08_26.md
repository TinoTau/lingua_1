# MODEL3 V1 TTS Readiness Audit

**Status:** `SUPERSEDED_FOR_MODEL3`  
**Reason:** `ROLE_DRIFT_CORRECTED` (2026-08-26)  
**Superseding authority:** `MODEL3_SYNTHETIC_V1_FROZEN.md` · `MODEL3_ARCHITECTURE_CONTRACT_V1.md` · `MODEL3_V1_TEXT_ONLY_ROLE_CORRECTION_REPORT_2026_08_26.md`

Model3 is **TEXT_ONLY**. TTS is **not** a required Model3 V1 training stage.  
Default next Model3 phase is **`MODEL3_V1_RUNTIME_TEXT_PIPELINE_INTEGRATION_AUDIT`**, not TTS-ASR pilot.

This document is retained as **historical evidence** only.  
TTS infrastructure used by Model2 / Tone / ASR experiments is **not** deleted by this supersession.

---

# MODEL3 V1 TTS Readiness Audit (HISTORICAL)

**Date:** 2026-08-26  
**Phase:** `MODEL3_V1_TTS_READINESS_AUDIT`  
**Mode:** READ-ONLY (no TTS generation · no training · no Synthetic V1 mutation · no runtime change)  
**Prerequisite:** Synthetic V1 freeze = **PASS**

---

## 1. Purpose of TTS stage

**Not** more synthetic text sentences.

**Goal:** acoustic / pronunciation variation → **actual production-equivalent ASR** → Model3 training evidence.

Primary residual gap to address: Heldout pronunciation family F1 ≈ **0.58**.

---

## 2. Required future pipeline

```text
reference text
 → TTS audio
 → pronunciation / accent perturbation (voice + phoneme paths — not text-only “accent”)
 → current production ASR (faster-whisper-vad)
 → ASR raw output + FW timestamps
 → Tone / acoustic evidence (from audio — not reference tone)
 → FineSpan
 → Domain / Model2 Anchor
 → Model3 training sample (evidenceLevel=TTS_ASR)
```

**Forbidden shortcut:** TTS reference text → artificial error text (skip real ASR).

---

## 3. Engine / environment inventory

| Item | Finding |
|------|---------|
| Engine | **Piper TTS** HTTP service (`electron_node/services/piper_tts/`) |
| Training client | `training/model2/adapters/piper_tts_client.py` |
| Default voice | `zh_CN-huayan-medium` (zh / cmn espeak) |
| Native sample rate | **22050 Hz** WAV PCM16 (model config) |
| ASR target rate | **16000 Hz** (`DEFAULT_ASR_SAMPLE_RATE`) — resample required |
| Device | CPU Piper path present; CUDA optional in local PiperVoice load |
| Prior pipeline | Model2 `run_accent_scale_pipeline.py` / phoneme realizer |
| Product YourTTS | Translation playback path — **not** Model3 training ASR roundtrip |
| License provenance | Piper + voice model licenses **not fully SSOT-documented for Model3** → **LICENSE_GAP** |

**This audit did not install engines or generate audio.**

---

## 4. Pronunciation variation coverage

| Class | Path | Status |
|-------|------|--------|
| A. TTS voice / accent variation | Single zh voice today; multi-voice not Model3-bound | **GAP** (limited voices) |
| B. Phoneme / pronunciation perturbation | Model2 phoneme realizer + surface resolver exist | **READY** (reuse shape) |
| C. Actual ASR error | faster-whisper-vad client exists | **READY** (service dependency) |

Confusion families (n/l, d/t, z/zh, c/ch, s/sh, in/ing, en/eng, an/ang, tone): coverable via **B+C**, not by swapping text labels alone.

**Tone:** ToneModule produces acoustic tone from audio (`docs/tone-module/ARCHITECTURE.md`). Must **not** feed reference tone into Model3 inputs. Integration into Model3 sample materialization is **TONE_INTEGRATION_GAP** (contract allows channels; pipeline not wired for Model3 TTS samples).

---

## 5. Audio format vs production

| Spec | Production / ASR | Piper TTS | Action |
|------|------------------|-----------|--------|
| Sample rate | 16 kHz | 22.05 kHz | Resample before ASR |
| Channels | mono preferred | mono/stereo validated in client | Enforce mono |
| PCM | 16-bit | 16-bit WAV | Match |
| Container | wav / pcm16 jobs | WAV | OK |
| Timestamps | FW word times | N/A until ASR | Capture post-ASR |

---

## 6. ASR roundtrip

| Capture field | Status |
|---------------|--------|
| referenceText / audioId | Definable |
| ASR raw text | `faster_whisper_client` READY |
| FW / word timestamps | Production path exists; Model3 materializer **not built** |
| ASR model / config identity | Client lock_config pattern READY |
| Second/special ASR | **Forbidden** — use production-equivalent only |

**Verdict:** `Production ASR Roundtrip = READY` at service level; `FW Timestamp Path = GAP` for Model3 sample writer; overall stage still needs pilot plumbing.

---

## 7. Schema / label / leakage

| Topic | Verdict |
|-------|---------|
| Map into `MODEL3_TRAINING_SAMPLE_V1` | Mostly READY (`evidenceLevel=TTS_ASR`, `audioRef`) |
| Acoustic extension | If denser tone/ASR conf tensors needed → report only: **SCHEMA_EXTENSION_REQUIRED** (do not edit formal schema this round) |
| evidenceLevel | Must be `TTS_ASR` — never claim `HUMAN_ASR` |
| Feature availability | Tone/ASR conf: REAL when from audio; ABSENT when missing — never fake |
| RETRY label | Same frozen rules (Anchor · reachability · Recall) — ASR≠ref ⇏ RETRY |
| Leakage boundary | **RISK** until materializer enforce allowlist on TTS path |
| Eval sets | dialog_200 / heldout family / unseen tests / formal eval **must not** enter TTS train gen |
| Split | Split text/family **before** audio — READY as policy; tooling GAP |

---

## 8. Volume estimates (engineering only — no schedule promise)

| Pilot | Audio hours (approx) | Disk (wav 16k mono) | Gen+ASR wall (order) | Sample yield |
|-------|---------------------:|--------------------:|----------------------|--------------|
| 5k utt | ~4–8 h | ~0.5–1.5 GB | hours–day (CPU) | <<5k usable RETRY |
| 10k utt | ~8–16 h | ~1–3 GB | day-scale | TBD after error-yield gate |
| 20k | scale ~2× | scale ~2× | decide after pilot | — |

Expect **LOW_ERROR_YIELD** risk if TTS is too clean — fix via generation/perturbation, **not** label hacks or ASR text edits.

---

## 9. Future quality gates (pilot)

valid audio rate · ASR success · ASR error yield · usable RETRY yield · Anchor availability · Tone evidence availability · duplicate rate · label leakage · split leakage.

---

## 10. Mixed training strategy (recommend one)

**Preferred:** **A. Synthetic V1 frozen corpus as base → TTS-ASR fine-tune / V1.1 train** producing **`MODEL3_V1_1_TTS`**.

Alternatives (not chosen this round): full mixed retrain from scratch; limited acoustic adapter.

Synthetic V1 **must not** be overwritten.

---

## 11. Human data boundary

TTS-ASR ≠ real user ASR. Even if TTS pilot PASSes, **do not claim** real-user accent solved. Final validation remains human/shadow usage.

---

## 12. Classification

| Code | Applied? |
|------|----------|
| READY_FOR_TTS_PILOT | **NO** (gaps remain) |
| READY_WITH_GAPS | **YES** |
| SCHEMA_GAP | soft — extension may be needed; base schema usable |
| ASR_ROUNDTRIP_GAP | service READY; Model3 writer GAP |
| TONE_INTEGRATION_GAP | **YES** |
| LICENSE_GAP | **YES** |
| DATA_LEAKAGE_RISK | **YES** until TTS materializer gates |
| ARCHITECTURE_CONFLICT | **NO** — design can carry acoustic evidence without changing Synthetic V1 |

---

## 13. Go / No-Go

**Ready for 5k–10k TTS-ASR pilot development:** **YES, with gaps** (documentation + plumbing first; not generation this round).

**Blocking before generation:** license SSOT · split-before-audio tooling · leakage tests on TTS materializer · Tone wiring policy · error-yield monitoring plan.

**Recommended next phase:** `MODEL3_V1_TTS_ASR_PILOT_DATASET_DEVELOPMENT` (5k–10k only).
