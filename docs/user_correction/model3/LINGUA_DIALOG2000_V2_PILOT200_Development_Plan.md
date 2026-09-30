# LINGUA_DIALOG2000_V2_PILOT200 — Development Plan

**Status:** Block A dataset frozen after freeze-correction (`LINGUA_DIALOG2000_V2_PILOT200_BLOCK_A_DATASET_FROZEN`)  
**SSOT:** `LINGUA_DIALOG2000_V2_PILOT200_SSOT.md`  
**Authoritative build:** `build_20260911_091806` (supersedes `build_20260911_010554`)

```text
NEXT_PHASE = LINGUA_DIALOG2000_V2_PILOT200_BLOCK_B_PROFILE_AWARE_RUNNER_DEVELOPMENT
```

Develop **one block at a time**: audit → minimal extension → acceptance → freeze → next block.  
Prefer scripts / test harness extensions. **No** new workflow engine, DB, or production fork.

---

## Global freezes (all blocks)

```text
MODEL2 WEIGHTS/CODE/THRESHOLDS/RELATION SET = FROZEN
MODEL3 = FROZEN
RETRY = FROZEN
LEXICON = FROZEN
TONE / ELISION = DEFERRED
OLD dialog_200 = untouched
PRODUCTION_CODE_CHANGE for Model2 path = NONE unless later ACP
```

---

## Block A — Pilot Dataset Builder

**Next entry:** `LINGUA_DIALOG2000_V2_PILOT200_BLOCK_A_DATASET_BUILDER_PREDEV_AUDIT`

### Reuse

| Asset | Path / area |
|-------|-------------|
| Piper TTS + restore pattern | `electron_node/services/piper_tts`, `scripts/test-corpus/restore-dialog200-full.py` |
| PronunciationCorruptor / PhonemeRealizer | `training/model2/pronunciation/` |
| ACTIVE_SET_V1 / relation-direction | `relation-direction.ts`, `active_set.py` |
| ProfileDelta writeback | `central_server/api-gateway/src/profile_delta.rs` |
| Allocation plan | `LINGUA_DIALOG2000_V2_PILOT200_Case_Allocation.csv` |
| Schemas | `LINGUA_DIALOG2000_V2_PILOT200_Schema.json` |

### Minimal extension

- Scenario + seed assignment for 200 cases (not hand-curating expected ASR errors)
- Correction-history → P1/P2/P3 profiles per user
- Eval-corpus wrapper around Corruptor/Realizer → wav + audio identity
- Manifest + validators (lexical isolation, domain deconfound, leak checks)

### Forbidden

- Text-only error injection main path (`model3_error_text`)
- Lexicon auto-add / regenerate-until-ASR-fails
- Reconnect tone_bias / elision fakes
- Mutating old `dialog_200`
- Training Model2 on Pilot outputs

### Target list

1. Frozen 200-case metadata + references  
2. Wavs with audio hashes  
3. Profile build sets + UserProfileV1 blobs  
4. Validator report all PASS  

### Checklist / acceptance evidence

- Anti-overfit checklist §1–11 PASS  
- `case_count=200`, clean≥40, splits 120/60/20  
- `PROFILE_LEXICAL_ISOLATION_PASS`  
- Dataset identity: `LINGUA_DIALOG2000_V2_PILOT200` V1 + build_id + seed  

---

## Block B — Profile-Aware Dialog Runner

**Only after Block A frozen.**

### Reuse

| Asset | Path / area |
|-------|-------------|
| Real ASR runners | `tests/run-dialog200-*.mjs`, `run-fresh-dialog200-causal-reconciliation.mjs` |
| `/run-pipeline-with-audio` | `test-server.ts` + `inference-service.runPipelineWithAudio` |
| SessionBootstrap → session cache | `node-agent-simple.ts`, protocols `UserProfileV1` |
| MODEL2_DIALOG200_TRACE | `dialog200-path-trace.ts` |

### Minimal extension

- Per-case / per-run: bootstrap existing SessionBootstrap with condition profile  
- Execute NO / CORRECT / WRONG on same `audioPath`  
- Persist `run_identity` (`caseId`, `profileCondition`, `runId`, `rawAsrHash`)  
- Optional: enable Model2 path trace env for dumps  

### Forbidden

- New profile override APIs bypassing SessionBootstrap  
- Model2/Model3/Lexicon changes  
- Cached-ASR replay service as blocker (optional later only)  
- Parallel full redesign of scheduler/AudioAggregator  

### Target list

1. 200 × {NO, CORRECT, WRONG} runnable (600 executions OK)  
2. RAW hashes compared across conditions  
3. Dumps consumable by Block C  

### Checklist / acceptance evidence

- Injection uses production contract only  
- ASR variance flagged when present  
- Stateless default sessions unless accumulation explicitly tested  
- No production architecture change required  

---

## Block C — Profile-Aware Evaluator

**Only after Block B frozen.**

### Reuse

| Asset | Path / area |
|-------|-------------|
| Normalized baseline logic | `run_asr_repair_normalized_baseline.mjs` |
| Model2 union / base candidates in dumps | fresh jsonl / path trace |
| User-visible + normalized baseline reporting patterns | prior audit artifacts |

### Minimal extension

- Dataset-agnostic IO for Pilot200 dumps  
- `PROFILE_GAIN`, `WRONG_PROFILE_DELTA`  
- `MODEL2_USEFUL_EXPANSION` / `MODEL2_FALSE_EXPANSION` with SSOT definitions  
- Clean preservation + candidate p50/p95/max + cap>16  
- P0–P3 trend tables (no hard monotonic gate)  
- **No** numeric PROFILE_GAIN thresholds before first baseline measure  

### Forbidden

- Scoring tone as Model2 success  
- Holdout-driven threshold tuning  
- Declaring “production ready” from Pilot alone  

### Target list

1. Level 1/2/3 metric suite  
2. Per-relation / per-domain / clean slices  
3. Baseline report ready for failure-owner audit if flat  

### Checklist / acceptance evidence

- Useful expansion eligibility excludes `TARGET_NOT_IN_LEXICON`  
- Attribution respects `PROFILE_ATTRIBUTION_AMBIGUOUS`  
- Cap ≤16 governance reported  

---

## Optional later — PROFILE_A_B_REPLAY_RUNNER

**Not Block A/B/C blocker.**  
Develop only if ASR replay variance **materially confounds** profile metrics.  
Then: cache RAW once → replay postprocess under profiles (profile-conditioned comparison only; full-audio acceptance still required separately).

---

## Sequencing

```text
DESIGN_FROZEN (this phase)
  → Block A predev audit → implement A → freeze dataset
  → Block B predev audit → implement B → freeze runner
  → Block C predev audit → implement C → freeze evaluator
  → PILOT200_PROFILE_AWARE_BASELINE_RUN
  → measure → failure-owner audit if needed
  → only then Model2 delta discussion / Full 2000 design
```

---

## Final principle

```text
DATASET VALIDITY > MODEL SCORE
RELATION GENERALIZATION > LEXICAL MEMORIZATION
ONE BLOCK AT A TIME
```
