# Lingua1 — d157 Frozen Replay Upstream Boundary Trace Audit V1

**Mode:** READ_ONLY / TRACE_FIRST / CONTRACT_FIRST / SINGLE_CASE_PROBE  
**Case:** d157  
**No implementation / production / replay / evaluator / SSOT / capture changes.**

---

## 1. Executive Verdict

**TRUE_FIRST_DIVERGENCE** is not E6/E3 comparator output. It is the **WordTimeSpan absolute times for ASR batch-1 words**.

Capture sets `ctx.segmentTimeOffsetsSec ≈ [0, 1.6]` and `ctx.asrSegmentNodeBatchIndices = [0, 1]` in `asr-step`. Replay injects frozen segments + absolute `acousticToneSlices` but **omits** those offset arrays. `buildWordTimeSpans` then treats batch-local word times as absolute → `mapToneEvidenceForRecall` attaches the **wrong** slices to batch-1 windows → different `acousticTonePattern` / `CanonicalRecallQuery.toneNorm` → Base 37 vs 35 → Path/Final cascade.

**RESULT: A — REPLAY_STATE_OMISSION_PROVEN**  
**NEXT OWNER: REPLAY_STATE_REPAIR**  
**Evidence strength: PROVEN** (mechanism). Full raw Base tables remain NOT_EVALUABLE (compact truncation).

All seven E18 finals share the same multi-batch offset precondition (**YES**).

---

## 2. Scope / Frozen Authority

- EVALUATION_SSOT_V1 authoritative; Frozen Acoustic Evidence remains single Dialog200 SSOT.
- Old baseline stays retired. Funnel stays blocked.
- Path comparator not re-audited (still: deterministic given identical edges).
- Known evaluator defects (thresholds, fine_spans, E16/E17, slice(0,48)) not fixed this round.

---

## 3. d157 Known Evidence

| | Capture | Replay |
|--|---------|--------|
| Final | 您好我定,但显示 **耽误**三天没更新能帮我查一下吗? | 您好我定,但显示 **但物流**三天没更新能帮我查一下吗? |
| pathCount | 2 | 2 |
| base flatMap n | 37 | 35 |
| Observed firstDivergence | E6_SEGMENTATION_PATH | — |
| Bypass | — | ASR delta 0; tone skipped; inject true |

Capture ASR raw: `您好我定,但顯示 但物流三天沒更新能幫我查一下嗎?`  
Path0 base includes `物流`; Path1 splits `物`/`流`. Assembly pool includes both `耽误` and `但物流` variants; Capture KenLM picks `耽误`.

---

## 4. Capture vs Replay Entry Architecture

```
CAPTURE: WAV → /run-pipeline-with-audio → runAsrStep (multi-batch)
         → sets segments + offset slices + segmentTimeOffsetsSec + asrSegmentNodeBatchIndices
         → FW → Base → …

REPLAY:  Frozen → /run-lexicon-mock → runPipelineWithMockAsr
         → injects asrText + segments + acousticToneSlices ONLY
         → skips ASR → offsets NEVER set → FW → Base → …
```

Secondary non-causal note: harness sends `lexicon_v2_intent_enabled: false`, but `/run-lexicon-mock` **ignores** it (`runPipelineWithMockAsr` never sets the job flag → intent scheduling defaults enabled). `resolveRecallScope` does not consume sessionIntent for same-turn Base domain scope → classified **NON_CAUSAL_RUNTIME_DIFFERENCE**.

---

## 5. Boundary Inventory B0–B14 (summary)

| Boundary | Capture source | Replay source | Identical? |
|----------|----------------|---------------|------------|
| B0 entry | `/run-pipeline-with-audio` | `/run-lexicon-mock` | NO (entrypoint) |
| B1 ASR text/segments | JobResult | frozen inject | **YES** |
| B2 Tone slices array | ASR+offset | frozen inject | **YES** at store |
| B2 mapped tone | uses WordTimeSpans | uses WordTimeSpans w/o offsets | **NO** |
| B3 FW input offsets | asr-step | missing | **NO** ← first real input delta |
| B4 FineSpan | production | production | UNKNOWN (not dumped) |
| B5 WindowQuery | + toneNorm | + wrong toneNorm | **NO** |
| B6–B8 Base | diverges | diverges | NO / raw NOT_EVALUABLE |
| B9–B14 | cascade | cascade | downstream |

Full field inventory: `LINGUA_D157_FROZEN_REPLAY_BOUNDARY_DIFF_V1.json`.

---

## 6. ASR Boundary

**ASR_BOUNDARY_IDENTICAL = YES**

- Same `rawMergedAsrText`, same `segments` / `words[]` / start/end from frozen jsonl.
- E1 PASS. Replay inject uses that object.

---

## 7. Tone Boundary

**Slices at inject: IDENTICAL (YES).**  
**Downstream-consumed mapped Tone: IDENTICAL = NO.**

Frozen slices are on the **absolute** multi-batch timeline `[0, 5.38]`.  
`evidenceProduction` shows batch-1 words already at absolute times (e.g. 但 `[2.34, 2.78]`).  
Segment `words[].start/end` for batch-1 remain **batch-local** (但 `[0.74, 1.18]`). Offset = **+1.6s** for all 14 batch-1 words.

Production mapping (`mapToneEvidenceForRecall`) selects slices by overlap with **WordTimeSpan** times from `buildWordTimeSpans`, which applies `segmentTimeOffsetsSec[batchIndex]`.

---

## 8. FineSpan Boundary

**FINESPAN_IDENTICAL = UNKNOWN** (OBSERVABILITY_GAP).

Production emits `finespans`; compact capture never persisted them. Not used as equality proof.

---

## 9. WindowQuery Boundary

**WINDOW_QUERY_IDENTICAL = NO** (mechanism PROVEN; full ordered tables NOT_EVALUABLE without live dump).

`CanonicalRecallQuery` includes `toneNorm` from `acousticTonePattern` (`utterance-recall-cache.ts` / `recall-topk-for-windows.ts`). Batch-1 windows get wrong overlap slices on Replay → different `toneNorm` keys.

---

## 10–12. Base Recall Query / Raw / Post

| Item | Status |
|------|--------|
| Query keys identical? | **NO** (toneNorm) |
| Lexicon DB identity | YES (identity guard SHA) |
| SQL branch | same functions; params differ via tone pattern |
| Cache | per-utterance; **CACHE_CAUSAL = NO** for cross-case; within-case order follows windows |
| Full raw Base 37 vs 35 | **NOT_EVALUABLE** (only compact `.slice(0,48)` surfaces) |
| Where 37 vs 35 arises | After divergent tone-keyed Base queries (STRONG); exact missing/extra terms not listable |

---

## 13–15. Model2 / LexicalEdge / Path

Not independently attributed. Path divergence is **downstream cascade** once Base/edges diverge. No contradiction (identical edges + different paths) was observed.

---

## 16. Config / Runtime State Delta (causal)

| STATE_NAME | Capture | Replay | Expected to differ? | Affects Base? | Authority |
|------------|---------|--------|---------------------|---------------|-----------|
| `ctx.segmentTimeOffsetsSec` | `[0, 1.6]` | unset → `[]` | **NO** | **YES** | production asr-step contract |
| `ctx.asrSegmentNodeBatchIndices` | `[0, 1]` | unset → `[]` | **NO** | **YES** | production asr-step |
| `ctx.segmentCharOffsets` | set | unset | NO | PARTIAL | asr-step |
| sessionId / jobId Date.now() | differs | differs | YES | NO (NON_CAUSAL) | — |
| lexicon_v2_intent flag applied | false | default true | NO | NO (NON_CAUSAL same-turn) | — |
| PROFILE_MODE | NO_PROFILE | NO_PROFILE | — | — | — |

---

## 17. Cache / Domain State

- UtteranceRecallCache: per-utterance init; not the root cause.
- `resolveRecallScope`: config/job domains — no Capture/Replay delta proven for d157.
- Do not confuse Domain Vote output with pre-Recall domain scope.

---

## 18. True First Divergence

```
TRUE_FIRST_DIVERGENCE:
  FIELD = WordTimeSpan.start/end for ASR batch-1 words
  FUNCTION = buildWordTimeSpans
  INPUTS = segmentTimeOffsetsSec + asrSegmentNodeBatchIndices

CAPTURE:
  offsets [0, 1.6], indices [0, 1]
  word 但 (batch 1) → absolute [2.34, 2.78]

REPLAY:
  offsets [], indices []
  word 但 (batch 1) → wrongly [0.74, 1.18]

OWNER = Replay inject omission of ASR multi-batch alignment state
CAUSE = absolute slices + batch-local word times without offsets
  → mapToneEvidenceForRecall wrong slice selection
  → toneNorm / Base query divergence
```

**OBSERVED_FIRST_DIVERGENCE** = E6 (comparator).  
**TRUE_PIPELINE_FIRST_DIVERGENCE** = B3 offset inputs → mapped Tone (above).

---

## 19. Root Cause Classification

| Level | Value |
|-------|-------|
| Top-level | **3 OBSERVABILITY GAP** (offsets not first-class in inject schema) **+** behavioral **Replay omission** |
| Primary RESULT enum | **A REPLAY_STATE_OMISSION_PROVEN** |
| Secondary detail | **TONE_MAPPING_DIFFERENCE** / **REPLAY_STATE_OMISSION** |
| Architecture Gap? | **NO** — intended boundary can work if alignment state is restored; not a responsibility conflict |
| Production defect? | **NO** — asr-step correctly sets offsets; Replay harness omits them |
| Evidence strength | **PROVEN** for first input divergence; **STRONG** for Base 37/35 linkage; raw candidate lists **INSUFFICIENT** |

---

## 20. Other Six Cases Lightweight Validation

| Case | SAME_ROOT_CAUSE_PRESENT | Offset (batch1) |
|------|-------------------------|-----------------|
| d019 | YES | +1.2s |
| d045 | YES | +1.4s |
| d061 | YES | +2.9s |
| d110 | YES | +0.9s |
| d112 | YES | +3.2s |
| d156 | YES | +3.3s |
| d157 | YES | +1.6s |

All seven E18 finals are multi-batch with non-zero offsets. Deep re-trace of the other six deferred.

---

## 21. Q1–Q22

| # | Answer |
|---|--------|
| Q1 ASR boundary identical? | **YES** |
| Q2 Downstream Tone identical? | **NO** |
| Q3 FineSpans identical? | **UNKNOWN** |
| Q4 WindowQueries identical? | **NO** |
| Q5 Base query keys identical? | **NO** |
| Q6 SQL branches/params identical? | Branch same; tone params **NO** |
| Q7 Lexicon DB identity identical? | **YES** |
| Q8 Cache/order identical? | Cache non-causal; query order follows windows |
| Q9 Full raw Base identical? | **NOT_EVALUABLE** |
| Q10 37 vs 35 arises at? | Tone-keyed Base Recall under wrong WordTimeSpans |
| Q11 Model2 inputs identical? | **UNKNOWN** (cascade; not first) |
| Q12 Model2 outputs identical? | **UNKNOWN** |
| Q13 LexicalEdges identical? | **NO** (expected cascade) |
| Q14 Path independent? | **YES disappears** as independent RC once upstream proven |
| Q15 First differing runtime state? | `segmentTimeOffsetsSec` / `asrSegmentNodeBatchIndices` |
| Q16 Missing Frozen Evidence? | First-class offset fields absent; **reconstructible** from `evidenceProduction` |
| Q17 Replay fail to restore? | **YES** — omits alignment state while injecting slices+segments |
| Q18 Entrypoint defaults? | Intent flag ignore = non-causal; offset omission = state omission |
| Q19 Production defect proven? | **NO** |
| Q20 Architecture Gap proven? | **NO** |
| Q21 Same in other six? | **YES** (all seven) |
| Q22 Minimum next owner? | **REPLAY_STATE_REPAIR** |

---

## 22. Final Result

**A — REPLAY_STATE_OMISSION_PROVEN**

---

## 23. Next Owner

**REPLAY_STATE_REPAIR**

Minimum restore (report-only; do not implement this round):

1. Inject or reconstruct `segmentTimeOffsetsSec`, `asrSegmentNodeBatchIndices`, and (as needed) `segmentCharOffsets` into mock JobContext before FW.
2. Reconstruction can use captured `utterance_tone.evidenceProduction` + `segments.words` without recapture/ASR/Tone rerun.
3. Evaluator defects remain outstanding before FUNNEL.

---

## Artifacts

1. This report  
2. `LINGUA_D157_FROZEN_REPLAY_BOUNDARY_DIFF_V1.json`  
3. `LINGUA_D157_OTHER_E18_ROOT_CAUSE_VALIDATION_V1.json`
