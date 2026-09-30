# Lingua Model3 V1 Synthetic Shortcut + Generalization Audit

**Date:** 2026-08-24  
**Phase:** `MODEL3_V1_SYNTHETIC_SHORTCUT_GENERALIZATION_AUDIT`  
**Verdict:** `DATA_LEAKAGE`

---

## Executive finding

The V1 BiGRU’s perfect RETRY F1 is **not** evidence of Anchor-conditioned repair-trigger learning.

`span_features()` in `training/model3_dataset/train/bigru_v1.py` packs **label-defining fields** into the model-visible feature vector:

| Dim | Source | Why it leaks |
|-----|--------|--------------|
| 2 | `phoneticCompatible` | Label table requires phonetic for RETRY |
| 4 | `referenceSurface != surface` | Direct correctness / corruption bit |
| 5–6 | `referenceReachable` YES/NO | Exact repairability probe used to mint RETRY |
| 7 | `targetMask` | Also duplicated as a numeric feature |

Frozen label rule ≈ `¬anchor ∧ ref≠surface ∧ phonetic ∧ reachYES`.  
Measured reconstruction coverage on sampled supervised spans: **RETRY rule coverage = 1.0000**.

Therefore: **DIRECT_LABEL_LEAKAGE** + **REPAIRABILITY_LABEL_SHORTCUT**.

---

## Baseline reproduction

| Item | Value |
|------|------:|
| Original test RETRY F1 | 1.0 |
| Reproduced | YES |
| TP/FP/FN/TN | 2802/0/0/190451 |

---

## Anchor dependence

| Test | RETRY F1 | Flip rate vs baseline |
|------|--------:|----------------------:|
| Original | 1.0000 | — |
| Anchor zero | 1.0000 | 0.0000 |
| Anchor shuffle | 1.0000 | 0.0000 |

**Conclusion:** `NOT_USED` — model does not need Anchor mask to achieve perfect RETRY.

---

## Feature ablation (selected)

| Ablation | RETRY F1 | Flip rate |
|----------|--------:|----------:|
| Text removed | 1.0000 | 0.0000 |
| Anchor removed | 1.0000 | 0.0000 |
| ref≠surface removed | 0.8242 | 0.0043 |
| Reachability removed | 0.4906 | 0.0301 |
| Leak trio removed (phon+ref≠+reach) | 0.0000 | 0.0145 |
| All feats zero (text only) | 0.0000 | 0.0145 |
| Anchor-only geometry | 0.0000 | 0.0145 |

**Most important channels:** `ref_ne_surface`, `reach_YES/NO`, `phoneticCompatible` (not Anchor).

---

## NO_ANCHOR

| Model | RETRY F1 |
|-------|--------:|
| BiGRU (original) | 1.0000 |
| Linear (with leak feats) | 1.0000 |
| Rule baseline (phon∧ref≠∧reachYES) | 1.0000 |
| Length-only | 0.0000 |

**Explanation:** Without Anchor, label is still recoverable from the leaked feature trio. Linear ≈ BiGRU ≈ rule ≈ 1.0 ⇒ sequence reasoning is unnecessary for this packing.

---

## Controls

| Control | RETRY F1 | Interpretation |
|---------|--------:|----------------|
| Linear full test (leak feats) | 1.0000 | Task linearly separable under current packing |
| Linear without leak feats | 0.0000 | Harder when leak channels removed |
| Shuffled-label BiGRU control | 0.0000 | Should collapse if no leakage; residual ⇒ packing still encodes label |

---

## Surface / family generalization

| Split | RETRY F1 | N utterances |
|-------|--------:|-------------:|
| Seen surface pairs | 1.0 | 7641 |
| Held-out surface pairs | 0.0 | 3 |
| Family-holdout control on hold families ['eng_en', 'h_f'] | 1.0000 | 572 |
| Family-holdout control on seen families | 1.0000 | 6918 |
| Original model on hold families | 1.0000 | — |

Even held-out pairs stay strong **while leak features remain** — memorization is secondary to label leakage.

---

## Anchor counterfactual pairs

| Metric | Value |
|--------|------:|
| Pairs (same surface, KEEP vs RETRY contexts) | 78 |
| Correct context-sensitive decisions | 78 |
| Accuracy | 1.0000 |
| Surface-dominated rate | 0.0000 |

**Caveat:** Perfect accuracy here does **not** prove Anchor/context reasoning. Same-surface KEEP vs RETRY rows still differ on leaked feats (`phoneticCompatible`, `ref≠surface`, `reachYES`). With Anchor zero flip_rate=0, the discrimination is **leak-feature-sensitive**, not Anchor-sensitive.

---

## Root cause

- **Primary:** DIRECT_LABEL_LEAKAGE (`referenceSurface!=surface` in feats)
- **Secondary:** REPAIRABILITY_LABEL_SHORTCUT; ANCHOR_NOT_USED
- **Classification:** **H (MIXED: A+B+F)** — not pure text memorization (`all_feats_zero` F1→0)
- BiGRU architecture problem: **NO**
- Dataset construction / feature packing problem: **YES**
- Input contract (loader packing) problem: **YES**

---

## TTS GO / NO-GO

**Safe to start TTS-ASR enhancement: NO**

Required fix before TTS: **FIX_DATASET_INPUT_CONTRACT** — strip label-table fields from model-visible tensors; keep them QA/loss-only; retrain same Small BiGRU.

**Recommended next phase:** `FIX_MODEL3_V1_FEATURE_PACKING_AND_RETRAIN`

---

## STOP

No architecture change, no production retry, no TTS, no Domain Vote / Recall / Model2 changes this round.
