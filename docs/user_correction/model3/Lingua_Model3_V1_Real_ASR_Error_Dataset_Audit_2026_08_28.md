# Lingua Model3 V1 — Real ASR Error Dataset Audit

**Phase:** `MODEL3_V1_REAL_ASR_ERROR_DATASET_AUDIT`  
**Date:** 2026-08-28  
**Mode:** Read-only data audit  
**Result:** **PASS**

---

## Purpose

Explain which error distribution is missing from frozen Model3 Synthetic V1 training relative to dialog_200 EVAL_PROXY eligible errors (after feature-contract PASS and RETRY=0).

---

## Audit Set Verification

| Metric | Expected | Observed |
|--------|----------:|----------:|
| Anchored utterances with ASR error | 46 | 46 |
| Eligible error utterances | 46 | 46 |
| Eligible error spans (EVAL_PROXY) | 151 | 153 |
| Proxy false positives | — | 0 |
| Valid audit spans | — | 153 |
| Sample adequacy | — | **SUFFICIENT_FOR_DIRECTION** |

EVAL_PROXY utterance identity verified (46/46). Span count 153 vs prior 151 is minor opcode/filter drift (+2); same audit set class. Taxonomy is EVAL_PROXY (char-diff), not perfect FineSpan ground truth.

---

## Real Error Distribution (valid spans)

| Family | Count | % | span_len p50/p95 | margin p50/p95/max |
|--------|------:|--:|------------------:|--------------------|
| PHONETIC_SUBSTITUTION | 64 | 41.83 | 1.0/1.0 | -17.6794/-15.7234/-15.105 |
| DELETION | 3 | 1.96 | 6.0/9.0 | -16.6613/-15.9831/-15.9831 |
| INSERTION | 5 | 3.27 | 2.0/4.0 | -16.5733/-16.5042/-16.5042 |
| SEGMENTATION_BOUNDARY | 0 | 0.0 | None/None | None/None/None |
| MULTI_CHAR_REPLACEMENT | 68 | 44.44 | 3.0/6.0 | -17.3872/-15.1618/-8.3166 |
| CHARACTER_FORM_VARIANT | 13 | 8.5 | 1.0/1.0 | None/None/None |
| LOCAL_ORDER_OR_STRUCTURE | 0 | 0.0 | None/None | None/None/None |
| OTHER | 0 | 0.0 | None/None | None/None/None |

### Error length (valid)

| Len | Count | % |
|-----|------:|--:|
| 1 | 77 | 50.33 |
| 2 | 34 | 22.22 |
| 3 | 18 | 11.76 |
| 4+ | 24 | 15.69 |

All observed margins remain strongly negative (KEEP). No family escapes under-trigger on current synthetic-trained Model3.

---

## Synthetic V1 RETRY Distribution

Sources: frozen `model3_v1_anchor_contrast_full100k` + `model3_v1_strict_contrast_reconstruction` (train+test RETRY spans).  
**Total RETRY spans classified:** 12991

| Family | Count | % |
|--------|------:|--:|
| PHONETIC_SUBSTITUTION | 12991 | 100.0 |
| DELETION | 0 | 0.0 |
| INSERTION | 0 | 0.0 |
| SEGMENTATION_BOUNDARY | 0 | 0.0 |
| MULTI_CHAR_REPLACEMENT | 0 | 0.0 |
| CHARACTER_FORM_VARIANT | 0 | 0.0 |
| LOCAL_ORDER_OR_STRUCTURE | 0 | 0.0 |
| OTHER | 0 | 0.0 |

### Synthetic error length

| Len | Count | % |
|-----|------:|--:|
| 1 | 12991 | 100.0 |
| 2 | 0 | 0.0 |
| 3 | 0 | 0.0 |
| 4+ | 0 | 0.0 |

**Material finding:** Synthetic RETRY is ~100% `PHONETIC_SUBSTITUTION`, overwhelmingly 1-character closed-set confusions.

---

## Real vs Synthetic Coverage

**Material distribution shift:** YES  
**Length distribution shift:** YES  
**Phonetic subtype shift:** YES  

Largest overrepresented synthetic family: **PHONETIC_SUBSTITUTION**  
Largest underrepresented (real−synth): **MULTI_CHAR_REPLACEMENT**  
Missing real families in synthetic RETRY: **DELETION, INSERTION, MULTI_CHAR_REPLACEMENT**

See `model3_v1_synthetic_real_coverage_gap.csv`.

---

## Ownership (valid real spans)

| Ownership | Count |
|-----------|------:|
| MODEL3_TARGET | 140 |
| DOWNSTREAM_NORMALIZATION | 13 |
| UPSTREAM_FINE_SPAN | 0 |
| RECALL_PROBLEM | 0 |
| OUT_OF_SCOPE | 0 |
| UNCERTAIN | 0 |

`CHARACTER_FORM_VARIANT` → **DOWNSTREAM_NORMALIZATION** (do not train Model3 RETRY on trad/simp).

---

## Material Coverage Gaps

### GAP-01 — LENGTH_BIAS_1CHAR
- Real evidence: 77 (50.33%)
- Synthetic %: 100.0
- Why: Synthetic V1 RETRY surfaces are almost entirely 1-character; real eligible errors include substantial 2+/multi-char local mismatches.
- Model3 target: True
- Data action: **ADD** — Increase 2+/multi-char local replacement positives under Anchor conditioning.

### GAP-02 — PHONETIC_SUBSTITUTION
- Real evidence: 64 (41.83%)
- Synthetic %: 100.0
- Why: Synthetic RETRY mass is almost only closed-set phonetic families (in_ing/n_l/ch_c/…/seed_phonetic).
- Model3 target: True
- Data action: **DECREASE** — Keep phonetic as majority but reduce exclusive dominance; broaden subtypes.

### GAP-03 — MULTI_CHAR_REPLACEMENT
- Real evidence: 68 (44.44%)
- Synthetic %: 0.0
- Why: Real ASR often replaces 2–4 char local units; frozen Synthetic RETRY has essentially zero multi-char family coverage.
- Model3 target: True
- Data action: **ADD** — Add Anchor-conditioned multi-char local replacement RETRY pairs.

### GAP-04 — DELETION
- Real evidence: 3 (1.96%)
- Synthetic %: 0.0
- Why: Real dialog_200 eligible set contains deletion patterns absent from Synthetic RETRY positives.
- Model3 target: True
- Data action: **ADD** — Pilot small controlled DELETION pilot under Anchor context (not free utterance rewrite).

### GAP-05 — INSERTION
- Real evidence: 5 (3.27%)
- Synthetic %: 0.0
- Why: Real dialog_200 eligible set contains insertion patterns absent from Synthetic RETRY positives.
- Model3 target: True
- Data action: **ADD** — Pilot small controlled INSERTION pilot under Anchor context (not free utterance rewrite).

### GAP-06 — CHARACTER_FORM_VARIANT
- Real evidence: 13 (8.5%)
- Synthetic %: 0.0
- Why: Trad/simp and orthographic variants appear in real ASR but are normalization, not Model3 RETRY semantics.
- Model3 target: False
- Data action: **EXCLUDE** — Route to downstream normalization; do not train Model3 to RETRY form variants.

### GAP-07 — PHONETIC_SUBTYPE_NARROWNESS
- Real evidence: 64 (41.83%)
- Synthetic %: 100.0
- Why: Synthetic phonetic subtypes are a closed confusion set; real ASR confusions are broader / often UNKNOWN.
- Model3 target: True
- Data action: **INCREASE** — Broaden phonetic confusion inventory beyond in_ing/n_l/ch_c/z_zh/sh_s/eng_en/h_f.

---

## Model3 Status

| Question | Answer |
|----------|--------|
| Architecture failure proven | NO |
| Runtime failure proven | NO |
| Feature contract failure | NO |
| Training distribution gap proven | **YES** |
| Retraining eventually justified | **YES** |
| Immediate retraining recommended | **NO** |

Default assumption holds: keep architecture / features / Anchor / runtime; **revise training distribution**.

---

## Next Dataset (proposal only — no generation)

**New dataset needed:** YES  
**Large-scale generation now:** NO  

### Recommended family mix (Model3-target RETRY pilot)

| Family | % |
|--------|--:|
| MULTI_CHAR_REPLACEMENT | 48.6 |
| PHONETIC_SUBSTITUTION | 45.7 |
| INSERTION | 3.6 |
| DELETION | 2.1 |

### Recommended length mix

| Len | % |
|-----|--:|
| 1 | 47.8 |
| 2 | 26.1 |
| 3 | 15.7 |
| 4+ | 10.4 |

**Pilot scale:** 2k–5k Anchor-conditioned RETRY pairs, then train/eval before any large expansion.  
Retain Hard KEEP / NATURAL KEEP / NO_ANCHOR discrimination mass.

**Recommended next phase:** `MODEL3_V1_REAL_DISTRIBUTION_RETRY_PILOT_DATASET`

---

## Governance

Runtime / model / training / dataset generation / architecture: **unchanged**.  
Report artifacts: **5** (≤10).

**HARD STOP** — awaiting user review.
