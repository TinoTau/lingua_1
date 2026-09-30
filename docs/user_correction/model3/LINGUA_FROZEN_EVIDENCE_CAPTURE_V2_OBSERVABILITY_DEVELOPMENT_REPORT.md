# Lingua1 — Frozen Evidence Capture V2 Observability Development Report

```
RESULT_ENUM = A — CAPTURE_V2_OBSERVABILITY_IMPLEMENTATION_VALIDATED
NEXT_OWNER = DIALOG200_CAPTURE_V2_EXECUTION
CAPTURE_V2_OBSERVABILITY_IMPLEMENTED = YES
B1_B18_MANDATORY_BOUNDARIES_COMPLETE = YES
PRODUCTION_ALGORITHM_CHANGED = NO
OBSERVABILITY_ONLY_PRODUCTION_FILES_TOUCHED = 8
CAPTURE_GATE_DEFAULT_OFF = YES
OFF_ON_FINAL_PARITY = PASS
OFF_ON_DECISION_PARITY = PASS
AUTHORITATIVE_TRUNCATION_PRESENT = NO
COMPLETENESS_VALIDATOR_READY = YES
SMALL_PROBE_CASE_COUNT = 5
SMALL_PROBE_COMPLETE = YES
OFFICIAL_DIALOG200_CAPTURE_V2_EXECUTED = NO
CURRENT_BASELINE_REPLACED = NO
REPLAY_EQUIVALENCE_CERTIFIED = NO
TRUSTED_DIALOG200_FUNNEL_V2 = BLOCKED
```

---

## 1. Summary

Implemented Capture V2 observability per frozen SSOT:

- Gate `FROZEN_EVIDENCE_CAPTURE_V2=1` (default OFF)
- Case-scoped `CaptureV2Collector` (AsyncLocalStorage)
- Canonical serializer + float policy
- Completeness validator → `COMPLETE` / `CAPTURE_INCOMPLETE`
- OBSERVABILITY_ONLY hooks for B1–B18
- Contract tests + 5-scenario development probe (synthetic; **not** CANDIDATE_CAPTURE_V2)

No Production algorithm/decision changes. SSOT / baseline / evaluator / Replay unchanged.

---

## 2. Modified File Inventory

### NEW_CAPTURE_INFRASTRUCTURE

| Path | Role |
|------|------|
| `main/src/capture-v2/gate.ts` | Env gate |
| `main/src/capture-v2/float-policy.ts` | FLOAT_TIME 0.001 / KenLM 1e-6 |
| `main/src/capture-v2/serialize.ts` | snapshot + hash |
| `main/src/capture-v2/types.ts` | Schema types |
| `main/src/capture-v2/collector.ts` | Case-scoped sink; B17 by_path merge |
| `main/src/capture-v2/completeness.ts` | Completeness validator |
| `main/src/capture-v2/index.ts` | Public API |
| `main/src/capture-v2/capture-v2.contract.test.ts` | T1–T40 |
| `tests/run-capture-v2-observability-dev-probe.mjs` | Dev probe runner |

### OBSERVABILITY_ONLY_HOOK (Production)

| File | Boundaries | Mutation? | Decision branch? |
|------|------------|-----------|------------------|
| `fw-detector-orchestrator.ts` | B1 + begin case | NO | NO |
| `span-assembly-v4-orchestrator.ts` | B2 B3 B5 B15 | NO | NO |
| `recall-topk-for-windows.ts` | B4 B7 B8 B9 | NO | NO |
| `lattice-fine-span-runtime.ts` | B6 B10–B14 | NO | NO |
| `fw-detector-v4-path.ts` | B16 B18 | NO | NO |
| `run-model3-path-step.ts` | B17 | NO | NO |
| `result-builder-core.ts` | finalize → `extra.frozen_evidence_capture_v2` | NO | NO |
| `expand-windows-with-model2.ts` | path_trace when Capture ON; untruncated union for B11 | NO | NO |

---

## 3. Production Change Audit

All Production edits:

1. Guarded by `isFrozenEvidenceCaptureV2Enabled()` (except expand: also builds `path_trace` diagnostic when Capture ON — **diagnostic only**, same candidate arrays / inference path).
2. Snapshot/copy only via `captureV2Boundary` / `snapshotCopy`.
3. No SQL/ORDER BY/threshold/path-cap/Model changes.
4. JobResult: only optional namespaced `extra.frozen_evidence_capture_v2` when gate ON; absent when OFF; no core schema change; no Production consumer reads it for decisions.

OFF/ON parity (unit):

- Gate OFF → hooks no-op; `finalizeCaptureV2Case()` = null.
- Production return values of recall/path/Model2 expand unchanged by capture branch (capture appends diagnostics only).

---

## 4. B1–B18 Conformance

See `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_CONFORMANCE.json`.

**All 18 mandatory boundaries: IMPLEMENTED.** Blocked: 0.

Notable:

- B5 forces `field_name: "finespans"`
- B7 uses Production `serializeCanonicalRecallQueryKey`
- B9 untruncated occurrence_list
- B11 Capture ON uses untruncated `compactCandidate` list (not `DIALOG200_CANDIDATE_CAP`)
- B17 merges multi-path `by_path`

---

## 5. Test Results

`LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_TEST_RESULTS.json`

- Jest `capture-v2.contract`: **21 passed, 0 failed**
- Includes T40 five-scenario synthetic probe
- `tsc --noEmit` clean after hook fixes

---

## 6. Small Development Probe

| Item | Value |
|------|--------|
| Kind | DEVELOPMENT_PROBE (synthetic) |
| Cases | 5 (single-batch, multi-batch, script-norm, multipath, kenlm/model3 shell) |
| Completeness | COMPLETE each |
| Official Dialog200 Capture V2 | **NO** |
| Named CANDIDATE_CAPTURE_V2 | **NO** |

Live WAV/Dialog200 probe deferred to **DIALOG200_CAPTURE_V2_EXECUTION**.

---

## 7. Remaining Gaps (non-blocking for Result A)

- Live multi-case OFF/ON pipeline parity on full Electron Dialog200 path not executed this round (unit-level PASS).
- B10 WindowEvidence fullness depends on Model2 expand running; when Model2 unavailable, B10 records explicit null/unavailable summary (contract-valid).

---

## 8. Result / Next Owner

**RESULT_ENUM = A — CAPTURE_V2_OBSERVABILITY_IMPLEMENTATION_VALIDATED**  
**NEXT_OWNER = DIALOG200_CAPTURE_V2_EXECUTION**

Funnel remains **BLOCKED**. Baseline unchanged. Frozen Capture Contract V2 SSOT unchanged.
