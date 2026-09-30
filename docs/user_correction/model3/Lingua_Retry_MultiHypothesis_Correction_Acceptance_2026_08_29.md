# Lingua — Retry Multi-Hypothesis Correction Acceptance

**Phase:** RETRY_MULTIHYPOTHESIS_CORRECTION_ACCEPTANCE  
**Date:** 2026-08-29  
**Mode:** STRICT ACCEPTANCE / ENVIRONMENT RECOVERY ONLY

---

## MAIN VERDICT

**PASS**

Environment recovered; real dialog_200 pipeline executed 53/53; global candidate ≤16 PASS; controlled multi-hypothesis correction still intact. No production business code changed in this phase.

---

## PREVIOUS REPORT CORRECTIONS

### Development Sequence Gate

| | |
|--|--|
| **previous** | OPEN |
| **corrected starting state (this phase)** | **HOLD** |
| **final after acceptance PASS** | **OPEN** |

### Global ≤16 evidence

| | |
|--|--|
| **previous claim** | validated by dialog_200 |
| **corrected** | **NOT VALIDATED** in previous run (`casesExecuted=0`) |
| **now** | **VALIDATED** — max KenLM pool = **6**, cases >16 = **0** |

---

## ENVIRONMENT ROOT CAUSE

### Previous :5020 failure

`start-node-detached` printed `STARTED electron pid 3468`, then `/health` never succeeded for ~15 minutes.

### Root cause (layered)

1. **`:5020` never bound:** `ELECTRON_RUN_AS_NODE=1` (used to run the acceptance runner under Electron ABI) was copied into the **real Electron app** env → `app.whenReady` undefined → FATAL exit.  
   Classification: **A** (process exited) + **J** (env leak).

2. **After `:5020` recovered:** ASR still failed — `servicePreferences.faster-whisper-vad=false` (all prefs false) while `serviceLastRuntimeState.faster-whisper-vad=true` → auto-start skipped ASR → `endpointCount=0`.  
   Classification: **H** (ASR dependency not started).

### Working startup contract

| Field | Value |
|-------|-------|
| command | `ELECTRON_RUN_AS_NODE=1 electron.exe tests/run-dialog200-model3-acceptance.mjs --anchored-only [--max-minutes 60]` |
| cwd | `electron_node/electron-node` |
| environment | `PROJECT_ROOT`; app: `NODE_ENV=production`, `TONE_P10_VAD_CPU=1`, `MODEL2_DIALOG200_TRACE=1`; **app must NOT** have `ELECTRON_RUN_AS_NODE` |
| expected port | `5020` (test server), `6007` (ASR) |
| health | `GET http://127.0.0.1:5020/health` |
| readiness | Node health OK + ASR warmup (`faster-whisper-vad` + non-empty `raw_asr_text`) |
| servicePreferences | `faster-whisper-vad` must be `true` for auto-start |

### Difference vs failed run

Prior run leaked `ELECTRON_RUN_AS_NODE` into the app and left ASR preference off; health wait consumed the entire `--max-minutes 15` budget → `casesExecuted=0`.

### Environment/harness changes (HARNESS ONLY)

1. `tests/repro/start-node-detached.mjs` — strip `ELECTRON_RUN_AS_NODE` from Electron **app** env  
2. `tests/run-dialog200-model3-acceptance.mjs` — `ensureServicePreferencesForAcceptance()` restores prefs from `serviceLastRuntimeState` + forces FW

**Production business files modified: 0**

---

## NODE HEALTH

| Item | Status |
|------|--------|
| Process | Electron pid 15524 (acceptance run) |
| Port :5020 | READY |
| Health | **PASS** |

---

## SQLITE

| Item | Status |
|------|--------|
| Real SQLite | **YES** (`lexicon_runtime_status=ok` on pipeline cases) |
| Recall executed | **YES** (pipeline + prior controlled validation) |

---

## CONTROLLED VALIDATION

| Metric | Value |
|--------|-------|
| Cases | 13 |
| Multipath | 6 |
| d160 alternative hypotheses visible | **YES** (`向木`, `顺便`) |
| crossAnchor / crossKeep / outOfRegion | 0 / 0 / 0 |
| perSpanBudgetViolations | 0 |

---

## DIALOG_200

| Field | Value |
|-------|-------|
| Command | `ELECTRON_RUN_AS_NODE=1 electron.exe tests/run-dialog200-model3-acceptance.mjs --anchored-only --max-minutes 60` |
| Cases discovered | 53 |
| Cases executed | **53** |
| Pipeline cases executed | **53** |
| Failed | 0 |
| Regressed | 0 |
| Improved / Unchanged | 15 / 38 |
| Completed | **YES** |
| Wall clock | 647 s |

---

## MAINLINE INVARIANTS

| Invariant | Result |
|-----------|--------|
| Model3 violations | 0 (158 paths; decisions_retry=0 on this batch) |
| Domain Vote violations | **0** (`second_vote=0`, all `vote_calls=1`) |
| Retry cycle violations | 0 |
| Recursive Retry | 0 |
| crossAnchor / crossKeep / outOfRegion | 0 (controlled; no Retry fire on dialog_200 batch) |

Note: This anchored dialog_200 batch had **Model3 RETRY rate = 0** (training/trigger behavior). Multi-hypothesis Retry consumer behavior remains validated by controlled cases.

---

## CANDIDATE BUDGET

| Metric | Value |
|--------|-------|
| Max global sentence candidates (kenlm_pool) | **6** |
| Cases >16 | **0** |
| GLOBAL_CANDIDATE_CAP | **PASS** |

---

## RETRY INTERMEDIATE GROWTH

dialog_200: N/A for Retry regions (no RETRY decisions this batch).

Controlled (authoritative for correction growth):

| Metric | Max |
|--------|-----|
| Retained paths | 4 (d160) |
| Unique local spans | 8 (d179) |
| Stage-2 Recall calls | 8 |

---

## FAILURE CLASSIFICATION

| Class | Count / note |
|-------|----------------|
| Correction regression | **0** |
| Preexisting mainline | 0 infra failures; Model3 RETRY=0 on anchored set is preexisting trigger behavior |
| Lexicon | not evaluated as acceptance blocker |
| Model3 | no inference errors |
| Training | next-phase coverage opportunity (RETRY not firing) |
| Environment | recovered |
| Expected unreparable | N/A |

---

## PRODUCTION CHANGES

| Item | Value |
|------|-------|
| Production business files modified | **0** |
| Harness-only changes | `start-node-detached.mjs`, `run-dialog200-model3-acceptance.mjs` |

---

## ARCHITECTURE GOVERNANCE

Retry / Model3 / FineSpan / Lattice / Recall / Lexicon / Domain Vote / Model2 / Assembly / KenLM / JobResult: **NO** changes.  
New config / ranking / fallback / compatibility path: **NO**.

---

## TRAINING GATES

| Gate | Status |
|------|--------|
| ARCHITECTURE_TRAINING_GATE | **OPEN** |
| DEVELOPMENT_SEQUENCE_GATE | **OPEN** |

---

## NEXT PHASE

**MODEL3_V1_TRAINING_COVERAGE_AUDIT**

(Do not execute in this phase.)

---

## Artifacts (5)

1. `Lingua_Retry_MultiHypothesis_Correction_Acceptance_2026_08_29.md`
2. `retry_multihypothesis_acceptance_dialog200.csv`
3. `retry_multihypothesis_acceptance_summary.json`
4. `retry_multihypothesis_acceptance_governance.json`
5. `retry_multihypothesis_environment_diagnostics.txt`
