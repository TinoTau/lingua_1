# Lingua — ASR 7s Latency Case-Level Causal Audit

**PHASE:** `ASR_7S_LATENCY_CASE_LEVEL_CAUSAL_AUDIT`  
**MODE:** READ-ONLY  
**DATE:** 2026-09-05  
**VERDICT:** `ASR_7S_CAUSAL_AUDIT_PASS_MIXED_OWNERS`

---

## 0. Gate: identity join

| Join | Result |
|------|--------|
| Timing dump `caseId` (d001…) ↔ service-log `list(segments)` | **`CASE_LEVEL_CAUSAL_JOIN = FAILED`** |
| Service-log `job_id` ↔ per-call `list(segments)` / `perform_asr` | **OK** |

**Why timing join fails (proven in code):**

1. `runPipelineWithAudio` **ignores** HTTP `jobId` and always sets `job_id = audio-test-${Date.now()}` (`inference-service.ts`).
2. Timing dump stores `caseId` + `pipeline_ms` / `fw_detector_step_ms` only — **no** `asr_latency_ms`, **no** ASR `job_id`, **no** `list(segments)` ms.
3. Prior `asr_est = pipeline_ms − fw_detector_step_ms` is **not** ASR boundary latency (includes non-FW work outside the FW step).

Therefore: **do not** explain timing-dump “~7–10s residual” rows as ASR multi-segment without new instrumentation.  
This audit answers the **~7s recognition** question from **service-log case/job identity**, which is the only place `list(segments)` exists.

Architecture note preserved: multi-segment ASR from AudioAggregator is **`ARCHITECTURE_REQUIRED_MULTI_SEGMENT_ASR`** when it occurs — not automatically a bug.

---

## 1. What “~7s” means here

Two different quantities were previously cited together:

| Quantity | Source | Meaning |
|----------|--------|---------|
| `list(segments)` p95 ≈ 6.8s | ASR worker log | **Black-box inference materialization** (correct timer) |
| `perform_asr` p95 ≈ 7.23s | `utterance_asr` | Queue + IPC + `list(segments)` |
| Timing `asr_est` ≥ 7s (52 cases excl. d094) | `pipeline − fw` | **Not ASR** — join to inference **FAILED** |

This audit’s causal claims use **`list(segments)` wall** as model inference.

---

## 2. Slow cohorts selected

### A. Timing dump (identity incomplete)

- `asr_est ≥ 7000ms`: **52** cases (excl. outlier `d094`)
- `asr_est ≥ 6000ms`: **55**
- Top residuals include `d096` (24623), `d088` (16672), `d090` (15606), …
- Fixture audio exists (manifest `durationSec` / `wavBytes`) — see `asr_7s_case_identity_join.csv`
- **Cannot** attach ASR call history → no causal classification from this cohort alone

### B. Service log — primary causal cohort

**Band:** `6.0s ≤ list(segments) ≤ 12.0s` (the “approximately 7s” inference observations)

| Scope | n |
|-------|---|
| All history | **996** |
| **2026-09 only (primary)** | **29** |

### C. Multi-segment sum cohort (no single call ≥6s)

Jobs with `sum(list) ≥ 6` and `max(list) < 6`:

| Scope | n |
|-------|---|
| All history | **975** |
| **2026-09** | **180** |

This is the cohort that can prove “7s = serial multi-call math” **without** any single call being 7s.

---

## 3. Mandatory slow-case table (excerpt)

Full table: `asr_7s_slow_cases.csv` (recent band + multi-sum examples).

### 3.1 Recent Sept `list ∈ [6,12]` — top rows

| caseId (job) | audioMs | asrCalls | segmentMs[] | inferenceMs[] | thisCallInferenceMs | inferenceSumMs | ASRBoundaryMs (perform) | nonModelMs | queueClass | classification |
|---|---:|---:|---|---|---:|---:|---:|---:|---|---|
| …702586 | 2500 | 2 | [2500,2580] | [9286,781] | **9286** | 10067 | 9330 | 44 | NO_QUEUE_WAIT | SINGLE_CALL_MODEL_INFERENCE_SLOW |
| …011793 | 4080 | 1 | [4080] | [7721] | **7721** | 7721 | 7770 | 49 | NO_QUEUE_WAIT | SINGLE_CALL_MODEL_INFERENCE_SLOW |
| …182041 | 4620 | 1 | [4620] | [7341] | **7341** | 7341 | 7360 | 19 | NO_QUEUE_WAIT | SINGLE_CALL_MODEL_INFERENCE_SLOW |
| …133893 | 3880 | 1 | [3880] | [7290] | **7290** | 7290 | 7380 | 90 | NO_QUEUE_WAIT | SINGLE_CALL_MODEL_INFERENCE_SLOW |
| …122299 | 4020 | 1 | [4020] | [7190] | **7190** | 7190 | 7230 | 40 | NO_QUEUE_WAIT | SINGLE_CALL_MODEL_INFERENCE_SLOW |
| …099475 | 4640 | 1 | [4640] | [7174] | **7174** | 7174 | 7220 | 46 | NO_QUEUE_WAIT | SINGLE_CALL_MODEL_INFERENCE_SLOW |
| …088360 | 3460 | 1 | [3460] | [7094] | **7094** | 7094 | 7120 | 26 | NO_QUEUE_WAIT | SINGLE_CALL_MODEL_INFERENCE_SLOW |
| …345702 | 7520 | 1 | [7520] | [6546] | **6546** | 6546 | 6590 | 44 | NO_QUEUE_WAIT | EXPECTED_LONG_AUDIO_SINGLE_SEGMENT |
| …193734 | 3820 | 2 | [1400,3820] | [5042,6814] | **6814** | 11856 | 6920 | 106 | SELF_SERIALIZATION… | SINGLE_CALL_MODEL_INFERENCE_SLOW |

**Read:** for these rows the ~7s **is the single `list(segments)` call**. Second segment (when present) is usually <<7s; multi-call does **not** create the 7s by addition of two fast inferences.

### 3.2 Sept multi-sum examples (`max(list)<6`, `sum≥6`) — architecture multi-segment

| job | lists (s) | sum (s) | auds (s) | classification |
|-----|-----------|---------|----------|----------------|
| audio-test-1788358773586 | 5.479 + 3.827 | **9.31** | 5.9 + 1.1 | SELF_SERIALIZED_MULTI_SEGMENT |
| audio-test-1788383151541 | 5.324 + 3.638 | **8.96** | 5.9 + 1.22 | SELF_SERIALIZED_MULTI_SEGMENT |
| audio-test-1788358796230 | 4.076 + 4.858 | **8.93** | 2.7 + 4.18 | SELF_SERIALIZED_MULTI_SEGMENT |
| audio-test-1788358841841 | 4.424 + 4.413 | **8.84** | 4.0 + 2.56 | SELF_SERIALIZED_MULTI_SEGMENT |

**Read:** here ~9s **is** explained by **two serial ASR calls** (QUEUE_MAX=1 self-serialization). No single call is ≥6s. This is **expected** under intentional AudioAggregator segmentation — **not** proven equal to the `list` p95≈6.8 observation (that p95 is per-call).

---

## 4. Single vs multi classification counts

### Recent Sept `list ∈ [6,12]` band (n=29)

| Class | Count |
|-------|------:|
| `SINGLE_ASR_CALL` | 18 |
| `MULTI_ASR_CALL` (job had ≥2 HTTP calls) | 11 |
| `IDENTITY_NOT_PROVEN` | 0 |

Primary classification on these 29:

| classification | Count |
|----------------|------:|
| `SINGLE_CALL_MODEL_INFERENCE_SLOW` | **28** |
| `EXPECTED_LONG_AUDIO_SINGLE_SEGMENT` | **1** |

### Single-call ≥6s gate

**YES — many cases** have `ASR_HTTP_CALL_COUNT = 1` and `list(segments) ≥ 6000ms`.

Examples (Sept): audio ~3.5–4.6s, inference ~7.0–7.7s, **RTF ≈ 1.5–2.0**, `nonModelMs` ≈ 20–100ms, `queueClass=NO_QUEUE_WAIT`, no concurrent worker starts during infer.

→ **`SINGLE_CALL_MODEL_INFERENCE_SLOW`** (subcause of *why* RTF≫1: **NOT_ISOLATED** — no GPU/health counters in this read-only pass).

---

## 5. Does multi-call mathematically explain ~7s?

| Question | Answer |
|----------|--------|
| For a call already in the `list≥6` band? | **NO** — that call alone is ≥6s |
| Can multi-segment produce ~7–9s without any call ≥6s? | **YES** — **180** such jobs in Sept 2026 alone |
| Is “7s latency = 2 ASR calls” always true? | **NO** — must not claim without per-job lists |

`SUM_OF_ASR_INFERENCE_EXPLAINS_TOTAL`:

- Multi-sum cohort: **YES** (sum of lists ≈ envelope of serial inference)
- `list≥6` band: **NO_SINGLE_CALL_ALREADY_GE6**

---

## 6. Audio length relationship (case-level, not Pearson)

**dialog_200 fixtures:** max `durationSec = 8.034`; `≥6s` fixtures = 35; `≥7s` = 16.  
Energy split (`splitAudioByEnergy(5000, 2000, …)`) **can** produce 2 ASR segments for longer fixtures — **architecture-required**.

**Recent `list≥6` band audio:**

| | |
|--|--|
| audio p50 | **3.82 s** |
| audio &lt; 4s | **19 / 29** |
| audio ≥ 5s | **2 / 29** |
| RTF p50 | **1.84** |

So the typical ~7s **`list(segments)`** is **not** “because the fixture was ~7s long”.

---

## 7. Queue / contention

- Config: `QUEUE_MAX=1`, one worker.
- During slow `list(segments)`, **no other worker task starts** observed → **not** `CROSS_JOB_QUEUE_CONTENTION`.
- Call index ≥2 on multi-HTTP jobs: **`SELF_SERIALIZATION_FROM_MULTI_SEGMENT`**.
- Exact `queueMs`: **NOT_MEASURABLE** (no queue-enter timer).

---

## 8. Non-model envelope

Where `perform_asr` and `list(segments)` both exist:

`NON_MODEL_ASR_ENVELOPE ≈ perform_asr − list(segments)` → typically **20–120 ms**.

**Not** the owner of ~7s. Decode/VAD/Tone/HTTP may sit **outside** `perform_asr`; those are **NOT_MEASURABLE** here and are **not** required to explain the ~7s `list` band.

---

## 9. Test harness

Slow jobs are overwhelmingly `audio-test-*` from `runPipelineWithAudio`:

- WAV → Opus → Node PCM16 (harness encode/decode)
- `TONE_P10_VAD_CPU=1` on performance harness env (VAD on CPU) — may affect VAD cost, **not** proven as the 7s `list` owner
- **No** dual-fork on production timing mode

Separate: harness overhead ≠ `list(segments)` 7s. The 7s band is **inside the worker black-box materialization**.

---

## 10. The 7-second question (explicit)

1. **Was original test audio actually long?** Often **no** for the `list≥6` band (p50 ≈ 3.8s). Longer fixtures exist (up to ~8s) and can multi-segment.
2. **Exact duration?** Per row `audioMs` / manifest `durationSec` when dialog case is known (timing join failed for ASR lists).
3. **Split by AudioAggregator?** **Sometimes** (multi HTTP same `job_id`).
4. **How many ASR calls?** Recent band: **18×1**, **11×≥2**.
5. **How long each call?** See `inferenceMs[]` in CSV.
6. **Do multiple calls explain ~7s?** **Sometimes** (180 Sept multi-sum jobs). **Not** for the per-call `list≥6` observations.
7. **Or did a single Faster-Whisper call take ~7s?** **Yes — primary for the list∈[6,12] band.**
8. **Queue/contention?** No cross-job contention proven; multi-segment self-serialization for call2+.
9. **Unexplained?** Why RTF≈1.5–2+ on ~4s audio (GPU health / cold start / contention outside ASR worker) — **not isolated**.

---

## 11. Causal classification summary

| Owner | Proven? | Role for “~7s” |
|-------|---------|----------------|
| A. Intentional multi-segment serial ASR | **Yes** (180 Sept sum≥6 max&lt;6) | Can produce ~7–9s **envelope** |
| B. Single `list(segments)` ≥6–7s | **Yes** (29 Sept band; 28 slow) | **Primary** for inference p95-style ~7s |
| C. Cross-job queue | **No** | |
| D. VAD/Tone/HTTP envelope | **No** as 7s owner | tens of ms inside `perform_asr` |
| E. Harness WAV↔Opus | Present | Not the `list` 7s |
| Timing-dump residual ≥7s | Join **FAILED** | Do not attribute |

---

## 12. Verdict

**`ASR_7S_CAUSAL_AUDIT_PASS_MIXED_OWNERS`**

- **Owner 1 (dominant for `list(segments)≈7s`):** `SINGLE_CALL_MODEL_INFERENCE_SLOW` on often-short audio (RTF≫1).  
- **Owner 2 (real, architectural):** `SELF_SERIALIZED_MULTI_SEGMENT` / expected multi-segment summing to ~7–9s without any single call ≥6s.  
- **Do not** collapse these into “7s = two ASR calls” for the inference p95 observation.  
- **Do not** optimize segmentation/model in this phase.

---

## 13. Next measurement (not this phase)

To join dialog `caseId` ↔ ASR lists: persist `job_id` from harness **or** stop overwriting it in `runPipelineWithAudio`; emit `list_segments_ms` / `asr_latency_ms` into timing dump. Until then, timing-dump residuals remain **non-ASR-causal**.

---

## Artifacts

1. `Lingua_ASR_7s_Latency_Case_Level_Causal_Audit.md` (this file)  
2. `asr_7s_slow_cases.csv`  
3. `asr_7s_audit_summary.json`  
4. `asr_7s_case_timing_raw.jsonl`  
5. `asr_7s_case_identity_join.csv`
