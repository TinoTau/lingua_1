# Model3 V2 Final Acceptance and Freeze Report

**Phase:** `MODEL3_V2_FINAL_ACCEPTANCE_AND_FREEZE`  
**Mode:** `ACCEPTANCE + DOCUMENTATION FREEZE`  
**Date:** 2026-09-07  
**Verdict:** `MODEL3_V2_FINAL_ACCEPTANCE_PASS_FROZEN`

### Runtime default update (2026-09-08)

Subsequent phase `MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_DELTA` completed:

```text
RUNTIME_DEFAULT_MODEL = MODEL3_V2_S3_RANDOM_INIT_V1
EXPLICIT_ROLLBACK_MODEL = MODEL3_SYNTHETIC_V1
PRODUCTION_RETRY_ENABLED = YES
MODEL3_RETRY_SUBCHAIN = ACTIVE_AND_FROZEN
```

See `model3_v2_runtime_promotion_acceptance.json`. This freeze report remains the responsibility-acceptance seal; runtime wiring is no longer “Synthetic default / S3 candidate”.

---

## Formal freeze record

```text
MODEL3_V2 = FROZEN
MODEL3_V2_S3_RANDOM_INIT_V1 = AUTHORITATIVE_MODEL
MODEL3_RETRY_SUBCHAIN = FROZEN
DELTA_RQ_STAGE2_NO_SLIDING = RESOLVED_ACCEPTED_CLOSED
DELTA_RQ_FALLBACK_BOUNDARY_LOCK = RESOLVED_ACCEPTED_CLOSED
MODEL3_DEVELOPMENT_PHASE_CLOSED = YES
```

---

## Freeze decisions

| Decision | Result |
| -------- | ------ |
| `CAN_MODEL3_V2_BE_FROZEN` | **YES** |
| `CAN_RETRY_BE_FROZEN_WITH_MODEL3` | **YES** |
| `MODEL3_DEVELOPMENT_PHASE_CLOSED` | **YES** |
| `MODEL3_RETRAIN_REQUIRED` | **NO** |
| `RETRY_REDESIGN_REQUIRED` | **NO** |
| `DELTA1_REOPEN_REQUIRED` | **NO** |
| `DELTA2_REOPEN_REQUIRED` | **NO** |

---

## Acceptance order results

| # | Gate | Result | Blocking? | Evidence |
| - | ---- | ------ | --------- | -------- |
| 1 | Architecture | PASS | YES | KEEP/RETRY-only types; contracts V1; no role collapse in runtime |
| 2 | Ownership | PASS | YES | Model3 trigger; Retry bounded reinterpretation; Recall/Lexicon/Domain/Assembly/KenLM unchanged owners |
| 3 | Model identity | PASS | YES | S3 weights/config/manifest match; A1 not promoted |
| 4 | Semantic continuity | PASS | YES | Path-local Model3→Retry; voteCallCount=1; no second Model3 |
| 5 | Delta1 / Delta2 | PASS | YES | Acceptance hardGates + stage2/fallback tests; statuses CLOSED |
| 6 | Anti-test-gaming | PASS | YES | No case-ID/oracle branches in `model3-runtime` production path |
| 7 | Targeted tests | PASS | YES | 8 suites / 56 tests / 0 failed / 0 skipped hard-gates |
| 8 | Production build | PASS | YES | `npm run build:main` exit 0 |
| 9 | Causal responsibility | PASS | YES | Prior audit PASS; final=0 ≠ responsibility failure |
| 10 | Deferred registration | PASS | NO | See `model3_v2_known_deferred_items.csv` |
| 11 | Documentation authority | PASS | YES | Contracts updated; SSOT index added |
| 12 | Drift gate | PASS | YES | `ARCHITECTURE_DRIFT=NONE` (causal + barrier counters) |
| 13 | Freeze | PASS | YES | This report + freeze manifest |

Full matrix: `model3_v2_final_acceptance_matrix.csv`

---

## 1. Causal basis (not re-litigated)

From `MODEL3_V2_END_TO_END_CAUSAL_EFFECTIVENESS_AUDIT`:

| Item | Value |
| ---- | ----- |
| Verdict | `MODEL3_CAUSAL_AUDIT_PASS_MODEL3_DOWNSTREAM_BLOCKED` |
| Model3 responsibility | PASS |
| Retry responsibility | PASS |
| Need modify Model3 | NO |
| Architecture drift | NONE |
| MODEL3_ELIGIBLE | 16 |
| CORRECT_RETRY | 15 |
| FALSE_KEEP | 1 |
| Correct_lexical_hit | 0 |
| FINAL_IMPROVED | 0 |

**Frozen causal interpretation:**

```text
MODEL3_RESPONSIBILITY_ACCEPTANCE = PASS
RETRY_RESPONSIBILITY_ACCEPTANCE = PASS
MODEL3_FINAL_UTILITY = DOWNSTREAM_BLOCKED
PRIMARY_ELIGIBLE_DOWNSTREAM_BREAKPOINT = LEXICON_COVERAGE
```

`FINAL_IMPROVED = 0` is **not** Model3 acceptance failure.

---

## 2. Model identity

| Field | Value | Verified |
| ----- | ----- | -------- |
| datasetId | `MODEL3_V2_PRODUCTION_CORE_S3` | `model_manifest.json` |
| datasetBuildId | `prod_core_s3_build_20260830_v1` | same |
| modelId | `MODEL3_V2_S3_RANDOM_INIT_V1` | manifest + registry |
| weights SHA256 | `f1e4196933a66bbea73fdd8f17fa460f52696656208ff05c41f2dc9ff81cbbb1` | on-disk `weights.pt` |
| config SHA256 | `8c181cb95ab159f5c35c47dc417e527946bf5d0f9614cb83b37a62ab7f01f221` | on-disk `config.json` |
| seed | `2026083013` | checkpoint path + manifest |
| class_weight_retry | `1.0` | manifest (not A1) |

**A1:** `MODEL3_V2_S3_EXP_CLASS_WEIGHT_A1_RERUN1` remains registry `CANDIDATE` only — **not promoted**.

### Runtime wiring note (superseded 2026-09-08)

~~At freeze time, Electron default without env was still `MODEL3_SYNTHETIC_V1` and S3 was registry `CANDIDATE`.~~

**Updated by** `MODEL3_V2_RUNTIME_DEFAULT_PROMOTION_DELTA`:

- `RUNTIME_DEFAULT_MODEL` = `MODEL3_V2_S3_RANDOM_INIT_V1`
- `EXPLICIT_ROLLBACK_MODEL` = `MODEL3_SYNTHETIC_V1`
- Deferred item `KNOWN_DEFERRED_ELECTRON_DEFAULT_STILL_SYNTHETIC_V1` = **CLOSED**

---

## 3. Ownership acceptance

### Model3 — PASS

| MUST NOT | Status |
| -------- | ------ |
| create/search/modify Anchor | PASS (adapter + mask) |
| create/split/merge/modify FineSpan | PASS |
| query Lexicon / generate lexical candidates | PASS (Retry requests Recall) |
| decide Domain / second Domain Vote | PASS (`voteCallCount=1`, barriers=0) |
| repair text / assemble / KenLM / ASR | PASS |

Output type: `KEEP | RETRY` only (`Model3DecisionLabel`).

### Retry — PASS

| MUST NOT | Evidence |
| -------- | -------- |
| second Domain Vote | `secondDomainVoteCount=0` (acceptance + typed `false`) |
| Model3 re-invoke | `model3ReinvokedCount=0` |
| recursive Retry | `recursiveRetryViolations` instrumented; tests assert |
| ASR rerun | no Retry→ASR path; second ASR forbidden in contract |
| cross Anchor | region + stage2 tests |
| bypass Recall ownership | reuses existing Recall |

### Path semantics — PASS

Per retained path: FineSpans → Domain Vote → Anchors → Model3 → Retry → Assembly. No proven global path collapse / cross-path ownership contamination in Delta2 acceptance.

### Candidate cap — PASS

`maxSentenceCandidates` default **16**; freeze-contract tests; acceptance `crossPathOver16Cases=0`.

### JobResult — PASS

Model3 diagnostics / acceptance snapshots explicitly **not** JobResult fields. No new JobResult fields in this phase.

### Anti-test-gaming — PASS

No `dialog_d0*` / oracle / expected-answer branches under `main/src/model3-runtime` production code. `dialog200-path-trace` is observation-only.

---

## 4. Delta freeze

| Delta | Status |
| ----- | ------ |
| `DELTA_RQ_STAGE2_NO_SLIDING` | `RESOLVED_ACCEPTED_CLOSED` |
| `DELTA_RQ_FALLBACK_BOUNDARY_LOCK` | `RESOLVED_ACCEPTED_CLOSED` |

Reachability ≠ lexical utility. cross-FineSpan Recall hit=0 does **not** reopen Delta1/2.

---

## 5. Build & tests

### Production build

```text
cd electron_node/electron-node
npm run build:main
→ PASS (exit 0)
```

### Targeted Jest (`model3-runtime`)

| Metric | Value |
| ------ | ----- |
| Suites | 8 |
| Tests run | 56 |
| Passed | 56 |
| Failed | 0 |
| Skipped | 0 |

Suites: `model3-retry-stage2-windows`, `model3-retry-region`, `model3-retry-region-resegment`, `model3-retry-region.controlled-validation`, `model3-mainline.integration`, `model3-feature-contract`, `model3-acceptance-snapshot`, `model3-candidate-provenance-trace.parity`.

---

## 6. Architecture change rule (post-freeze)

Any change to Model3 input ownership, KEEP/RETRY-only output, Anchor/KEEP barriers, RetryRegion semantics, second Model3, second Domain Vote, Retry→ASR, or candidate-cap ownership:

→ **STOP** → submit `ARCHITECTURE_CHANGE_PROPOSAL` → user approval required.

Downstream work (Lexicon, Recall, FineSpan, Assembly, KenLM, ASR, Model2) **must not** auto-retrain or modify Model3. Reopening requires `PROVEN_MODEL3_OWNED_BREAKPOINT`.

---

## 7. Next phase (report only — do not execute)

```text
MODEL3_V2_FINAL_ACCEPTANCE_AND_FREEZE
        ↓
CLOSED
        ↓
LEXICON_COVERAGE_DELTA
        ↓
later (separate):
UPSTREAM_NO_REPAIRABLE_TARGET_CAUSAL_CLASSIFICATION_AUDIT
```

Do **not** merge Lexicon work with the 154 `NO_REPAIRABLE_TARGET` audit.

---

## DOCUMENTS_UPDATED

| Document | Change |
| -------- | ------ |
| `MODEL3_ARCHITECTURE_CONTRACT_V1.md` | Add Model3 V2 freeze seal + post-freeze ACP rule |
| `model3_retry_contract_v1.md` | Seal Delta1/2 CLOSED + V2 Retry freeze |
| `Model3_V2_Frozen_Architecture_SSOT.md` | New thin SSOT index (this phase optional #5) |

## DOCUMENTS_SUPERSEDED

| Document | Status |
| -------- | ------ |
| Ad-hoc “next: reopen Model3 training” notes in older V2 audit next-steps | Superseded by this freeze — development phase closed |
| Class-weight A1 as promotion candidate for final utility | Remains **rejected / non-promoted** |

Evidence audits (causal effectiveness, Delta acceptances) remain **EVIDENCE**, not Architecture SSOT.

---

## Final principle

This freeze does **not** claim dialog_200 final text is fixed.  
It claims Model3 and Retry **correctly implement frozen responsibilities**, with identity/build/tests/drift gates green, and Model3 development phase **closed**.
