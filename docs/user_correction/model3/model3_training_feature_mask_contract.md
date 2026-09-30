# Model3 Training Feature Mask Contract

**Status:** FROZEN (format audit 2026-08-23) · **Role correction:** 2026-08-26 (TEXT_ONLY)  
**Parent:** `MODEL3_TRAINING_DATASET_V1_CONTRACT.md`

---

## 1. Problem

`SYNTHETIC_TEXT` has **no real acoustic evidence**. Filling zeros / dummy confidence teaches the model that “0 = measured silence/confidence” → **local-LM collapse risk**.

**Role clarification (2026-08-26):** Model3 V1 is intentionally **TEXT_ONLY**. The correct mitigation is **not** to make Model3 an acoustic model. Mitigate collapse via Anchor conditioning, Strict Pair causality, and allowlist packing — **not** by requiring Tone/audio Model3 inputs.

---

## 2. Availability (sample-level)

`featureAvailability` (required):

| Channel | SYNTHETIC_TEXT default | TTS_ASR / HUMAN_ASR (provenance only) |
|---------|------------------------|---------------------------------------|
| `textContext` | true | true |
| `pinyinTextDerived` | true when Node SSOT succeeded | true when available |
| `toneAcoustic` | **false** | may be true in **schema/QA** — **not** Model3 V1 model-visible |
| `asrConfidence` | **false** | same — **not** Model3 V1 model-visible |
| `model2Pronunciation` | false unless offline evidence exists | as available (QA / future ACP) |
| `recallFirstPass` | false or SYNTHETIC_PROXY only if probe ran | true when first-pass recall exists |

Loader builds a **per-channel binary mask** for **allowlisted** features only. Absent acoustic channels must not be faked as measurements **and** must not be packed into Synthetic V1 tensors.

---

## 3. Span-level status enums

| Evidence | Allowed when ABSENT |
|----------|---------------------|
| `toneEvidence.provenance` | `ABSENT`; null pattern / penalty |
| `acousticEvidence.status` | `ABSENT`; `asrSegmentConfidence=null`; `wordTimeAligned=false` |
| `pronunciationEvidence.status` | `UNAVAILABLE` / `ABSENT` |
| `recallEvidence.status` | `ABSENT` or `SYNTHETIC_PROXY` (must not look like runtime first-pass) |
| `pinyinEvidence.provenance` | `TEXT_DERIVED_SYLLABLE_KEY` or `ABSENT` — **never** labeled acoustic |

---

## 4. Forbidden fills

- Fake Tone confidence  
- Fake ASR confidence  
- Dictionary tone labeled as `ACOUSTIC_REBIND`  
- Text pinyin labeled as acoustic  
- Invented `spanConfidence`  
- Packing acoustic / Tone tensors into Model3 V1 without ACP  

---

## 5. Training mitigations (corrected)

When dataset is SYNTHETIC_TEXT-dominant:

1. **Do not** require TTS_ASR / HUMAN_ASR share to “complete” Model3 V1 — text-only role is authoritative.  
2. Keep `toneAcoustic` / `asrConfidence` **false** and **out of** model-visible allowlist.  
3. Rely on Anchor conditioning + Strict Pair + Hard KEEP diet for causality (already frozen).  
4. Do **not** ship Model3 as an acoustic-linguistic / Tone-input model.

~~Historical item: “Require TTS_ASR before acoustic Model3 readiness”~~ → `REMOVE_FROM_CURRENT_ARCHITECTURE` / `ROLE_DRIFT_CORRECTED`.

---

## 6. Forward compatibility

Schema may store TTS_ASR / HUMAN_ASR **provenance** rows without schema break. That does **not** change Model3 modality. Adding acoustic Model3 inputs requires ACP + user approval.
