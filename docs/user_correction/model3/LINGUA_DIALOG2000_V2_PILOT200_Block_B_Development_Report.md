# LINGUA_DIALOG2000_V2_PILOT200 — Block B Development Report

**Phase:** `LINGUA_DIALOG2000_V2_PILOT200_BLOCK_B_PROFILE_AWARE_RUNNER_DEVELOPMENT`  
**Verdict:** `LINGUA_DIALOG2000_V2_PILOT200_BLOCK_B_RUNNER_FROZEN`  
**Authoritative dataset build:** `build_20260911_091806`  
**Runner:** `pilot200-block-b-runner-v1`  
**Full batch:** `blockb_2026-09-11T1021`  
**Acceptance batch:** `blockb_2026-09-11T1011`

---

## Scope executed

```text
BLOCK B ONLY — Profile-Aware Dialog Runner
200 cases × 3 conditions = 600 full-pipeline executions
NO Model2 scoring / PROFILE_GAIN / evaluator / dataset mutation
MODEL2 / MODEL3 / RETRY / LEXICON / old dialog_200 = UNCHANGED (semantics)
```

---

## Files added

| Path | Role |
|------|------|
| `electron_node/electron-node/tests/run-pilot200-block-b-profile-runner.mjs` | Block B runner (accept / full / resume) |
| `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_Block_B_Summary.json` | Machine-readable Block B summary |
| `docs/user_correction/model3/LINGUA_DIALOG2000_V2_PILOT200_Block_B_Development_Report.md` | This report |
| `test wav/LINGUA_DIALOG2000_V2_PILOT200/block_b_runs/blockb_2026-09-11T1021/` | Full-batch dumps (`run_manifest.json`, `executions.jsonl`, `failures.jsonl`, `traces/`, fingerprints) |

## Files modified (harness-only wiring)

| Path | Change |
|------|--------|
| `electron_node/electron-node/main/src/agent/node-agent-simple.ts` | `applySessionBootstrap()` — same Map write as WS bootstrap |
| `electron_node/electron-node/main/src/inference/inference-service.ts` | `runPipelineWithAudio` forwards optional `userProfile` / `profileVersion` into `processJob` |
| `electron_node/electron-node/main/src/test-server.ts` | `POST /session-bootstrap`; audio path reads `nodeAgent.getSessionUserProfile(sessionId)`; returns `extra.profile_runtime`; auto-remove `pilot200::*` sessions |

No Model2 / Model3 / Retry / Lexicon / Scheduler / AudioAggregator semantic edits.

---

## Preflight (narrow)

| Check | Result |
|-------|--------|
| A. SessionBootstrap can carry UserProfileV1 | PASS |
| B. Node agent/session cache receives it | PASS (`applySessionBootstrap`) |
| C. `runPipelineWithAudio` uses session/profile state | PASS after harness wiring (was HTTP gap) |
| D. Model2 reads profile from production path | PASS (`ctx.userProfileV1` / `phonetic_bias`) |
| E. Runner associates one execution ↔ one session | PASS (unique `sessionId`) |
| F. Model2 trace evidence | PASS (`MODEL2_DIALOG200_TRACE=1`, compact summary) |

Initial gap: HTTP audio path skipped NodeAgent cache. Closed by harness wiring — **not** a production profile override API and **not** STOP/contract conflict.

---

## Reused runtime assets

```text
SessionBootstrap / UserProfileV1 contract
node-agent session profile cache
/run-pipeline-with-audio + Faster-Whisper
Lingua postprocess → Model2 / Model3 / Retry / Assembly / KenLM
MODEL2_DIALOG200_TRACE
start-node-detached.mjs + wait-asr-ready.mjs
Block A frozen corpus (cases / audio / profiles / manifest)
```

---

## Runner architecture

```text
Frozen Pilot case + frozen WAV + profileCondition
        ↓
unique sessionId = pilot200::<caseId>::<CONDITION>::<runId>
        ↓
POST /session-bootstrap  (UserProfileV1 READ_ONLY artifact)
        ↓
POST /run-pipeline-with-audio  (same session_id; profile from cache)
        ↓
Faster-Whisper → postprocess → Model2/3/…
        ↓
execution JSONL record + optional compact trace sidecar
```

### Profile condition mapping

| Condition | Profile source |
|-----------|----------------|
| `NO_PROFILE` | Valid empty / P0-compatible UserProfileV1 (same bootstrap path) |
| `CORRECT_PROFILE` | Frozen `case.profileRef` / stage / version / hash |
| `WRONG_PROFILE` | Frozen wrong-user mapping (`wrongProfileUserId` / wrong ref); no dynamic “worse” construction |

### Session isolation

- Unique `sessionId` per `caseId × condition × runId`
- No shared conversation accumulation
- Test sessions `pilot200::*` removed after run
- Hard gate: `SESSION_ID_COLLISION_COUNT = 0` (observed **0** / 600)

### Profile identity verification

- Expected: `profileVersion` + canonical hash of frozen UserProfileV1
- Runtime: bootstrap accept + `extra.profile_runtime` (`profile_version`, `phonetic_bias_keys`)
- Result: **600 / 600** `PROFILE_IDENTITY_VERIFIED`

### Writeback prevention

- Artifacts READ_ONLY (fingerprint before/after)
- Isolated session IDs (no evaluation write into frozen profile files)
- `PROFILE_WRITEBACK_DETECTED = false`
- Runtime store mutation observability: `PROFILE_POSTRUN_MUTATION_NOT_OBSERVABLE` when store not readable

### Execution identity

```text
dataset case = 200
execution = caseId + profileCondition + runId  (= 600)
```

Counterbalanced deterministic `conditionOrder` from `caseId` seed (not quality-adaptive).

### RAW ASR identity

- Records `rawMergedAsrText` + `rawAsrHash` (raw identity; not normalization substitute)
- Same case × 3 conditions → `RAW_ASR_STABLE` or `RAW_ASR_VARIANCE`
- Structural attribution flag only: READY vs AMBIGUOUS (no quality scoring)

### Trace capture

- Env: `MODEL2_DIALOG200_TRACE=1`
- Compact fields: invoked?, profile-present?, phonetic keys, P/D action counts
- Sidecars under `traces/` — not full debug flood

---

## Small acceptance tests

Batch `blockb_2026-09-11T1011` (`--accept-only`): **24 / 24 OK**

Covered: P0/P1/P2/P3, WRONG_PROFILE, multi-user, clean + phonetic targets, same-case × 3 isolation, same audio SHA256, dataset fingerprint immutability.

Gates before full batch:

```text
SESSION_ISOLATION PASS
PROFILE_IDENTITY PASS
SAME_AUDIO PASS
DATASET_IMMUTABILITY PASS
NO_PROFILE_WRITEBACK PASS
PRODUCTION_FREEZE PASS
```

---

## 600-run results

| Metric | Value |
|--------|-------|
| EXECUTION_EXPECTED | 600 |
| EXECUTION_COMPLETED | 600 |
| EXECUTION_FAILED | 0 |
| INFRA_RETRY_COUNT | 0 |
| SESSION_ID_COUNT | 600 |
| SESSION_ID_COLLISION_COUNT | 0 |
| PROFILE_BOOTSTRAP_SENT / ACCEPTED | 600 / 600 |
| PROFILE_IDENTITY_VERIFIED / MISMATCH | 600 / 0 |
| SAME_AUDIO_ACROSS_CONDITIONS | PASS |
| DATASET_IMMUTABILITY | true |
| PROFILE_ARTIFACT_IMMUTABILITY | true |
| TONE_P10_VAD_CPU | `1` |

### RAW variance summary

| Metric | Value |
|--------|-------|
| CASE_COUNT | 200 |
| RAW_ASR_STABLE_CASE_COUNT | 118 |
| RAW_ASR_VARIANCE_CASE_COUNT | 82 |
| RAW_ASR_STABILITY_RATE | 0.59 |
| PROFILE_ATTRIBUTION_READY | 118 |
| PROFILE_ATTRIBUTION_AMBIGUOUS | 82 |
| NO vs CORRECT identical | 134 |
| NO vs WRONG identical | 138 |
| CORRECT vs WRONG identical | 143 |

Variance is **reported only** — not a Block B hard fail. Rate (~41% cases) is high enough to **materially weaken** cross-condition profile attribution for Block C on ambiguous cases.

### Trace completeness

| Metric | Value |
|--------|-------|
| MODEL2_TRACE_EXPECTED | 600 |
| MODEL2_TRACE_PRESENT | 597 |
| MODEL2_TRACE_MISSING | 3 |
| MODEL2_NOT_INVOKED | 0 |

---

## Production freeze check

```text
MODEL2_CHANGED = false
MODEL3_CHANGED = false
RETRY_CHANGED = false
LEXICON_CHANGED = false
ASR_SEMANTIC_CHANGE = false
PRODUCTION_SEMANTIC_CHANGE = false
OLD_DIALOG200_CHANGED = false
```

Allowed changes: test runner + minimal test-server / NodeAgent HTTP bootstrap plumbing so the **existing** production profile contract is reachable from `/run-pipeline-with-audio`.

---

## Known limitations

1. **RAW ASR variance (~41% cases)** — full ASR replay is non-deterministic; Block B does not force Scheduler/Aggregator changes or cached-RAW replay.
2. **`OPTIONAL_REPLAY_NEEDED = true`** — propose `PROFILE_A_B_REPLAY_RUNNER` as **user-decided** optional delta; not auto-developed.
3. **3 Model2 traces missing** despite invocations elsewhere — residual capture gap; bulk consumable (597/600).
4. **Profile postrun mutation** not always observable from harness — recorded as NOT_OBSERVABLE; frozen artifact hashes unchanged.
5. First full-batch attempt failed warmup when using `cases[0]` as warmup wav (empty RAW); fixed to preferred known-good `p2_u001_025.wav`.

---

## Hard gates (final)

```text
AUTHORITATIVE_BUILD_CORRECT = PASS
SESSION_ID_COLLISION_COUNT = 0
SESSION_PROFILE_ISOLATION = PASS
PROFILE_IDENTITY_VERIFICATION = PASS
SAME_AUDIO_ACROSS_CONDITIONS = PASS
DATASET_IMMUTABILITY = PASS
PROFILE_ARTIFACT_IMMUTABILITY = PASS
NO_EVALUATION_PROFILE_LEARNING = PASS
PRODUCTION_FREEZE = PASS
RUN_PROVENANCE_COMPLETE = PASS
TRACE_OUTPUT_CONSUMABLE = PASS
```

---

## Final verdict

```text
LINGUA_DIALOG2000_V2_PILOT200_BLOCK_B_RUNNER_FROZEN
```

Answer to Block B question:

> Yes — the same frozen WAV can be run independently under NO_PROFILE / CORRECT_PROFILE / WRONG_PROFILE through the real production-compatible profile contract, with session isolation, identity verification, and consumable dumps for Block C.

**Not answered:** Model2 quality / PROFILE_GAIN (deferred).

---

## ONE_NEXT_PHASE

```text
USER_DECISION_REQUIRED_FOR_OPTIONAL_PROFILE_A_B_REPLAY
```

Evidence: `RAW_ASR_STABILITY_RATE = 0.59` (82/200 variance).  
If user declines replay delta, Block C may proceed with `PROFILE_ATTRIBUTION_AMBIGUOUS` marking on variance cases.

Optional next delta (not started):

```text
OPTIONAL_NEXT_DELTA = PROFILE_A_B_REPLAY_RUNNER
```
