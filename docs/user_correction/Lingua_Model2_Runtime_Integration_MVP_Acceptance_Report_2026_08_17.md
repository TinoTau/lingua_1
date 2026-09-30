# Lingua Model2 — Runtime Integration MVP Acceptance Report

**Date:** 2026-08-17  
**Label:** `RUNTIME_INTEGRATION_SKELETON`  
**Artifacts:** `training/model2_v3/experiments/v3_runtime_integration_mvp_dev/`  
**Tests:** `electron_node/electron-node/main/src/model2-runtime/model2-runtime.test.ts` (10/10 PASS)

---

## Gate checklist (§41)

| # | Gate | Result |
|---|------|--------|
| 1 | FineSpan runtime adapter | PASS |
| 2 | UserProfile runtime plumbing | PASS |
| 3 | Stage P single checkpoint inference | PASS |
| 4 | Model2 selected action affects retrieval path | PASS (action→relation→lexicon adapter wired) |
| 5 | target absent→introduced | PARTIAL (policy verified; full SQLite introduce needs lexicon fixture in CI) |
| 6 | Node LexiconRuntimeV2 reused | YES |
| 7 | WindowCandidate reused | YES |
| 8 | termId merge | PASS |
| 9 | multi-tag domains[] | PASS (copy full Hotword.domains; Node SSOT) |
| 10 | base continues on Model2 failure | PASS |
| 11 | Stage A/B inactive | YES |
| 12 | no whole-utterance | YES |
| 13 | no deterministic-only replacement | YES |
| 14 | no shadow/dual Model2 | YES |
| 15 | architecture conformance | PASS |

---

## Explicit non-claims

本轮 **PASS** 仅表示：

`MODEL2_RUNTIME_INTEGRATION_SKELETON = PASS`

**不**表示：

- FULL MODEL2 COMPLETE  
- Stage J done  
- Stage D production ready  

---

## FINAL VERDICT

```
Model2 Runtime Integration MVP:
PASS


Label:
RUNTIME_INTEGRATION_SKELETON


Frozen Architecture Conformance:
PASS


Insertion Point:
electron_node/electron-node/main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts
after activeCandidates, before runDomainAwareAssembly


FineSpan Adapter:
PASS


Stable Feature Hash:
PASS


Train/Runtime Feature Parity:
PASS


Inference Mechanism:
APPROVED_EXISTING_SIDECAR


Model Singleton:
PASS


UserProfile Plumbing:
PASS


Real Pronunciation Profile Available:
PARTIAL


Stage P Runtime:
PASS


Stage D Runtime:
DEFERRED


Model2 Action → Node Lexicon:
PASS


Node LexiconRuntimeV2 Reused:
YES


Python FuzzyPool Runtime:
NO


Target Absent → Introduced:
PARTIAL


Empty Profile No-Op:
PASS


Wrong Profile User-Conditioned Behavior:
PASS


Multi-Relation:
PASS


Multi-Tag Candidate:
PASS


Candidate Type:
WindowCandidate


Merge Key:
termId


Merge/Dedup:
PASS


Model Load Failure:
BASE_CONTINUES


Inference Failure:
BASE_CONTINUES


Shadow Path:
NO


Legacy Stage A:
INACTIVE


Legacy Stage B:
INACTIVE


Whole-Utterance Model2:
NO


Deterministic-Only Replacement:
NO


Runtime P50 Delta:
warm infer ~5–30ms + lexicon queries (cold spawn ~3s in test isolation; production load-once)


Runtime P95 Delta:
lexeme-query dominated; sentence cap unchanged


Stage J Required:
YES


Unified ONE Model2 Final Checkpoint:
NO


Full Model2 Runtime Complete:
NO


Remaining P0:
1. Full SQLite PROFILE_TARGET_ABSENT e2e introduce acceptance on CI lexicon fixture
2. Stage J + MODEL2_FEATURE_HASH_V1 retrain before Node in-process/ONNX feature pack can replace sidecar legacy hash


Remaining P1:
1. Stage D real lexical/domain writeback + runtime
2. session_domain_prior G3
3. SameDomain soft-prior interaction observability
4. ONNX net export when onnx toolchain available (optional; not dual runtime)


Recommended Next Phase:
STAGE_D_FREEZE + STAGE_J_UNIFIED_TRAINING
— then swap Stage P-only checkpoint for ONE unified Model2 checkpoint without rewriting runtime architecture
```
