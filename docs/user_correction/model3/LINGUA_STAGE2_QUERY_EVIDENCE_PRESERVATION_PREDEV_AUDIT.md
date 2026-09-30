# LINGUA Stage2 Query Evidence Preservation V1 — Pre-Development Code Audit

| Field | Value |
|---|---|
| Phase | `LINGUA_STAGE2_QUERY_EVIDENCE_PRESERVATION_V1_PREDEV_AUDIT` |
| Date | 2026-09-15 |
| Mode | READ_ONLY / NO_PRODUCT_IMPLEMENTATION |
| ACP | `LINGUA-ACP-STAGE2-QUERY-EVIDENCE-PRESERVATION-V1` **APPROVED / FROZEN** |
| Product runtime changed this round | **NO** |

---

## 0. Phase A — ACP freeze corrections

| Correction | Status |
|---|---|
| #1 `ON_RAW_VS_SYLLABLE_CONFLICT = REJECT…FALLBACK_TO_ASR` | **PASS** — frozen in ACP_V1_FROZEN + geometry contract |
| #2 Path wording → `PATH_OWNERSHIP=NONE` / `EVIDENCE_VISIBILITY=ALL_PATHS_OF_SAME_UTTERANCE` | **PASS** — replaces draft `CROSS_PATH_REUSE_ALLOWED` |
| Other ACP decisions altered | **NO** |

```text
ACP_STATUS = APPROVED_FROZEN
IMPLEMENTATION_STATUS = NOT_STARTED
```

---

## 1. Call graph — BEFORE (production today)

```text
runLatticeFineSpanGenerationWithPreEdgeModel2
  → Base Recall (windows)
  → expandWindowsWithModel2
       → host.infer (Model2)
       → executeProfileLexiconQueries          ← QUERY_EXECUTED_BY_RECALL
            → hypothesizeIntendedSyllables / applyRelationsChain
            → recallSpanTopKV2(querySyllables)  ← transformed query call-local
            → return ProfileQueryResult[]
       → materializeProfileHits                 ← transformed pinyin LOST on candidate
            (WindowCandidate.windowPinyinKey = ASR policyInput.windowPinyinKey)
  → LexicalEdge → path enum → PathFineSpanView[]
  → LatticeFineSpanSuccess { model2Diagnostics?, … }

span-assembly-v4-orchestrator (per path):
  → Domain Vote → Anchors → runModel3PathStep
       → routeModel3Retry
            → enumerateStage2SuccessPathQueryLocals
            → syllables = globalSyllables.slice(local.sylStart, local.sylEnd)  ← ASR
            → windowPinyinKey = syllables.join('|')
            → recall({ syllables, … retainedDomains })
                 → recallSpanTopKV2(syllables, recallMode=model3_retry_pinyin_domain_recovery)
```

---

## 2. Call graph — AFTER (planned touchpoints only)

```text
executeProfileLexiconQueries / expandWindowsWithModel2
  → after each recallSpanTopKV2 execution
  → emit RecallQueryEvidence { pinyinKey, syl/raw geometry, source }
  → attach to ExpandWindowsWithModel2Result / LatticeFineSpanSuccess store

orchestrator
  → pass store into runModel3PathStep args (pipeline-local; not JobResult)

routeModel3Retry Stage2 loop
  → mapped = mapEvidenceToStage2Window(store, local)
  → syllables/windowPinyinKey = mapped ?? ASR slice
  → existing recallSpanTopKV2 (one invocation / window)
```

No second Recall pipeline. No Model2 on Retry. Model3 does not read evidence.

---

## 3. Producer (exact)

| Item | Value |
|---|---|
| EVIDENCE_PRODUCER_FILE | `electron_node/electron-node/main/src/model2-runtime/relation-lexicon-adapter.ts` + collector in `expand-windows-with-model2.ts` |
| EVIDENCE_PRODUCER_FUNCTION | `executeProfileLexiconQueries` (execution) / collection after return in `expandWindowsWithModel2` |
| EVIDENCE_CREATION_BOUNDARY | After `recallSpanTopKV2(...)` succeeds into `queries.push({…})` (~L94–122 `relation-lexicon-adapter.ts`); geometry from `policyInput` in expand (~L446–478) |

**QUERY_EXECUTED_BY_RECALL** = entry into `recallSpanTopKV2` with Model2-conditioned `querySyllables`.

Do **not** emit on: relation predict only, nChanged≤0 skip, identity skip, empty action list.

Geometry for evidence = originating FineSpan / policyInput:

- `syllableStart/End`, `rawStart/End` from `Model2PolicyInput` / window evidence
- `pinyinKey` from executed `ProfileQueryResult.pinyinKey`

---

## 4. Existing type / carrier audit

| TYPE | OWNER | LIFETIME | CREATED_BEFORE_PATH? | SURVIVES_TO_RETRY? | PATH_SCOPED? | CANDIDATE_SCOPED? | CROSS_SERVICE? | COUPLING | SUITABLE |
|---|---|---|---|---|---|---|---|---|---|
| `ProfileQueryResult` | Model2/Recall adapter | call-local | yes (inside expand) | **NO** (not retained) | no | no | no | low | **NO** — no persistence |
| `WindowCandidate` | Lattice/candidate | until drop | yes | only if survives | via path views | **YES** | no | **candidate** | **NO** — violates candidate independence |
| `LexicalEdge` | Lattice | path build | yes | edge-level | edge | edge | no | edge | **NO** |
| `PathFineSpan` / view | Path | path loop | **no** (after paths) | yes on path | **YES** | spans hold cands | no | **path** | **NO** — path-owned |
| `Model2ExpandDiagnostics` | Model2 expand | utterance | yes | on lattice success | no | no | no | diag/env | **NO** — observation/`path_trace` gated; not semantic SSOT |
| `LatticeFineSpanSuccess` | Lattice runtime | utterance assembly | **YES** | **YES** (orchestrator holds) | no | no | no | low | **YES** — extend with evidence store field |
| `ExpandWindowsWithModel2Result` | Model2 expand | feeds lattice | yes | via lattice | no | no | no | low | **YES** — produce store here |
| RetryRegion / Stage2 local | Model3 Retry | retry only | no | n/a | region | no | no | consumer geom | consumer only |
| JobResult / metrics | Adapter | response | n/a | n/a | n/a | n/a | yes | **FORBIDDEN** | **NO** |
| UserProfile | Session | long-lived | n/a | n/a | n/a | n/a | yes | **FORBIDDEN** | **NO** |

### Recommended carrier

```text
RECOMMENDED_CARRIER =
  utterance-local RecallQueryEvidence[] produced by expandWindowsWithModel2,
  attached on LatticeFineSpanSuccess (sibling to model2Diagnostics; NOT inside diagnostics)

CARRIER_OWNER = Lattice Fine Span runtime / Span Assembly V4 orchestrator (pipeline-local)
CARRIER_LIFETIME = single utterance SpanAssemblyV4 invocation
CARRIER_ALREADY_EXISTS = NO (container LatticeFineSpanSuccess EXISTS; evidence field does not)
NEW_TOP_LEVEL_RUNTIME_CONTAINER_REQUIRED = NO
```

Thread: `lattice.recallQueryEvidence` → `model3Args` → `routeModel3Retry({ evidenceStore })`.

```text
JOBRESULT_CHANGE_REQUIRED = NO
EVIDENCE_CANDIDATE_COUPLED = NO (selected design)
EVIDENCE_PATH_COUPLED = NO (selected design)
```

---

## 5. Syllable / pinyin / raw proofs

| Fact | Proof |
|---|---|
| SYLLABLE_INDEX_SEMANTIC | Half-open `[start,end)` — `buildWindowDescriptorForRange` comment + `globalSyllables.slice(start,end)` |
| PINYIN_KEY_ONE_TO_ONE_SYLLABLE_ALIGNMENT | **PROVEN** — `hypothesizeIntendedSyllables` maps 1:1 over observed; `pinyinKey = querySyllables.join('|')`; length = `policyInput.syllableEnd - syllableStart` |
| RAW_OFFSET_SEMANTIC | UTF-16 code units into `rawText` (`String.prototype.slice`) via `syllableRangeToRawCharRange` / Stage2 `rawText.slice(local.rawStart, local.rawEnd)` |
| RAW_OFFSET_COMPARABLE | **YES** — same utterance `rawText` + same half-open raw convention on both sides |
| RAW_CONSISTENCY_CHECK_IMPLEMENTABLE | **YES** — fail-closed: syl EXACT/CONTAINS must match raw EXACT/CONTAINS else reject |

```text
EXACT_MAPPING_IMPLEMENTABLE = YES
EXACT_MAPPING_EXTRA_STATE_REQUIRED = NO (beyond evidence store)
SUBSPAN_SLICE_IMPLEMENTABLE = YES
```

---

## 6. Stage2 consumer seam

| Item | Value |
|---|---|
| STAGE2_CONSUMER_FILE | `model3-runtime/model3-retry-router.ts` |
| STAGE2_CONSUMER_FUNCTION | `routeModel3Retry` Stage2 loop (~L378–400) |
| STAGE2_QUERY_SELECTION_SEAM | After `enumerateStage2SuccessPathQueryLocals`; **replace ASR `syllables` / `windowPinyinKey` before `args.recall(...)`** |

Critical: production Recall uses **`syllables` array** in `run-model3-path-step.ts` recall closure (`recallSpanTopKV2({ syllables, … })`), not `windowPinyinKey` alone. REPLACE must set **both** consistently.

```text
CURRENT_STAGE2_RECALLS_PER_WINDOW = 1
FUTURE_STAGE2_RECALLS_PER_WINDOW = 1
EXTRA_DB_QUERY_REQUIRED = NO
```

Domain:

```text
DOMAIN_CONTEXT_SOURCE = PATH_LOCAL (vote.retainedDomains → domainIds)
EVIDENCE_DOMAIN_COUPLING = NO
CROSS_UTTERANCE_LEAK_POSSIBLE = NO (per-assembly store; no session global)
```

---

## 7. Mapper ownership

```text
MAPPER_OWNER = RECALL (pronunciation query evidence mapping)
MAPPER_FILE_EXISTING_OR_NEW = NEW
  recommended: lexicon-v2/recall-query-evidence.ts
  (or model2-runtime/recall-query-evidence.ts colocated with producer; MUST NOT import Model3)
MAPPER_MODEL3_DEPENDENCY = NO
```

Mapper inputs: evidence store + Stage2 window geometry only. No KEEP/RETRY, no retainedDomains, no Model2 internals.

```text
EXPLICIT_SORT_REQUIRED = YES
DETERMINISTIC_CONFLICT_POLICY_IMPLEMENTABLE = YES
DUPLICATE_EVIDENCE_POSSIBLE = YES (overlapping windows × actions × multi-path visibility of same store)
DEDUP_REQUIRED_FOR_CORRECTNESS = YES
DEDUP_LOCATION = evidence store insert (identity key)
```

---

## 8. Trace

Existing: `retry_recall_invocations` under `MODEL2_DIALOG200_TRACE` already records `windowPinyinKey` / syllables.

```text
TRACE_EXTENSION_REQUIRED = YES
TRACE_TARGET = Model3RetryRecallInvocationTrace (+ optional mappingReason enum)
  values: ASR | RECALL_QUERY_EVIDENCE + NONE|EXACT|SUBSPAN|RAW_CONFLICT_REJECT|UNSUPPORTED_GEOMETRY|INVALID_EVIDENCE
```

Observation-only; not JobResult.

---

## 9. Target implementation shape (~minimal)

```text
1. RecallQueryEvidence type + dedup store helpers
2. Producer emit in expand / after executeProfileLexiconQueries
3. LatticeFineSpanSuccess field + orchestrator thread to Model3 args
4. mapEvidenceToStage2Window (Recall-owned module)
5. REPLACE seam in routeModel3Retry
6. Trace enum extension
7. Unit tests (T1–T14)
```

No architecture expansion beyond threading one store reference.

```text
ARCHITECTURE_CONFLICT_FOUND = NO
IMPLEMENTATION_SCOPE = MINIMAL
```

---

## 10. Q1 acceptance (frozen)

```text
Q1_CONFIRMED = 33
Q1_EXPECTED_MAPPABLE = 32
Q1_DEFERRED = 1
RESEGMENT_CASE_POLICY = DEFERRED
DEFERRED_CASE = p2_u005_011
```

---

## 11. Regression check points (future)

| Invariant | Where to assert |
|---|---|
| Model2 inference count | expand diagnostics / once per lattice |
| Model3 inputs / KEEP/RETRY | existing Model3 tests + inferenceInputTrace |
| Stage2 window enum | `model3-retry-stage2-windows.test.ts` |
| RetryRegion | `model3-retry-region*.test.ts` |
| Tone mode / retainedDomains | Stage2 recall closure + domain acceptance |
| Budget / scoring / SameDomain / Assembly / KenLM | must-not-modify + existing suites |

---

## 12. Anti-drift answers

All required answers: **NO** (no Model2/Model3 redesign, no JobResult, no candidate/path coupling of evidence, no Tone/Domain/budget/RESEGMENT/parallel query/implementation this round).

---

## 13. Final verdicts

```text
ACP_ID = LINGUA-ACP-STAGE2-QUERY-EVIDENCE-PRESERVATION-V1
ACP_STATUS = APPROVED_FROZEN
ACP_CORRECTION_RAW_CONFLICT = PASS
ACP_CORRECTION_PATH_SCOPE = PASS
PRODUCT_RUNTIME_CODE_CHANGED = NO

QUERY_EVIDENCE_OWNER = RECALL
QUERY_EVIDENCE_SCOPE = UTTERANCE_WINDOW
QUERY_EVIDENCE_PATH_OWNERSHIP = NONE
EVIDENCE_VISIBILITY = ALL_PATHS_OF_SAME_UTTERANCE
CROSS_UTTERANCE_REUSE = NO
DOMAIN_CONTEXT = PATH_LOCAL_RETAINED_DOMAINS

EVIDENCE_PRODUCER_FILE = model2-runtime/relation-lexicon-adapter.ts (+ emit collect in expand-windows-with-model2.ts)
EVIDENCE_PRODUCER_FUNCTION = executeProfileLexiconQueries
EVIDENCE_CREATION_BOUNDARY = post-recallSpanTopKV2 queries.push / expand collect with policyInput geometry

RECOMMENDED_CARRIER = LatticeFineSpanSuccess.recallQueryEvidence[] (new field on existing success type)
CARRIER_OWNER = lattice-fine-span-runtime / span-assembly-v4-orchestrator
CARRIER_LIFETIME = utterance SpanAssemblyV4 invocation
CARRIER_ALREADY_EXISTS = NO (container yes; field no)
NEW_TOP_LEVEL_RUNTIME_CONTAINER_REQUIRED = NO

JOBRESULT_CHANGE_REQUIRED = NO
EVIDENCE_CANDIDATE_COUPLED = NO
EVIDENCE_PATH_COUPLED = NO

STAGE2_CONSUMER_FILE = model3-runtime/model3-retry-router.ts
STAGE2_CONSUMER_FUNCTION = routeModel3Retry
STAGE2_QUERY_SELECTION_SEAM = ASR syllables/windowPinyinKey assignment before args.recall

MAPPER_OWNER = RECALL
MAPPER_FILE_EXISTING_OR_NEW = NEW (lexicon-v2/recall-query-evidence.ts recommended)
MAPPER_MODEL3_DEPENDENCY = NO

SYLLABLE_INDEX_SEMANTIC = half-open [start, end)
PINYIN_KEY_ONE_TO_ONE_SYLLABLE_ALIGNMENT = PROVEN
RAW_OFFSET_SEMANTIC = UTF-16 code units into rawText
RAW_OFFSET_COMPARABLE = YES
RAW_CONSISTENCY_CHECK_IMPLEMENTABLE = YES

EXACT_MAPPING_IMPLEMENTABLE = YES
SUBSPAN_SLICE_IMPLEMENTABLE = YES

MULTIPLE_EVIDENCE_POSSIBLE = YES
DETERMINISTIC_CONFLICT_POLICY_IMPLEMENTABLE = YES
DUPLICATE_EVIDENCE_POSSIBLE = YES
DEDUP_REQUIRED_FOR_CORRECTNESS = YES

EVIDENCE_DOMAIN_COUPLING = NO
CROSS_UTTERANCE_LEAK_POSSIBLE = NO

CURRENT_STAGE2_RECALLS_PER_WINDOW = 1
FUTURE_STAGE2_RECALLS_PER_WINDOW = 1
EXTRA_DB_QUERY_REQUIRED = NO

TRACE_EXTENSION_REQUIRED = YES

Q1_CONFIRMED = 33
Q1_EXPECTED_MAPPABLE = 32
Q1_DEFERRED = 1
RESEGMENT_CASE_POLICY = DEFERRED

MUST_MODIFY_FILE_COUNT = 8
MAY_MODIFY_FILE_COUNT = 5
MUST_NOT_MODIFY_FILE_COUNT = 18

ARCHITECTURE_CONFLICT_FOUND = NO
IMPLEMENTATION_SCOPE = MINIMAL
PREDEV_STATUS = PASS
IMPLEMENTATION_ALLOWED_NEXT_ROUND = YES

ONE_NEXT_OWNER = STAGE2_QUERY_EVIDENCE_PRESERVATION_V1_IMPLEMENTATION
ONE_NEXT_DELTA = Single delta: emit RecallQueryEvidence at first-pass Recall boundary; attach on LatticeFineSpanSuccess; thread to routeModel3Retry; EXACT/SUBSPAN REPLACE seam on syllables (fail-closed raw); tests T1–T14. No Model3/Model2/JobResult/budget change.
```
