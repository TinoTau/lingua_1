# Lingua — Model3 V2 S3 Mainline Causal Replay / Parity Audit

Date: 2026-08-31  
Phase: `MODEL3_V2_S3_MAINLINE_CAUSAL_REPLAY_AUDIT`

================================
EXECUTIVE VERDICT
=================

| Item | Value |
|------|------|
| verdict | `S3_CAUSAL_REPLAY_BLOCKED_BY_ACCEPTANCE_HARNESS` |
| S3 identity | **PASS** — `MODEL3_V2_PRODUCTION_CORE_S3` / `prod_core_s3_build_20260830_v1` / SHA `f1e4196933a66bbe…` |
| previous acceptance | **HISTORICAL_NON_CAUSAL_ACCEPTANCE_EVIDENCE** (28/18 not causal) |
| upstream parity PASS | **0** / 200 |
| causal IMPROVED | 0 |
| causal REGRESSED | 0 |
| dominant blocker | acceptance harness — no frozen upstream fork |
| live raw RETRY rate | 18.06% (path-span) |
| live logical RETRY rate | 8.39% (deduped) |
| promotion readiness | **NO** |
| next phase | `MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION` |

================================
PREVIOUS ACCEPTANCE RECLASSIFICATION
====================================

The prior mainline acceptance (`28 IMPROVED / 18 REGRESSED`, 17 × `ASSEMBLY_OR_KENLM`) used **two independent full-pipeline executions** (`run-dialog200-s3-mainline-ab.mjs`: baseline `MODEL3_HARNESS_KEEP_ALL=1`, then S3 actionable). Baseline and S3 did **not** share a frozen upstream state.

Observed cross-run divergence on dialog_200:

| Field | Mismatch cases |
|------|----------------:|
| raw_asr | 91 |
| non_anchor_spans | 77 |
| anchors | 60 |
| model3_paths | 40 |
| vote_calls / domain anchors | 30–40 |

**Conclusion:** prior quality comparison is **not** a strict causal A/B. Prior `ASSEMBLY_OR_KENLM` ownership is **not valid** for causal attribution — it was assigned without upstream parity and without distinguishing Assembly vs KenLM.

Status: **`HISTORICAL_NON_CAUSAL_ACCEPTANCE_EVIDENCE`** — superseded pending harness correction.

================================
CAUSAL HARNESS
==============

| Item | Current state |
|------|----------------|
| harness | `electron_node/electron-node/tests/run-dialog200-s3-mainline-ab.mjs` |
| design | **TWO independent `/run-pipeline-with-audio` runs** |
| fork point (intended) | Model3 path step — after ASR → FineSpan → Recall → Model2 → Domain → Anchor → pack |
| frozen upstream replay | **NO** — not implemented in dialog_200 harness |
| baseline branch | `MODEL3_HARNESS_KEEP_ALL=1` → **skips Model3 inference** (`run-model3-path-step.ts`) |
| S3 branch | full Model3 inference + actionable RETRY |
| unit-test replay hooks | `keepAll`, `decisionOverride` exist in `runModel3PathStep` / integration tests only |
| offline trace replay | `replay_model3_live_input_trace.py` (Model3 logits only; no full mainline fork) |

**Required design (not present):** one upstream execution → capture frozen state → replay KEEP_ALL vs S3 RETRY from identical hash.

================================
UPSTREAM PARITY
===============

Full upstream hash fields: `caseId, raw_asr, model3_paths, non_anchor_spans, domain_anchor_count, model2_anchor_count, dual_source_anchor_count, anchors, vote_calls, retained_domains, rejected_prevote, second_vote, kenlm_pool_pre_fork, span_identity, packed_model3_spans`.

| Metric | Count |
|------|------:|
| total cases | 200 |
| PARITY_PASS | 0 |
| UPSTREAM_PARITY_MISMATCH | 200 |

Mismatch stage attribution (first failing stage):

| Stage | Cases |
|------|------:|
| FineSpan_or_Path | 109 |
| ASR | 91 |

**Root causes:**

1. **ASR non-determinism** — 91/200 cases differ in `raw_asr` between sequential independent runs.
2. **FineSpan / path drift** — downstream multipath counts differ when upstream text or state diverges.
3. **Packer / trace serialization** — baseline KEEP_ALL skips Model3 inference → **zero packed spans** on baseline vs S3 traces; full hash fails on all cases lacking symmetric packed capture.
4. **No single-run fork** — harness reruns ASR, Model2, Domain Vote independently for A and B.

Sample mismatch cases: d001, d002, d003, d004, d005, d006, d007, d008…

================================
CAUSAL FINAL QUALITY
====================

Quality attribution requires `PARITY_PASS`. With full upstream hash including packed Model3 state:

| Class | N |
|------|--:|
| IMPROVED | 0 |
| REGRESSED | 0 |
| UNCHANGED | 0 |
| INDETERMINATE | 0 |
| EXCLUDED (non-parity) | 200 |

Prior 28/18 counts are **excluded** from causal quality. **Do not use** for promotion or downstream fix prioritization.

================================
REGRESSION OWNERSHIP
====================

Causal regression ownership: **N/A** (0 parity-pass cases under full hash; 0 causal REGRESSED).

Historical non-causal proxy (invalid for ownership): `ASSEMBLY_OR_KENLM` × 17 — **rejected**.

================================
LIVE RETRY DISTRIBUTION (S3 run)
================================

Metric units clarified:

| Metric | Value | Unit |
|------|------:|------|
| raw path RETRY spans | 1701 | path-span decision |
| non-Anchor spans | 9416 | path-span |
| **raw path RETRY rate** | 18.06% | RETRY / non-Anchor path spans |
| logical unique RETRY spans | 790 | dedup (caseId,start,end,surface) |
| **logical unique RETRY rate** | 8.39% | logical / non-Anchor spans |
| case-level any RETRY | 188 / 200 | case |
| Retry regions | 1201 | merged retry region |
| retry attempts | 1701 | per-span retry routing call |
| candidates returned | 1010 | recall return events |
| zero-candidate attempts | 715 | retry attempt with 0 candidates |

Formal training RETRY label rate: 6.28% (`RETRY` / spanPathSamples).

**D22 — Is 18.1% largely path-accounting inflation?** Partially yes. Raw path rate 18.1% vs logical 8.4% → multipath inflation factor ≈ 2.15×. Remaining gap vs formal ~6.3% also reflects corpus / Anchor / candidate-state distribution shift — not a packer contract defect alone.

Logical RETRY spans per case: {'0': 12, '1': 18, '2-3': 61, '4-6': 86, '7+': 23}.  
Retry regions per case: {'0': 12, '1': 18, '2-3': 70, '4-6': 47, '7+': 53}.

================================
LIVE / FORMAL PACKER PARITY
===========================

| Check | Result |
|------|--------|
| feature contract | `packModel3SpanInferFields` — frozen |
| S3 trace rows with full contract | 9698 |
| trace missing/error rows | 0 |
| baseline packed spans (KEEP_ALL) | 0 |
| S3 packed spans | 9698 |
| all-zero scalar rows | 0 |

**D23/D24:** Production contract is correct where S3 inference runs and traces are captured. Baseline KEEP_ALL **does not produce** symmetric packed traces — acceptance harness artifact, not production packer drift. Prior Generalization Limit all-zero extraction bug remains **UNRESOLVED_NONBLOCKING** for separability claims; this audit confirms live non-Anchor scalar features are **present** on S3 traces (non-zero distributions below).

Live feature summary (S3 traces, non-Anchor scalars where captured):

- `current_cjk_len_log1p`: n=9698, mean=0.715, p50=0.693, zeroFrac=0.000
- `first_pass_cand_log1p`: n=9698, mean=0.406, p50=0.693, zeroFrac=0.415
- `pinyin_channel_avail`: n=9698, mean=1.000, p50=1.000, zeroFrac=0.000
- `span_len_log1p`: n=9698, mean=0.715, p50=0.693, zeroFrac=0.000
- `span_rel_position`: n=9698, mean=0.500, p50=0.500, zeroFrac=0.044

Distribution shift: **PATH_ACCOUNTING_DIFFERENCE, EXPECTED_CORPUS_DISTRIBUTION_SHIFT, ACCEPTANCE_HARNESS_TRACE_ASYMMETRY**

================================
HIGH-RETRY CASES (diagnostic)
=============================

High logical RETRY counts arise primarily from **multipath duplication** (same surface retried across paths) and **region fragmentation** (adjacent FineSpans merged into regions), not broad clean-text triggering. Multipath-inflated cases (raw > 1.5× logical): significant share of high-count cases. Broad clean-text triggering (≥7 logical RETRY, low raw ASR error distance): rare.

================================
ZERO-CANDIDATE RETRY
====================

| Class | Regions |
|------|--------:|
| VALID_SUSPICIOUS_REGION_BUT_RECALL_MISS | 366 |
| UNKNOWN | 12 |
| LIKELY_FALSE_RETRY | 10 |

Zero-candidate rate (raw attempts): 715/1701 = 42.0%.

================================
ASSEMBLY / KENLM CONSISTENCY
============================

Non-causal historical observation only:

| Metric | Count | Unit |
|------|------:|------|
| Assembly pool changed | 30 | case (kenlm_pool delta) |
| KenLM winner changed proxy | 56 | case (final text changed ∧ retry returned) |
| final text changed | 63 | case |

**D32:** Counts differ because they measure **different units** plus **upstream non-parity** between runs. Not evidence of KenLM nondeterminism.

**D33 KenLM determinism:** **NOT_EVALUABLE** without frozen candidate-set replay on parity cases.

================================
CAUSAL LATENCY
==============

Post-fork causal latency: **NOT MEASURED** — harness blocked.

End-to-end pipeline_ms delta (non-causal): baseline p50 7029 ms vs S3 p50 8028 ms (Δ ≈ 999 ms) — **cannot attribute to Model3** under independent upstream runs.

See `model3_v2_s3_causal_latency.csv`.

================================
ARCHITECTURE INVARIANTS
=======================

| Check | S3 run |
|------|--------|
| Domain Vote second violations | 0 |
| effective Anchor RETRY | 0 |
| KenLM pool > 16 | 0 |
| Anchor mutation | 0 |
| JobResult changed | NO |

Model3 invocation: orchestrator processes multiple paths per utterance; **one Model3 decision cycle per path**; KEEP_ALL harness bypass skips inference on baseline only.

================================
GOVERNANCE
==========

| Item | Changed |
|------|---------|
| S3 | NO |
| Model3 | NO |
| threshold | NO |
| feature | NO |
| Retry | NO |
| Recall | NO |
| Assembly | NO |
| KenLM | NO |
| JobResult | NO |
| training / dataset | NO |

================================
REQUIRED DECISIONS (D1–D40)
===========================

| ID | Answer |
|----|--------|
| D1 | YES — S3 identity verified |
| D2 | YES — previous baseline/S3 upstream parity was false |
| D3 | NO — cannot replay both branches from one frozen state in current dialog_200 harness |
| D4 | 0 cases full-hash parity (0 with symmetric packed capture) |
| D5 | See upstream hash field list in summary JSON |
| D6 | 200 cases fail — see `model3_v2_s3_upstream_parity.csv` |
| D7 | ASR (91), FineSpan/Path (33), Anchor/Domain (1), Mixed (1) |
| D8 | YES — only parity cases would count; all 200 excluded under full hash |
| D9–D17 | Causal IMPROVED/REGRESSED/owners: **0** — no valid causal denominator |
| D18 | raw path RETRY rate 18.06% |
| D19 | logical unique RETRY rate 8.39% |
| D20 | case any RETRY 188/200 (94.0%) |
| D21 | region distribution — see live_retry_distribution.csv |
| D22 | Partially — multipath inflation ~2.15×; not entire 18.1%→5.4% gap |
| D23 | YES — contract correct on S3 inference traces |
| D24 | Harness asymmetry (KEEP_ALL skips packed capture), not production packer defect |
| D25 | PATH_ACCOUNTING + corpus distribution + ASR live variability |
| D26 | YES — selective/local (most cases 1–6 logical spans; regions localized) |
| D27–D28 | multipath artifacts common in high-raw-count cases; broad clean triggering rare |
| D29–D31 | zero-candidate audit in CSV; mixed owner classes |
| D32 | different metric units + upstream non-parity |
| D33 | not evaluable |
| D34 | causal post-fork delta **not measured** |
| D35 | no architecture invariant violation on S3 run |
| D36 | NO — prior Assembly/KenLM ownership invalid |
| D37 | **INVALID / SUPERSEDED** pending causal parity |
| D38 | NO — promotion not evaluable |
| D39 | `S3_CAUSAL_REPLAY_BLOCKED_BY_ACCEPTANCE_HARNESS` |
| D40 | `MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION` |

================================
NEXT PHASE
==========

**`MODEL3_V2_ACCEPTANCE_HARNESS_CORRECTION`** — implement frozen upstream capture + Model3 fork replay in acceptance harness (reuse `decisionOverride` / single-run trace; do not add permanent dual-chain). Do not execute in this phase.

Wait for user review.
