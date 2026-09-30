# Lingua Model3 V1 — Runtime Feature Contract Correction Report

**Phase:** `MODEL3_V1_RUNTIME_FEATURE_CONTRACT_CORRECTION_AND_TRACE_VALIDATION`  
**Date:** 2026-08-27  
**Result:** **PASS**

---

## Summary

Two production feature semantics were corrected to match frozen training SSOT. Synthetic runtime replay remains **100%**. Per-span logit trace is now exposed. dialog_200 anchored cases replayed through existing `stage2_materialize` + production Model3 host show **strongly negative margins** (all KEEP) — feature correction did **not** produce RETRY.

**Primary finding:** `REAL_SYNTHETIC_DISTRIBUTION_SHIFT` — runtime contract is now correct; real ASR error morphology differs from synthetic training positives.

---

## Feature Contract Corrections

### pinyin_channel_avail

| | Definition |
|---|------------|
| **Training** | `featureAvailability.pinyinTextDerived` — utterance-level; true when Node text-derived syllable SSOT succeeded |
| **Runtime (before)** | `syllables.length > 0` per span (wrong granularity) |
| **Runtime (after)** | `globalSyllables.length > 0` — same value for all spans in utterance |
| **Parity** | **PASS** |

### first_pass_cand_log1p

| | Definition |
|---|------------|
| **Training** | `log1p(recallEvidence.firstPassCandidateCount)` from lattice `PathFineSpan.candidates` |
| **Runtime (before)** | `log1p(bound activeCandidates.length)` — wrong candidate population |
| **Runtime (after)** | `log1p(span.candidates.filter(!isCovered).length)` |
| **Parity** | **PASS** |

**Code:** `model3-feature-pack.ts` → `run-model3-path-step.ts`

---

## Logit Trace (Observation-Only)

Host now returns per span:

- `keep_logit`, `retry_logit`, `margin` (= retry − keep)
- Propagated to `Model3SpanDecision` and dialog200 trace (`MODEL2_DIALOG200_TRACE=1`)

Decision path unchanged: argmax, class 0=KEEP, class 1=RETRY, Anchor forced KEEP.

---

## Synthetic Replay

| Metric | Value |
|--------|------:|
| RETRY samples | 120 |
| RETRY agreement | **100%** |
| KEEP samples | 120 |
| KEEP agreement | **100%** |
| Margin identity | PASS |

---

## EVAL_PROXY (dialog_200)

| Metric | Value |
|--------|------:|
| Anchored utterances with ASR error | 46 |
| Eligible error utterances (EVAL_PROXY) | 46 |
| Eligible error spans (EVAL_PROXY) | 151 |
| Subset invariant (eligible ⊆ anchored+error) | **PASS** |

---

## Real Runtime Margins

Replay: 53 anchored cases, raw ASR from prior acceptance, materialized via existing `stage2_materialize.cjs`, inferred via production `model3_inference_host.py`.

| Cohort | count | p50 | p95 | max |
|--------|------:|----:|----:|----:|
| Anchored non-anchor spans | 1522 | **−18.13** | **−12.30** | **−3.58** |
| EVAL_PROXY eligible spans | 1369 | **−18.08** | **−12.51** | **−5.71** |
| Synthetic RETRY positive (ref) | — | +2.43 | +6.21 | — |

| | |
|---|---:|
| KEEP | 1522 |
| RETRY | **0** |

**RETRY before correction:** 0  
**RETRY after correction:** 0  
**Feature correction changed decisions:** **NO**

Real eligible errors are **strongly KEEP** (not near boundary). Synthetic positives sit at +2 to +6 margin.

---

## Interpretation

| Question | Answer |
|----------|--------|
| Runtime feature contract material cause? | **NO** — correction did not unlock RETRY |
| Distribution shift? | **YES** |
| Model under-trigger on real errors? | **YES** (with parity PASS + actual logits) |
| Retrain justified? | **NO** (yet — need real-ASR eval corpus first) |

---

## Tests

All 8 required tests **PASS** — see `model3_v1_feature_contract_tests.json`.

Unit/integration: `model3-feature-contract.test.ts` + `model3-mainline.integration.test.ts` (**17/17 PASS**).

---

## Decision

| | |
|---|---|
| Mainline rollback | NO |
| Model3 retrain | NO |
| New corpus needed | YES |
| Next phase | `MODEL3_V1_REAL_ASR_ERROR_DATASET_AUDIT` |

**Model3 effectiveness:** remains **UNPROVEN** (no validated RETRY rescue on real pipeline).

---

## Artifacts (5)

1. `Lingua_Model3_V1_Runtime_Feature_Contract_Correction_Report_2026_08_27.md`
2. `model3_v1_feature_contract_validation.json`
3. `model3_v1_runtime_margin_analysis.csv`
4. `model3_v1_feature_contract_governance.json`
5. `model3_v1_feature_contract_tests.json`

**HARD STOP** — Awaiting user review.
