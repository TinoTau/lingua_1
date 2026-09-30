# Lingua — Model3 / Retry Dual-Path Architecture Audit

Date: 2026-09-01  
Phase: `MODEL3_V2_RUNTIME_DUAL_PATH_ARCHITECTURE_AUDIT`  
Mode: READ-ONLY code / call-graph / SSOT audit

================================
EXECUTIVE VERDICT
=================

| Item | Result |
|------|--------|
| **Verdict** | **`DUAL_PATH_AUDIT_PASS_SINGLE_PRODUCTION_CHAIN_WITH_TEST_DUPLICATION`** |
| Production chain count | **1** |
| Production dual chain | **NO** |
| Business logic duplication | **NO** (shared implementations) |
| Test harness duplication | **YES** (measurement-only double complete + baseline KenLM trace) |
| Audit semantic divergence | **PARTIAL** (Lexicon exact lookup ≠ production Recall) |
| Signal-loss LOCAL_RESEGMENTATION=84 | **VALID** (production `retry_regions.resegmentOk` trace) |
| Signal-loss LEXICON_COVERAGE=39 | **NOT production-equivalent** (audit lookup) |
| Frozen causal acceptance | **NOT invalidated** |
| Next phase | **`MODEL3_V2_LOCAL_RESEGMENTATION_CAUSAL_EVIDENCE_AUDIT`** |
| Secondary follow-up | `MODEL3_V2_SIGNAL_LOSS_AUDIT_PARITY_CORRECTION` (lexicon slice only) |

No code modified. No architecture change required.

================================
CANONICAL PRODUCTION CALL GRAPH
===============================

```
ASR (asr-step)
  → runFwDetectorOrchestrator
    → runFwDetectorV4Path
      → runSpanAssemblyV4Orchestrator
        → lattice / Recall / Model2
        → runModel3PathStep                    [when fork OFF]
            → prepareModel3PathUpstream
                voteUtteranceDomainFromPool    (once)
                materializeModel3Anchors
                packModel3SpanInferFields + inferPath
            → completeModel3PathFromUpstream
                routeModel3Retry
                  resegmentRetryRegionWithLattice
                  recallSpanTopKV2
                completeDomainAwareAssemblyFromVote
        → buildSentenceCandidates (per path/bucket)
        → mergeCrossPathSentenceCandidates
      → runFwSentenceRerankFromPrefilled       (S3 output)
  → segmentForJobResult → JobResult.text_asr
```

**Single Model3 stage entry:** `runModel3PathStep` per path (orchestrator loop).  
**No Retry → Model3 re-entry** (`model3Reinvoked: false` in retry region traces).

================================
ACCEPTANCE CALL GRAPH (env gate)
================================

When `MODEL3_ACCEPTANCE_CAUSAL_FORK=1`:

```
same upstream through prepareModel3PathUpstream (once)
  → runModel3PathStepCausalFork
      → completeModel3PathFromUpstream(baseline KEEP)   [measurement]
      → completeModel3PathFromUpstream(S3 decisions)      [authoritative output path]
  → orchestrator uses fork.s3 as model3Step
  → optional baselinePathAssemblyResults + baseline KenLM trace
  → returned customer text = S3 branch only
```

Classification per node:
- **SHARED_PRODUCTION_FUNCTION:** prepare, complete, routeModel3Retry, resegment, Recall, Assembly, KenLM
- **TEST_OVERRIDE_ONLY:** `keepOverrideFromPacked` on baseline decisions
- **TEST_TRACE_ONLY:** snapshot hash, `acceptance_causal` in observation trace

This is **not** a production dual chain (HARD STOP C avoided): two branches share identical downstream implementations; only decision override differs.

================================
AUDIT / REPLAY CALL GRAPH
=================================

`run-retry-reinterpretation-signal-loss-audit.mjs`:

| Mode | Behavior |
|------|----------|
| A Pipeline replay | Invokes `/run-pipeline-with-audio` with same causal fork env — **production helpers** |
| B Trace observation | Reads `dialog200_path_trace` / `retry_regions.resegmentOk` — **PRODUCTION_TRACE_BASED** |
| C Diagnostic eval | `evaluateMaterializableTargetV1`, alignment units — **SAFE_DIAGNOSTIC_REPLAY** |
| D Lexicon check | `LexiconRuntimeV2.lookupBaseByExactSurfaceAndPinyin` — **AUDIT_SEMANTIC_MISMATCH** (≠ Recall path) |

**Does NOT** independently call `resegmentRetryRegionWithLattice` for ownership counts.  
**LOCAL_RESEGMENTATION=84** is based on production trace fields.

================================
PREPARE / COMPLETE SPLIT
========================

| Question | Answer |
|----------|--------|
| Old inline path coexists? | **NO** — `runModel3PathStep` = prepare + complete |
| Normal production uses both? | **YES** |
| Shared by harness? | **YES** |
| Duplicate Domain Vote? | **NO** — vote only in prepare (once per path) |
| Duplicate infer on fork? | **NO** — infer once in prepare; complete runs twice |

TESTABILITY REFACTOR is behavior-preserving when fork is off.

================================
MODEL3 / RETRY / RECALL / ASSEMBLY / KENLM
========================================

| Responsibility | Authoritative owner | Duplicate? |
|----------------|---------------------|------------|
| Pack | `packModel3SpanInferFields` | NO |
| Infer | `Model3InferenceHost.inferPath` | NO |
| Decision apply | `maskAnchorDecisions` + effective decisions | NO |
| Retry router | `routeModel3Retry` | NO |
| Retry region | `deriveRetryRegions` | NO |
| Local resegment | `resegmentRetryRegionWithLattice` → `runLatticeFineSpanGeneration` | NO |
| Retry Recall | `recallSpanTopKV2` callback | NO |
| Assembly | `completeDomainAwareAssemblyFromVote` + `buildSentenceCandidates` | NO |
| KenLM | `runFwSentenceRerankFromPrefilled` | NO |

`runDomainAwareAssembly` exists in codebase for **tests/legacy**; **mainline orchestrator does not call it** — production uses Model3-path `completeDomainAwareAssemblyFromVote`.

================================
KEEP_ALL LEGACY
===============

| Item | Status |
|------|--------|
| `MODEL3_HARNESS_KEEP_ALL` in code | **YES** (`prepareModel3PathUpstream`) |
| Production default reachable? | **NO** (orchestrator passes `keepAll: false`; env unset) |
| Causal harness | **Explicitly deleted / not set** |
| Bypasses pack/infer? | **YES** when env set and `!forcePackSymmetry` |
| Classification | **OBSOLETE_TEST_PATH** |

Superseded by `keepOverrideFromPacked` + symmetric pack.

================================
SNAPSHOT / JOBRESULT
====================

| Check | Result |
|-------|--------|
| `MODEL3_ACCEPTANCE_UPSTREAM_SNAPSHOT_V1` in production contracts | **NO** |
| JobResult interface expanded for acceptance | **NO** |
| Snapshot in `JobResult` fields | **NO** |
| `acceptance_causal` in observation extra | **YES** (trace only when `MODEL2_DIALOG200_TRACE=1`) |
| Affects `text_asr` | **NO** (S3 KenLM winner only) |

================================
CONFIG / ENV FLAGS
==================

See `model3_v2_env_flag_inventory.csv`.

Only **`MODEL3_ACCEPTANCE_CAUSAL_FORK=1`** enables fork behavior.  
**Not set in normal production service path.**

================================
SIGNAL-LOSS AUDIT PARITY
========================

| Finding | Validity |
|---------|----------|
| LOCAL_RESEGMENTATION primary (84) | **VALID** — production trace `resegmentOk` |
| LEXICON_COVERAGE (39) | **INVALID for production ownership** — audit exact lookup ≠ Recall |
| Resegmentation reimplemented? | **NO** |
| Invalidates whole signal-loss audit? | **NO** — partial only |
| Invalidates frozen Final Causal Acceptance? | **NO** |
| 166/1 vs frozen 170/0 | Independent ASR rerun — diagnostic only |

================================
SSOT / DOCUMENTATION
======================

Reports correctly describe causal harness as **test/audit** mechanism.  
Minor drift: `freeze-contract.test.ts` still expects `runDomainAwareAssembly` string in orchestrator (stale test expectation, not runtime dual path).

================================
SEVERITY
========

| Level | Count | Items |
|-------|------:|-------|
| P0 | 0 | No production dual chain |
| P1 | 2 | Double complete + baseline KenLM trace (shared impl) |
| P2 | 3 | Lexicon audit mismatch; diagnostic eval; trace-based valid finding |
| P3 | 3 | KEEP_ALL legacy; superseded AB runner; ASR variance |

================================
REQUIRED DECISIONS (D1–D51) — SUMMARY
======================================

| ID | Answer |
|----|--------|
| D1–D2 | S3 exact; **one** canonical production Model3 chain |
| D3–D6 | Production calls prepare+complete via `runModel3PathStep`; shared; no coexisting inline duplicate |
| D7–D8 | Causal fork **not** reachable without env=1; cannot accidentally change production without gate |
| D9–D10 | KEEP_ALL exists; **not** production-reachable by default |
| D11–D15 | One packer, one infer, one decision owner |
| D16–D22 | One Retry router/region/resegment; signal-loss observes production resegment trace; **no** audit resegment reimplementation |
| D23–D25 | Retry uses authoritative Recall; audit Lexicon lookup **differs** from Recall |
| D26–D29 | One Assembly, one KenLM; audit uses proxies for comparison only |
| D30–D32 | Domain Vote once in prepare; Retry does not re-vote or re-invoke Model3 |
| D33–D35 | Model2 not duplicated across fork; snapshot not in JobResult; **no** JobResult expansion |
| D36–D39 | Env flags inventoried; obsolete KEEP_ALL + superseded AB runner remain |
| D40 | No copied business logic likely to drift (shared functions) |
| D41–D42 | LOCAL_RESEGMENTATION=84 uses **production path evidence** |
| D43 | 166/1 did **not** overwrite frozen 170/0 authority |
| D44 | No SSOT describing two production mainlines |
| D45 | **NO** production dual chain |
| D46 | **YES** test/audit semantic dual path (Lexicon diagnostic only) |
| D47 | **PARTIAL** invalidation (Lexicon slice only) |
| D48 | **NO** invalidation of frozen acceptance |
| D49 | **NO** architecture change required |
| D50 | `DUAL_PATH_AUDIT_PASS_SINGLE_PRODUCTION_CHAIN_WITH_TEST_DUPLICATION` |
| D51 | `MODEL3_V2_LOCAL_RESEGMENTATION_CAUSAL_EVIDENCE_AUDIT` |

================================
NEXT PHASE
==========

**Primary:** `MODEL3_V2_LOCAL_RESEGMENTATION_CAUSAL_EVIDENCE_AUDIT`  
**Secondary (lexicon slice):** `MODEL3_V2_SIGNAL_LOSS_AUDIT_PARITY_CORRECTION`

Do not execute automatically. Wait for user review.
