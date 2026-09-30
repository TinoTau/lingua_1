# Lingua1 — Frozen Evidence Replay V2 Pre-Development Audit

**MODE:** READ_ONLY_AUDIT  
**Date:** 2026-09-26  
**Code change:** NONE  
**Implementation this round:** NONE  

```text
RESULT_ENUM = A — REPLAY_V2_DEVELOPMENT_READY
NEXT_OWNER = FROZEN_EVIDENCE_REPLAY_V2_DEVELOPMENT

CANDIDATE_RUN_ID = dialog200_capture_v2_20260925100532
CANDIDATE_SHA256 = ae4b569473cbaa01fe905efa6368b58d7f295468451195eeb9d4cd8b4fdca13a

CAPTURE_V2_ACCEPTED = YES
CAPTURE_V2_MODIFICATION_REQUIRED = NO

I1_I9_SUFFICIENT = YES

PROPOSED_REPLAY_BOUNDARY =
  inject Capture V2 I1–I9 (post-ASR + acousticToneSlices + NO_PROFILE)
  → Production runPipelineWithMockAsr / FW orchestration
  → recompute B3–B18 (Capture ON for evidence extract OR equivalent TRACE)

PROPOSED_PRODUCTION_ENTRY =
  TEST_ONLY HTTP POST /run-lexicon-mock
  → InferenceService.runPipelineWithMockAsr
  → runJobPipeline (skip ASR; inject JobContext post-ASR fields)
  → existing FW detector / SpanAssemblyV4 / Model2 / KenLM / Model3

B3_RECOMPUTABLE = YES
B4_MAPPED_TONE_RECOMPUTABLE = YES
B5_B18_RECOMPUTABLE = YES

PRODUCTION_ALGORITHM_CHANGE_REQUIRED = NO

REPLAY_V1_REUSE_CLASS = REPLACE_WITH_V2 (harness/comparator); REUSE_AFTER_MECHANICAL_ADAPTATION (float tolerances / mock inject surface)
V1_FALLBACK_REQUIRED = NO

COMPARATOR_CONTRACT_RESOLVED = YES
FIRST_DIVERGENCE_REPORTING_FEASIBLE = YES

REFERENCE_TEXT_REQUIRED = NO

BUSINESS_ACCURACY_IS_FREEZE_GATE = NO
LEXICON_ADAPTATION_REQUIRED = NO

CURRENT_BASELINE_REPLACED = NO
REPLAY_EQUIVALENCE_CERTIFIED = NO
```

---

## 1. Executive verdict

Accepted Candidate Capture V2 (`dialog200_capture_v2_20260925100532`, SHA256 matches) provides **complete I1–I9 injection state**, including **200/200 non-empty `B4.payload.acousticToneSlices`**.

A safe Production downstream entry already exists and was proven in Phase A controlled parity:

`POST /run-lexicon-mock` → `runPipelineWithMockAsr` → `runJobPipeline(skipASR)` → real FW chain.

Replay V2 can be implemented **entirely in test/replay infrastructure** without Production algorithm change, without Capture redesign, and without lexicon/model tuning.

Prior Preexecution audit (`LINGUA_FROZEN_EVIDENCE_REPLAY_V2_PREEXECUTION_AUDIT.md`) that blocked on missing slices is **historical only** — that gap is closed by the accepted Candidate.

**Main remaining work is construction of Replay V2 (loader + I1–I9 adapter + B1–B18 comparator + first-divergence reporter), not Capture repair and not Production redesign.**

Replay V1 remains **invalid under Capture Contract V2** as an authoritative equivalence evaluator (E-stage schema, V1 JSONL authority, alignment reconstruction, promotion naming heritage). It must be **replaced**, not extended as dual mode.

---

## 2. Authoritative Candidate state (not reopened)

| Field | Value |
|-------|--------|
| RESULT | A — CANDIDATE_CAPTURE_V2_READY |
| RUN_ID | `dialog200_capture_v2_20260925100532` |
| JSONL | `docs/user_correction/model3/DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2.jsonl` |
| SHA256 (measured) | `ae4b569473cbaa01fe905efa6368b58d7f295468451195eeb9d4cd8b4fdca13a` |
| Cases | 200/200 COMPLETE |
| Slices | 200/200 present; required-missing = 0 |
| Injection state | REPLAY_MINIMUM_INJECTION_STATE_COMPLETE = YES |
| Profile | NO_PROFILE / VALID_EMPTY |
| Baseline | NOT replaced |
| Replay | NOT executed |

Verified static sample: single `run_id`, schema `DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2`, B2 alignment triples present, B4 `slice_role=INJECTION_STATE`, `acousticToneSlices` present.

---

## 3. Frozen Replay Role Matrix — authoritative I1–I9

Authority: `LINGUA_FROZEN_EVIDENCE_CAPTURE_V2_REPLAY_ROLE_MATRIX.json` + Capture Contract V2.

### Injection state (authorized)

| ID | Field | Capture locus | Notes |
|----|-------|---------------|-------|
| I1 | `rawAsrText` | B1.payload.rawAsrText | Exact string inject |
| I2 | `segments` (+ words + timestamps) | B1.payload.segments | FULL inject |
| I3 | `segmentTimeOffsetsSec`, `asrSegmentNodeBatchIndices`, `segmentCharOffsets` | B2.payload | FULL inject; FLOAT_TIME on offsets |
| I4 | `acousticToneSlices` | **B4.payload.acousticToneSlices** (canonical) | INJECTION_STATE; not reconstructed from mapped Tone |
| I5 | Profile | row `profile_mode=NO_PROFILE` + `profile_evidence=VALID_EMPTY` | Do not invent P/D |
| I6 | Capture schema / contract | row.schema + artifact.schema / contract_id | IDENTITY_GUARD |
| I7 | Model2 / KenLM / Model3 identities | Identity Manifest + case artifact | IDENTITY_RECONSTRUCTABLE (do not invent PINNED) |
| I8 | Lexicon identity | Identity Manifest (sqlite SHA) | IDENTITY_GUARD |
| I9 | Corpus / WAV identity | row.sourceAudio.sha256 + Manifest inventory | IDENTITY_GUARD |

Role Matrix `injection_state_minimum` also lists profile snapshot + IDENTITY_GUARD pins — covered by I5–I9.

### Comparison-only (must NOT inject)

B1.repairText / scriptNormalized · B3 WTS · B4 mapped Tone/toneNorm · B5 FineSpan · B6 WindowQuery · B7 CanonicalRecallQuery · B8–B17 decisions · B18 final.

### No additional injection field authorized

No field audited as required beyond I1–I9. Alignment reconstruction from V1 helpers is **not** required when B2 is present (Candidate has B2).

If a future implementation claims a new inject field, it must open a contract review — not silently expand.

---

## 4. Production entry-point audit

### Proposed Replay V2 entry (TEST_ONLY adapter → Production)

| Item | Value |
|------|--------|
| FILE | `electron_node/electron-node/main/src/test-server.ts` |
| FUNCTION | HTTP `POST /run-lexicon-mock` handler |
| INPUT TYPE | JSON: `asrText`, `segments`, `acousticToneSlices` / `utterance_tone`, alignment triples, `session_id`, `is_manual_cut`, `lexicon_v2_intent_enabled` |
| CALLER | Replay V2 harness (to be built) |
| CALLEE | `InferenceService.runPipelineWithMockAsr` |
| ROLE | TEST_ONLY HTTP surface; **does not** redefine FW business logic |

| Item | Value |
|------|--------|
| FILE | `electron_node/electron-node/main/src/inference/inference-service.ts` |
| FUNCTION | `runPipelineWithMockAsr` |
| INPUT | asrText + optional frozen post-ASR JobContext fields |
| CALLEE | `initJobContext` → field inject → `runJobPipeline` |
| ROLE | Production InferenceService method used by tests |

| Item | Value |
|------|--------|
| FILE | `electron_node/electron-node/main/src/pipeline/job-pipeline.ts` |
| FUNCTION | `runJobPipeline` |
| BEHAVIOR | `skipASR` when `providedCtx.asrText !== undefined` |
| ROLE | Production pipeline; ASR step skipped; FW steps execute |

### What `/run-lexicon-mock` does / does not do

| Question | Answer |
|----------|--------|
| Skips ASR? | YES — intentional (I1–I3 already frozen) |
| Skips Tone model? | YES — intentional (I4 slices injected) |
| Recomputes mapped Tone? | YES — via Production `mapToneEvidenceForRecall` / WTS consumers |
| Recomputes B3 WTS? | YES — `buildWordTimeSpans` in `span-assembly-v4-orchestrator.ts` |
| Reimplements FW? | NO — calls Production |
| Injects FineSpan/Model2/KenLM/final? | NO — only post-ASR inject fields |
| Test-only HTTP? | YES |
| Can serve Replay V2 unchanged? | YES as Production invoke surface, with V2 harness owning loader/compare |
| Phase A precedent | Controlled pin → mock inject → Capture OFF/ON 8/8 PASS |

### Mechanical note (not a Production algorithm change)

Full-audio Capture job sets `use_nmt: true`; `/run-lexicon-mock` currently passes `useNmt: false`. B1–B18 are ASR/FW-side Capture boundaries; NMT is outside Capture Contract V2 comparison set. Replay V2 should treat NMT as **orthogonal** (keep Phase A proven `useNmt:false`) unless a measured first divergence proves otherwise — then classify as harness config mismatch (TEST/EVALUATOR), not lexicon tune.

### Not the official Capture entry

Phase B official Capture must remain `/run-pipeline-with-audio`. Replay V2 must **not** use Phase A pins as official Capture input (already enforced by Capture execution boundary).

---

## 5. Trace table (Replay V2 intended)

| Stage | Frozen input | Production function | Source file | Replay action | Capture boundary | Comparison type | Injection allowed? | Known blocker? |
|-------|--------------|---------------------|-------------|---------------|------------------|-----------------|--------------------|----------------|
| Post-ASR state | I1–I4 (+ I5 NO_PROFILE) | `runPipelineWithMockAsr` field inject | `inference-service.ts` | Inject only | B1/B2/B4.slices | identity pin | YES | NO |
| WTS | repairText path + segments + I3 | `buildWordTimeSpans` | `tone-time-align.ts` / orchestrator | Recompute | B3 | ordered + FLOAT_TIME 0.001 | NO | NO |
| Tone mapping | I4 slices + WTS | `mapToneEvidenceForRecall` | `tone-time-align.ts` | Recompute | B4 mapped | exact toneNorm/pattern; posteriors NOT_EVALUABLE | slices YES / mapped NO | NO |
| FineSpan | Production path | lattice / materialize | `lattice-fine-span-runtime.ts` | Recompute | B5 | SET (`finespans`) | NO | NO |
| WindowQuery | Production | `buildLexicalWindowQueries` + hard-block | recall / lexical window | Recompute | B6 | windows + counts | NO | NO |
| CanonicalRecallQuery | Production | `serializeCanonicalRecallQueryKey` | utterance-recall-cache / recall | Recompute | B7 | key SET | NO | NO |
| Base SQL | Production + lexicon | SQL recall | `recall-topk-for-windows.ts` | Recompute | B8 | HASH_PLUS_SUMMARY | NO | NO |
| Base materialization | Production | window bind | same | Recompute | B9 | SET primary; MULTISET secondary | NO | NO |
| Model2 input | Production + NO_PROFILE | Model2 pack | lattice-fine-span-runtime | Recompute | B10 | HASH_PLUS_SUMMARY | NO | NO |
| Model2 output | Production | Model2 inference | same | Recompute | B11 | action/candidate SET | NO | NO |
| LexicalEdge | Production | `buildLexicalEdges` | lattice | Recompute | B12 | edge SET | NO | NO |
| Path PreCap | Production | `enumerateCompleteSegmentationPaths` | lattice | Recompute | B13 | count + hash | NO | NO |
| Path PostCap | Production | same + cap | lattice | Recompute | B14 | ordered retained ids + events | NO | NO |
| Domain / SameDomain / Assembly | Production | path-specific | FW path / assembly | Recompute | B15 | vote + sentence SET | NO | NO |
| Global Sentence / KenLM | Production | KenLM + gate | FW | Recompute | B16 | pool SET + pick + gate; scores 1e-6 | NO | NO |
| Model3 | Production | Model3 | FW | Recompute | B17 | anchors/decisions exact; float tensors NOT_EVALUABLE | NO | NO |
| Final | Production | result builder | pipeline | Recompute | B18 | exact text/hash | NO | NO |

---

## 6. Anti-cheat / cache / hidden state

### Anti-cheat

No Production inject of Capture downstream answers found on the mock path. Replay V1 injects only ASR/segments/slices/alignment (correct inject class) but compares via **E-stages** against **V1** evidence.

### Utterance recall cache

`createUtteranceRecallContext` is **per-utterance** (created in lattice runtime, released after). Not a cross-case module singleton. Cross-case contamination risk: **low** if each Replay case uses a fresh session id (Phase A pattern `capture-v2-phase-a::` / Replay should use `dialog200-frozen-replay-v2::`).

### Other state

| State | Risk | Mitigation |
|-------|------|------------|
| Lexicon sqlite | Identity | Manifest SHA guard |
| Model2/3 hosts | Identity reconstructable | Same checkpoints as Capture Manifest |
| Capture ALS collector | Per-case begin/finalize | Reset between cases; Capture ON for evidence extract OK (Phase A proved observer-effect free under controlled pin) |
| `reference_corpus_identity_only` on JSONL rows | Evaluator contamination | Must never enter equivalence compare |

---

## 7. HASH_PLUS_SUMMARY (B8 / B10 / B13)

| Boundary | Capture payload | Hash authority | Replay reproducibility |
|----------|-----------------|----------------|------------------------|
| B8 | `{ executions: [...] }` | Production capture of SQL execution summaries | Re-run Production with Capture ON → same serializer |
| B10 | `{ windows, inputHash, model2_summary }` | `canonicalHash` in `capture-v2/serialize.ts` | Same |
| B13 | `{ completePathCountBeforePrune, sortedPathIdentityHash, ... }` | `canonicalizeUnorderedIdentities` + `canonicalHash` | Same |

**Policy:** compare Capture Candidate payload_hash / embedded hashes / canonical semantic fields — not pretty-printed JSON. Summary fields are diagnostic unless they are the hash inputs themselves.

Float strip/normalize: Capture serialize strips job/session/paths only; does not invent float quantization beyond contract.

---

## 8. Comparator contract (resolved by Frozen SSOT; not yet implemented for V2)

| Rule | Frozen authority | V2 action |
|------|------------------|-----------|
| Exact discrete | Contract §6 FLOAT_EXACT_DISCRETE | Keep |
| Time 0.001s | `float-policy.ts` / alignment tolerance | Reuse |
| KenLM 1e-6 | Contract + `SCORE_ABS_TOLERANCE` | Reuse |
| Model2/3 tensors | NOT_EVALUABLE | Keep |
| Tone posteriors | argmax discrete; raw NOT_EVALUABLE | Keep |
| No EXPECTED_NONDETERMINISM | Contract B14 + Evaluator repair | **Do not reintroduce** |
| No % promotion | Contract §3 FORBIDDEN | V1 `decidePromotion` already `promote:false` — do not restore thresholds |
| First divergence B3→B18 | Contract purpose | Implement ordered B-boundary walk |
| SET vs MULTISET (B9) | Contract | SET primary |
| Ordered retained paths (B14) | Contract | Exact order |
| KenLM ties | No invented tie-break | Order submetric NOT_EVALUABLE if no total order |

V1 `compareCaptureReplay` uses **E1–E18** against V1 JSONL — **REPLACE_WITH_V2**, do not map as authority.

---

## 9. Replay V1 classification

| Component | Path | Class |
|-----------|------|-------|
| Replay V1 runner | `tests/run-dialog200-frozen-evidence-replay-v1.mjs` | **REPLACE_WITH_V2** → later **DELETE_AFTER_V2_VALIDATION** |
| Replay V1 contract | `tests/lib/dialog200-frozen-evidence-replay-contract.mjs` | **REPLACE_WITH_V2** (E-stages / V1 JSONL / promotion heritage); float constants **REUSE_AFTER_MECHANICAL_ADAPTATION** |
| Alignment reconstruct | `tests/lib/dialog200-frozen-replay-alignment-state.mjs` | **HISTORICAL / DELETE_AFTER_V2** for V2 authority (Candidate supplies B2; reconstruction anti-pattern) |
| V1 acoustic JSONL | `DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1.jsonl` | **HISTORICAL_ARTIFACT_ONLY** — never fallback |
| Pilot200 profile AB replay | `tests/run-pilot200-profile-ab-replay-runner.mjs` | **HISTORICAL_ARTIFACT_ONLY** (different corpus/profile goals) |
| Phase A controlled helpers | `tests/lib/capture-v2-phase-a-controlled-parity.mjs` | **REUSE_AFTER_MECHANICAL_ADAPTATION** (deepClone/hash/inject body patterns) |
| Capture float-policy | `main/src/capture-v2/float-policy.ts` | **REUSE_UNCHANGED** |
| Capture serialize | `main/src/capture-v2/serialize.ts` | **REUSE_UNCHANGED** (hash semantics) |
| `/run-lexicon-mock` + `runPipelineWithMockAsr` | test-server + inference-service | **REUSE_UNCHANGED** |

**Forbidden after V2 validation:** dual Replay mode, env switch V1/V2, V1 evidence supplementation.

---

## 10. Answers Q1–Q18

**Q1.** Replay V1 = `run-dialog200-frozen-evidence-replay-v1.mjs` + `dialog200-frozen-evidence-replay-contract.mjs` (+ alignment-state helper), loading **V1** `DIALOG200_FROZEN_ACOUSTIC_EVIDENCE_V1.jsonl`.

**Q2.** Invalid under V2: V1 evidence authority; E-stage naming vs B1–B18; alignment **reconstruction** instead of B2 inject; historical promotion/percentage semantics (even if currently disabled); not Candidate SHA-bound.

**Q3.** Earliest safe entry: inject post-ASR JobContext → `runPipelineWithMockAsr` → `runJobPipeline(skipASR)` → FW orchestration (`span-assembly-v4-orchestrator` / lattice / Model2 / KenLM / Model3).

**Q4.** YES — fields already accepted by `runPipelineWithMockAsr` / test-server parser. Phase A proven.

**Q5.** `/run-lexicon-mock` satisfies inject+Production FW invoke. It skips ASR/Tone **models** (required). It does not skip FW. It is test-only HTTP. Prefer it over duplicating FW in harness.

**Q6.** YES — `buildWordTimeSpans` recomputes B3; Capture B3 is COMPARISON_ONLY.

**Q7.** YES — inject B4 slices + I3 alignment; mapped Tone via Production mapping only.

**Q8.** YES — single Production chain after inject.

**Q9.** No hidden decision state beyond identity-guarded lexicon/models/profile. Session extras must stay NO_PROFILE.

**Q10.** Utterance recall cache is per-utterance. Isolate sessions per case. No proven cross-case singleton that invalidates equivalence.

**Q11.** YES if Replay runs Capture V2 hooks (or reuses same `canonicalHash`) — hashes produced by Production capture path.

**Q12.** YES — Candidate FULL boundaries untruncated (`authoritative_truncated` absent/false on accepted completeness).

**Q13.** V1 historically had EXPECTED_NONDETERMINISM / % promotion; repaired toward SSOT but still E-stage/V1. V2 must not reintroduce. `float-policy.ts` is clean.

**Q14.** No active V2 path falls back to V1. V1 runner still points at V1 JSONL — must not be used as V2 authority.

**Q15.** YES — test/replay only.

**Q16.** Minimum: new V2 runner + V2 contract/comparator module; optional thin reuse of Phase A inject helpers; docs/acceptance artifacts. Production algorithm files: **none**.

**Q17.** After V2 cert: retire V1 runner/contract as authority; keep historical docs/JSONL as HISTORICAL_ONLY; delete/disable V1 promote-to-SSOT paths.

**Q18.** NO Frozen contract conflict found given accepted Candidate.

---

## 11. File impact table

| FILE | CURRENT_ROLE | V2_ACTION | WHY | PRODUCTION_OR_TEST | DELETE_LATER? |
|------|--------------|-----------|-----|--------------------|---------------|
| `tests/run-dialog200-frozen-evidence-replay-v2.mjs` | absent | **CREATE** | Official V2 runner | TEST | NO |
| `tests/lib/dialog200-frozen-evidence-replay-v2-*.mjs` | absent | **CREATE** | Loader, I1–I9, B-comparator, first-divergence | TEST | NO |
| `tests/lib/capture-v2-phase-a-controlled-parity.mjs` | Phase A control | **REUSE_ADAPT** | deepClone/hash/inject patterns | TEST | NO |
| `main/src/test-server.ts` `/run-lexicon-mock` | Test entry | **REUSE_UNCHANGED** | Production invoke | TEST→PROD call | NO |
| `main/src/inference/inference-service.ts` `runPipelineWithMockAsr` | Inject entry | **REUSE_UNCHANGED** | Production | PROD | NO |
| `main/src/capture-v2/*` | Capture | **REUSE_UNCHANGED** | Evidence extract when gate ON | PROD observability | NO |
| `tests/run-dialog200-frozen-evidence-replay-v1.mjs` | Legacy authority | **REPLACE_WITH_V2** | Invalid under V2 | TEST | YES after V2 cert |
| `tests/lib/dialog200-frozen-evidence-replay-contract.mjs` | V1 E-stages | **REPLACE_WITH_V2** | Wrong schema/authority | TEST | YES after V2 cert (keep float constants via copy) |
| `tests/lib/dialog200-frozen-replay-alignment-state.mjs` | V1 reconstruct | **RETIRE for V2 authority** | B2 present on Candidate | TEST | YES after V2 cert |
| FW / Model2 / Model3 / Tone / lexicon sources | Production | **NO CHANGE** | Equivalence via real code | PROD | NO |

`PRODUCTION_ALGORITHM_CHANGE_REQUIRED = NO`

---

## 12. Testability matrix (T1–T22) — feasibility

| ID | Feasible? | Note |
|----|-----------|------|
| T1 Candidate SHA/run | YES | Hash file + require run_id |
| T2 200 unique load | YES | |
| T3 I1–I9 validation | YES | Hard fail if missing |
| T4 no downstream inject | YES | Body allowlist |
| T5–T14 recompute | YES | Production path |
| T15 first-divergence | YES | Ordered B3→B18 |
| T16 float/time policy | YES | Reuse float-policy |
| T17 missing inject → invalid | YES | |
| T18 wrong identity → invalid | YES | Manifest guards |
| T19 V1 fallback impossible | YES | No V1 path in V2 runner |
| T20 reference text inert | YES | Ignore `reference_corpus_identity_only` |
| T21 no Production algo change | YES | Process invariant |
| T22 Candidate immutable | YES | Read-only open; refuse write |

---

## 13. Future Replay V2 acceptance model (feasibility)

Feasible under Frozen tolerances **without** percentage acceptance:

```text
TOTAL_CASES = 200
REPLAY_EXECUTED_CASES = 200
REPLAY_INVALID_CASES = 0
INJECTION_STATE_VALID = 200/200
B3_B18_EQUIVALENT = 200/200
FIRST_DIVERGENCE_CASES = 0
FINAL_EQUIVALENT = 200/200
V1_FALLBACK_USED = NO
REFERENCE_TEXT_USED_FOR_EQUIVALENCE = NO
PRODUCTION_ALGORITHM_CHANGED = NO
```

NOT_EVALUABLE submetrics (Model2/3 tensors, KenLM order under undefined ties, raw tone posteriors) must not be coerced to FAIL or PASS.

---

## 14. Development plan (next round — do not implement now)

### A. Artifact loader
- **TARGET:** Load exactly Candidate JSONL; verify SHA256 + single run_id + 200 ids  
- **FILES:** new V2 runner/lib  
- **INPUT:** `DIALOG200_FROZEN_EVIDENCE_CAPTURE_V2.jsonl`  
- **OUTPUT:** case records  
- **INVARIANT:** no V1/merge/patch  
- **TEST:** T1, T2, T22  

### B. Identity validation
- **TARGET:** Manifest + schema + model/lexicon/WAV guards  
- **FILES:** V2 lib + read Identity Manifest  
- **INVARIANT:** IDENTITY_RECONSTRUCTABLE not upgraded; git_dirty not hard fail  
- **TEST:** T18  

### C. I1–I9 injection adapter
- **TARGET:** Map B1/B2/B4.slices + NO_PROFILE → mock body  
- **FILES:** V2 adapter (reuse Phase A inject shape)  
- **INVARIANT:** no FineSpan/Model2/KenLM/final inject; no alignment reconstruction when B2 present  
- **TEST:** T3, T4, T17  

### D. Production downstream invocation
- **TARGET:** `/run-lexicon-mock` → `runPipelineWithMockAsr`  
- **FILES:** V2 runner only  
- **INVARIANT:** real FW; Capture ON for B-boundary extract recommended  
- **TEST:** T5–T14  

### E. B3–B18 evidence extraction
- **TARGET:** Read Replay `frozen_evidence_capture_v2` boundaries  
- **INVARIANT:** same Capture Contract shapes  
- **TEST:** T5–T14  

### F. Semantic comparator
- **TARGET:** B-boundary compare per Contract float/exact/SET/order rules  
- **FILES:** new V2 comparator (do not authority-import V1 E-stages)  
- **TEST:** T16  

### G. First-divergence reporter
- **TARGET:** First FAIL in B3→B18 order; cascade not root cause  
- **OUTPUT:** CASE_ID, FIRST_DIVERGENCE_BOUNDARY, hashes, DIFF_CLASS, UPSTREAM_EQUAL, DOWNSTREAM_NOT_ROOT  
- **TEST:** T15  

### H. 200-case runner
- **TARGET:** Sequential isolated sessions; progress artifacts  
- **TEST:** T2  

### I. Acceptance report
- **TARGET:** Replay V2 validation + equivalence status; **no baseline replace**  
- **INVARIANT:** CURRENT_BASELINE_REPLACED = NO  

### J. Replay V1 retirement plan
- **TARGET:** After V2 CERTIFIED: remove V1 authority; archive historical; single Replay implementation  
- **INVARIANT:** no old/new switch  

---

## 15. Failure classification (for future divergences)

| Symptom | Class |
|---------|-------|
| Missing I1–I9 on Candidate | OBSERVABILITY GAP (not expected now) |
| Replay custom logic ≠ Production | TEST / EVALUATOR DEFECT |
| Production ≠ Frozen SSOT | IMPLEMENTATION DEFECT |
| Frozen contracts mutually impossible | ARCHITECTURE GAP / CONFLICT |
| Lexicon lacks term / bad ASR word but Capture≡Replay | DATA / TRAINING FAILURE — **not** Replay-equivalence failure |
| Business expected-text mismatch | NOT a Replay gate |

---

## 16. Version-freeze policy reminder

Engineering freeze gate = **Capture↔Replay Production-boundary equivalence**.

Not gates: Dialog200 expected text, WER/CER, lexicon coverage, Model2/3 “should have fixed this”, KenLM linguistic preference, personalized P under NO_PROFILE.

---

## 17. Result

```text
RESULT_ENUM = A — REPLAY_V2_DEVELOPMENT_READY
NEXT_OWNER = FROZEN_EVIDENCE_REPLAY_V2_DEVELOPMENT
```

STOP. No Replay V2 implementation in this round. No Production/Capture/lexicon/baseline change.
