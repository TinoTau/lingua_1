# Lingua — Faster-Whisper ASR Controllable Performance Surface Audit

**PHASE:** `ASR_FASTER_WHISPER_CONTROLLABLE_PERFORMANCE_SURFACE_AUDIT`  
**MODE:** READ-ONLY (no production / model / Faster-Whisper / CTranslate2 changes)  
**DATE:** 2026-09-05  
**VERDICT:** `ASR_CONTROLLABLE_PERFORMANCE_AUDIT_PASS_MEDIUM_VALUE_OPTIMIZATION_FOUND`

---

## 1. EXECUTIVE VERDICT

Prior pipeline residual **ASR ≈ 57.4% (p50 ≈ 3489 ms)** is **`pipeline_ms − fw_detector_step_ms`**, **not** pure Faster-Whisper inference. Do **not** equate that share with the model black box.

**Within each ASR HTTP call**, black-box inference (`list(segments)` after `transcribe()`) is the dominant service cost: recent log cohort **p50 ≈ 0.92 s** on **~4 s** audio (**RTF p50 ≈ 0.32** on the broader `perform_asr` warning cohort; steady warnings often ~0.22–0.31).

**Lingua still owns meaningful controllable cost outside the black box:**

| Finding | Bucket | Steady-state latency impact |
|--------|--------|------------------------------|
| Node `AudioAggregator` energy-split → **2× `/utterance` on ~34% of recent jobs** | B (quality/architecture risk) | **MEDIUM–HIGH bounded** (extra full VAD+IPC+inference+Tone per extra batch; serial `QUEUE_MAX=1`) |
| FastAPI main loads **unused** `WhisperModel` via `models.py` (VAD import coupling) | A | Startup/VRAM; **not proven** large per-utterance |
| Verbose sync INFO → 330MB+ service log | A | **LOW until measured** |
| Opus WAV→Opus→PCM roundtrip | A (harness) | **Test path only**; live Node already sends **pcm16** |

**Answer to the final question:** Without touching Faster-Whisper/CTranslate2 internals, Lingua can **not** honestly promise multi-second safe savings from buffer/serialization alone. The **largest Lingua-owned lever** is **multi-batch energy segmentation** (decision-gated). After that, remaining cost is largely **upstream inference + hardware**. Prefer **instrumentation + quantify multi-batch delta** before any ASR engineering; do **not** invent beam/model surgery.

---

## 2. CURRENT ASR OWNER

| Item | Value |
|------|--------|
| Service id | `faster-whisper-vad` |
| Port | `6007` (`FASTER_WHISPER_VAD_PORT`) |
| Endpoint | `POST /utterance` |
| Process | `faster_whisper_vad_service.py` + `ASRWorkerManager` → `asr_worker_process` |
| Model | local **`faster-whisper-medium`** (`ASR_MODEL=medium`) |
| Device | **`cuda`** (CPU disallowed) |
| Compute type | **`int8_float16`** (`service.json`) |

**Production chain (FW path):**

1. Audio (client Opus **or** test WAV→Opus) → Node  
2. `runAsrStep` / `PipelineOrchestratorAudioProcessor` → decode to **pcm16 base64**, optional **energy split** → `audioSegments[]`  
3. `taskRouter.routeASRTask` → `executeFasterWhisperASR` → HTTP `POST {baseUrl}/utterance`  
4. Python: base64→PCM → preprocess → **Silero VAD** → `perform_asr` → worker `WhisperModel.transcribe` (`vad_filter=False`, `word_timestamps=True`) → materialize segments/words  
5. **Tone** inference on same request → JSON response  
6. Node receipt → raw text/segments/words/tone → **FW Repair / Tone align / FineSpan**

**Symbols / files:**

- Node: `faster-whisper-asr-strategy.ts`, `asr-step.ts`, `pipeline-orchestrator-asr.ts`, `audio-aggregator-process-finalize.ts`  
- Python: `api_routes.process_utterance`, `utterance_audio.py`, `vad.py`, `utterance_asr.perform_asr`, `asr_worker_manager.py`, `asr_worker_process.py`  
- Config: `service.json`, `config.py`

---

## 3. BLACK-BOX BOUNDARY

**INSIDE (not Lingua-optimizable in this phase):** Faster-Whisper neural inference, CTranslate2 kernels, decoder, CUDA kernels, architecture/weights, the real work inside `list(segments)`.

**OUTSIDE (eligible):** service startup, model load sites, config, audio decode/preprocess, Silero VAD, HTTP/JSON/base64, pickle IPC, `QUEUE_MAX`, Node energy split / batching, thread defaults, response formatting, logging, unused main-process model.

---

## 4. SERVICE LIFECYCLE

| Question | Answer |
|----------|--------|
| **MODEL_LOAD_PER_UTTERANCE** | **NO** |
| Load once per worker lifetime | **YES** (`asr_worker_process`) |
| Explicit warm-up | **NO** |
| First utterance | May pay lazy CUDA/CTranslate2 init — **NOT separately timed** |

**Duplicate load (startup):** `vad.py` → `from models import vad_session` executes **`models.py`**, which constructs **`WhisperModel` + VAD**. Production inference uses **worker** `WhisperModel` only (`asr_worker.py` / in-process `asr_model` is legacy). Classify: **LINGUA_SAFE_OPTIMIZATION** for splitting VAD load from Whisper load (startup/VRAM).

Lifecycle singleton for inference worker: **CORRECT**.

---

## 5. TIMING BOUNDARIES

| Timer | Exists? | Notes |
|-------|---------|--------|
| T0 Node send | Partial | `_requestDurationMs` / step logs; not SSOT dump field |
| T1 Python receive | Log only | `Received utterance request` |
| T2 decode/preprocess done | **NO** dedicated ms |
| T3–T4 VAD | **NO** dedicated ms |
| T5–T6 FW inference | **Partial / misleading** | `transcribe() completed (took Xs)` ≈ generator return (~0 ms); **real** = `Converted segments to list (took Xs)` |
| T7–T8 response | Log steps; no ms envelope | Tone has `tone_inference_ms` in diagnostics |
| T9 Node receive | Partial | request duration |
| T10 FW Repair start | Separate FW timers | |

**`asr_latency_ms` in diagnostics** = `perform_asr` only (queue + worker), **excludes** decode/VAD/Tone/serialize.

**Smallest future instrumentation (do not add in this audit):**  
Node T0/T9; Python decode_ms, vad_ms, queue_wait_ms, worker_infer_ms (`list` wall), tone_ms, serialize_ms; propagate into JobResult/timing dump.

---

## 6. ASR LATENCY BREAKDOWN

| Component | p50 | p95 | max | % of ASR boundary | Status |
|-----------|-----|-----|-----|-------------------|--------|
| NODE_TO_ASR_IPC | — | — | — | — | **NOT_MEASURABLE** |
| PYTHON_REQUEST_PARSE | — | — | — | — | **NOT_MEASURABLE** |
| AUDIO_DECODE_CONVERT | — | — | — | — | **NOT_MEASURABLE** |
| VAD | — | — | — | — | **NOT_MEASURABLE** |
| MODEL_INFERENCE (`list(segments)`) | **916 ms** | **6814 ms** | **9286 ms** | dominant *within call* | YES (log cohort n=187) |
| WORD_TIMESTAMP_EXTRACTION | — | — | — | folded into inference | **NOT_MEASURABLE** separately |
| POSTPROCESS | — | — | — | skipped dedup on FW | small / unmeasured |
| SERIALIZATION | — | — | — | — | **NOT_MEASURABLE** |
| ASR_TO_NODE_IPC | — | — | — | — | **NOT_MEASURABLE** |
| `perform_asr` wall (warning cohort) | **1590 ms** | **7230 ms** | **21820 ms** | — | YES (n=94, only >1 s) |
| Prior residual A_ASR | **3489 ms** | **9916 ms** | **24623 ms** | 57.4% of pipeline | **NOT pure FW** |
| UNATTRIBUTED (residual − inference) | — | — | — | large | multi-batch + VAD + Tone + HTTP + Node prep |

No fabricated sub-component percentages beyond what logs support.

---

## 7. AUDIO PREPROCESSING

| Step | Path | Class |
|------|------|--------|
| Client Opus → Node PCM16 | Live orchestrator | **REQUIRED** |
| Test WAV → Opus → Node PCM16 | `runPipelineWithAudio` | **REDUNDANT_ENCODE_DECODE** (harness) |
| Base64 PCM16 over HTTP | Always | **REQUIRED** transport encoding |
| Python pcm16 → float32 | `audio_decoder` | **REQUIRED** |
| Peak norm + silence trim | `audio_preprocess` | **REQUIRED** (policy) |
| Resample if sr mismatch | conditional | **REQUIRED** when needed |
| Temp WAV file for ASR | Not on pcm16 path | **N/A** (memory/base64) |
| Pickle numpy → worker queue | IPC | **REQUIRED** for process isolation; copy cost unmeasured |

---

## 8. FILE IO / MEMORY PATH

**Production ASR receives:** HTTP JSON + **base64 PCM16** (memory).  
**Class:** **MEMORY_NATIVE** for audio payload (no per-utt temp WAV on happy path).  
**Avoidable disk:** service **log FileHandler** (not audio). Opus ffmpeg/temp paths exist only on deprecated Opus fallback.

---

## 9. VAD COST

| Layer | Role |
|-------|------|
| Node energy split | `splitAudioByEnergy(5000, 2000, hangover)` before ASR |
| Silero VAD | Once per `/utterance` in Python |
| Faster-Whisper `vad_filter` | **False** (explicit) |

**Class:** Silero = **REQUIRED** once per HTTP call. Combined with Node energy split → **POSSIBLE_DUPLICATE_VAD** (different algorithms/purposes). Significance: **NOT_MEASURABLE** (no VAD ms). Do not remove in this phase.

---

## 10. ASR CALL COUNT

| Metric | Value |
|--------|--------|
| **ASR_INFERENCE_CALLS_PER_UTTERANCE (intended)** | **1** |
| FW ASR rerun | **OFF** (`disableAsrRerun=true`) |
| Recent log (tail sample) | **57** jobs ×1, **30** jobs ×2 (**34.5%** multi) |
| Owner when >1 | **`AudioAggregator` energy split + stream batcher** → `asr-step` loops `audioSegments` |
| Test-only dual fork | Acceptance harness only (excluded from production timing dump) |

Production **>1** is **Lingua orchestration**, not Faster-Whisper retry.

---

## 11. MODEL CONFIGURATION

| Param | Value | Class |
|-------|--------|--------|
| model | medium (local CT2) | ARCHITECTURE / FUTURE_MODEL_REPLACEMENT |
| device | cuda | ARCHITECTURE_REQUIRED |
| device_index | default | DEFAULT_UNVERIFIED |
| compute_type | int8_float16 | POTENTIAL_PERFORMANCE_SURFACE (quality risk) |
| CPU threads / OpenMP | unset | DEFAULT_UNVERIFIED |
| num_workers | 1 subprocess | EXPLICIT_AND_REASONABLE for isolation |
| beam_size | 1 | already greedy |
| best_of | unset/null | no unused n-best |
| temperature | 0 | EXPLICIT |
| patience | 1.0 | DEFAULT-ish |
| condition_on_previous_text | false (FW) | EXPLICIT |
| vad_filter | false | EXPLICIT |
| word_timestamps | true | REQUIRED_BY_FROZEN_ARCHITECTURE |
| language | Node `src_lang` (zh in dialog logs) | supplied |
| task | transcribe | REQUIRED |
| initial_prompt | off on FW | EXPLICIT |

---

## 12. SEARCH / BEAM COST

- **Mode:** greedy-equivalent **`beam_size=1`**, **`temperature=0`**, no `best_of`.  
- Lingua consumes: **top-1 text + segments + word timestamps + tone** (not n-best lists).  
- **POTENTIAL_UNUSED_COMPUTE (beam/n-best):** **NO** on current FW path.  
- Do **not** reduce further without decision (already minimal search).

---

## 13. WORD TIMESTAMP COST

- **Enabled:** yes.  
- **Cost separately measurable:** no.  
- **Consumers:** Tone module (Python, pre-dedup); Node `tone-time-align.ts` / FineSpan / Recall; JobResult segments.  
- **Class:** **REQUIRED_BY_FROZEN_ARCHITECTURE**. Disabling is **not** a safe optimization.

---

## 14. LANGUAGE DETECTION

- Dialog / FW path supplies **`src_lang=zh`** → worker `language=zh`.  
- Automatic LID inside Whisper when language is `None` / auto — **avoided** when lang known.  
- Separate Node LID engine exists for `auto` + candidates — different owner.  
- Redundant FW LID when lang known: **not observed** on dialog logs.  
- **SAFE_OPTIMIZATION_CANDIDATE** only if any path still omits `language` while upstream already knows it — **not proven** on current FW dialog path.

---

## 15. AUDIO LENGTH / RTF

From recent service log cohorts (not full dialog_200 recompute):

| Metric | p50 | p95 | max |
|--------|-----|-----|-----|
| Audio into ASR (warning cohort) | **4.0 s** | **5.92 s** | **7.72 s** |
| `perform_asr` RTF | **0.32** | **3.53** | **4.11** |
| `list(segments)` | **0.92 s** | **6.81 s** | **9.29 s** |

Interpretation: **~1 s model work on ~4 s audio** is a different regime than **3.5 s residual on 1 s audio**. p95 RTF is **queue/contention polluted**, not steady-state model RTF.

---

## 16. CHUNK / PRE-ASR WAIT

| Owner | Role |
|-------|------|
| Web stream chunks | Live path |
| Scheduler / aggregator | Buffer until cut/timeout |
| Node energy segmentation | May split before ASR |
| ASR Silero VAD | Trim/concat speech regions |
| Faster-Whisper | Non-streaming full utterance API |

**LATENCY_BEFORE_ASR_REQUEST** (aggregator hold) vs **ASR_PROCESSING_LATENCY** are **not separated** in the production timing dump. User policy: non-streaming ASR retained for quality — no streaming redesign in this phase.

---

## 17. QUEUE / WORKERS

- **`QUEUE_MAX = 1`**, **one** worker process, serial `transcribe`.  
- **QUEUE_WAIT_MS:** **NOT_MEASURABLE** alone; multi-batch and concurrent jobs **serialize**.  
- If multi-batch is common, queue wait is **ORCHESTRATION_COST**. Do not add concurrency in this phase.

---

## 18. CPU/GPU PLACEMENT

| Item | Evidence |
|------|----------|
| Configured device | **cuda** |
| Silent CPU fallback | **Blocked** by startup policy (exit on GPU failure) |
| VAD | CUDA EP required; `TONE_P10_VAD_CPU=1` is **test-only** |
| Live `/health` at audit time | **Service down** (connection failed) — config from code + historical/recent logs |
| VRAM | Dual main+worker model residency **suspected**; not measured with nvidia-smi this audit |

**No evidence of unexpected steady-state CPU ASR** in recent pcm16/zh dialog logs.

Thread knobs: **DEFAULT_UNVERIFIED** (not set). Not classified oversubscribed/underutilized without hardware counters.

---

## 19. RESPONSE PAYLOAD

| Field | Consumer class |
|-------|----------------|
| text | CONSUMED (FW / JobResult) |
| segments (+ start/end) | CONSUMED |
| words (+ start/end/prob) | CONSUMED (Tone / align) |
| language / language_probability(ies) | CONSUMED (contracts / repair meta) |
| tone / acousticToneSlices / evidenceProduction | CONSUMED |
| diagnostics (asr_latency_ms, toneModule, …) | TRACE + some SSOT |
| avg_logprob / compression_ratio / no_speech_prob | mostly TRACE / quality gates |

No proven large **UNUSED** blob with measured serialize cost. Simplification requires consumer freeze — **do not remove yet**.

---

## 20. LOGGING

- Hot path: many **INFO** lines per utterance (params, full text repr/bytes, VAD details, segment dumps).  
- **Sync `FileHandler`** → multi-hundred-MB log.  
- Class: mix of **PRODUCTION_REQUIRED** (errors) and **POTENTIAL_IO_REDUNDANCY** (verbose success dumps).  
- Do not strip in this phase; measure if pursuing.

---

## 21. CONSUMER CONTRACTS

Must preserve: raw ASR text ownership, word timestamps, Tone alignment, FW postprocess, FineSpan, Domain Vote, Model2/3, Retry, Assembly, KenLM, JobResult.

Any change that alters batch boundaries, timestamps, or text semantics → **ARCHITECTURE_CHANGE_REQUIRED**.

---

## 22. USER-CONTROLLABLE OPTIMIZATIONS

### A — LINGUA_SAFE_OPTIMIZATION

1. **Decouple VAD load from WhisperModel in `models.py`** — remove unused main-process ASR weights.  
2. **Reduce hot-path success logging** (after measure).  
3. **Harness:** skip WAV→Opus when measuring ASR (send pcm16) — measurement hygiene only.

### B — LINGUA_CONFIG_TUNING_WITH_QUALITY_RISK

1. **Energy-split thresholds / single-batch complete utterances** — largest candidate.  
2. `compute_type`, VAD thresholds, silence trim aggressiveness.  
3. Not beam (already 1).

### C — UPSTREAM_MODEL_LIMITATION

- `list(segments)` / CT2 inference dominates **within** a call at ~0.9 s p50 for ~4 s audio.

### D — HARDWARE_LIMITATION

- Single GPU serial worker; VRAM pressure if dual model resident — **not quantified**.

### E — NOT_PROVEN

- Exact IPC/VAD/Tone ms shares; queue wait ms; logging ms; silent CPU fallback on current box.

---

## 23. UPSTREAM MODEL LIMITATIONS

- Medium + `int8_float16` + word timestamps + CUDA is already a **performance-oriented** Lingua config.  
- Further latency without quality loss likely needs **upstream/model replacement evaluation**, not CT2 patches.  
- Forbidden here: FW/CT2 patches, custom kernels, retrain, quantization implementation beyond existing `compute_type` env.

---

## 24. VALUE / RISK MATRIX

| Candidate | Bounded saving | Complexity | Quality risk | Arch risk | Value |
|-----------|----------------|------------|--------------|-----------|-------|
| Multi-batch → fewer ASR calls | Up to ~1× extra call (~0.5–2+ s) on ~34% jobs | Med | **Yes** (boundaries) | Possible | **MEDIUM–HIGH** |
| Unload main WhisperModel | Startup/VRAM; utt **unproven** | Low | Low | Low | **MEDIUM (startup)** / **LOW (utt)** |
| Logging trim | Unknown ms | Low | None if levels only | Low | **LOW** |
| compute_type change | Unknown | Low | **Yes** | Low | **DECISION** |
| Disable word_timestamps | Possibly material | Low | **Breaks Tone/FW** | **High** | **NOT_WORTH / FORBIDDEN without redesign** |
| Beam reduce | ~0 (already 1) | — | — | — | **NOT_WORTH** |

---

## 25. DECISION_REQUIRED_BEFORE_OPTIMIZATION

| Item | Required? |
|------|-----------|
| Energy-split / batch policy | **REQUIRED** |
| compute_type / VAD semantics / language policy changes | **REQUIRED** |
| word_timestamps off | **REQUIRED** (effectively reject without arch change) |
| models.py VAD-only split | **EMPTY** (semantics-preserving if worker unchanged) |
| Logging level on success path | **EMPTY** |

---

## 26. TARGET LIST

1. Add boundary timers (T0–T10 minimal set) into timing dump.  
2. Quantify **multi-batch delta**: same dialog_200 with `outputSegmentCount` × per-call `list` ms.  
3. Optional safe: split `models.py` VAD vs Whisper load.  
4. **No** beam/model/CT2 work unless decision + quality gate.

---

## 27. CHECK LIST

- [x] Production ASR owner = `faster-whisper-vad`  
- [x] Black-box boundary defined  
- [x] `MODEL_LOAD_PER_UTTERANCE = NO`  
- [x] Call count / multi-batch owner identified  
- [x] Config inventory from `service.json` + code + logs  
- [x] Prior 57.4% marked non-pure-FW  
- [x] RTF / list(segments) from logs (cohort-limited)  
- [x] Consumers of timestamps traced  
- [x] No production/model changes  
- [ ] Full T0–T10 numeric breakdown — **deferred**  
- [ ] nvidia-smi dual-model VRAM proof — **deferred** (service down at audit)

---

## 28. NEXT PHASE

**`ASR_BOUNDARY_TIMER_ISOLATION_AND_MULTI_BATCH_COST_QUANTIFICATION`**

Goal: prove how much of the ~3489 ms residual is (a) black-box `list(segments)`, (b) second energy-split call, (c) VAD/Tone/HTTP/Node.  
Only then choose: safe A fixes, decision-gated B, or **no ASR engineering** (`ASR_INTEGRATION_ALREADY_EFFICIENT` / upstream model track).

---

## FINAL QUESTION (explicit)

**Without changing Faster-Whisper/CTranslate2/model internals, what meaningful latency can Lingua itself remove?**

| Bucket | Finding |
|--------|---------|
| **Lingua-controlled waste** | Multi-batch energy-split ASR (~34% ×2 HTTP+inference); unused main WhisperModel (startup/VRAM); possible verbose log IO |
| **Config tuning w/ quality risk** | Split thresholds, compute_type, VAD params — **decision required** |
| **Upstream model inference** | ~0.9 s p50 `list(segments)` per call on ~4 s audio — **dominant inside each call** |
| **Hardware** | Serial single GPU worker; dual residency unmeasured |

**If restricting to safe, semantics-identical changes only:** do **not** expect multi-second utterance wins; **recommend no blind ASR latency engineering** until multi-batch cost is quantified. The medium-value surface that *does* exist is **orchestration (energy-split batches)**, not Faster-Whisper internals.
