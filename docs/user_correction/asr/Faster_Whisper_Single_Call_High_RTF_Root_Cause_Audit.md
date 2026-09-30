# Faster-Whisper — Single-Call High-RTF Root Cause Audit

**PHASE:** `FASTER_WHISPER_SINGLE_CALL_HIGH_RTF_ROOT_CAUSE_AUDIT`  
**MODE:** READ-ONLY (+ diagnostic replay; no production / ASR-param / segmentation changes)  
**DATE:** 2026-09-07  
**VERDICT:** `FW_SINGLE_CALL_HIGH_RTF_ROOT_CAUSE_NOT_ISOLATED`  

> **Naming:** `FW` in the verdict = **Faster-Whisper**, not Lingua FW Repair.  
> `ARCHITECTURE_DRIFT = NONE`

---

## 0. Control variable

Only:

`SINGLE ASR CALL → list(segments) latency variance`

on ~3–4s audio (≈1s vs 6–12s). Multi-segment / FineSpan / Model3 / etc. are out of scope.

---

## 1. Timer validity

**`LIST_SEGMENTS_TIMER_VALID = YES`**

Evidence (`asr_worker_process.py`):

1. `model.transcribe(...)` returns a **lazy generator** (logged separately, often ~0–20ms).
2. Inference wall is:

```text
list_start = time.time()
segments_list = list(segments)
# log: Converted segments to list (took Xs)
```

3. Controlled replay used the same boundary (`perf_counter` around `list(segments)` only).  
   Tone / HTTP / FastAPI are outside this timer.

Do **not** use `transcribe() completed` as inference time.

---

## 2. Historical single-call cohorts

Filter: **one** `list(segments)` per `job_id`, audio **3.0–4.5s**.

| Cohort | Threshold | n | list p50 | audio p50 | notes |
|--------|-----------|--:|---------:|----------:|-------|
| FAST | ≤1.5s | **6848** | 0.918s | 3.88s | |
| NORMAL | (1.5, 4)s | **4006** | 2.64s | 3.92s | |
| SLOW | ≥6s | **343** | 7.27s | 3.92s | |

Sept 2026 subset: FAST=338, SLOW=15 (SLOW ordinal **104–126**, idle p50 **4s**).

Exported sample: `faster_whisper_high_rtf_case_comparison.csv`.

---

## 3. Worker lifecycle (Q1–Q3)

| Question | Result |
|----------|--------|
| Q1 Slow on `requestOrdinal=1`? | **NO** — SLOW ord1 = **2/343**; Sept SLOW all mid-lifetime |
| Q2 Slow after long idle (≥60s)? | **NO** — SLOW idle≥60 = **0/341**; idle p50≈4s |
| Q3 Restart / model reload? | **NO** — reload_recent ≈ **2/343** |

→ **H4 Worker lifecycle: NOT_SUPPORTED** for historical 6–12s.

---

## 4. Controlled same-audio replay (current machine)

**Audio:** `dialog_d031.wav` (3820ms), production-matched config:

`medium` / `cuda` / `int8_float16` / `beam_size=1` / `temperature=0` / `language=zh` / `vad_filter=False` / `word_timestamps=True`

**Environment note:** `Wow.exe`, Chrome, other Python processes were on the GPU (`OTHER_GPU_PROCESS_ACTIVE` for *current* session). Historical contention: **`HISTORICAL_GPU_CONTENTION_NOT_OBSERVABLE`**.

### Test A — immediate ×15

| run | list(segments) ms | RTF | output stable |
|----:|------------------:|----:|---------------|
| 1 (first after load) | **3899** | 1.02 | yes |
| 2–15 warm | **809–947** (p50 **838**) | ~0.22 | identical text |

`cold/warm ratio ≈ 4.66` (first vs warm median) — **mild** cold effect, **not** historical 6–12s.

### Test B — idle 90s then infer

After idle: **938–1176ms** (slight bump, still ≪6s).

### Second ~3.8s audio (`dialog_d183.wav`) ×5 warm

**768–903ms** — also fast.

**Pattern:** **A** — same input is stably **fast** when warm; historical 7s **not reproduced** today.

Full tables: `faster_whisper_same_audio_replay.csv`, `faster_whisper_gpu_runtime_evidence.csv`.

---

## 5. Decoder workload (duration-matched)

FAST vs SLOW historical samples (|Δaudio|≤500ms):

- `segmentCount` mean delta ≈ **-0.1**
- `textLen` nearly equal (~19–20)

→ **H5 Decoder workload: NOT_SUPPORTED** on available proxies (no token-step counters in logs).

---

## 6. GPU / clock / thermal (current replay only)

| Moment | SM clock | P-state | Temp | Notes |
|--------|----------|---------|------|-------|
| Before model load | ~600–1020 MHz | P3/P4 | ~39°C | low power |
| During/after warm infer | **2505** | **P0** | ~41–44°C | stable |
| After 90s idle → infer | 2505 | P0 | ~44°C | still ~1s |

→ Clock/P-state tracks **mild first-call** wake-up. **Not proven** as owner of historical mid-worker 6–12s.

Device: **CUDA** (no CPU fallback in replay).

---

## 7. Hypothesis grades

| ID | Hypothesis | Grade |
|----|------------|-------|
| H1 | Cold / warm | **STRONGLY_CORRELATED** for first-after-load (~3.9s vs ~0.8s); **NOT proven** for historical 6–12s |
| H2 | External GPU contention | **POSSIBLE**; historical **NOT_OBSERVABLE**; current Wow present but warm still fast |
| H3 | Clock / thermal / power | **STRONGLY_CORRELATED** with mild first-call; **NOT proven** for historical 6–12s |
| H4 | Worker lifecycle | **NOT_SUPPORTED** |
| H5 | Decoder workload | **NOT_SUPPORTED** (available proxies) |
| H6 | Hidden queue in timer | **NOT_SUPPORTED** |
| H7 | Measurement defect | **NOT_SUPPORTED** (`LIST_SEGMENTS_TIMER_VALID=YES`) |
| H8 | Other / transient | **POSSIBLE** (unreproduced historical band) |

---

## 8. Required final answers

1. **Reproduce 6–12s now?** **No** (warm ~0.8s; first-after-load ~3.9s only).  
2. **Same slow audio stably slow?** **No** (Pattern A — stable fast).  
3. **Mostly worker cold start?** **No** for historical SLOW; mild yes for first after load.  
4. **Idle related?** **No** for explaining 6–12s.  
5. **Restart/reload?** **No**.  
6. **External GPU contention evidence?** Current processes exist; **not sufficient** to force 6–12s now; historical unknown.  
7. **Clock/power/thermal?** Mild first-call only.  
8. **More decoder work?** **No** on segment/text proxies.  
9. **CPU fallback?** **No**.  
10. **Explained fraction of historical single-call SLOW?** **≈0%** of the 6–12s band by reproducible H1; first-call mild variance is a **separate** smaller effect.  
11. **Unexplained?** Historical **343** single-call SLOW cases in the 3–4.5s window.  
12. **Next ONE control variable:**  
    **`EXTERNAL_OR_TRANSIENT_GPU_LOAD_REPRODUCTION`** — try to reproduce 6–12s under controlled GPU load / exclusive-GPU A/B, and attach live `nvidia-smi` to service slow events. **Still no ASR param / segmentation / model changes.**

---

## 9. Comparison table (representative)

| case/audio | cohort | audioMs | inferenceMs | RTF | workerPid | requestOrdinal | idleBeforeSec | segmentCount | word/token | GPU | classification |
|------------|--------|--------:|------------:|----:|-----------|---------------:|--------------:|-------------:|------------|-----|----------------|
| hist sample FAST | FAST | ~3800 | ~900 | ~0.25 | logged if known | mid | ~1–4 | ~1–2 | textLen~19 | hist N/A | HISTORICAL |
| hist sample SLOW | SLOW | ~3800 | ~7000 | ~1.9 | logged if known | mid | ~4 | ~1–2 | textLen~20 | hist N/A | HISTORICAL |
| d031 run1 | replay | 3820 | 3899 | 1.02 | 11464 | 1 after load | 0 | 1 | words=18 | Wow+… | MILD_COLD |
| d031 run2–15 | replay | 3820 | ~838 | 0.22 | 11464 | warm | 0 | 1 | 18 | Wow+… | WARM_FAST |
| d031 after 90s idle | replay | 3820 | ~1000–1176 | ~0.28 | 11464 | warm | 90 | 1 | 18 | Wow+… | IDLE_MILD |

See CSVs for full rows.

---

## 10. Verdict

**`FW_SINGLE_CALL_HIGH_RTF_ROOT_CAUSE_NOT_ISOLATED`**

- Timer is valid; historical single-call 6–12s is real.  
- Current controlled replay **cannot** reproduce that band.  
- Mild **cold-after-model-load** (~4×) is real but **does not** match historical SLOW (not first ordinal; not long idle).  
- Decoder proxies and worker lifecycle do not explain the band.  
- Do **not** optimize ASR/warmup/scheduling until 6–12s is reproduced under a controlled GPU/system variable.

---

## Artifacts

1. `Faster_Whisper_Single_Call_High_RTF_Root_Cause_Audit.md`  
2. `faster_whisper_high_rtf_case_comparison.csv`  
3. `faster_whisper_same_audio_replay.csv`  
4. `faster_whisper_high_rtf_summary.json`  
5. `faster_whisper_gpu_runtime_evidence.csv`
