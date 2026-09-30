# Lingua — Model3 Retry Performance Causal Breakdown Audit

Generated: 2026-09-05T06:30:00Z  
Phase: `MODEL3_RETRY_PERFORMANCE_CAUSAL_BREAKDOWN_AUDIT`  
Mode: READ-ONLY — NO PRODUCTION CHANGE / NO OPTIMIZATION

Freeze preserved (not reopened):

| Item | State |
|------|--------|
| Delta 1 | `RESOLVED_ACCEPTED_CLOSED` |
| Delta 2 | `RESOLVED_ACCEPTED` |
| `RETRY_FALLBACK_QUERY_GEOMETRY` | `LEGAL_BOUNDED_RETRY_REGION_WINDOW_SPACE_1_TO_5` |
| `FIRST_PASS_FINESPAN_FALLBACK_ROLE` | `OWNERSHIP_SUPPORT_ONLY_NOT_QUERY_AUTHORITY` |

================================
1. EXECUTIVE VERDICT
====================

**MODEL3_RETRY_PERFORMANCE_CAUSAL_AUDIT_PASS_MULTIPLE_OWNERS**

Performance risk: **`PERFORMANCE_CONCERN_NONBLOCKING`**  
Formal target: **`PERFORMANCE_TARGET_NOT_FORMALLY_ENFORCED`**

### Final question — why ~10s p50 / ~23s p95?

The accepted Delta2 Acceptance metric `utterancePipelineMs` is **not pure production Runtime inference latency**. It is wall-clock of HTTP `/run-pipeline-with-audio` under **dual-weight causal-fork acceptance harness**, and is dominated by **ASR upstream**, not by Delta2 query amplification.

| Owner | Production share (clean n=198) | Class |
|-------|-------------------------------:|-------|
| **A. ASR / non-FW** | **~57%** (p50 ≈ 3489 ms) | **DOMINANT / PRIMARY** |
| **B. FW residual** (FineSpan / 1st-pass Recall / Vote / Assembly excl. M3/Retry/KenLM) | **~31%** (p50 ≈ 1915 ms) | **SIGNIFICANT / SECONDARY** |
| **K. KenLM** | **~10%** (p50 ≈ 633 ms) | SIGNIFICANT |
| **H. Retry** (incl. Stage-2 Recall) | **~1%** (p50 ≈ 44 ms) | MINOR |
| **D. Model3** | **~0.35%** (p50 ≈ 20 ms) | NEGLIGIBLE |
| Acceptance dual-fork harness | +~2.6s p50 vs production | SIGNIFICANT on Acceptance metric only |

**PRIMARY_LATENCY_OWNER:** `A_ASR_upstream`  
**SECONDARY_LATENCY_OWNER:** `B_FW_first_pass_residual`  
**DELTA2_INCREMENTAL_LATENCY_OWNER:** `H_Retry_Stage2_Recall` — real but **tiny** vs E2E (~2.5 ms/query; <1% of pipeline).

Do **not** optimize Delta2 window space to “fix” the 10s p50.

`DECISION_REQUIRED_BEFORE_OPTIMIZATION`: **EMPTY** for next measurement isolation (ASR/FW). Window pruning would be a **SEMANTIC_TRADEOFF** and is not selected.

================================
2. MEASUREMENT VALIDITY
=======================

| Gate | Result |
|------|--------|
| `npm run build:main` | PASS |
| Electron 28.3.3 / modules **119** | PASS |
| LEXICON / SQLITE / RECALL runtime | PASS |
| Same Model3 / Lexicon / Delta1+2 code | YES |
| Invalid ABI / mock Recall | NOT used |

Two measurement layers:

1. **Acceptance dump** (Delta2 AFTER, 200/200) — dual-weight causal fork ON (same as Acceptance).  
2. **Production timing dump** (`model3_retry_performance_timing_raw.jsonl`, 198 clean / 1 outlier excluded `d094=916722ms`) — **single-pass**, fork OFF; captures already-emitted `pipeline_ms`, `fw_detector_step_ms`, `model3_latency_ms`, `retry_path_latency_ms`, KenLM ms.

================================
3. LATENCY CLOCK DEFINITION
===========================

### Acceptance `utterancePipelineMs` / harness `pipelineMs`

```text
start: acceptance runner Date.now() before HTTP POST /run-pipeline-with-audio
end:   after HTTP response received
```

Server `extra.pipeline_ms` likewise wraps `runPipelineWithAudio` (ASR + full postprocess).

**Includes:** audio/ASR, FW path, Model3, Retry, Assembly, KenLM, IPC, response/trace serialization, and (in Acceptance) **dual Model3 infer + dual Retry/Assembly per path** via `MODEL3_ACCEPTANCE_DUAL_WEIGHT_CLASS_WEIGHT_AUDIT`.

**Excludes:** Electron cold start before first case, `npm run build`.

**Pure runtime inference?** **NO.**

### Production timing clocks used for ownership

| Metric | Boundary |
|--------|----------|
| `pipeline_ms` | full audio pipeline (ASR+FW) |
| `fw_detector_step_ms` | `runFwDetectorV4Path` wall |
| ASR estimate | `pipeline_ms - fw_detector_step_ms` |
| `model3_latency_ms_sum` | path-sum host infer |
| `retry_path_latency_ms_sum` | path-sum `routeModel3Retry` wall |
| KenLM ms | `kenlmVetoMs` / subprocess batch |

================================
4. REPLAY POPULATION
====================

| Population | n | Config |
|------------|--:|--------|
| Delta2 Acceptance AFTER | 200 | dual-weight causal fork |
| Production timing | 198 clean (+1 error, +1 outlier) | single-pass production |
| dialog_200 | same manifest / Model3 / Lexicon | measurement only |

================================
5. END-TO-END LATENCY
=====================

| Metric | Acceptance (dual fork) | Production (single) |
|--------|-----------------------:|--------------------:|
| p50 | 9958 | **7400** |
| p95 | 22853 | **18003** |
| max | 37134 | 30911 (clean) |
| mean | 11277 | 8469 |

Warm-run (production): first10 p50 **11745** → mid **5971** → last50 **4870** (warm-up present; not sole cause of ~7–10s).

================================
6. STAGE LATENCY BREAKDOWN
==========================

Production clean n=198 (see `model3_retry_performance_stage_breakdown.csv`):

| Stage | p50 ms | p95 ms | share % | Class |
|-------|-------:|-------:|--------:|-------|
| Pipeline | 7400 | 18003 | 100 | — |
| A ASR (+non-FW) | 3489 | 9916 | **57.4** | DOMINANT |
| B FW total | 2661 | 7512 | 42.6 | — |
| B FW residual (ex M3/Retry/KenLM) | 1915 | 6452 | **31.3** | SIGNIFICANT |
| K KenLM | 633 | 3658 | **10.0** | SIGNIFICANT |
| H Retry | 44 | 285 | **1.0** | MINOR |
| D Model3 | 20 | 85 | **0.35** | NEGLIGIBLE |

Stages without dedicated timers (region derive, window enum alone, merge): folded into Retry or FW residual → class **NOT_SEPARATELY_MEASURABLE** but bounded by parent stage.

================================
7. RETRY LATENCY BREAKDOWN
==========================

Production path-sum Retry:

| Metric | Value |
|--------|------:|
| p50 / p95 / max | 44 / 285 / 656 ms |
| share of pipeline | ~1% |
| ms / Stage-2 query (p50) | **~2.5 ms** |
| Pearson(queryCount, retryMs) | **0.91** |
| Pearson(queryCount, pipelineMs) | **~0.02** |

Decomposition (static + timers):

| Substage | Evidence |
|----------|----------|
| region derivation | inside Retry timer; cheap relative to Recall |
| lattice resegment | inside Retry; success vs fallback both under Retry sum |
| window enumeration | CPU only; not dominant |
| Recall / SQLite | **dominant inside Retry** (scales with query count) |
| materialize/merge | inside Retry; secondary |
| Assembly contribution | post-Retry; mainly in FW residual / KenLM path |

================================
8. QUERY COUNT VS LATENCY
=========================

Acceptance wall clock scales with query count (Pearson **0.80**) largely because multipath+fork inflate both. Production Retry scales tightly with queries; **E2E pipeline does not** (Pearson ~0).

| Query bucket | Acc pipe p50 | Prod Retry p50 |
|--------------|-------------:|---------------:|
| 0–5 | 8019 | 9 |
| 6–10 | 8847 | 21 |
| 11–20 | 10855 | 37 |
| 21–40 | 12851 | 85 |
| >40 | 22923 | 205 |

Latency scales with query count **inside Retry**, not as the E2E dominant.

================================
9. DELTA2 INCREMENTAL COST
==========================

| Item | Value |
|------|------:|
| beforeFallbackQueryCount | 1074 |
| afterFallbackQueryCount | 2463 |
| additionalQueries | **1389** |
| CAUSALLY_COMPARABLE | 109 |
| ASR_CONTAMINATED | 91 |
| comparable Δpipeline p50 | +3535 ms |
| comparable ΔfallbackQueries mean | +5.67 |
| estimated ΔRetry ms/utt @2.5ms/q | **~14 ms** |

**Interpretation:** Delta2 expands architecture-required query space, but the Acceptance +3.5s comparable pipeline delta is **not** Delta2-causal at query-cost scale. ASR/timing variance + harness dominate. Delta2 incremental owner remains Retry Recall, **MINOR** vs E2E.

================================
10. SQLITE / RECALL COST
========================

| Finding | Evidence |
|---------|----------|
| Stage-2 calls | `recallSpanTopKV2` per window (serial) |
| First-pass utterance cache | used in first-pass window recall path |
| Retry Stage-2 shared utterance cache | **not wired** in `run-model3-path-step` recall injection |
| Lattice resegment | `enableUtteranceRecallCache: false` |
| Cost | ~2.5 ms/query p50 inside Retry |

Classification: Retry SQLite work is **INTENTIONALLY_SERIAL** per window; cache gap is possible **IMPLEMENTATION_REDUNDANCY** for future, not proven dominant E2E.

================================
11. DUPLICATE WORK
==================

Cross-path duplicate Stage-2 invocations (same start/end/pinyin key across paths) observed in Acceptance dump:

| Metric | Value |
|--------|------:|
| total Retry invocations | 3351 |
| cross-path duplicate invocations | (see summary JSON) |
| class | **EXPECTED_MULTIPATH** (path-local Domain Vote frozen) |

Not classified as accidental global cache failure without path-local requirement change.

================================
12. MULTIPATH COST
==================

Acceptance:

| Cohort | n | pipe p50 | mean queries | mean paths |
|--------|--:|---------:|-------------:|-----------:|
| single-path / none | 100 | 8646 | 7.3 | 0.96 |
| multipath Retry | 100 | 10961 | 26.2 | 3.03 |

Legitimate per-path independence explains much query growth; path collapse forbidden.

================================
13. FALLBACK VS SUCCESS COST
============================

Delta2 Acceptance: fallback regions 384 / success 168; fallback queries 2463 vs success remainder.  
Production Retry timer does not split success vs fallback internally; both share Stage-2 enumerator. Fallback has more windows by design → higher Recall count, still under Retry ~1% E2E.

================================
14. MODEL3 COST
===============

| Metric | Production |
|--------|------------|
| p50 / p95 / max (path-sum) | 20 / 85 / 171 ms |
| share | ~0.35% |
| load | singleton host; dual-fork Acceptance reloads weights (harness-only) |

Engineering doc target 5–15 ms CPU p50 is **engineering target only**, not enforced PASS gate. Measured ~20 ms path-sum is still negligible vs ASR.

================================
15. KENLM COST
==============

| Metric | Production |
|--------|------------|
| p50 / p95 | 633 / 3658 ms |
| share | ~10% |
| sentence pool | ≤16 (cap intact) |

Material inside FW, not the E2E primary owner.

================================
16. STARTUP / HARNESS OVERHEAD
=============================

| Class | Finding |
|-------|---------|
| COLD_START | excluded from per-utt metrics after ASR ready |
| WARM_RUNTIME | last50 production p50 ~4870 ms |
| HARNESS_OVERHEAD | Acceptance dual-fork ≈ **+2558 ms p50** vs production |

Acceptance ~10s p50 ≈ production ~7.4s + harness dual-fork + case mix.

================================
17. WARM-RUN ANALYSIS
=====================

Production: first10 hotter than last50 (~11.7s → ~4.9s p50). Warm-up exists but **does not relocate** primary ownership away from ASR/FW.

================================
18. PERFORMANCE OWNER CLASSIFICATION
====================================

| Stage | Class |
|-------|-------|
| ASR | **DOMINANT** |
| FW residual | **SIGNIFICANT** |
| KenLM | **SIGNIFICANT** |
| Retry / Stage-2 Recall | **MINOR** |
| Model3 | **NEGLIGIBLE** |
| Window enum alone | NEGLIGIBLE / not separately timed |
| Acceptance dual fork | SIGNIFICANT **on Acceptance metric only** |

================================
19. ARCHITECTURE-REQUIRED VS AVOIDABLE COST
===========================================

| Cost | Class |
|------|-------|
| Legal 1..5 Retry windows (Delta2) | **ARCHITECTURE_REQUIRED_COST** |
| Per-path Retry independence | **ARCHITECTURE_REQUIRED_COST** |
| Dual-weight Acceptance fork | **TEST_HARNESS_COST** |
| ASR wall time | **IO_COST / MODEL_INFERENCE_COST** (upstream) |
| Possible missing Stage-2 utterance cache | **IMPLEMENTATION_REDUNDANCY** (candidate; not E2E primary) |

================================
20. EXISTING PERFORMANCE TARGET STATUS
======================================

Authoritative doc `model3_performance_contract_v1.md`:

- Model3 CPU p50 **5–15 ms** = **engineering target**, explicitly **not a PASS threshold**.
- No enforced end-to-end utterance SLA found for current mainline Acceptance.

→ **`PERFORMANCE_TARGET_NOT_FORMALLY_ENFORCED`**

================================
21. POTENTIAL OPTIMIZATION SURFACES
===================================

| Surface | Measured cost | Class | Semantic risk |
|---------|---------------|-------|---------------|
| ASR upstream latency | ~57% E2E | SAFE_IMPLEMENTATION_OPTIMIZATION / infra | none to Retry SSOT |
| First-pass FW residual | ~31% | needs isolation first | unknown until split |
| KenLM subprocess | ~10% | SAFE_IMPLEMENTATION_OPTIMIZATION possible | ranking risk if changed |
| Stage-2 utterance cache share | Retry ~1% E2E | SAFE_IMPLEMENTATION_OPTIMIZATION | low if result-identical |
| Reduce legal windows / TopK | Retry only | **SEMANTIC_TRADEOFF** | changes search space |
| Drop multipath Retry | — | **ARCHITECTURE_CHANGE_REQUIRED** | frozen |

================================
22. CONTROL-VARIABLE NEXT STEP
==============================

**Exactly one:** `ASR_UPSTREAM_AND_FIRST_PASS_FW_COST_ISOLATION`

Highest avoidable/unexplained E2E mass; lowest architecture risk to Delta1/Delta2.  
Do **not** choose Delta2 query pruning.

================================
23. DECISION_REQUIRED_BEFORE_OPTIMIZATION
=========================================

**EMPTY**

(Next step is further read-only isolation / infra measurement. Any window/TopK/cap change would require a new decision and is **not** selected.)

================================
24. TARGET LIST FOR NEXT PHASE
==============================

READ_ONLY next:

- Isolate ASR service time vs queue/IPC
- Split FW residual (1st-pass Recall vs lattice vs vote vs assembly)
- Optionally quantify Stage-2 cache miss duplication without enabling cache

Do not modify production.

================================
25. CHECK LIST
==============

- [x] env valid
- [x] clock defined (Acceptance ≠ pure runtime)
- [x] stage breakdown with shares
- [x] Retry vs query scaling proven
- [x] Delta2 incremental cost bounded
- [x] Model3 / KenLM / multipath measured
- [x] harness dual-fork quantified
- [x] primary owner ≠ Delta2
- [x] no production change
- [x] Delta1/Delta2 freeze preserved

================================
26. NEXT PHASE
==============

**`MODEL3_RETRY_PERFORMANCE_ASR_FW_OWNER_ISOLATION`** (read-only)  
and/or continue **`MODEL3_RETRY_POST_DELTA_RECONCILIATION`** (architecture read-only).

Do not start query pruning / TopK / Lexicon / Model3 quality work from this performance signal alone.
