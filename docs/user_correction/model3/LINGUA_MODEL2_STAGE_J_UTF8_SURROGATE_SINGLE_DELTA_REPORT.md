# LINGUA_MODEL2_STAGE_J_UTF8_SURROGATE_SINGLE_DELTA_FIX — Report

**Phase:** `LINGUA_MODEL2_STAGE_J_UTF8_SURROGATE_SINGLE_DELTA_FIX`  
**Diagnostic run:** `MODEL2_STAGE_J_UTF8_SURROGATE_SINGLE_DELTA_V1`  
**Mode:** SINGLE TRANSPORT DELTA / NO MODEL OPTIMIZATION  

---

## 1. Exact root cause

```text
Where did the unpaired surrogate originate?
```

| Layer | Finding |
|-------|---------|
| Frozen Pilot200 `personal_terms` on disk | Clean Unicode Chinese — **no** unpaired surrogates |
| Profile construction / SessionBootstrap | Pass-through of clean terms |
| Node JS string representation | Clean before IPC |
| JSON serialization | Node emits **UTF-8** JSONL (Chinese as multibyte, not `\u` escapes) |
| **Python stdin decode (Windows)** | **OWNER** — `sys.stdin` encoding = **GBK** |
| Failure mechanism | UTF-8 bytes for `哪里` include `0xAA`; GBK decode illegal → **U+DCAA** (surrogateescape) |
| Python encode boundary | `feature_hash_v1.stable_bucket` → `t.encode("utf-8")` → `surrogates not allowed` |

```text
data corruption = NO
profile construction = NO
Node representation = NO (payload clean)
serialization boundary = UTF-8 write OK
Python encoding boundary = YES (locale GBK stdin misread)
```

NO_PROFILE worked previously because empty `personal_terms` avoided the GBK-illegal UTF-8 byte sequences.

---

## 2. Exact fix owner

```text
FIX_OWNER =
  1) model2_inference_host.py: sys.stdin.buffer + UTF-8 decode
  2) inference-host.ts spawn: PYTHONUTF8=1 + PYTHONIOENCODING=utf-8
  3) unicode-sanitize.ts at Node IPC stringify boundary (defense + observability)
```

Narrowest correct boundary: **cross-process JSONL stdin must be UTF-8**, matching Node’s write encoding. Sanitization of unpaired surrogates is defense-in-depth for true JS unpaired surrogates (not the Pilot data path).

---

## 3. Files changed

| File | OBSERVABILITY_ONLY / TRANSPORT_ONLY |
|------|-------------------------------------|
| `electron_node/services/model2_runtime/model2_inference_host.py` | TRANSPORT_ONLY |
| `electron_node/electron-node/main/src/model2-runtime/inference-host.ts` | TRANSPORT_ONLY |
| `electron_node/electron-node/main/src/model2-runtime/unicode-sanitize.ts` | new helper |
| `electron_node/electron-node/main/src/model2-runtime/unicode-sanitize.test.ts` | tests T1–T6 |
| `electron_node/electron-node/main/src/model2-runtime/types.ts` | obs fields |
| `electron_node/electron-node/main/src/model2-runtime/expand-active-candidates.ts` | obs pass-through |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts` | obs pass-through |
| `electron_node/electron-node/tests/run-model2-stage-j-observability-diagnostic.mjs` | harness `--utf8-surrogate-delta` |

```text
MODEL2_SEMANTIC_CHANGE = false
RECALL_SEMANTIC_CHANGE = false
PROFILE_LEARNING_CHANGE = false
TONE_CHANGE = false
LEXICON_CHANGE = false
PRODUCTION_SEMANTIC_CHANGE = false
```

---

## 4. Tests

```text
T1–T5 unit/boundary: PASS
T6 host stdin UTF-8 with 哪里: PASS
```

---

## 5. Same-sample diagnostic rerun

Pinned cases (unchanged from observability delta): 8 cases / 12 executions.

| Metric | Value |
|--------|-------|
| UTF8_SURROGATE_FAILURE_COUNT | **0** |
| MODEL2_INFERENCE_SUCCESS_COUNT | **8** |
| MODEL2_INFERENCE_FAILED_COUNT | **0** |
| P_DECISION_REACHED_COUNT | **8** |
| D_DECISION_REACHED_COUNT | **8** |
| ASR_INVOCATION_COUNT | 0 |
| FROZEN_REPLAY_IMMUTABLE | PASS |

### P (CORRECT)

| selected_action_count | n |
|----------------------|---|
| 0 | 1 |
| 1 | 5 |
| 2 | 2 |

| p_retrieval_status | n |
|--------------------|---|
| P_RETRIEVAL_TONE_NOT_READY | 7 |
| NO_P_ACTION | 1 |

`acousticTonePattern_present=false`, `toneRecallReadiness=no_pattern` when P selected.

`p_added=0` all CORRECT.

### D (CORRECT)

| domain_none | n |
|-------------|---|
| false | 8 |

Domain actions observed (`domain_soft:tourism_*` / `medical`). `d_hit_count>0`, `d_materialized_count=0`, `d_added=0`.

### Mandatory Tone question

```text
MANDATORY_TONE_FAIL_CLOSED_WHEN_P_SELECTED = CONFIRMED
```

(selected_actions > 0 → retrieval fail-closed without acousticTonePattern)

---

## 6. Owner update (STOP — do not fix)

Transport owner **resolved**.

```text
FIRST_CONFIRMED_ZERO_ACTION_OWNER = MULTIPLE_INDEPENDENT_OWNERS
  P dominant: P_RETRIEVAL_TONE_NOT_READY (7/8)
  P minority: MODEL_DECISION_NO_P_ACTION (1/8)
  D:         D_MATERIALIZATION_EMPTY (8/8)

ONE_NEXT_OWNER = P_RETRIEVAL_TONE_NOT_READY
ONE_RECOMMENDED_NEXT_DELTA =
  Architecture/owner decision on Tone readiness coupling in fixed-RAW Replay
  (DO NOT bypass Tone in an ad-hoc delta without SSOT)
```

---

## 7. Acceptance

```text
SINGLE_DELTA_SCOPE_PASS = PASS
UNICODE_SANITIZATION_PASS = PASS
VALID_INPUT_IDENTITY_PASS = PASS
MODEL2_HOST_UTF8_TRANSPORT_PASS = PASS
SAME_DIAGNOSTIC_SAMPLE_PASS = PASS
FROZEN_REPLAY_IMMUTABLE = PASS
NO_BUSINESS_LOGIC_CHANGE = PASS
MODEL2_CHANGED = false
RECALL_CHANGED = false
TONE_CHANGED = false
LEXICON_CHANGED = false
DATASET_CHANGED = false
PRODUCTION_SEMANTIC_CHANGE = false
```

---

## Final objective check

```text
CORRECT_PROFILE → MODEL2_INFERENCE_FAILED
  ↓ FIXED
CORRECT_PROFILE → MODEL2_INFERENCE_SUCCEEDED → REAL STAGE-J DECISION EVIDENCE
```

```text
STOP
```
