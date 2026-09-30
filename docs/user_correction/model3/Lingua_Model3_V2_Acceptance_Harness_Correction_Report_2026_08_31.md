# Lingua — Model3 V2 Acceptance Harness Correction

Date: 2026-08-31  
Phase: `MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|------|
| verdict | **`ACCEPTANCE_HARNESS_CORRECTION_PASS`** |
| fork point | `prepareModel3PathUpstream` → `completeModel3PathFromUpstream` in `run-model3-path-step.ts` |
| snapshot | `MODEL3_ACCEPTANCE_UPSTREAM_SNAPSHOT_V1` (test/audit only) |
| dialog_200 parity | **200 / 200** PASS |
| subset parity (30) | **30 / 30** PASS |
| packed symmetry | **200 / 200** (`baselinePacked == s3Packed`) |
| mutation isolation | **200 / 200** |
| architecture change | **NO** |
| production behavior change | **NO** (gated by `MODEL3_ACCEPTANCE_CAUSAL_FORK=1`) |
| next phase | **`MODEL3_V2_S3_FINAL_CAUSAL_MAINLINE_ACCEPTANCE`** |

This phase does **not** run final model promotion acceptance. It makes causal acceptance **valid**.

================================
PREVIOUS ACCEPTANCE STATUS
==========================

Prior mainline acceptance (`28 IMPROVED / 17 ASSEMBLY_OR_KENLM`) remains:

**`HISTORICAL_NON_CAUSAL_ACCEPTANCE_EVIDENCE`**

Cause: two independent full-pipeline runs with `MODEL3_HARNESS_KEEP_ALL=1` skipping Model3 pack/infer on baseline. Prior Assembly/KenLM ownership is **rejected** for causal attribution.

Historical artifacts are **not deleted** — superseded for ownership only.

================================
HARNESS BEFORE / AFTER
======================

| | Before | After |
|---|--------|-------|
| upstream | 2× `/run-pipeline-with-audio` (ASR rerun) | **1×** upstream per case |
| baseline | `MODEL3_HARNESS_KEEP_ALL=1` skips infer/pack | **same pack/infer**, effective KEEP via `keepOverrideFromPacked` |
| S3 | separate run | **same frozen snapshot**, real decisions |
| parity | 0 / 200 | **200 / 200** |
| env gate | `MODEL3_HARNESS_KEEP_ALL` | **`MODEL3_ACCEPTANCE_CAUSAL_FORK=1`** (no KEEP_ALL) |

Runner: `electron_node/electron-node/tests/run-dialog200-acceptance-harness-correction.mjs`

================================
FORK BOUNDARY
=============

**Function:** `runModel3PathStepCausalFork`  
**Files:**
- `electron_node/electron-node/main/src/model3-runtime/run-model3-path-step.ts`
- `electron_node/electron-node/main/src/model3-runtime/model3-acceptance-snapshot.ts`
- `electron_node/electron-node/main/src/fw-detector/span-assembly-v4/span-assembly-v4-orchestrator.ts`
- `electron_node/electron-node/main/src/fw-detector/fw-detector-v4-path.ts`

**Frozen after:** ASR → FW → FineSpan paths → Recall → Model2 → Domain Vote → Anchor → `packModel3SpanInferFields` + host infer  
**Frozen before:** actionable RETRY routing, Recall retry, Assembly refresh, KenLM

**Model3 stage semantics:** ONE decision stage per path (may evaluate multiple spans); Retry does **not** invoke a second Model3 stage.

================================
SNAPSHOT CONTRACT
=================

Schema: `model3_v2_acceptance_snapshot_contract.json`  
Hash: `sha256_canonical_json_v1`  
Scope: **test/audit only** — NOT JobResult, NOT production API

Immutability: `structuredClone` per branch; `upstreamHash` unchanged after baseline and after S3.

================================
BRANCH SYMMETRY
===============

| Branch | Mechanism | Retry | Downstream |
|--------|-----------|-------|------------|
| BASELINE | `keepOverrideFromPacked(packedDecisions)` | none actionable | `routeModel3Retry` → Assembly → KenLM |
| S3 | `packedDecisions` after Anchor mask | actionable RETRY | same production implementations |

Packed symmetry verified: **baselinePacked == s3Packed** on all 200 cases (inference trace span counts match).

KenLM: both branches scored via `runFwSentenceRerankFromPrefilled` (same implementation).

================================
DETERMINISM
===========

| Check | Result |
|-------|--------|
| Same-run packed symmetry | PASS (200/200) |
| Same-run mutation isolation | PASS (200/200) |
| Cross-run upstream hash (3 probe cases) | **Not required** — independent ASR reruns differ; parity is **within-run** fork |
| Unit tests (`model3-acceptance-snapshot.test.ts`) | 9/9 PASS |
| Integration tests (`model3-mainline.integration.test.ts`) | 12/12 PASS |

================================
DIALOG_200 PARITY
=================

| Metric | Count |
|--------|------:|
| snapshot captured | 200 |
| full upstream parity PASS | 200 |
| packed symmetric | 200 |
| mutation isolated | 200 |
| second Domain Vote | 0 |
| effective Anchor RETRY | 0 |

Preliminary same-run baseline-vs-S3 final comparison (sanity only, not promotion): all 200 **UNCHANGED** relative to reference distance — Retry did not change KenLM winner vs KEEP baseline on this run. Formal causal quality attribution deferred to next phase.

================================
INVARIANTS
==========

See `model3_v2_acceptance_harness_invariants.json`. All checks PASS on full run.

================================
LATENCY INSTRUMENTATION
=======================

Post-fork timing now available (case-level sum of path post-fork ms):

| Metric | p50 (ms) |
|--------|----------|
| baseline post-fork | ~1 |
| S3 post-fork | ~16 |
| delta | ~15 |

Unit: per-case sum of path-level Retry+Assembly completion time after fork. Does **not** include ASR or Model3 infer (infer runs once in prepare, before fork).

See `model3_v2_acceptance_harness_latency_probe.csv`.

================================
GOVERNANCE
==========

| Item | Changed |
|------|---------|
| business architecture | NO |
| S3 / training | NO |
| features / threshold | NO |
| Retry / Recall / Assembly / KenLM | NO |
| JobResult | NO |
| production dual-chain | NO |

Test-only refactor: `prepareModel3PathUpstream` / `completeModel3PathFromUpstream` split in `run-model3-path-step.ts` — **TESTABILITY REFACTOR, NOT ARCHITECTURE CHANGE**.

================================
REQUIRED DECISIONS (D1–D40)
===========================

| ID | Answer |
|----|--------|
| D1 | YES — S3 identity exact |
| D2 | Fork: `prepareModel3PathUpstream` / `runModel3PathStepCausalFork` |
| D3 | rawAsr, paths, FineSpans, candidates, domains, anchors, packed tokenIds/featVector/availMask |
| D4 | YES — test/audit only |
| D5 | YES — JobResult untouched |
| D6 | YES — one upstream execution per case |
| D7 | YES — identical snapshot hash consumed by both branches (per path) |
| D8 | YES — identical packed Model3 state (200/200 symmetric) |
| D9 | YES — baseline runs same pack/infer/trace infrastructure |
| D10 | YES — effective KEEP |
| D11 | YES — real S3 decisions from frozen pack |
| D12–D15 | YES — same Retry/Recall/Assembly/KenLM implementations |
| D16 | NO duplicated business logic |
| D17 | NO permanent dual mainline (`MODEL3_ACCEPTANCE_CAUSAL_FORK=1` gate) |
| D18 | NO production behavior change without env gate |
| D19–D20 | Same-run branch outputs stable; cross-run ASR may differ |
| D21 | 30/30 subset PASS |
| D22–D23 | 200/200 capture; 200/200 parity |
| D24–D26 | none |
| D27 | YES — metric units in snapshot contract |
| D28–D32 | invariants PASS |
| D33 | NO JobResult change |
| D34 | YES — post-fork latency measurable |
| D35–D36 | prior 28/18 historical; Assembly/KenLM ownership rejected |
| D37 | YES — corrected harness ready for **formal** causal acceptance |
| D38 | `ACCEPTANCE_HARNESS_CORRECTION_PASS` |
| D39 | `MODEL3_V2_S3_FINAL_CAUSAL_MAINLINE_ACCEPTANCE` |

================================
NEXT PHASE
==========

**`MODEL3_V2_S3_FINAL_CAUSAL_MAINLINE_ACCEPTANCE`**

Do not execute automatically. Do not promote Model3 in this phase.

Wait for user review.
