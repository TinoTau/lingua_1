# Lingua Model3 V1 No-Leak Feature Packing Fix + Retrain

**Date:** 2026-08-24  
**Phase:** `FIX_MODEL3_V1_FEATURE_PACKING_AND_RETRAIN`  
**Verdict:** `PASS_WITH_DATA_GAPS`

---

## 1. Feature packing fix

Removed from `span_features()` (label/QA plane only):

- `phoneticCompatible`
- `referenceSurface != surface`
- `referenceReachable` YES/NO
- `targetMask` as predictive feature

**Allowlisted model-visible dims (6):** `['isAnchor', 'span_len_log1p', 'span_rel_position', 'first_pass_cand_log1p', 'current_cjk_len_log1p', 'pinyin_channel_avail']`

Schema `MODEL3_TRAINING_SAMPLE_V1` unchanged — loader ignores label-side fields for tensors.

Pretrain gate: **PASS**  
Label-side mutation → model tensor identical: **YES**  
Inference mutation flip rate: **0.0**

---

## 2. Model

| Item | Value |
|------|-------|
| Name | `MODEL3_V1_SYNTHETIC_BASELINE_NOLEAK_V1` |
| Architecture | Small BiGRU (unchanged) |
| Train from scratch | YES |
| Parameters | 231490 |
| Weights | 930364 bytes |
| Class weight RETRY | 8.2867 (train-only formula) |
| Old leaked model | DEPRECATED_LEAKED_FEATURE_MODEL |

Path: `training/model3_dataset/model3_v1_synthetic_bigru_noleak/`

---

## 3. Quality (held-out test)

| Metric | Value |
|--------|------:|
| Always-KEEP RETRY F1 | 0.0000 |
| Linear RETRY F1 | 0.0544 |
| BiGRU RETRY precision | 0.9936 |
| BiGRU RETRY recall | 0.9964 |
| BiGRU RETRY F1 | 0.9950 |
| False RETRY rate | 0.0001 |
| Macro F1 | 0.9968 |
| TP/FP/FN/TN | 2792/18/10/190433 |

F1≪1.0 after leak removal is **expected**.

**Interpretation note:** After packing fix, BiGRU still reaches high RETRY F1 via the **text/surface** channel (`text_removed` F1→0.0). Anchor ablation Δ≈0 (PARTIAL). Family holdout hold F1≪seen F1. This is **not** A/B label leakage returning; it indicates **synthetic surface-pattern learnability** + weak Anchor-dependent diet → `PASS_WITH_DATA_GAPS`.

---

## 4. Anchor dependence

| Test | RETRY F1 | Δ vs base | Flip rate |
|------|--------:|----------:|----------:|
| Original | 0.9950 | — | — |
| Anchor zero | 0.9955 | -0.0005 | 0.0000 |
| Anchor shuffle | 0.9954 | -0.0004 | 0.0001 |

**Conclusion:** `PARTIAL`

---

## 5. Ablations / generalization / counterfactual

Ablations: see `model3_v1_noleak_acceptance.json` → `feature_ablation`.

Held-out surface spans: seen=8741, unseen=3 (INSUFFICIENT_HELDOUT_SURFACE_PAIR_VOLUME)  
Unseen RETRY F1: 0.0000

Family holdout ['eng_en', 'h_f']: hold F1=0.4224, seen F1=0.9633

Anchor counterfactual pairs=22, accuracy=0.8636, signal=PRESENT

---

## 6. Root-cause recheck

| Code | Value |
|------|-------|
| A_DIRECT_LABEL_LEAKAGE | False |
| B_REPAIRABILITY_LABEL_SHORTCUT | False |
| F_ANCHOR_NOT_USED | False |

---

## 7. Performance / shadow

CPU p50/p95/p99 ms: 2.768 / 4.055 / 5.099  
Production output changed: **NO** · Actual retry: **NO**

---

## 8. Decision

- Feature packing fixed: **YES**
- Same BiGRU suitable: **YES**
- Dataset Anchor-dependent signal: **PRESENT**
- Safe to start TTS-ASR: **NO**
- Recommended next: `MODEL3_V1_ANCHOR_DEPENDENT_DATASET_REDESIGN`

## STOP

No TTS · No production RETRY · No Domain Vote / Recall / Model2 / schema changes.
