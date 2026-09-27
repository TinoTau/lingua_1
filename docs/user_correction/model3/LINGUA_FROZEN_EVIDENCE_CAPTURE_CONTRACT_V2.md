# Lingua1 — Frozen Evidence Capture Contract V2

**STATUS: FROZEN** (schema / float / boundary contract unchanged)  
**Contract ID:** `DIALOG200_FROZEN_EVIDENCE_CAPTURE_CONTRACT_V2`

**BASELINE AUTHORITY UPDATE — Engine Stable V1 (SUPERSEDES baseline lines below):**

```text
CURRENT_BASELINE_REPLACED = YES
AUTHORITATIVE_DIALOG200_BASELINE = Capture V2
RUN_ID = dialog200_capture_v2_20260925100532
SHA256 = ae4b569473cbaa01fe905efa6368b58d7f295468451195eeb9d4cd8b4fdca13a
V1_AUTHORITY_RETIRED = YES
V1_STATUS = HISTORICAL_ONLY
V1_RUNTIME_FALLBACK = NOT_RUNTIME_FALLBACK
REPLAY_EQUIVALENCE_CERTIFIED = YES
TRUSTED_DIALOG200_FUNNEL_V2 = UNBLOCKED_FOR_ENGINEERING_BASELINE
```

The original freeze header recorded contract-freeze time, when REPLACE had not yet happened. Those baseline-status lines are **historical**. Capture schema, roles matrix, and float policy are unchanged.

**Machine companions:**  
- `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_BOUNDARY_CONTRACT.json`  
- `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_REPLAY_ROLE_MATRIX.json`  
- `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_FREEZE_VALIDATION.json`

---

## Freeze Result Header

```
RESULT_ENUM = A — CAPTURE_V2_CONTRACT_FROZEN
NEXT_OWNER = CAPTURE_V2_OBSERVABILITY_DEVELOPMENT
CAPTURE_CONTRACT_V2_FROZEN = YES
PRODUCTION_ALGORITHM_CHANGE = NO
OBSERVABILITY_ONLY_CHANGE_AUTHORIZED = YES
RECAPTURE_REQUIRED = YES
CURRENT_BASELINE_REPLACED = NO
SINGLE_BASELINE_AUTHORITY_PRESERVED = YES
REPLAY_EQUIVALENCE_CERTIFIED = NO
TRUSTED_DIALOG200_FUNNEL_V2 = BLOCKED
FLOAT_POLICY_RESOLVED = YES
B1_B18_CONTRACT_COMPLETE = YES
IMPLEMENTATION_CRITICAL_DECISIONS_REMAINING = 0
```

Predesign audit remains **historical design evidence only**. This document is the **authoritative Capture V2 SSOT**. Implementation must conform; it must not silently reinterpret.

---

## 1. Purpose

Define what Dialog200 Capture V2 must observe so Capture↔Replay comparison can locate the **first true Production-boundary divergence**, not merely the first persisted diverge.

This freeze:

- does **not** implement hooks  
- does **not** run Capture/Replay  
- does **not** replace baseline  
- does **not** change Production/Evaluator behavior  

---

## 2. Accepted Predesign Inputs

| Item | Frozen value |
|------|----------------|
| RESULT_ENUM (predesign) | B — MINOR_OBSERVABILITY_HOOKS_REQUIRED |
| RECAPTURE_REQUIRED | YES |
| PRODUCTION_ALGORITHM_CHANGE_REQUIRED | NO |
| OBSERVABILITY_ONLY_CHANGE_REQUIRED | YES |
| REPLAY_BOUNDARY_CHANGE_REQUIRED | NO |
| CURRENT_BASELINE_REPLACED | NO |
| REPLAY_EQUIVALENCE_CERTIFIED | NO |
| TRUSTED_DIALOG200_FUNNEL_V2 | BLOCKED |

---

## 3. Single SSOT Governance

**Exactly one** authoritative Dialog200 baseline at all times.

| Now | Role |
|-----|------|
| Capture V2 (`DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2.jsonl`) | **authoritative Dialog200 engineering baseline** |
| Frozen Evidence V1 | **HISTORICAL_ONLY** — `NOT_RUNTIME_FALLBACK` |
| Capture Contract V2 (this doc) | **capture contract** — schema unchanged by baseline REPLACE |

### Lifecycle (frozen)

```
V2 Contract Freeze
→ Observability Implementation
→ Capture V2  (= CANDIDATE_CAPTURE_V2, not authority)
→ Capture Completeness Validation
→ Replay V2
→ Replay Equivalence Validation
→ VALIDATE
→ REPLACE DIALOG200_BASELINE_SSOT
→ retire V1 baseline authority (V1 may remain historical audit only)
```

**FORBIDDEN:** dual authority, fallback, compatibility, merge, env-selectable authority, approximate % promotion.

**Rule:** VALIDATE → REPLACE → ONE SSOT.

---

## 4. d149 Status (non-defect freeze)

**Observed Production data-flow fact (not a defect conclusion):**

`raw ASR → normalizeForFwRepairInput (Trad→Simp + NFKC) → repairText`  
`buildWordTimeSpans` consumes **repairText**; ASR `segments.words` tokens may remain original script.

**Still frozen as case evidence only:**

- `FIRST_OBSERVABLE_DIVERGENCE = B9 / E3 Base materialization`  
- `TRUE_FIRST_DIVERGENCE = NOT_PROVABLE_WITH_CURRENT_FROZEN_EVIDENCE`

**NOT frozen as defects:** Production/Replay WTS bug, normalization bug, Tone bug, Base Recall bug.

**No d149-specific fields or behavior** in this contract.

---

## 5. Env Gate & Observability Authority

| Item | Value |
|------|--------|
| Gate | `FROZEN_EVIDENCE_CAPTURE_V2=1` |
| Default | **OFF** |
| Conceptual owner | Capture V2 (not `MODEL2_DIALOG200_TRACE`) |
| Reuse | Existing TRACE/collector code may be reused **internally** |
| When OFF | Production behavior + normal diagnostics unchanged |
| When ON | Snapshot existing runtime objects only |

### Allowed

read · immutable copy · canonical serialize · hash · audit side-channel append

### Forbidden

mutate Production · reorder collections · alter cache/SQL/async/model inputs/path enum/thresholds/gates · add fallback · add business fields for capture convenience · Production decisions depending on capture state

### Production source files

May be touched as **OBSERVABILITY_ONLY_CHANGE** if:

1. snapshot-only  
2. env-gated  
3. default OFF  
4. no business-interface semantic change  
5. no JobResult **core** schema pollution  
6. no decision dependency on trace  
7. OFF vs ON behavior parity tests  

**“File modified” ≠ failure. “Behavior modified” = hard failure.**

### JobResult

JobResult remains cross-service main-chain transport. Prefer dedicated Capture V2 collector/sink. `JobResult.extra` diagnostic attachment only if explicitly non-business and non-core-contract. No Production consumer may depend on Capture V2 evidence.

---

## 6. Float Policy (resolved)

### FLOAT_EXACT_DISCRETE

Tone class digits, indices, counts, IDs, syllable positions, integer geometry, flags, path/query keys → **exact**.

### FLOAT_TIME

Word/span/slice/offset/window times.

| Parameter | Value |
|-----------|--------|
| abs_tolerance_sec | **0.001** |
| Authority | `ALIGNMENT_TIME_TOLERANCE_SEC` in `dialog200-frozen-replay-alignment-state.mjs` — **JSON/IEEE timestamp serialization noise**, not Capture↔Replay observed deltas |
| Persist | original IEEE values |

### FLOAT_MODEL_SCORE

| Producer | Policy |
|----------|--------|
| KenLM scores / deltaVsRaw | Persist original; compare abs **1e-6** (`SCORE_ABS_TOLERANCE` in `dialog200-frozen-evidence-replay-contract.mjs`); must not widen ad hoc |
| Scores absent | score submetric **NOT_EVALUABLE** |
| Model2/Model3 float tensors | Persist if present; numeric equality **NOT_EVALUABLE** unless future SSOT adds producer tolerance; discrete decisions/anchors remain exact |
| Tone posteriors | Certification via **argmax → discrete pattern**; raw posterior numeric **NOT_EVALUABLE** |

**Do not invent Production tie-breaks** for equal KenLM scores. If no total-order contract → order submetric **NOT_EVALUABLE**.

---

## 7. Missing Evidence / Fail Gate

Statuses: `PASS | FAIL | UNKNOWN | NOT_APPLICABLE | NOT_EVALUABLE`

**FAIL** only when all hold: concept defined · measurement defined · Capture evidence · Replay evidence · env/capability · valid comparator · values violate.

Otherwise **NOT_EVALUABLE** / **UNKNOWN** per EVALUATION_SSOT_V1.

Never: missing → FAIL; missing → PASS; empty array as PASS when field missing.

Capture mandatory miss → **`CAPTURE_INCOMPLETE`** (not silent empty success).

---

## 8. B1–B18 Boundary Contracts

Authoritative detail: `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_BOUNDARY_CONTRACT.json`.

| ID | Concept | Evidence | Replay role (core) | Comparator gist |
|----|---------|----------|--------------------|-----------------|
| B1 | rawAsr + **repairText** + segments | FULL | inject ASR/segments; **compare** repairText | exact + FLOAT_TIME stamps |
| B2 | alignment triples | FULL | **INJECTION_STATE** | FLOAT_TIME offsets; indices exact |
| B3 | **WordTimeSpan[]** at producer exit | FULL | COMPARISON_ONLY | ordered semantic; FLOAT_TIME |
| B4 | mapped Tone / toneNorm | FULL | inject slices; **compare** mapped | exact toneNorm/pattern |
| B5 | **`finespans`** (not `fine_spans`) | FULL | COMPARISON_ONLY | FineSpan identity SET |
| B6 | **buildLexicalWindowQueries + latticeHardBlockFilter** | FULL | COMPARISON_ONLY | windows + separate counts |
| B7 | `serializeCanonicalRecallQueryKey` | FULL | COMPARISON_ONLY | serialized key SET |
| B8 | Base SQL | **HASH_PLUS_SUMMARY** | COMPARISON_ONLY | params + ordered semantic rows |
| B9 | Base materialization | FULL | COMPARISON_ONLY | **SET** primary; MULTISET secondary |
| B10 | Model2 input | HASH_PLUS_SUMMARY | COMPARISON_ONLY | identity + hash |
| B11 | Model2 output | FULL | COMPARISON_ONLY | action/candidate SET |
| B12 | LexicalEdge | FULL | COMPARISON_ONLY | edge identity SET |
| B13 | Path pre-cap | HASH_PLUS_SUMMARY | COMPARISON_ONLY | count + hash |
| B14 | Path post-cap | FULL | COMPARISON_ONLY | retained path_ids + capEvents |
| B15 | Domain / SameDomain / Assembly | FULL | COMPARISON_ONLY | vote + sentence SET |
| B16 | KenLM pool/score/gate | FULL | COMPARISON_ONLY | pool SET + pick + gate; scores per float policy |
| B17 | Model3 anchors/input/decisions | FULL | COMPARISON_ONLY | anchors + input_trace + decisions |
| B18 | Final text | FULL | COMPARISON_ONLY | exact string |

### Hard rules (selected)

- **B3:** Capture consumer-visible WTS; never inject into Replay; never infer from segments.  
- **B4:** Identical slices ≠ identical mapped Tone.  
- **B5:** Wrong field name → NOT_EVALUABLE, not empty PASS.  
- **B6:** Not harness `generateGlobalWindows`. Counts never collapsed.  
- **B7:** Serializer authority = Production `serializeCanonicalRecallQueryKey`.  
- **B8:** No invented SQL nondeterminism tolerance.  
- **B9:** No `.slice`/display cap in authoritative payload.  
- **B14:** Path mismatch under identical edges+limits = real mismatch; no `EXPECTED_NONDETERMINISM`.  
- **B15:** Path-specific Domain Vote; no domain→segmentation feedback.  
- **B16:** No authoritative pool truncation; no invented tie-break.  
- **B17:** Missing input evidence → dependent Model3 metrics NOT_EVALUABLE.  
- **B18:** Terminal only; does not certify upstream.

Canonical query identity (Production):

`v2|kind|pinyinKey|toneNorm|domainsSorted|exactTopK|lexiconVersion|surfaceText`

---

## 9. Canonical Serialization

Shared Capture V2 layer:

**May strip:** jobId, sessionId, absolute machine paths, runtime handles, object addresses.  
**Must keep:** text, geometry, tone, pinyin, scores, domains, provenance, path/query/gate identity.  
**Maps/Sets:** copy then serialize; never mutate Production.  
**Sort:** only when Production concept is semantically unordered. Never sort ordered concepts to match hashes.

---

## 10. Recapture & Completeness

`RECAPTURE_REQUIRED = YES` — V1 not losslessly upgradable.  
Capture entry: full-audio Production pipeline (ASR/Tone run again).  
Artifact name role: **`CANDIDATE_CAPTURE_V2`** until REPLACE.

### Completeness gate (all 200 cases)

case/WAV identity · B1–B18 required evidence · no unauthorized truncation · identity guards · gate state · schema version · code/runtime/model/lexicon identity · no silent empty success for required misses → else **CAPTURE_INCOMPLETE**.

Replay V2 equivalence validation must not start until completeness PASS.

---

## 11. Baseline Replacement — COMPLETE (Engine Stable V1)

REPLACE executed. Authoritative baseline is Capture V2. V1 authority retired. No approximate promotion thresholds. No dual authority.

Historical note: at contract-freeze time this section said replacement was "not this round". That statement is **SUPERSEDED**.

---

## 12. Funnel

`TRUSTED_DIALOG200_FUNNEL_V2` engineering baseline authority is **unblocked** after Engine Stable V1 REPLACE. Business-quality funnel metrics remain a separate track and are not an Engine Stable gate.

---

## 13. Predesign D1–D5 Resolution

| ID | Resolution |
|----|------------|
| D1 Float | §6 Float Policy (TIME 1e-3 auth; KenLM 1e-6 auth; else NOT_EVALUABLE) |
| D2 Base comparator | SET primary; MULTISET secondary; ordered not default |
| D3 SQL depth | HASH_PLUS_SUMMARY |
| D4 Model3 | FULL anchors + inference_input_trace + decisions; packed features HASH |
| D5 Hook authority | `FROZEN_EVIDENCE_CAPTURE_V2=1` + OBSERVABILITY_ONLY_CHANGE authorized |

`LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_DECISION_REQUIRED.md` is **superseded** (historical).

---

## 14. CAPTURE_V2_IMPLEMENTATION_TARGET_LIST

**Not implementation — development targets for next owner.**

### New / harness (preferred)

| Target | Why |
|--------|-----|
| Capture V2 collector/sink module | Dedicated side-channel; avoid JobResult core pollution |
| Canonical serializer + hash helper | Shared B1–B18 serialization |
| Schema writer (jsonl/artifact) | Persist `DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2` |
| Completeness validator | Enforce CAPTURE_INCOMPLETE |
| Capture harness `run-dialog200-frozen-acoustic-evidence-capture-v2.mjs` | Full-audio entry; gate ON; no V1 field-name bugs |
| OFF/ON parity tests | Prove no behavior change when gate OFF |
| Unit tests for serializer / float policy / role matrix | Contract conformance |

### Production files that may need OBSERVABILITY_ONLY hooks

| File | Why state is otherwise invisible |
|------|----------------------------------|
| `span-assembly-v4-orchestrator.ts` | `WordTimeSpan[]` is local; not JobContext |
| `recall-topk-for-windows.ts` | mapped Tone + CanonicalRecallQuery + SQL summaries are loop-local |
| `lattice-fine-span-runtime.ts` | LexicalEdge + path pre/post-cap events not in Capture V1 |
| `fw-detector-orchestrator.ts` / repair path | Ensure repairText snapshot at consumer entry |
| `dialog200-path-trace.ts` | Reuse compactors; Capture mode must **not** apply display caps to authoritative payloads |
| `result-builder-core.ts` | Optional attach of Capture sink reference under gate — diagnostic only |
| `run-model3-path-step.ts` / diagnostics | Ensure anchors + `inferenceInputTrace` reachable by sink |

Internal reuse of TRACE helpers allowed; **gate ownership remains Capture V2**.

---

## 15. Development Checklist (future)

- [ ] `FROZEN_EVIDENCE_CAPTURE_V2` default OFF  
- [ ] B1–B18 evidence per contract  
- [ ] No authoritative truncation  
- [ ] Canonical serialization + float policy  
- [ ] Side-channel only; no JobResult business-schema pollution  
- [ ] No Production mutation / decision dependency  
- [ ] OFF/ON behavior parity tests  
- [ ] Dialog200 200-case completeness  
- [ ] Artifact + runtime/model/lexicon identity  
- [ ] Replay roles respected; no downstream answer injection  
- [ ] Single SSOT lifecycle; no dual baseline  
- [ ] Funnel remains BLOCKED until REPLACE complete  

---

## 16. Freeze Validation Gates

G1–G36: see `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_FREEZE_VALIDATION.json` — all **PASS**.

---

## 17. Final Principle

Freeze measurement first. Implement second. Capture third. Interpret last.

Target chain:

Production runtime state → faithful evidence → Replay recomputation → contract-valid comparison → **first true divergence directly observable**.
