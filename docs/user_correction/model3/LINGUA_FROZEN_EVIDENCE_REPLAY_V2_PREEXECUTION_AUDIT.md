# Lingua1 — Frozen Evidence Replay V2 Preexecution Audit

RESULT_ENUM = D — CAPTURE_V2_EVIDENCE_GAP_FOUND

NEXT_OWNER = CAPTURE_V2_CONTRACT_EVIDENCE_AUDIT

CANDIDATE_CAPTURE_V2_SUFFICIENT = NO

CAPTURE_RECORDS_PARSEABLE = 200/200

REPLAY_ROLE_MATRIX_HONORED = PARTIAL

AUTHORIZED_INJECTION_SUPPORTED = PARTIAL

DOWNSTREAM_PRODUCTION_RECOMPUTATION_SUPPORTED = PARTIAL

B1_B18_COMPARATOR_COVERAGE = INSUFFICIENT

IDENTITY_GUARDS_READY = PARTIAL

ACTIVE_V1_CONTAMINATION = NO

FIRST_DIVERGENCE_SEMANTICS_READY = NO

IMPLEMENTATION_REQUIRED_BEFORE_REPLAY = YES

PRODUCTION_ALGORITHM_CHANGE_REQUIRED = NO

CAPTURE_V2_CHANGE_REQUIRED = NO

CURRENT_BASELINE_REPLACED = NO

REPLAY_V2_EXECUTED = NO

REPLAY_EQUIVALENCE_CERTIFIED = NO

TRUSTED_DIALOG200_FUNNEL_V2 = BLOCKED

> Clarification: this Preexecution audit did not modify Capture artifacts or code. Closing the `acousticToneSlices` gap requires a **separate** Capture observability/evidence action under `CAPTURE_V2_CONTRACT_EVIDENCE_AUDIT`. That future Capture repair is outside this round’s write scope.

---

## 1. Verdict

Candidate Capture V2 is **not sufficient** for faithful Replay V2.

Frozen Replay Role Matrix / Boundary Contract require **`acousticToneSlices` as INJECTION_STATE**. Static inspection of `DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2.jsonl` finds **0** occurrences of `acousticToneSlices` / `utterance_tone` across all 200 records.

Prior completeness PASS is **not contradicted as a Capture-completeness-validator failure** (validator never required raw slices). It **is** a Replay-blocking evidence gap relative to frozen injection requirements.

Do **not** fill the gap from V1 evidence (that would be baseline fallback). Do **not** recapture in this round.

Secondary finding (would alone yield Result B after gap closure): **no Replay V2 harness/comparator/first-divergence implementation exists**.

---

## 2. Authority & baseline

| Item | Status |
|------|--------|
| Capture Contract V2 / Role Matrix / Boundary Contract | FROZEN, unchanged |
| EVALUATION_SSOT_V1 | unchanged |
| Candidate Capture V2 | CANDIDATE only; not baseline |
| V1 baseline | remains authoritative |
| Identity Manifest terminology | authoritative; `IDENTITY_RECONSTRUCTABLE` not upgraded to PINNED |
| Replay V2 execution | NOT run |

---

## 3. Dry validation (static only)

| Check | Result |
|-------|--------|
| JSONL parse | **200/200** |
| Schema role | `DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2` / `CANDIDATE_CAPTURE_V2` |
| Gate | ON on inspected cases |
| Completeness field | COMPLETE |
| Profile | `NO_PROFILE` / VALID_EMPTY |
| B5 field name | `finespans` (not `fine_spans`) |
| Production Replay invoke | **not performed** |

Representative cases inspected: `d002` (single-batch), `d001`/`d005` (multi-batch), `d010`/`d149` (script-normalized), `d003` (multipath), Model2/KenLM/Model3 active via B10–B17 payloads.

---

## 4. ASR / Tone Replay boundary

| Question | Answer |
|----------|--------|
| Rerun ASR? | **NO** — `rawAsrText` + `segments.words` are INJECTION_STATE (present in B1) |
| Rerun Tone **model**? | **NO** — `acousticToneSlices` are INJECTION_STATE |
| Recompute Tone **mapping**? | **YES** — B4 mapped `acousticTonePattern` / `toneNorm` are COMPARISON_ONLY |
| Current blocker | Slices **missing** from Candidate Capture V2 → cannot honor Tone inject boundary |

---

## 5. Readiness dimensions (not collapsed)

| Dimension | Status |
|-----------|--------|
| A Injection | **NO** (slices gap; ASR/alignment/profile OK) |
| B Production recomputation | **PARTIAL** (functions exist; cannot drive Tone mapping without slices) |
| C Comparator | **INSUFFICIENT** (only `float-policy.ts`; no B1–B18 Replay V2 comparators) |
| D Identity guards | **PARTIAL** (Manifest reconstructable SHAs; case identity thin) |
| E Missing-evidence semantics | **PARTIAL** (V2 Replay statuses not implemented) |
| F V1 contamination on V2 path | **NO** (no V2 path wired) |
| G Harness | **NO** (no Replay V2 runner; Production inject API reusable later) |

---

## 6. B1–B18 Replay Role summary

Authoritative source: `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_REPLAY_ROLE_MATRIX.json`.

Full matrix: `LINGUA_FROZEN_EVIDENCE_REPLAY_V2_READINESS_MATRIX.json`.

| B | Role | Inject? | Recompute? | Capture | Gap |
|---|------|---------|------------|---------|-----|
| B1 | Inject ASR/segments; compare repairText | ASR YES / repair NO | repair YES | Present | Comparator |
| B2 | Inject alignment (+ slices per matrix part) | Triples YES / **slices NO** | NO | Triples only | **Slices missing** |
| B3 | COMPARISON_ONLY WTS | NO | `buildWordTimeSpans` | Present | Comparator |
| B4 | Inject slices; compare mapped Tone | **Slices required ABSENT** | mapping YES | Mapped windows only | **Evidence gap** |
| B5 | COMPARISON_ONLY `finespans` | NO | YES | `finespans` OK | Comparator |
| B6 | COMPARISON_ONLY WindowQuery | NO | `buildLexicalWindowQueries`+filter | Present | Comparator |
| B7 | COMPARISON_ONLY canonical query | NO | `serializeCanonicalRecallQueryKey` | Present | Comparator |
| B8 | COMPARISON_ONLY SQL + lexicon guard | NO | Production SQL | Present | Comparator |
| B9 | COMPARISON_ONLY Base SET | NO | YES | Untruncated OK | Comparator |
| B10/11 | COMPARISON_ONLY Model2 | NO | YES | Present / NO_PROFILE | Comparator |
| B12 | COMPARISON_ONLY edges | NO | `buildLexicalEdges` | Present | Comparator |
| B13/14 | COMPARISON_ONLY paths | NO | YES | Present | Comparator |
| B15 | COMPARISON_ONLY domain/assembly | NO | YES | Present | Comparator |
| B16 | COMPARISON_ONLY KenLM+gate | NO | YES | Present | Comparator |
| B17 | COMPARISON_ONLY Model3 | NO | YES | Present (unlike V1) | Comparator |
| B18 | COMPARISON_ONLY final | NO | YES | Present | Comparator + no override |

**Forbidden inject (must remain unrecomputed answers):** WTS, mapped Tone, finespans, WindowQuery, CanonicalRecallQuery, Base, Model2 decisions, edges, paths, Domain/Assembly, KenLM pick, Model3 decisions, final.

---

## 7. Production inject surface (capability, not Replay V2)

Existing Production path supports authorized upstream injection:

`POST /run-lexicon-mock` → `InferenceService.runPipelineWithMockAsr`  
fields: `asrText`, `asrSegments`, `acousticToneSlices`, `segmentTimeOffsetsSec`, `asrSegmentNodeBatchIndices`, `segmentCharOffsets`, profile.

This is **ACTIVE_BUT_V2_SAFE** infrastructure. It is **not** a Replay V2 implementation.

---

## 8. Comparator / first divergence

| Item | Status |
|------|--------|
| FLOAT_TIME 0.001 | implemented in `capture-v2/float-policy.ts` |
| KenLM 1e-6 | implemented |
| B1–B18 Replay V2 comparators | **absent** |
| First divergence B1→B18 order | **not implemented** |
| Percentage promotion / EXPECTED_NONDETERMINISM legalization | must not be reintroduced; V1 `decidePromotion` currently `promote:false` (historical) |
| Final equality override | must be forbidden in V2 design |

---

## 9. Identity guards

From `LINGUA_DIALOG200_CAPTURE_V2_IDENTITY_MANIFEST.json` (authority):

| Artifact | Class |
|----------|-------|
| ASR / Tone | IDENTITY_RECONSTRUCTABLE |
| Model2 / KenLM / Lexicon / Model3 | IDENTITY_RECONSTRUCTABLE (SHA present where files exist) |
| Profile | NO_PROFILE / VALID_EMPTY |
| Corpus | 200 WAV inventory hash recorded |

Do not relabel as PINNED. Replay V2 identity-guard module still required.

---

## 10. V1 legacy contamination

See `LINGUA_FROZEN_EVIDENCE_REPLAY_V2_LEGACY_CONTAMINATION.json`.

- **ACTIVE_V2_CONTAMINATION = 0**
- V1 Replay uses `/run-lexicon-mock` + alignment reconstruction helpers + E-stage naming — **DEAD_HISTORICAL** relative to V2 until reused.
- V1 evidence **does** contain `acousticToneSlices` (contrast only). Using it for V2 Replay = contamination.

---

## 11. Proposed Replay V2 flow (not executed)

```
Capture V2 case
→ parse/validate schema
→ identity guard (Manifest)
→ inject ONLY: rawAsr, segments, acousticToneSlices, alignment triples, NO_PROFILE
→ Production mock-ASR entry (no ASR/Tone model)
→ recompute B1.repairText … B18 via Production
→ compare per Role Matrix
→ first divergence in B1–B18 order; mark cascade
→ case result (no promote / no baseline replace)
```

---

## 12. Implementation targets (after evidence gap)

See `LINGUA_FROZEN_EVIDENCE_REPLAY_V2_IMPLEMENTATION_TARGETS.json`.

Priority:

1. **Capture observability repair**: persist Production `acousticToneSlices` as INJECTION_STATE (owner: Capture evidence audit — **not** this round).
2. Replay V2 harness + role-enforcing inject adapter.
3. B1–B18 comparators + first-divergence + NOT_EVALUABLE semantics.
4. Quarantine V1 reconstruct/promotion from V2 imports.

Production algorithm / Evaluation SSOT / baseline replace: **NO**.

---

## 13. Test plan (required before official 200 Replay)

| ID | Intent | Precondition |
|----|--------|--------------|
| T1–T2 | Schema + 200 parse | OK today |
| T3–T4 | Role enforcement; reject downstream inject | Needs R2 |
| T5–T9 | Exact inject ASR/segments/alignment/slices/NO_PROFILE | **T8 blocked until slices in Capture** |
| T10–T27 | Production recompute + comparators B1–B18 | Needs Capture slices + R1/R2 |
| T28–T30 | NOT_EVALUABLE / first divergence / cascade | Needs R2 |
| T31–T36 | No % promote / no nondeterminism legalization / no V1 fallback / no answer inject / identity class / V1 contamination absent | Needs R2 + guards |

---

## 14. Acceptance gates (this audit)

| Gate | Result |
|------|--------|
| G1–G7 no mutate / no Replay exec / no funnel | PASS |
| G8 200 parse | PASS |
| G9–G14 roles / inject / ASR-Tone boundary | PASS (documented); inject **not** fully satisfiable |
| G15–G30 boundary paths | PARTIAL (Production exists; Replay V2 absent; B4 inject broken) |
| G31 float policy match | PASS (code present) |
| G32–G37 semantics / anti-cheat | PARTIAL (design clear; V2 impl absent) |
| G38–G44 identity / NO_PROFILE / V1 scan | PASS for audit scope |
| G45–G48 entrypoint / ownership / targets / tests | PASS (documented) |

---

## 15. Result / Next owner

**D — CAPTURE_V2_EVIDENCE_GAP_FOUND**

**NEXT_OWNER = CAPTURE_V2_CONTRACT_EVIDENCE_AUDIT**

Mandatory frozen injection concept `acousticToneSlices` is absent from Candidate Capture V2 despite completeness PASS. Do not execute Replay V2. Do not use V1 as fallback. Do not promote baseline.

After evidence gap is closed under a separate Capture repair/re-capture contract, Replay readiness should be re-audited; expected subsequent enum absent contamination: **B — REPLAY_V2_IMPLEMENTATION_REQUIRED**.
