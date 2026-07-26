# Lingua Recall & Sentence Candidate Budget Expansion Experiment

**Date:** 2026-07-15
**Corpus:** dialog_200 (full 200 cases)
**Experiment type:** Counterfactual budget expansion only — frozen architecture preserved

## Baseline (code SSOT)

| Parameter | Value | Source |
|-----------|------:|--------|
| exactTopK | 2 | v4-limits.ts |
| parentFragmentTopK | 3 | v4-limits.ts |
| per-span limit (1/2/3+) | 8/4/2 | per-span-candidate-limit.ts |
| maxSentenceCandidates | 16 | fw-config / electron-node-config |
| maxIntervalEnumNodes | 1024 | v4-limits.ts |

## Core Results

| Metric | A Baseline | B1 | B2 | C1 | C2 | D1 | D2 | E Best |
|--------|----------:|---:|---:|---:|---:|---:|---:|-------:|
| Target in preFilter | 48.2% | 50.0% | 50.0% | 50.0% | 50.0% | 48.2% | 48.2% | 48.2% |
| Target Recall Hit Rate | 48.2% | 50.0% | 50.0% | 50.0% | 50.0% | 48.2% | 48.2% | 48.2% |
| Selected Target Rate | 46.4% | 51.8% | 51.8% | 46.4% | 46.4% | 42.9% | 42.9% | 50.0% |
| Multi-target selected jointly | 45.7% | 45.7% | 48.6% | 51.4% | 62.9% | 57.1% | 57.1% | 65.7% |
| Target in Generated | 57.1% | 62.9% | 65.7% | 62.9% | 71.4% | 68.6% | 68.6% | 74.3% |
| All targets in one sentence | 37.1% | 40.0% | 37.1% | 48.6% | 60.0% | 48.6% | 48.6% | 60.0% |
| Business-usable candidate rate | 5.7% | 8.6% | 8.6% | 20.0% | 22.9% | 17.1% | 17.1% | 28.6% |
| Candidate better than Raw | 5.7% | 8.6% | 8.6% | 20.0% | 22.9% | 17.1% | 17.1% | 28.6% |
| KenLM selected usable rate | 0.0% | 0.0% | 0.0% | 42.9% | 25.0% | 0.0% | 0.0% | 20.0% |
| Raw Fallback Opportunity Loss | 1 | 2 | 2 | 2 | 5 | 5 | 5 | 6 |
| Mean candidate count | 10.86 | 11.77 | 11.37 | 14.97 | 15.77 | 13.69 | 14.31 | 27.69 |
| P95 latency (ms) | 26065 | 25128 | 28342 | 6691 | 14625 | 10359 | 22700 | 24102 |

## Variant E composition

- Recall tier: **B1**
- Per-span tier: **C1**
- Sentence tier: **D1**

## Final Verdict — D

### D — Expanded Budgets Produce Usable Candidates, KenLM Rejects Them

## Required Answers (summary)

1. Recall TopK limits targets: **Limited — +1.8pp recall hit only, +39% recall noise (B1)**
2. Primary miss: **preFilter miss ≈ recall miss** (A preFilter=48.2%, recall hit=48.2%); TopK truncation not dominant (Recall@1=0% all variants)
3. Per-span limit drops targets: **Yes — C1/C2 raise business-usable 5.7%→22.9%**
4. maxSentenceCandidates=16 truncates: **Partially — D1 usable 17.1% vs C2 22.9%; generated coverage +11.5pp**
5. Largest business-usable gain: **E 28.6%** (single-tier: C2 22.9%)
6. Multi-target same sentence A→E: 37.1% → 60.0%
7. Noise/latency: B1 recall noise p95 +21/case; E mean candidates 27.69 vs A 10.86
8. KenLM selects usable when present: C1 **42.9%**, E **20.0%**
9. Raw Fallback Opportunity Loss (E): **6** (A=1)
10. Gate opportunity loss recorded, Gate not modified: **Yes**
11. Recommended independent validation combo: **E (B1+C1+D1)** — not auto-promoted to Production
12. Formal Repair parameter unfreeze required: **No** (budget-only counterfactual)
13. Next priority: **KenLM Corpus Audit**

## Counterfactual Attribution (usable gain vs A, 35 target cases)

| Gain source | Δ business-usable | Notes |
|-------------|------------------:|-------|
| Recall TopK (B1) | +2.9% | Noise +39% recall hits/case |
| Per-span (C2) | +17.1% | Primary single-tier lever |
| Sentence cap (D1) | +11.4% | Generated coverage ↑, KenLM pick still weak |
| Combined (E) | +22.9% | Stacking; Raw Fallback Loss ↑ |

## Artifacts

- Traces: `tmp/budget_expansion_20260715/{A,B1,B2,C1,C2,D1,D2,E}/`
- Analysis JSON: `tmp/budget_expansion_20260715/budget_expansion_analysis.json`
- Runner: `electron_node/electron-node/tests/experiments/run-budget-expansion-matrix.mjs`

## Promotion Gate (not met for auto-promote)

E shows +22.9pp usable on dialog_200 but Raw Fallback Loss=6 and KenLM usable-pick=20%. Requires **independent corpus** before any Production default change.

---

*EXPERIMENT ONLY — production defaults unchanged.*