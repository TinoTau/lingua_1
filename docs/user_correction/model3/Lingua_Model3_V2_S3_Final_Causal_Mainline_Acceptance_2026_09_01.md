# Lingua — Model3 V2 S3 Final Causal Mainline Acceptance

Date: 2026-09-01  
Phases: `MODEL3_V2_ACCEPTANCE_HARNESS_FREEZE` → `MODEL3_V2_S3_FINAL_CAUSAL_MAINLINE_ACCEPTANCE`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|------|
| Harness freeze | **`ACCEPTANCE_HARNESS_FREEZE_PASS`** |
| Final verdict | **`S3_FINAL_CAUSAL_ACCEPTANCE_SAFE_BUT_UTILITY_NOT_DEMONSTRATED`** |
| S3 identity | Exact (`MODEL3_V2_S3_RANDOM_INIT_V1` / SHA `f1e4196…bbb1`) |
| QUALITY_SAFETY | **PASS** (0 REGRESSED) |
| QUALITY_UTILITY | **NOT_DEMONSTRATED** (0 IMPROVED) |
| IMPROVED / REGRESSED / UNCHANGED | **0 / 0 / 200** |
| MODEL3_RESCUABLE_CASES | **170** (baseline wrong) |
| Rescuable final repairs | **0** |
| Dominant signal-loss stage | **`RETRY_REGION_NO_USEFUL_REINTERPRETATION`** (131/200) |
| Secondary loss | ASSEMBLY drops viable (17), Recall/no-viable surface (12), Model3 no-trigger (10), baseline already correct (30) |
| Latency | Matrix **CONCERN** (total increment p95 ≈ 238 ms); not promotion-blocking alone |
| PROMOTION | **NOT_READY** |
| Next phase | **`MODEL3_V2_RETRY_REGION_SIGNAL_LOSS_AUDIT`** |

Do **not** promote. Do **not** retrain / retune / change Retry / Recall / Assembly / KenLM.

================================
PART A — HARNESS FREEZE
=======================

| Field | Frozen value |
|-------|----------------|
| harnessVersion | `MODEL3_ACCEPTANCE_HARNESS_V1_20260831` |
| fork | `runModel3PathStepCausalFork` |
| prepare / complete | `prepareModel3PathUpstream` / `completeModel3PathFromUpstream` |
| snapshot | `MODEL3_ACCEPTANCE_UPSTREAM_SNAPSHOT_V1` (test/audit only) |
| hash | `sha256_canonical_json_v1` |
| override | `keepOverrideFromPacked` |
| gate | `MODEL3_ACCEPTANCE_CAUSAL_FORK=1` |
| runner | `run-dialog200-acceptance-harness-correction.mjs` |
| prior runner | `run-dialog200-s3-mainline-ab.mjs` = **SUPERSEDED_FOR_CAUSAL_ACCEPTANCE** |

Frozen evidence: subset 30/30, full 200/200 parity, packed symmetry 200/200, mutation isolation 200/200, unit 9/9, integration 12/12.

Prior 28/18/17 remains **`HISTORICAL_NON_CAUSAL_ACCEPTANCE_EVIDENCE`**.

Phase A verdict: **`ACCEPTANCE_HARNESS_FREEZE_PASS`** → Phase B authorized.

================================
FINAL CAUSAL QUALITY
====================

Formal dialog_200 (frozen harness, one upstream per case):

| Class | Count |
|-------|------:|
| IMPROVED | 0 |
| REGRESSED | 0 |
| UNCHANGED | 200 |
| INDETERMINATE | 0 |

Snapshot / packed parity: **200 / 200**.

================================
UNCHANGED DECOMPOSITION
=======================

| Subtype | Count |
|---------|------:|
| UNCHANGED_NO_RETRY | 12 |
| UNCHANGED_RETRY_NO_CANDIDATE | 14 |
| UNCHANGED_RETRY_CANDIDATE_NO_ASSEMBLY_CHANGE | 173 |
| UNCHANGED_RETRY_ASSEMBLY_CHANGED_WINNER_SAME | 1 |
| UNCHANGED_RETRY_INTERNAL_CHANGE_FINAL_SAME | 0 |
| UNCHANGED_OTHER | 0 |

================================
RESCUABLE CASE FUNNEL
=====================

| Stage | Unit | Count |
|-------|------|------:|
| utterances | CASE | 200 |
| baseline already correct | CASE | 30 |
| MODEL3_RESCUABLE_CASES | CASE | 170 |
| rescuable + any RETRY | CASE | 160 |
| rescuable + candidate return | CASE | 148 |
| rescuable + viable Assembly sentence (closer to ref than baseline) | CASE | 17 |
| rescuable + KenLM pool fingerprint changed | CASE | 1 |
| rescuable + KenLM selected repair (≈ IMPROVED) | CASE | 0 |
| final IMPROVED | CASE | 0 |

================================
SIGNAL LOSS OWNERSHIP
=====================

| Stage | Cases | Owner |
|-------|------:|-------|
| RETRY_REGION_NO_USEFUL_REINTERPRETATION | 131 | RETRY_REGION |
| BASELINE_ALREADY_CORRECT_OR_EQUIVALENT | 30 | BASELINE_ALREADY_CORRECT |
| ASSEMBLY_DROPS_VIABLE_CANDIDATE | 17 | ASSEMBLY |
| RECALL_NO_VIABLE_CANDIDATE | 12 | RECALL_OR_NO_VIABLE_SURFACE (not auto-Recall-fail) |
| MODEL3_TRIGGER_NO_USEFUL_TARGET | 10 | MODEL3_TRIGGER |

**Primary owner for next audit:** `RETRY_REGION`  
(Candidates often return, but almost never change the KenLM sentence pool / useful local reinterpretation.)

Model3 trigger is **not** the dominant blocker: 188/200 cases have any RETRY; 160/170 rescuable cases were triggered.

================================
RETRY DISTRIBUTION
==================

| Metric | Value |
|--------|------:|
| RAW_PATH_RETRY_SPAN | 1666 |
| LOGICAL_UNIQUE_RETRY_SPAN | 851 |
| RETRY_REGION | 1154 |
| CASE_WITH_ANY_RETRY | 188 / 200 (94%) |
| logical ≈ rate vs packed spans | ~8.75% |

Historical causal-audit reference (raw≈1701, logical≈790, case≈188/200) — same order of magnitude; not required to match exactly.

================================
FALSE RETRY BUSINESS IMPACT
===========================

Among 188 CASE_WITH_ANY_RETRY:

| Impact | Count |
|--------|------:|
| NO_FINAL_EFFECT | 0 (classified under latency when delta>1ms) |
| LATENCY_ONLY_EFFECT | 188 |
| FINAL_REGRESSION | 0 |
| ACCIDENTAL_IMPROVEMENT | 0 |

Frequent RETRY is **harmless to final text** on this set, but **not free** (latency).

================================
LATENCY
=======

Post-ASR Model3 mainline increment (inference + Retry incremental):

| | p50 | p90 | p95 | max |
|--|----:|----:|----:|----:|
| Model3 inference (ms) | 20 | 64 | 92 | 307 |
| Retry incremental (ms) | 14 | 88 | 132 | 363 |
| TOTAL_MODEL3_MAINLINE_INCREMENT (ms) | 33 | 141 | 238 | 522 |

ASR excluded. Matrix LATENCY = **CONCERN** (p95 total > 200 ms) — secondary to utility failure.

================================
INVARIANTS
==========

| Check | Result |
|-------|--------|
| Domain Vote second | 0 |
| effective Anchor RETRY | 0 |
| Anchor mutation | 0 |
| recursive Model3 | 0 |
| candidate cap >16 | 0 (max pool 6) |
| multipath | preserved |
| JobResult | unchanged |
| Model3 stage | one stage / utterance; multipath internal |

================================
ACCEPTANCE MATRIX
=================

| Axis | Result |
|------|--------|
| QUALITY_SAFETY | **PASS** |
| QUALITY_UTILITY | **NOT_DEMONSTRATED** |
| ARCHITECTURE | **PASS** |
| LATENCY | **CONCERN** |
| PROMOTION | **NOT_READY** |

================================
GOVERNANCE
==========

S3 / training / dataset / feature / threshold / Retry / Recall / Assembly / KenLM / JobResult / ASR / production dual-chain: **all NO change**.

Test-only enrichment: KenLM pool fingerprints + model3 inference ms sum on `acceptance_causal` (fork gate only).

================================
REQUIRED DECISIONS (D1–D47)
===========================

| ID | Answer |
|----|--------|
| D1 | YES — Harness Freeze PASS |
| D2 | MODEL3_ACCEPTANCE_HARNESS_V1_20260831 |
| D3 | runModel3PathStepCausalFork |
| D4 | MODEL3_ACCEPTANCE_UPSTREAM_SNAPSHOT_V1 |
| D5 | YES — 200/200 |
| D6 | YES — 200/200 |
| D7 | NO production architecture change |
| D8 | YES — S3 identity exact |
| D9 | IMPROVED = 0 |
| D10 | REGRESSED = 0 |
| D11 | UNCHANGED = 200 |
| D12 | INDETERMINATE = 0 |
| D13 | UNCHANGED_NO_RETRY = 12 |
| D14 | UNCHANGED_RETRY_NO_CANDIDATE = 14 |
| D15 | UNCHANGED_RETRY_CANDIDATE_NO_ASSEMBLY_CHANGE = 173 |
| D16 | UNCHANGED_RETRY_ASSEMBLY_CHANGED_WINNER_SAME = 1 |
| D17 | UNCHANGED_RETRY_INTERNAL_CHANGE_FINAL_SAME = 0 |
| D18 | baseline already correct = 30 |
| D19 | MODEL3_RESCUABLE = 170 |
| D20 | rescuable triggered = 160 |
| D21 | produced candidate return = 148 |
| D22 | viable survived into path Assembly sentences = 17 |
| D23 | KenLM selected repair = 0 |
| D24 | rescuable final improvements = 0 |
| D25 | dominant loss = RETRY_REGION_NO_USEFUL_REINTERPRETATION |
| D26 | Model3 trigger blocker? NOT primary (10 no-trigger only) |
| D27 | Retry-region blocker? **YES — primary** |
| D28 | Recall blocker? NOT primary (12 zero-cand / no-viable surface) |
| D29 | Assembly blocker? Secondary (17) |
| D30 | KenLM blocker? NO (pool almost never gains viable winner) |
| D31 | raw path RETRY = 1666 |
| D32 | logical RETRY = 851 (~8.75% vs packed) |
| D33 | case any RETRY = 188/200 (94%) |
| D34 | false RETRY impact = LATENCY_ONLY (188) |
| D35 | Model3 inference p50/p95 = 20 / 92 ms |
| D36 | Retry incremental p50/p95 = 14 / 132 ms |
| D37 | total increment p50/p95 = 33 / 238 ms |
| D38 | candidate-cap violation = 0 |
| D39 | second Domain Vote = 0 |
| D40 | Anchor ownership violation = 0 |
| D41 | recursive Model3 = 0 |
| D42 | quality safety PASS |
| D43 | quality utility NOT_DEMONSTRATED |
| D44 | promotion NOT justified |
| D45 | primary owner = RETRY_REGION |
| D46 | `S3_FINAL_CAUSAL_ACCEPTANCE_SAFE_BUT_UTILITY_NOT_DEMONSTRATED` |
| D47 | `MODEL3_V2_RETRY_REGION_SIGNAL_LOSS_AUDIT` |

================================
NEXT PHASE
==========

**`MODEL3_V2_RETRY_REGION_SIGNAL_LOSS_AUDIT`**

Do not execute automatically.  
Do not promote Model3.  
Do not optimize threshold / train / change Assembly or KenLM in that phase until Retry-region reinterpretation evidence is complete.

Wait for user review.
