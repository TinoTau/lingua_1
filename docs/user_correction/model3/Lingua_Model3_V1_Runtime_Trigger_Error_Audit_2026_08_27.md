# Lingua Model3 V1 — Runtime Trigger Error Audit

**Phase:** `MODEL3_V1_RUNTIME_TRIGGER_ERROR_AUDIT`  
**Date:** 2026-08-27  
**Mode:** Read-only / observation-only — no model, threshold, feature, or business-logic changes.

---

## Executive Summary

dialog_200 mainline acceptance showed **RETRY = 0** across **9811** non-anchor spans. This audit independently determines **why**, without treating RETRY=0 as evidence of model failure.

**Verdict:** `MULTIPLE_CAUSES`

Synthetic V1 positive replay through the **production JSONL sidecar** (`model3_inference_host.py`) achieves **100% decision agreement** with offline frozen checkpoint inference. Runtime adapter and decision path are **correct** on the frozen synthetic distribution.

dialog_200 RETRY=0 is primarily explained by:

1. **Low anchor coverage** — 147/200 utterances have zero Anchor; Model3 is anchor-conditioned.
2. **Error-family / distribution shift** — real Piper-TTS ASR errors (multi-char homophone, punctuation drift) do not resemble synthetic single-char phonetic corruption positives.
3. **Partial production feature parity** — `pinyin_channel_avail` and `first_pass_cand_log1p` semantics differ between training snapshots and live runtime packing.

**Model under-trigger on real ASR errors is NOT proven** (requires feature parity PASS + span-level eligible-error logits; per-span trace was not captured in dialog_200 acceptance artifacts).

**Mainline integration remains ACCEPTED.** RETRY functional effectiveness remains **UNPROVEN**.

---

## Part A — Dataset Target Coverage

Independent eval-plane alignment: raw ASR vs reference, Anchor marks from acceptance trace, char-level diff blocks excluding Anchor overlap, local length ≤ 8.

| Metric | Value |
|--------|------:|
| Utterances total | 200 |
| Utterances with Anchor | 53 |
| Anchored utterances with ASR error | 46 |
| Model3-eligible error utterances | 48 |
| Model3-eligible error spans (char-diff proxy) | 160 |
| Eligible errors per anchored utterance | 3.02 |
| Dataset can validate RETRY | **LIMITED** |

**Note:** Eligible spans are char-diff proxies; dialog_200 raw jsonl lacks per-span FineSpan logits. Span-level trigger proof requires a future trace-enabled eval run.

147 utterances without Anchor cannot exercise anchor-conditioned RETRY semantics by design.

---

## Part B — Anchored Subset (53 cases)

Consolidated in `model3_v1_runtime_trigger_case_analysis.csv`.

Examples with eligible errors but Model3 RETRY=0:

| ID | Eligible surfaces | Anchors | dist_raw |
|----|-------------------|---------|----------|
| d003 | 烟, 烧病, 背 | 拿铁 | 4 |
| d019 | 們團隊 对, 成×2, 限, 划 | 后选 | 8 |
| d041 | 易是龟仔 | 前台 | 4 |
| d045 | 划, 安, 限 | 上限 | 10 |

All 53 anchored cases: aggregate `decisions_retry = 0`.

---

## Part C — Synthetic Runtime Replay (Hard Test)

Source: `model3_v1_strict_contrast_reconstruction/test/` — frozen Synthetic V1 eval shards.  
Path: Python offline checkpoint ↔ JSONL `model3_inference_host.py` (same as Node production sidecar).

| Metric | Value |
|--------|------:|
| RETRY positive samples | 120 |
| KEEP control samples | 120 |
| Labeled RETRY spans (offline predicts RETRY) | 115 |
| Labeled RETRY spans (runtime RETRY) | 115 |
| Positive decision agreement | **100%** |
| KEEP decision agreement | **100%** |
| Overall span agreement | **100%** |
| Runtime adapter parity | **PASS** |

Mismatch examples: **0**

Synthetic retry margin (retry_logit − keep_logit): p50 **+2.43**, p95 **+6.21**  
Synthetic KEEP control margin: p50 **−15.78**, p95 **−9.34**

---

## Part D — Feature Contract Parity

See `model3_v1_runtime_feature_parity.csv`.

| Feature | Parity | Notes |
|---------|--------|-------|
| surface char tokens | YES | max_len=8, pad=0, unk=1, same vocab |
| isAnchor | YES | Anchor forced KEEP in host + Node |
| span_len_log1p | YES | log1p(len(surface)) |
| span_rel_position | YES | index / max(n−1, 1) |
| first_pass_cand_log1p | PARTIAL | Same formula; live bound candidate count ≠ training snapshot |
| current_cjk_len_log1p | YES | CJK count in surface |
| pinyin_channel_avail | PARTIAL | Training: `pinyinTextDerived`; Runtime: `syllables.length > 0` |
| vocabulary | YES | Frozen checkpoint vocab.json |
| label mapping | YES | class 0=KEEP, class 1=RETRY, argmax |
| silent KEEP fallback | NO | Fail-fast on load/infer failure |

**Overall feature parity:** PARTIAL (production path)

On synthetic replay with training-equivalent feature packing: **100% numeric parity** (verified on sample spans).

---

## Part E — Score Distribution

| Cohort | p50 margin | p95 margin | max |
|--------|----------:|----------:|----:|
| Synthetic RETRY positive | +2.43 | +6.21 | — |
| Synthetic KEEP control | −15.78 | −9.34 | — |
| dialog_200 all non-anchor | 0.0 | 0.0 | 0.0 |
| dialog_200 anchored non-anchor | 0.0* | 0.0* | 0.0* |
| dialog_200 eligible errors | N/A* | N/A* | N/A* |

\*Per-span logits not captured in acceptance trace; inferred from observed RETRY=0 (all margins ≤ 0).

---

## Part F — Decision Path Audit

| Check | Result |
|-------|--------|
| Label mapping (KEEP=0, RETRY=1) | PASS |
| Threshold / argmax | PASS — no calibrated threshold |
| Eligibility mask (Anchor → KEEP) | PASS |
| Extra runtime gates | None beyond Anchor mask |
| Silent KEEP fallback | **NO** — load/infer failure throws |

Decision chain: `logits → retry_logit − keep_logit → argmax → Anchor mask → effective decision`.

---

## Part G — Distribution Comparison

**Material feature shift:** YES (pinyin avail semantics, candidate count source)  
**Material error-family shift:** YES

| Dimension | Synthetic V1 | dialog_200 |
|-----------|-------------|------------|
| Error type | Single-char phonetic substitution | Multi-char TTS homophone, punctuation, trad/simp |
| Anchor density | 100% in STRICT pairs | 26.5% utterances |
| Positive margin | p50 +2.43 | All observed KEEP |

---

## Root Cause Classification

**Primary:** `MULTIPLE_CAUSES`

**Evidence:**

1. Synthetic replay **PASS** — checkpoint + sidecar + decision path work on frozen distribution.
2. dialog_200 has **160** char-diff eligible error spans but **0** RETRY — errors do not match training positive family.
3. **147/200** utterances lack Anchor — structurally ineligible for anchor-conditioned trigger.
4. Production feature parity **PARTIAL** — cannot conclude model under-trigger per audit §36.
5. Per-span eligible-error logits unavailable — trigger miss vs feature shift indistinguishable at span granularity.

---

## Model Status

| Question | Answer |
|----------|--------|
| Frozen checkpoint correct | YES |
| Runtime adapter correct | YES (synthetic replay) |
| Runtime decision path correct | YES |
| Actual under-trigger proven | **NO** |
| Retraining justified | **NO** |

---

## Decision & Next Phase

| Recommendation | Value |
|----------------|-------|
| Mainline rollback | NO |
| Model3 retrain | NO |
| Model3 runtime fix | YES (feature contract alignment) |
| New evaluation corpus | YES |
| Next phase | `MODEL3_V1_REAL_ASR_ERROR_EVAL_CORPUS` |

After real-ASR eval corpus with span-level trace: revisit `MODEL3_V1_RUNTIME_FEATURE_CONTRACT_CORRECTION` for pinyin/candidate-count parity.

---

## Governance

| Item | Value |
|------|-------|
| Runtime business logic changed | NO |
| Model changed | NO |
| Training changed | NO |
| Threshold changed | NO |
| Report artifact count | 5 |
| ≤10 artifacts | YES |

**Artifacts:**

1. `Lingua_Model3_V1_Runtime_Trigger_Error_Audit_2026_08_27.md`
2. `model3_v1_runtime_trigger_audit_summary.json`
3. `model3_v1_runtime_trigger_case_analysis.csv`
4. `model3_v1_runtime_feature_parity.csv`
5. `model3_v1_runtime_trigger_governance.json`

**Audit script (observation-only):** `training/model3_dataset/scripts/model3_runtime_trigger_audit.py`

---

**HARD STOP** — Awaiting user review. No retrain, threshold change, runtime fix, or rollback applied.
