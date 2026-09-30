# LINGUA_MODEL2_STAGE_J_MINIMAL_OBSERVABILITY_DELTA — Report

**Phase:** `LINGUA_MODEL2_STAGE_J_MINIMAL_OBSERVABILITY_DELTA`  
**Mode:** OBSERVABILITY ONLY / NO BUSINESS LOGIC CHANGE / SSOT LOCKED  
**Diagnostic run:** `MODEL2_STAGE_J_OBSERVABILITY_DIAGNOSTIC_V1`  
**Date:** 2026-09-12  

---

## 1. Scope

Add minimal Stage-J observability so P/D zeroing points can be classified on a small representative fixed-RAW Replay sample.

In scope: FineSpan → Model2 infer → selected_actions / domain head → P/D retrieval → materialize → `p_added` / `d_added`.

Out of scope: Model2 weights/thresholds/catalogs, Tone/Recall behavior change, ASR, frozen Replay/Block B mutation, Block C scoring.

---

## 2. Files changed

| File | OBSERVABILITY_ONLY |
|------|--------------------|
| `electron_node/electron-node/main/src/model2-runtime/types.ts` | true |
| `electron_node/electron-node/main/src/model2-runtime/expand-active-candidates.ts` | true |
| `electron_node/electron-node/main/src/model2-runtime/relation-lexicon-adapter.ts` | true |
| `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts` | true |
| `electron_node/electron-node/tests/run-model2-stage-j-observability-diagnostic.mjs` | true (harness) |

```text
DELTA_ACCEPTANCE = PASS
NO_BUSINESS_LOGIC_CHANGE = PASS
```

No ranking / gate / retrieval argument / materialize / union condition changes.

---

## 3. Field lineage

| Field | Production owner | Runtime object | `model2_summary` | Diagnostic compact |
|-------|------------------|----------------|------------------|--------------------|
| `selected_actions` / ids / count | Stage-J host `selected_actions` | `Model2ExpandDiagnostics.selected_actions` + `observability.selected_action_*` | yes | yes |
| `domain_none` / `domain_action` | Stage-J host domain head | `infer.domainNone` / `infer.domainAction` → `observability` (any-span OR) | yes (`null` if decision not reached) | yes |
| `p_retrieval.status` | Expand + `recallSpanTopKV2` readiness | `observability.p_retrieval_status` | yes | yes |
| `acousticTonePattern_present` | Expand args `acousticTonePattern` | `observability.acousticTonePattern_present` | yes | yes |
| `toneRecallReadiness` | `recallSpanTopKV2.toneRecallReadiness.state` | via `executeProfileLexiconQueries.observability` | yes | yes |
| `inference_failed` / `failure_reason` | Host infer error | `Model2ExpandDiagnostics.inference_failed` / `reason` | yes | yes |
| `p_added` / `d_added` | unchanged counters | `pronunciation_candidates_added` / `domain_candidates_added` | yes (unchanged semantics) | yes |

---

## 4. Representative cases

8 cases × mostly `CORRECT_PROFILE`; 2 cases also `NO_PROFILE` + `WRONG_PROFILE` → **12 executions**.

Relations covered: `n_l`, `z_zh`, `sh_s`, `eng_en`, `ch_c`, `in_ing`, `h_f`.

Selection: RAW repair needed, `targetInLexicon`, P2/P3, deterministic from frozen dataset + prior Replay invoked set.

Authoritative RAW = Block B `NO_PROFILE` (`blockb_2026-09-11T1021`). Frozen `replay_2026-09-11T1347` hash unchanged.

```text
ASR_INVOCATION_COUNT = 0
EXECUTION_FAILURE = 0
PROFILE_IDENTITY_MISMATCH = 0
SESSION_COLLISION = 0
```

---

## 5. P decision results (CORRECT_PROFILE)

All 8 CORRECT executions:

```text
model2_invoked = false
selected_action_count = 0
p_retrieval_status = MODEL2_INFERENCE_FAILED
failure_reason = inference_failed:'utf-8' codec can't encode character '\udcaa' ... surrogates not allowed
```

Stage-J **action selection was never reached** on CORRECT_PROFILE in this diagnostic.

---

## 6. P retrieval results

Not reached on CORRECT (blocked before retrieval).

Supporting NO_PROFILE contrast (inference succeeds):

```text
selected_action_count = 0
p_retrieval_status = NO_P_ACTION
```

---

## 7. Tone readiness results

```text
acousticTonePattern_present = false (all diagnostic executions; fixed-RAW Replay has no tone slices)
toneRecallReadiness = null on CORRECT (retrieval not run)
MANDATORY_TONE_FAIL_CLOSED_WHEN_P_SELECTED = NOT_TRIGGERED
```

No case had `selected_actions > 0`, so Tone fail-closed could not be confirmed or rejected.

---

## 8. D decision results (CORRECT_PROFILE)

```text
domain_none = null
domain_action = null
```

Domain head **not reached** (same inference failure). Not derived from `d_added == 0`.

---

## 9. D retrieval results

CORRECT: not reached.

NO_PROFILE contrast (when inference succeeds):

| case | domain_none | domain_action | d_hit_count | d_materialized | D owner |
|------|-------------|---------------|-------------|----------------|---------|
| p2_u001_002 | false | `domain_soft:milk_tea` | 26 | 0 | D_MATERIALIZATION_EMPTY |
| p2_u002_001 | false | `domain_soft:milk_tea` | 10 | 0 | D_MATERIALIZATION_EMPTY |

These are **contrast evidence only**; CORRECT owner remains inference failure.

---

## 10. Owner distribution (CORRECT_PROFILE)

```text
P:
  MODEL2_INFERENCE_FAILED: 8

D:
  MODEL2_INFERENCE_FAILED: 8

COMMON_ZERO_OWNER = MODEL2_INFERENCE_FAILED
```

---

## 11. First confirmed zero owner

```text
FIRST_CONFIRMED_ZERO_ACTION_OWNER = MODEL2_INFERENCE_FAILED
OWNER_CONFIDENCE = HIGH
```

Direct evidence: host returns `ok:false` with UTF-8 surrogate encode error when CORRECT profiles include corrupted `personal_terms` (unpaired surrogates). Expand fail-closes before P/D action selection.

**Frozen Replay caveat:** prior Replay compact `model2_invoked=true` treated any `model2` path_trace except `NOT_CAPTURED` as invoked — **`INFERENCE_FAILED` was miscounted as invoked**. Block C “Model2 invoked” on CORRECT is therefore unreliable for decision-stage claims.

---

## 12. Architecture freeze verification

```text
MODEL2_CHANGED = false
RECALL_CHANGED = false
TONE_CHANGED = false
LEXICON_CHANGED = false
PRODUCTION_SEMANTIC_CHANGE = false
NO_ASR = PASS
NO_DATASET_CHANGE = PASS
NO_FROZEN_BATCH_CHANGE = PASS
```

---

## 13. One-delta readiness

```text
ONE_DELTA_READY = YES
ONE_RECOMMENDED_DELTA = Address MODEL2_INFERENCE_FAILED (host IPC / profile string UTF-8 surrogates)
```

This phase **does not fix**. Next allowed delta is encoding/transport hygiene so Stage-J can actually run under CORRECT_PROFILE — **not** Model2 weight/threshold/catalog changes, and **not** Tone bypass.

---

## 14. One recommended next action

1. Fix Model2 host JSON stdin UTF-8 / sanitize unpaired surrogates in profile payload (observability already proves this is the first blocker).  
2. Re-run the same diagnostic sample.  
3. Only then classify Stage-J P action selection / Tone readiness / D domain_none on CORRECT_PROFILE.

---

## Final answers

> 在 CORRECT_PROFILE 已存在、Model2 Stage-J 已被调用的情况下，P 和 D 为什么没有产生 candidate addition？

前提修正：本诊断中 CORRECT_PROFILE **并未成功调用** Stage-J decision（`inference_failed`）。冻结 Replay 的 “invoked” 分类不可靠。

```text
P: first confirmed zero point = MODEL2_INFERENCE_FAILED
D: first confirmed zero point = MODEL2_INFERENCE_FAILED

FIRST_CONFIRMED_ZERO_ACTION_OWNER = MODEL2_INFERENCE_FAILED
ONE_DELTA_READY = YES
```

Mandatory Tone question: **NOT_TRIGGERED** (`selected_actions` never > 0 on CORRECT).
