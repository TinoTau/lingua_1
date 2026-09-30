# Lingua1 — Capture V2 Phase A Live Parity Controlled-Boundary Audit

**Mode:** READ-ONLY AUDIT / TEST–EVALUATOR HARNESS AUDIT  
**Date:** 2026-09-25  
**Subject run:** `dialog200_capture_v2_20260925002556`  
**Code change:** NONE  

---

## Executive Result

```text
RESULT_ENUM =
A — PHASE_A_HARNESS_CONTROL_BOUNDARY_DEFECT_CONFIRMED

NEXT_OWNER =
CAPTURE_V2_PHASE_A_HARNESS_REPAIR

CURRENT_PHASE_A_SINGLE_VARIABLE_EXPERIMENT_VALID = NO

MINIMUM_CONTROLLED_BOUNDARY =
post-ASR JobContext pin
(rawAsrText + segments(+words/timestamps)
 + segmentTimeOffsetsSec
 + asrSegmentNodeBatchIndices
 + segmentCharOffsets
 + acousticToneSlices)
then OFF/ON fork only for Capture-gated FW post-processing

PRODUCTION_CHANGE_REQUIRED = NO

FAILURE_CLASS =
TEST / EVALUATOR DEFECT
(primary: uncontrolled upstream ASR/segmentation/Tone re-execution)
```

**One-line answer to the core question:**  
Before Capture gate is the only variable, OFF and ON **already differ** — both arms re-run full WAV→VAD→ASR→Tone; first observable divergence is at ASR-produced evidence (`rawAsrText` and/or `segments` timing), **before** any Capture hook that can snapshot Production state.

AcousticToneSlices persistence is **out of scope to reopen** — Phase A ON already produced non-zero slices (16–31) with `COMPLETE` on all 8 preflight cases.

---

## 1. Current Phase A Real Call Graph

Entry:

`electron_node/electron-node/tests/run-dialog200-frozen-evidence-capture-v2.mjs`  
→ `main()` → `runPhaseA(port, casesById, meta)` (~L866)

### Shared outer structure

1. `startServer(port, captureOn, { keepAsr })` (~L414)  
   - sets `FROZEN_EVIDENCE_CAPTURE_V2` via `buildServerEnv` (~L366)  
   - spawns `tests/repro/start-node-detached.mjs`  
2. `waitAsrReady` / `healthBundle`  
3. Per case: `runCaseResilient` → `runCaseWithRetry` → `runCase` (~L455)  
4. `POST http://127.0.0.1:${port}/run-pipeline-with-audio`  
5. `main/src/test-server.ts` (~L64–358) → `InferenceService.runPipelineWithAudio`  
6. `main/src/inference/inference-service.ts` `runPipelineWithAudio` (~L417)  
7. `runJobPipeline` / `pipeline-step-registry` → **`runAsrStep`** then **FW detector step**  
8. Response → harness `extractDecisionFingerprint` / `compareFingerprints` (~L174, ~L299)

---

## 2. OFF Execution Trace

```text
runPhaseA
  startServer(port, false, { keepAsr: false })     // Capture OFF; kill ASR+node cold start
  waitAsrReady(warmupWav)
  for each preflight case:
    runCaseResilient('OFF', c)
      runCase(port, wavAbs, jobId)
        POST /run-pipeline-with-audio { wavPath, sessionId, is_manual_cut:true, ... }
          test-server.ts → inferenceService.runPipelineWithAudio(wavPath, ...)
            WAV read → Opus → processJob / runJobPipeline
              pipeline-step-registry → runAsrStep (asr-step.ts)
                VAD/audio segments
                ASR HTTP (faster-whisper-vad :6007) per batch
                Tone slices from asrResult.tone.acousticToneSlices → ctx.acousticToneSlices
                segmentTimeOffsetsSec / segmentCharOffsets / asrSegmentNodeBatchIndices filled
              fw-detector-step.ts → runFwDetectorOrchestrator (fw-detector-orchestrator.ts)
                // Capture OFF: beginCaptureV2Case / captureV2Boundary = no-op (gate.ts)
                normalizeForFwRepairInput
                runFwDetectorV4Path → span-assembly / recall / Model2 / Domain / KenLM / Model3 ...
              result-builder-core.ts → JobResult (no capture artifact)
    buildCaseRow(..., captureOn=false) → decision_fingerprint
  [all OFF cases complete]
```

**Invariant:** each OFF case is a **full independent Production execution** of the same WAV.

---

## 3. ON Execution Trace

```text
runPhaseA (continued)
  startServer(port, true, { keepAsr: true })       // Capture ON; node restart; ASR process kept
  waitAsrReady(warmupWav)                          // may re-warmup pipeline
  for each preflight case:
    runCaseResilient('ON', c)
      runCase(...)  // SAME entry as OFF — another full WAV pipeline
        runAsrStep AGAIN (ASR + Tone AGAIN)
        runFwDetectorOrchestrator
          beginCaptureV2Case (collector.ts)          // FIRST Capture side-channel activation
          captureV2Boundary('B1', ...)               // after ASR already finished
          runFwDetectorV4Path
            span-assembly-v4-orchestrator.ts
              buildWordTimeSpans(...)
              captureV2Boundary('B2'|'B3'|'B4')      // B4.acousticToneSlices snapshot
              ... FineSpan / paths ...
            recall-topk-for-windows.ts
              captureV2Boundary('B4' merge windows, B7–B9, ...)
            ... Model2 / LexicalEdge / Domain / KenLM / Model3 ...
            fw-detector-v4-path.ts → B16/B18
          result-builder-core.ts → finalizeCaptureV2Case() attach artifact
    buildCaseRow(..., captureOn=true)
  comparator: upstream pin = (rawAsrText equal AND segmentsEvidenceHash equal)
               else LIVE_PARITY_NOT_PROVEN
```

**Invariant:** each ON case is also a **full independent Production execution**.  
`keepAsr:true` only avoids killing the ASR **process**; it does **not** pin ASR outputs between OFF and ON.

---

## 4. Capture Hook Locations (temporal)

| Order | File | Function | Stage | Gate |
|------:|------|----------|-------|------|
| 0 | `asr-step.ts` | `runAsrStep` | ASR+Tone into `ctx` | **No Capture** — always runs |
| 1 | `fw-detector-orchestrator.ts` L80–86 | `beginCaptureV2Case` / `captureV2Identity` | FW entry | ON only |
| 2 | `fw-detector-orchestrator.ts` L183–193 | `captureV2Boundary('B1')` | post-normalize, pre-V4 | ON only |
| 3 | `span-assembly-v4-orchestrator.ts` L294–327 | `captureV2Boundary('B2'|'B3'|'B4')` | post-`buildWordTimeSpans` | ON only |
| 4 | `recall-topk-for-windows.ts` ~L659+ | B4 merge / B7–B9 | recall | ON only |
| 5 | `fw-detector-v4-path.ts` ~L324/345 | B16/B18 | late | ON only |
| 6 | `result-builder-core.ts` | `finalizeCaptureV2Case` | JobResult attach | ON only |

Gate implementation: `capture-v2/gate.ts` `isFrozenEvidenceCaptureV2Enabled()` — env `FROZEN_EVIDENCE_CAPTURE_V2==='1'`.

Collector (`collector.ts` `captureV2Boundary`): `snapshotCopy` deep copy into AsyncLocalStorage; **documented Contract rule: Production must never read collector state**. No return value into Production algorithms. Merge special-cases B4/B17 are collector-local only.

---

## 5. Upstream Re-execution Matrix (Q1–Q10)

| Q | Question | Answer | Evidence |
|---|----------|--------|----------|
| Q1 | OFF/ON each full WAV pipeline? | **YES** | Two loops; each `runCase` → `runPipelineWithAudio` |
| Q2 | ASR re-called both arms? | **YES** | `runAsrStep` every case both arms |
| Q3 | VAD/segmentation re-run? | **YES** | Inside `runAsrStep` audio segment loop |
| Q4 | Tone inference re-run? | **YES** | `asrResult.tone.acousticToneSlices` pushed each ASR batch |
| Q5 | Word timestamps regenerated? | **YES** | From ASR `segments.words` + later `buildWordTimeSpans` |
| Q6 | `segmentTimeOffsetsSec` regenerated? | **YES** | `asr-step.ts` L193–194 |
| Q7 | `asrSegmentNodeBatchIndices` regenerated? | **YES** | filled in `runAsrStep` |
| Q8 | `segmentCharOffsets` regenerated? | **YES** | `asr-step.ts` |
| Q9 | `rawAsrText` from two ASR executions? | **YES** | Independent ASR HTTP calls |
| Q10 | Why 8/8 `segmentsEvidenceHash` OFF≠ON? | **First causal source = ASR segment evidence producer** (`runAsrStep` / faster-whisper segments+word times), hashed in harness `extractDecisionFingerprint` (~L265–279) from response `data.segments` | Always differs in this run; occurs **before** Capture B1 |

---

## 6. Representative Case First-Divergence Analysis

Harness upstream pin: `asrEqual && segmentsEqual` (`runPhaseA` L1020–1024).  
Fingerprint segments hash = canonicalHash of `{text,start,end,words[{word,start,end}]}` from **pipeline response segments**, not Capture artifact.

### d001 (ASR + segment differ)

| Field | Value |
|-------|--------|
| first_divergent_field | `rawAsrText` (钟貝 vs 中貝) |
| OFF | `...熱拿鐵鐘貝少糖...` |
| ON | `...熱拿鐵中貝少糖...` |
| producer | `runAsrStep` / ASR service |
| producer_file | `pipeline/steps/asr-step.ts` |
| Capture hook before divergence? | **NO** |
| CAPTURE_CAUSALITY | **NOT_POSSIBLE_AT_THIS_BOUNDARY** |
| classification | Upstream ASR nondeterminism |

Final diffs (钟贝 vs 中贝) are **downstream of that ASR text delta**, not proof of Capture observer effect.

### d002 (ASR text same; segment hash differs; final differs)

| Field | Value |
|-------|--------|
| first_divergent_field | `segmentsEvidenceHash` (asr_eq=true, seg_eq=false) |
| OFF final | `...美式带走大背...` |
| ON final | `...时代大背...` |
| producer of first divergence | ASR word/segment **timing** (same text, different start/end/words) via `runAsrStep` |
| Capture hook before divergence? | **NO** |
| CAPTURE_CAUSALITY | **NOT_POSSIBLE_AT_THIS_BOUNDARY** for the first divergence |
| classification | Upstream timestamp/segmentation nondeterminism → can change WTS / Tone bind / Base → “美式带走” vs “时代” |

Cannot attribute final delta to Capture until segments(+tone) are pinned.

### d010 (ASR same; segment differs; final same; decision_diffs=[])

| Field | Value |
|-------|--------|
| first_divergent_field | `segmentsEvidenceHash` |
| final_equal | true |
| Capture causality | **NOT_POSSIBLE** at first divergence |
| classification | Harness marks **NOT_PROVEN** solely because upstream pin failed — even though semantic fingerprint matched |

Proves current harness conflates “upstream not controlled” with “parity not shown”, without claiming observer effect (`OBSERVER_EFFECT_DETECTED=UNKNOWN`).

### d149 (ASR + segment differ)

| Field | Value |
|-------|--------|
| first_divergent_field | `rawAsrText` (麻麻 vs 码码 + punctuation) |
| producer | `runAsrStep` / ASR |
| CAPTURE_CAUSALITY | **NOT_POSSIBLE_AT_THIS_BOUNDARY** |

---

## 7. Capture Causality Analysis

```text
ASR + Tone + alignment materialization
        ↓  (divergence already possible here)
beginCaptureV2Case / B1 snapshot   ← earliest Capture side-channel
        ↓
B2/B3/B4 … B18
```

For all 8/8 cases in run `…002556`, first comparator-visible upstream pin failure is **ASR-side** (`rawAsrText` and/or segment timing hash).

Therefore:

- Capture cannot cause the **first** divergence.  
- Final OFF≠ON when ASR text already differs is expected contamination.  
- Final OFF≠ON when only segment times differ (d002) is **consistent with** timing-sensitive downstream, still **not** Capture-proven.  
- d010 shows segment hash noise can exist with **identical** finals — reinforcing that the experiment is not single-variable.

Code-level Capture hooks appear side-channel-only (snapshotCopy; no Production return path). This audit does **not** claim observer-effect absence in FW stages; it claims **current Phase A cannot prove** it.

---

## 8. Current Comparator Audit

| Field | Rule | Exact/hash | Purpose | Required for observer-effect proof? | Invalidated by upstream nondeterminism? |
|-------|------|------------|---------|--------------------------------------|----------------------------------------|
| rawAsrText | equality | exact | upstream pin | Prerequisite | YES |
| segmentsEvidenceHash | hash equality | exact hash of times+words | upstream pin | Prerequisite | YES (FLOAT_TIME noise) |
| P1 finalPostprocessText | equality | exact | decision | Only after pin | YES if upstream drifts |
| P2 base set | sorted set | exact | decision | After pin | YES |
| P3 model2 actions / after set | sorted set | exact | decision | After pin | YES |
| P5 path ids | sorted set | exact | decision | After pin | YES |
| P6 domain vote | stringify set | exact | decision | After pin | YES |
| P7 assembly | sorted set | exact | decision | After pin | YES |
| P8–P10 KenLM | set / string | exact | decision | After pin | YES |
| P11 Model3 | stringify set | exact | decision | After pin | YES |
| P12 final selection | equality | exact | decision | After pin | YES |
| capture artifact | not in decision compare | — | observability | NO (correctly excluded) | — |

**Not used for PASS:** percentage promotion, `EXPECTED_NONDETERMINISM`, stale/cross-run artifacts.  
**Harness behavior:** if pin fails → `LIVE_PARITY_NOT_PROVEN` (not `OBSERVER_EFFECT`). That classification is **directionally correct**; the defect is that the experiment **almost never reaches** a controlled pin under dual full-audio re-execution.

---

## 9. Phase A Invariant (from Frozen Contract + code)

Frozen Capture Contract V2 requires OFF vs ON **behavior** parity tests (observability must not change Production decisions).

Given current architecture, the meaningful Phase A invariant is:

> **Given identical Production state at the post-ASR / pre-FW boundary**  
> (identical `rawAsrText`, segments+word timings, alignment triples, and `acousticToneSlices`),  
> Production through FW post-processing with `FROZEN_EVIDENCE_CAPTURE_V2=0` vs `=1`  
> must yield identical semantic decision fingerprints (P1–P12 as currently defined),  
> with Capture collector state excluded from Production dependencies.

**boundary X = entry to `runFwDetectorOrchestrator` / post-`runAsrStep` JobContext**, not “shared WAV only”.

---

## 10. Controlled Boundary Classification

| State | Class | WHY / second variable if unpinned? |
|-------|-------|-------------------------------------|
| WAV file identity | A MUST PIN | Shared corpus input (already same path/sha in harness) |
| rawAsrText | A MUST PIN | Else ASR nondeterminism is second variable |
| segments + words + timestamps | A MUST PIN | Else FLOAT_TIME / segmentation noise; d002/d010 |
| segmentTimeOffsetsSec | A MUST PIN | Alignment / WTS |
| asrSegmentNodeBatchIndices | A MUST PIN | Alignment |
| segmentCharOffsets | A MUST PIN | Alignment |
| acousticToneSlices | A MUST PIN | Tone may re-diverge if re-inferred; Capture ON must observe real slices but arms must share them for parity |
| mapped Tone / toneNorm | B RECOMPUTE | Downstream of slices+WTS; should match if A pinned |
| FineSpan / WindowQuery / Base SQL / Model2 / LexicalEdge / paths | B RECOMPUTE | Subject under test for observer effect once A pinned |
| Capture artifact | C IRRELEVANT to decision parity | Must exist on ON; not compared as Production decision |
| Wall-clock / jobId / sessionId | C IRRELEVANT | Already excluded |
| Full second ASR+Tone from WAV | — FORBIDDEN as uncontrolled | Current Phase A defect |

---

## 11. Minimum Controlled Boundary Options

| Option | Control | Still polluted? | Detects Capture OE? | Degenerates to Replay V2? | Prod change? | Complexity | Contract fit |
|--------|---------|-----------------|---------------------|---------------------------|--------------|------------|--------------|
| **A** Shared WAV only (current) | Capture + all ASR/Tone | **YES** | NO | NO | NO | low | Fails Phase A purpose |
| **B** Pin ASR text+segments; Tone re-exec | Capture + Tone | Tone may still drift | Partial | NO | ideally NO | med | Incomplete |
| **C** Pin ASR+alignment; Tone re-exec | same as B | Tone drift | Partial | NO | ideally NO | med | Incomplete |
| **D** Pin ASR+alignment+**acousticToneSlices**; then OFF/ON FW | Capture gate only | Minimal | **YES** | NO (not frozen Replay certification; live OE test) | **NO** if harness/test-server fixture only | med–high | **Best match** |

### Recommended: **Option D**

`MINIMUM_CONTROLLED_BOUNDARY = post-ASR JobContext pin (rawAsrText + segments(+words/timestamps) + alignment triples + acousticToneSlices); OFF/ON diverge only on Capture gate for FW post-processing.`

**Phase A vs Replay V2:**  
- Phase A = controlled **live** experiment: same pinned upstream, Capture OFF vs ON, prove no decision dependency.  
- Replay V2 = later **frozen evidence** inject + recompute downstream under Replay Role Matrix.  
Do **not** reuse Replay harness; do **not** call Phase A “Replay”.

**Tone repeatability:** If Tone re-runs independently, slices may differ → must **share** `acousticToneSlices` for single-variable Capture test. Sharing via **test harness / test-server fixture injection** is preferred over Production semantic change.

---

## 12. Production Change Requirement

```text
PRODUCTION_CHANGE_REQUIRED = NO
```

Preferred next implementation surface:

- Phase A harness (+ optionally `test-server` test-only request fields), **not** ASR/Tone/FW algorithms.  
- Pattern: one authoritative upstream materialization (or recorded ASR+Tone response), then two Capture-gated post-ASR executions.

Only if a Production inject API is deemed mandatory would this flip to YES — **no such inevitability found in this audit**; test-server already exists solely for harness audio pipelines.

---

## 13. Failure Classification

```text
PRIMARY = TEST / EVALUATOR DEFECT
```

Evidence:

1. Dual full-audio re-execution by design (`runPhaseA` OFF loop then ON loop).  
2. 8/8 upstream pin failures; first divergence always ASR-side.  
3. d010: decisions match but still NOT_PROVEN.  
4. Capture hooks begin only in `runFwDetectorOrchestrator` after ASR.

Not classified as Production implementation defect or Capture Tone observability gap (slices already present on ON).

---

## 14. Exact Development Scope for Next Round

`NEXT_OWNER = CAPTURE_V2_PHASE_A_HARNESS_REPAIR`

In scope:

1. Redesign Phase A to pin Option D upstream state.  
2. Keep comparator’s “pin then compare P1–P12” logic.  
3. Keep Capture ON collecting real `acousticToneSlices` (from pinned Production slices, not mapped Tone reconstruction).  
4. Do not implement Replay V2; do not change Capture Contract / completeness validator / Production algorithms.

Out of scope:

- Official Dialog200 200 Capture  
- Baseline / funnel / accuracy / d149  
- Capture observability redesign  

---

## 15. Target List

| ID | Target |
|----|--------|
| T1 | Document dual full-pipeline OFF/ON in harness as invalid single-variable design |
| T2 | Define fixture schema for pinned post-ASR JobContext / ASR response |
| T3 | Phase A: materialize pin once per case (or once per wav) |
| T4 | Phase A: run Capture OFF vs ON only after pin |
| T5 | Preserve segmentsEvidenceHash + rawAsrText as hard pin (or replace with explicit pin record) |
| T6 | Ensure ON still emits Capture artifact with B4 slices from pinned slices |
| T7 | Re-run Phase A; require PASS before Phase B |
| T8 | Explicitly label Phase A ≠ Replay V2 in harness comments/report |

---

## 16. Check List

- [ ] CURRENT_PHASE_A_SINGLE_VARIABLE_EXPERIMENT_VALID = NO (confirmed)  
- [ ] FIRST DIVERGENCE producer identified (ASR / `runAsrStep`)  
- [ ] Capture hook order after ASR confirmed  
- [ ] MINIMUM_CONTROLLED_BOUNDARY = Option D stated  
- [ ] PRODUCTION_CHANGE_REQUIRED = NO  
- [ ] Tone slice capture not reopened  
- [ ] No code modified this round  
- [ ] No Replay / baseline / Production algorithm change  

---

## 17. Result Enum (final)

```text
A — PHASE_A_HARNESS_CONTROL_BOUNDARY_DEFECT_CONFIRMED

NEXT_OWNER =
CAPTURE_V2_PHASE_A_HARNESS_REPAIR

CURRENT_PHASE_A_SINGLE_VARIABLE_EXPERIMENT_VALID = NO
MINIMUM_CONTROLLED_BOUNDARY = post-ASR JobContext pin
  (rawAsrText + segments(+words/timestamps)
   + segmentTimeOffsetsSec + asrSegmentNodeBatchIndices + segmentCharOffsets
   + acousticToneSlices)
  → Capture OFF/ON fork for FW post-processing only
PRODUCTION_CHANGE_REQUIRED = NO
```
