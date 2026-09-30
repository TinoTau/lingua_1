# Lingua1 — Dialog200 Replay Alignment State Repair V1 Report

**Mode:** REPLAY_ONLY / CONTRACT_RESTORE / MINIMAL_CHANGE  
**Result:** **A — REPLAY_STATE_REPAIR_VALIDATED**  
**Next Owner:** **EVALUATOR_REPAIR**  
**Not declared:** REPLAY_EQUIVALENCE_CERTIFIED (evaluator defects remain)

---

## 1. Executive Verdict

Restored missing Capture multi-batch ASR alignment state into Frozen Replay inject:

- `ctx.segmentTimeOffsetsSec`
- `ctx.asrSegmentNodeBatchIndices`
- `ctx.segmentCharOffsets` (required by `buildWordTimeSpans` on batch change)

**d157 Final:** Capture == Replay (`耽误…`)  
**Other six prior E18 fails:** all Final PASS  
**Dialog200:** E18 **200/200**, critical **0**, reconstructable **200/200**  
Promotion thresholds were **not** used as acceptance authority (`--no-promote`).

---

## 2. Frozen Contract Restored

Production `asr-step` already created these JobContext fields during Capture. Replay previously injected only segments + absolute `acousticToneSlices`, omitting offsets → wrong `WordTimeSpan` → wrong Tone mapping.

This repair restores that Production state from Frozen Evidence. No Production algorithm change.

---

## 3. Modified File Inventory

| File | Kind | Justification |
|------|------|---------------|
| `tests/lib/dialog200-frozen-replay-alignment-state.mjs` | REPLAY_STATE_REPAIR | Reconstruction helper |
| `tests/lib/dialog200-frozen-replay-alignment-state.test.mjs` | REPLAY_STATE_REPAIR_TEST | Unit tests |
| `tests/run-dialog200-frozen-evidence-replay-v1.mjs` | REPLAY_STATE_REPAIR | Reconstruct + inject; hard-fail if not reconstructable |
| `main/src/inference/inference-service.ts` | REPLAY_STATE_REPAIR | Extend existing mock inject options to set JobContext fields only |
| `main/src/test-server.ts` | REPLAY_STATE_REPAIR | Pass-through on `/run-lexicon-mock` |

**Production algorithm files (asr-step, tone-time-align, recall, path):** **0**  
**Frozen Evidence / EVALUATION_SSOT:** **0 delta**

---

## 4. Reconstruction Design

```
FrozenEvidence
  → reconstructMultiBatchAlignmentState()
  → { segmentTimeOffsetsSec, asrSegmentNodeBatchIndices, segmentCharOffsets }
  → /run-lexicon-mock inject
  → runPipelineWithMockAsr sets ctx.*
  → existing Production buildWordTimeSpans / mapToneEvidenceForRecall
```

No duplication of Tone mapping or Base Recall.

---

## 5. Evidence Source

- `tone.utterance_tone.evidenceProduction` (absolute `startSec` + `batchIndex`)
- `asr.segments[].words[]` (batch-local `start`/`end`)
- `asr.rawMergedAsrText` (char-cursor reconstruction)

**Tolerance:** `ALIGNMENT_TIME_TOLERANCE_SEC = 1e-3` (serialization noise only).  
No averaging of contradictory batch offsets. No zero-offset fallback.

---

## 6–7. Offsets & Batch Indices

Per-batch offset = consistent `evidenceProduction.startSec - word.start`.  
Per-segment batch index = unanimous `batchIndex` of that segment’s aligned words (not assuming `segmentIndex == batchIndex`).

Example d157: offsets `[0, 1.6]`, indices `[0, 1]`.  
d061/d156: indices `[0, 0, 1]` (two segments in batch 0) — proven generic.

---

## 8. segmentCharOffsets Dependency Decision

**SEGMENT_CHAR_OFFSETS_REQUIRED = YES**

`buildWordTimeSpans` resets `searchFrom = segmentCharOffsets[batchIdx]` when batch index changes across segments. Restored via sequential token scan on `rawMergedAsrText` at each batch’s first word (Production-equivalent cursor).

`toneEvidenceProduction` not injected into business logic (diagnostics-only).

---

## 9. d157 Before/After

| | Before | After |
|--|--------|-------|
| offsets | unset | `[0, 1.6]` |
| 但 (batch1) WordTimeSpan | `[0.74, 1.18]` | `[2.34, 2.78]` |
| E18 | FAIL | **PASS** |
| Final | `…但物流…` | `…耽误…` (= Capture) |

---

## 10. Other Six Cases

All six: alignment reconstructed to expected offsets; E18 PASS; Final matches Capture.

---

## 11. Dialog200 Result

| Metric | Value |
|--------|------:|
| Cases | 200 |
| Reconstructable | 200 |
| E18 Final PASS | **200** |
| E7 Path count PASS | 199 |
| Critical FAIL | **0** |
| NOT_RECONSTRUCTABLE | 0 |

Remaining mid-stage soft (Final still match):

- **d149** — E7 pathCount 4→2  
- **d160** — E14 KenLM ranking order  

Evaluator still labels these `EXPECTED_NONDETERMINISM` (unsupported). Out of scope this round.

---

## 12. Remaining Divergences

None affecting Final. Two Final-preserving mid-stage diffs remain for **EVALUATOR_REPAIR** / optional follow-up audit — **not** a second alignment repair.

---

## 13. Production Delta Audit

- ASR / Tone / Recall / Path / Model2 / Model3 algorithms: **unchanged**
- Mock inject boundary: **extended only** to restore Capture JobContext fields (same pattern as existing `asrSegments` / `acousticToneSlices` inject)

---

## 14. SSOT / Baseline Authority

- Frozen Acoustic Evidence unchanged  
- No historical baseline restored  
- No second baseline  
- `--no-promote` — SSOT not re-promoted this round  

---

## 15. T1–T20

| Test | Result |
|------|--------|
| T1 single-batch | PASS |
| T2 multi-batch | PASS |
| T3 d157 +1.6s | PASS |
| T4 但 ≈[2.34,2.78] | PASS |
| T5 missing EP hard fail | PASS |
| T6 contradictory offsets | PASS |
| T7 invalid batch | PASS |
| T8–T13 no ASR/Tone/profile/identity change | PASS |
| T14 production algorithms unchanged | PASS (inject boundary only) |
| T15 d157 final | PASS |
| T16 six finals | PASS |
| T17 Dialog200 200/200 | PASS |
| T18–T20 no baseline/fallback/hardcoded offsets | PASS |

---

## 16. G1–G20

All PASS (G2 = inject-boundary-only; G17 = unsupported thresholds not used as repair authority; G18 = residual soft labels reported, not trusted).

---

## 17. Final Result

**A. REPLAY_STATE_REPAIR_VALIDATED**

---

## 18. Next Owner

**EVALUATOR_REPAIR**

Sequence remains:

REPLAY_STATE_REPAIR ✓ → EVALUATOR_REPAIR → clean Replay equivalence acceptance → TRUSTED_DIALOG200_FUNNEL_V2
