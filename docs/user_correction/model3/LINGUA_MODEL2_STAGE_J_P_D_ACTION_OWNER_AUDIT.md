# LINGUA — Model2 Stage-J P/D Action Owner Audit

**Phase:** `LINGUA_MODEL2_STAGE_J_P_D_ACTION_OWNER_AUDIT`  
**Mode:** READ-ONLY / NO DEVELOPMENT  
**Date:** 2026-09-12

---

## 1. Executive verdict

```text
FIRST_CONFIRMED_ZERO_ACTION_OWNER = NOT_CONFIRMED
OWNER_CONFIDENCE = LOW  (for a single root owner across all CORRECT_PROFILE runs)

P_ZERO_OWNER = NOT_CONFIRMED
D_ZERO_OWNER = NOT_CONFIRMED
COMMON_ZERO_OWNER = NONE_CONFIRMED

P_D_TRACE_RELIABILITY = PARTIAL
MODEL2_STAGE_J_CONTRACT = CONNECTED_AS_FROZEN  (with noted Tone/Recall coupling)
ONE_DELTA_READY = NO
PRODUCTION_CODE_CHANGED = false
```

**Direct answer to the audit question:**

> Under CORRECT_PROFILE with Model2 invoked, frozen artifacts prove `p_added=0` / `d_added=0` via the **Replay** extractor (which correctly reads `model2_summary.p_added`), and prove phonetic_bias keys/values exist. They do **not** preserve `selected_actions`, `domain_none` / `domain_action`, span-level `p_retrieval.status`, or `acousticTonePattern` / tone readiness. Therefore code can enumerate the real zeroing gates, but **cannot confirm which gate was the first to fire** on Pilot CORRECT runs.

**Minimal missing evidence (one gap):**

```text
ONE_NEXT_EVIDENCE_GAP =
frozen compact traces lack selected_actions + domain_none/domain_action
+ p_retrieval.status (+ tone pattern presence / toneRecallReadiness)
```

Do **not** relax `phonetic_bias` gate from this audit.

---

## 2. Frozen evidence identity

| Asset | ID |
|-------|-----|
| Dataset | `build_20260911_091806` |
| Block B | `blockb_2026-09-11T1021` |
| Replay | `replay_2026-09-11T1347` |
| Block C | `pilot200-block-c-evaluator-v1` |

No ASR / Replay / dataset regeneration. No production edits.

---

## 3. Production call chain (from code)

```text
span-assembly-v4-orchestrator.ts :: runSpanAssemblyV4Orchestrator
  (per path, after activeCandidatesBase / FineSpan+Recall)
        ↓
expand-active-candidates.ts :: expandActiveCandidatesWithModel2
        ↓
finespan-adapter.ts :: buildModel2PolicyInput   (null ⇒ skip span)
        ↓
inference-host.ts :: Model2InferenceHost.infer
        ↓
model2_inference_host.py :: Model2InferenceHost.infer   ← Stage-J checkpoint
        ↓
  P: selected_actions → relation-lexicon-adapter.ts :: executeProfileLexiconQueries
       → recall-span-topk-v2.ts :: recallSpanTopKV2  (Mandatory Tone Recall)
       → candidate-materialize.ts :: materializeProfileHits
       → pronunciation_candidates_added += mats.length
  D: if !domain_none && domainHits → materializeDomainHits
       → domain_candidates_added += mats.length
        ↓
merge-profile-candidates.ts :: mergeProfileIntoActiveCandidates
        ↓
orchestrator packs model2_summary.{p_added,d_added,selected_actions,...}
into model2PathTrace.paths[] → result.extra.dialog200_path_trace
```

### Stage-J owner

| Field | Value |
|-------|--------|
| `STAGE_J_OWNER_FILE` | `electron_node/electron-node/main/src/model2-runtime/expand-active-candidates.ts` |
| `STAGE_J_OWNER_FUNCTION` | `expandActiveCandidatesWithModel2` |
| Checkpoint host | `electron_node/services/model2_runtime/model2_inference_host.py` + `resolveStageJCheckpoint()` |
| Caller | `runSpanAssemblyV4Orchestrator` after base `activeCandidates`, before Domain Vote / Model3 |
| When | Every path with FineSpans; empty profile still runs (no external skip) |

### Invocation status

| Metric | Status |
|--------|--------|
| `MODEL2_INVOCATION_STATUS` | OBSERVED invoked on Replay (compact `model2_invoked=true` for 597/600) |
| `STAGE_J_INVOCATION_STATUS` | CONNECTED (same function); **count of host.infer calls** = NOT_OBSERVABLE in frozen dumps |
| Note | `model2_invoked=true` ≠ non-empty `selected_actions` (host sets invoked even when `chosen=[]`) |

---

## 4. Stage-J input contract

| Field | Status |
|-------|--------|
| span syllables | PRESENT (else `buildModel2PolicyInput` → null → span skip) |
| window text / raw offsets | PRESENT |
| basePool / baseHits | PRESENT |
| `phoneticBias` (positive-only filter) | PRESENT when profile has `>0` keys |
| personal_terms / domain_evidence | PRESENT (may be empty) |
| acoustic tone on **policy input** | NOT in Model2PolicyInput; tone passed separately into P retrieval |
| `acousticTonePattern` into P Recall | OPTIONAL arg; **absent ⇒ Mandatory Tone fail-closed empty hits** |

### FineSpan → Stage-J

```text
CONNECTED
```

Proof: orchestrator passes `pathFineSpans` into `expandActiveCandidatesWithModel2`; loop is `for (const span of args.pathFineSpans)`.

---

## 5. P path

```text
P_ACTION (production) =
  host selects pronunciation action_ids (after HARD_PERMISSION + nchg)
  → executeProfileLexiconQueries (relation reverse → LexiconRuntimeV2 recall)
  → materializeProfileHits
  → pronunciation_candidates_added (p_added)
```

- Profile-conditioned: **yes** (`phonetic_bias[relation] > 0` required before scoring).
- Does not write final text; expands candidates only.

### HARD_PERMISSION_GATE (real)

| Item | Value |
|------|--------|
| File | `electron_node/services/model2_runtime/model2_inference_host.py` |
| Function | `Model2InferenceHost.infer` |
| Expression | `if not all(float(phonetic_bias.get(r) or 0) > 0 for r in a.relations): continue` |

Gate inputs: `ACTION_CATALOG` single actions’ `relations`, request `phonetic_bias`, `span_syllables` (for subsequent `nchg`).

---

## 6. D path

```text
D_ACTION (production) =
  domain head argmax over DOMAIN_ACTION_CATALOG
  → domain_none = (top == "domain_none")
  → else execute_domain_action on Python domain index
  → domain_hits → materializeDomainHits → domain_candidates_added
```

- **No** `phonetic_bias` permission on D scoring (generic domain head).
- `GENERIC_ALLOWED` relative to phonetic profile: **yes** (contract not drifted on that point).
- If `domain_none` or empty hits / missing index → `d_added=0`.

---

## 7. Ordered gates (real execution order)

| Order | Gate / condition | Owner | Suppress P? | Suppress D? | Evidence |
|------:|------------------|-------|-------------|-------------|----------|
| 1 | Checkpoint load fail / `MODEL2_RUNTIME_DISABLED` | `inference-host` / expand early return | Y | Y | code; Replay invoked⇒not this for 597 |
| 2 | `buildModel2PolicyInput` null (no syllables) | `finespan-adapter` | Y (span) | Y (span) | code |
| 3 | Inference fail / exception | host / expand | Y | Y | code; would set invoked false |
| 4 | **HARD_PERMISSION** `phonetic_bias[r]>0` | `model2_inference_host.py` | Y | N | code |
| 5 | `hypothesize_intended_syllables` `nchg<=0` | same | Y | N | code |
| 6 | Model P ranking → `chosen=[]` | Stage-J logits + budget | Y | N | code; **chosen NOT frozen** |
| 7 | `selectedActions.length==0` → `NO_P_ACTION` | expand | Y | N | code |
| 8 | **Mandatory Tone Recall** `no_pattern` → empty hits | `tone-first-tier-collector` / `recall-span-topk-v2` | Y (hits) | N | code; Replay Tone typically absent |
| 9 | Domain argmax `domain_none` | host | N | Y | code; **domain_none NOT frozen** |
| 10 | Domain index missing / no hits | host executor | N | Y | code |

```text
COMMON_PRE_P_D_GATE =
  load/infer failure OR no policy syllables
  (not phonetic_bias — D is independent)
```

For Pilot Replay with `model2_invoked=true`, common pre-gate (1–3) is **not** the explanation for the bulk.

---

## 8. ACTIVE_SET / phonetic_bias mapping

| PROFILE_KEY | STAGE_J / host `_ACTIVE` | MATCH |
|-------------|--------------------------|-------|
| n_l | n_l | YES |
| z_zh | z_zh | YES |
| ch_c | ch_c | YES |
| sh_s | sh_s | YES |
| eng_en | eng_en | YES |
| in_ing | in_ing | YES |
| h_f | h_f | YES |

```text
ACTIVE_SET_MAPPING_STATUS = MATCH
RELATION_KEY_MISMATCH = not found
```

`finespan-adapter.positiveRecord` keeps only `v > 0` under the **same string keys**.

Frozen CORRECT examples (artifact values, not only keys):

| caseId | relation | profile bias | keys in runtimeProfile |
|--------|----------|--------------|------------------------|
| p2_u001_002 | n_l | n_l≈0.969, in_ing≈0.850 | n_l, in_ing |
| p2_u002_002 | z_zh | z_zh≈0.994, sh_s≈0.969 | z_zh, sh_s |

```text
PROFILE_RUNTIME_STATUS = PRESENT (keys + artifact values > 0)
VALUE_IN_COMPACT_TRACE = VALUE_NOT_OBSERVABLE (keys only)
```

Permission gate **can** PASS for CORRECT; therefore gate FAIL is **not** proven as first owner for CORRECT.

---

## 9. Candidate generation

| Path | Owner |
|------|--------|
| `P_GENERATOR_OWNER` | `executeProfileLexiconQueries` → `recallSpanTopKV2` → `materializeProfileHits` |
| `D_GENERATOR_OWNER` | Python `execute_domain_action` → `materializeDomainHits` |

Empty P hits when Mandatory Tone readiness ≠ `ready` (`no_pattern` if no `acousticTonePattern`) — **fail closed**, all lengths via `collectTierCandidatesToneFirst` / length-1 collector.

---

## 10. Union / dedup

| Item | Value |
|------|--------|
| `UNION_OWNER_FILE` | `merge-profile-candidates.ts` |
| `UNION_OWNER_FUNCTION` | `mergeProfileIntoActiveCandidates` |
| `DEDUP_KEY` | `termId` (diagnostics) |

`p_added` increments **before** merge dedup (`pronunciationAdded += mats.length`).  
Therefore `p_added=0` means **no materialized P mats**, not “all duplicates removed”.

```text
L GENERATED_CANDIDATE_ALREADY_IN_BASE
```
cannot explain global zero additions.

---

## 11. `p_added` / `d_added` provenance

### Production

```text
pronunciation_candidates_added  (expand-active-candidates.ts)
domain_candidates_added
        ↓
model2_summary.p_added / d_added  (span-assembly-v4-orchestrator.ts)
        ↓
extra.dialog200_path_trace.paths[].model2_summary
```

Increments: **after** retrieval materialize, **before** union dedup.

### Replay extractor (Block C input)

```text
sum.p_added = model2_summary.p_added   ← CORRECT field
```

### Block B extractor (historical)

```text
m2 = path.model2 || path.model2_summary
m2.p_action_count   ← WRONG: prefers path_trace object without p_added
```

⇒ Block B compact `p_action_count=0` is **UNRELIABLE** (extraction bug).  
Replay / Block C zeros remain the authoritative frozen addition counters.

### Default-zero risk

| Location | Risk |
|----------|------|
| `p_added: model2Diag.pronunciation_candidates_added ?? 0` | OK if diag present |
| Replay `Number(sum.p_added ?? 0)` | OK when summary present |
| Block B `m2.p_action_count \|\| 0` | **TRACE_ZERO_DEFAULT_RISK** (wrong object) |

```text
P_D_TRACE_RELIABILITY = PARTIAL
  - Replay p_added/d_added: RELIABLE when model2_summary present
  - selected_actions / domain_none: NOT IN COMPACT TRACE
  - base/union counts: UNRELIABLE (Array vs {count,items})
  - Block B p/d compact: UNRELIABLE
```

---

## 12. Trace reliability / naming table

| Semantic | Production | Runtime summary | Replay compact | Block C | Match |
|----------|------------|-----------------|----------------|---------|-------|
| P decision | `selected_actions` | `model2_summary.selected_actions` | **missing** | n/a | GAP |
| P added | `pronunciation_candidates_added` | `p_added` | `p_action_count` ← p_added | used | YES (Replay) |
| D decision | `domain_action` / `domain_none` | same | **missing** | n/a | GAP |
| D added | `domain_candidates_added` | `d_added` | `d_action_count` | used | YES (Replay) |
| Base count | `compactCandidates.count` | `{count,items}` | Array.isArray → 0 | ignored | NO |
| Union count | path_trace.union | same | schema mismatch | ignored | NO |

---

## 13. Representative frozen-case evidence (diagnostic only)

CORRECT_PROFILE, P2/P3, repair-needed, lexicon target, Model2 invoked (8 samples):

| caseId | rel | bias keys | Stage-J reached? | permission reachable? | P/D decision | P/D gen | p_added | d_added |
|--------|-----|-----------|------------------|----------------------|--------------|---------|--------:|--------:|
| p2_u001_002 | n_l | n_l,in_ing | YES (invoked) | YES (values>0) | NOT_OBSERVABLE | NOT_OBSERVABLE | 0 | 0 |
| p2_u001_004 | n_l | n_l,in_ing | YES | YES | NOT_OBSERVABLE | NOT_OBSERVABLE | 0 | 0 |
| p2_u002_001 | z_zh | z_zh,sh_s | YES | YES | NOT_OBSERVABLE | NOT_OBSERVABLE | 0 | 0 |
| p2_u002_002 | z_zh | z_zh,sh_s | YES | YES | NOT_OBSERVABLE | NOT_OBSERVABLE | 0 | 0 |
| p2_u003_001 | eng_en | eng_en,h_f | YES | YES | NOT_OBSERVABLE | NOT_OBSERVABLE | 0 | 0 |
| p2_u003_002 | eng_en | eng_en,h_f | YES | YES | NOT_OBSERVABLE | NOT_OBSERVABLE | 0 | 0 |
| p2_u002_016 | sh_s | z_zh,sh_s | YES | YES | NOT_OBSERVABLE | NOT_OBSERVABLE | 0 | 0 |
| p2_u002_017 | sh_s | z_zh,sh_s | YES | YES | NOT_OBSERVABLE | NOT_OBSERVABLE | 0 | 0 |

```text
DECISION_DISTRIBUTION_NOT_OBSERVABLE
GATE_REACHED (permission) for CORRECT = LIKELY but outcome NOT_OBSERVABLE
```

---

## 14. First confirmed zero-action owner

Root-cause ladder evaluation:

| Code | Result |
|------|--------|
| A PROFILE_NOT_PRESENT | REJECTED (CORRECT keys/values exist) |
| B PROFILE_RELATION_NOT_PRESENT | REJECTED for samples |
| C STAGE_J_NOT_REACHED | REJECTED (`model2_invoked`) |
| F RELATION_KEY_MISMATCH | REJECTED |
| H PHONETIC_BIAS_PERMISSION_BLOCKED | REJECTED as **first** CORRECT owner (bias>0); **CONFIRMED** for NO_PROFILE P only |
| I MODEL_DECISION_NO_ACTION | **POSSIBLE, NOT_OBSERVABLE** |
| J P_GENERATOR_EMPTY (Mandatory Tone) | **POSSIBLE & code-confirmed mechanism** for Replay without tone pattern; **not proven first** without `selected_actions` |
| L already-in-base | REJECTED as global explanation |
| N/O TRACE wrong / default zero | Block B compact P/D **yes**; Replay p_added **no** |

```text
FIRST_CONFIRMED_ZERO_ACTION_OWNER = NOT_CONFIRMED
```

Cannot pick a single earliest owner for CORRECT_PROFILE without decision/retrieval status fields.

---

## 15. Architecture drift check

| Contract item | Status |
|---------------|--------|
| FineSpan-local expansion | CONNECTED |
| phonetic_bias active for P | CONNECTED (HARD_PERMISSION in host) |
| P profile-conditioned | CONNECTED |
| D generic (no phonetic gate) | CONNECTED |
| Model2 expands candidates only | CONNECTED |
| Model2 ≠ Recall owner | CONNECTED (calls Recall for P queries) |
| tone_bias Model2 input | STILL DEFERRED / not Model2 feature |
| P Recall Mandatory Tone | **Coupling**: Stage-J P retrieval depends on acoustic tone pattern; Replay lacks slices |

```text
MODEL2_STAGE_J_CONTRACT = CONNECTED_AS_FROZEN
ARCHITECTURE_CHANGE_REQUIRED = false
```

(Tone coupling is an observability / experiment-harness limitation, not a license to reconnect Tone this phase.)

---

## 16. One-delta readiness

```text
ONE_DELTA_READY = NO
```

```text
ONE_NEXT_EVIDENCE_GAP =
MINIMAL_OBSERVABILITY_DELTA_REQUIRED:
  Persist into compact execution / sidecar (no full GB dumps):
  - model2_summary.selected_actions (or counts + top ids)
  - model2_summary.domain_none, domain_action
  - per-path or aggregate: p_retrieval executed vs NO_P_ACTION
  - acousticTonePattern_present (bool) / toneRecallReadiness
Stop after that instrumentation proves first gate; do not re-run 600 for “prettier scores”.
```

---

## 17. One next action

```text
STOP development.
Do not relax HARD_PERMISSION_GATE.
Do not retrain Stage-J.
Do not modify Recall / KenLM / Dataset.

User decision:
  approve MINIMAL_OBSERVABILITY_DELTA for selected_actions + domain_none + P retrieval status + tone-present flag
  OR accept NOT_CONFIRMED and keep Block C owner as investigation area only.
```

---

## Final question (answered)

> Why are P/D still all zero when CORRECT_PROFILE reached runtime and Model2 was invoked?

**Proven:** Stage-J ran; bias keys/values present; Replay `p_added`/`d_added` counters are the real materialize counts and are zero; permission is not a proven first failure for CORRECT; Block B’s compact P/D zeros were contaminated by extractor field mismatch.

**Not proven:** whether the first zeroing step was empty `selected_actions` / `domain_none`, Mandatory Tone empty P retrieval, domain index/hits empty, or span `nchg` filtering.

> Unique minimal missing evidence?

**`selected_actions` + `domain_none`/`domain_action` + P retrieval status (+ tone-pattern presence)** on frozen compact traces.
