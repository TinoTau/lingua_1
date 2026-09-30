# ASR Postprocess Performance & Quality Baseline Audit

Generated: 2026-09-10  
Phase: `ASR_POSTPROCESS_STAGE_PERFORMANCE_QUALITY_BASELINE_AUDIT`  
Mode: `READ_ONLY` · `NO RERUN` · `PRODUCTION_SEMANTIC_CHANGE = NONE`  

Evidence: `RUN_ID=dialog200_full_pipeline_20260909_001141`  
Baseline: `LINGUA_DIALOG200_BASELINE_V1` (unchanged)

---

## Freeze protection

```text
MODEL3 = FROZEN
RETRY_ARCHITECTURE = FROZEN
FULL_MAINLINE_ARCHITECTURE = FROZEN
LINGUA_DIALOG200_BASELINE_V1 = FROZEN
```

No architecture change. No production optimization.

---

## A. Postprocess total cost

| Metric | Value |
|--------|------:|
| `fw_detector_step_ms` p50 (postprocess inclusive) | **2414 ms** |
| mean / p95 / max | 3337 / 7561 / 17915 |
| Total postprocess ms (200 cases) | ~667 s |
| Pipeline wall p50 (ASR+postprocess) | 7146 ms |
| ASR reference approx (`pipeline − fw`) p50 | **4600 ms** (UPSTREAM_REFERENCE only) |

Postprocess ≈ **34%** of wall at p50; ASR remains larger, **not reopened**.

---

## B. Top cost stages (measurable)

Within postprocess (shares of `fw` p50):

| Rank | Stage | p50 | Share of postprocess |
| ---: | ----- | --: | -------------------: |
| 1 | **FW_rest** (FineSpan+Recall+Model2+Domain+Assembly merged) | **1823 ms** | **~75.5%** |
| 2 | **KenLM** | **512 ms** | **~21.2%** |
| 3 | Retry (path sum, includes Retry Recall) | 42 ms | ~1.7% |

---

## C. Negligible cost

| Stage | p50 | Notes |
|-------|----:|-------|
| Model3 | 19 ms | ~0.8% of postprocess · **FROZEN** |
| Retry | 42 ms | ~1.7% · **FROZEN** · do not double-count Recall inside |

---

## D. Clear quality positive signal

| Signal | Evidence |
|--------|----------|
| End-to-end postprocess | CER distance improved **66** / worsened **0** / unchanged 134 |
| Exact net gain | +6 (baseline) |
| CORRECT_BROKEN | 0 |

---

## E. High cost / weak per-module quality evidence

| Stage | Cost | Quality observability |
|-------|------|------------------------|
| FW_rest merged | HIGH | `NOT_DIRECTLY_MEASURABLE` per substage |
| Recall / Model2 / Domain / Assembly alone | UNKNOWN timing | `CORRECT_CANDIDATE_NOT_MEASURED` |

---

## F. FULL_RESCUE vs PARTIAL_IMPROVEMENT

| Field | FULL_RESCUE (6) | PARTIAL (60) |
|-------|----------------:|-------------:|
| postprocess p50 | 2121 | 2355 |
| Retry rate | 1.0 | 1.0 |
| kenlm pool p50 | 1 | 1 |
| kenlm input count p50 | 1 | 1 |
| path count p50 | 2 | 1 |

**No clear latency / Retry / pool difference.**  
Gap is not explained by “partial cases run less work.”

---

## G. CORRECT_PRESERVED control

| Field | Value |
|-------|------:|
| count | 25 |
| postprocess p50 | **2274 ms** |
| Retry rate | **1.0** |
| kenlm pool p50 | 2 |

Already-correct sentences still pay full postprocess + Retry.  
Performance waste signal for later; not architecture violation.

---

## H. Candidate cap

```text
max pool = 8 · p50 = 1 · p95 = 4 · over16 = 0
CAP16 = NO CURRENT PERFORMANCE/QUALITY ISSUE
```

---

## I. Model3 / Retry freeze

Remain **FROZEN**. Cost negligible; no reopen.

---

## J / K. Next priority

```text
NEXT_PRIORITY = QUALITY
ONE_NEXT_AUDIT = PARTIAL_IMPROVEMENT_TO_FULL_RESCUE_AUDIT
```

Not performance-first: largest exclusive known stage is KenLM (~21%), but FULL vs PARTIAL share similar KenLM/retry/pool profiles; residual exactness gap is the clearer phenomenon.  
FW_rest is larger but **MEASUREMENT_GAP** (merged timing) — do not invent a performance Delta without substage clocks.

KenLM selection gap **20/71** multi-candidate cases noted as secondary observation only.

---

## Required answers

| # | Answer |
|---|--------|
| A | Postprocess p50 ≈ **2414 ms** |
| B | FW_rest ≈75%, KenLM ≈21%, Retry ≈1.7% |
| C | Model3 (~19 ms), Retry (~42 ms) |
| D | Raw→final CER: 66 improved, 0 worsened |
| E | FW_rest + Recall/Model2/Domain/Assembly (no exclusive quality) |
| F | Almost no stage-metric difference |
| G | Yes — ~2.3 s postprocess + Retry on correct sentences |
| H | Cap16 safe |
| I | Yes, remain frozen |
| J | **QUALITY** |
| K | **`PARTIAL_IMPROVEMENT_TO_FULL_RESCUE_AUDIT`** |

---

## Cost / quality matrix

| Stage | Cost | Quality signal | Status |
|-------|------|----------------|--------|
| FW/FineSpan (+merged upstream of KenLM/Model3) | HIGH_COST | NOT_DIRECTLY_MEASURABLE | AUDIT_CANDIDATE (timing only later) |
| Recall | UNKNOWN | NO_MEASURABLE_SIGNAL | NO_EVIDENCE |
| Model2 | UNKNOWN | NO_MEASURABLE_SIGNAL | NO_EVIDENCE |
| Domain/SameDomain | UNKNOWN | NO_MEASURABLE_SIGNAL | FROZEN / NO_EVIDENCE |
| Model3 | NEGLIGIBLE | NOT_DIRECTLY_MEASURABLE | FROZEN |
| Retry | LOW_COST | MIXED_SIGNAL (association only) | FROZEN |
| Assembly | UNKNOWN | NO_MEASURABLE_SIGNAL | NO_EVIDENCE |
| KenLM | MEDIUM_COST | MIXED_SIGNAL (gap 20/71) | KEEP |

---

## MEASUREMENT_GAP (no rerun this phase)

Missing exclusive ms: Recall, Model2, Domain, SameDomain, Anchor, Assembly, CrossPath, FineSpan-only.  
Future optional: minimal timing instrumentation only — no semantic change.
