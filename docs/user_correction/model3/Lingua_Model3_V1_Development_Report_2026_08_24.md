# Lingua Model3 V1 Synthetic Training + Baseline Development Report

**Date:** 2026-08-24  
**Phase:** `MODEL3_V1_SYNTHETIC_TRAINING_DATA_AND_BASELINE_DEVELOPMENT`  
**Verdict:** `PASS_WITH_QUALITY_GAPS`

---

## 1. Summary

First meaningful Model3 V1 baseline on synthetic text: **100k** `MODEL3_TRAINING_SAMPLE_V1` corpus, anchor-conditioned diet (simulated training anchors), production Recall-validated RETRY labels, Small BiGRU training, held-out eval, CPU benchmark, shadow-only validation.

**Quality gaps:** RETRY span density 1.43% (below 10–20% construction target); **0** REAL_DOMAIN anchors.

**Next phase:** `MODEL3_TTS_ASR_DATASET_AND_REAL_ERROR_ENHANCEMENT` (after review).

**STOP:** No TTS, no production RETRY, no runtime Domain Vote / Recall / Model2 / schema changes.

---

## 2. Authorities

| Item | Status |
|------|--------|
| `MODEL3_TRAINING_SAMPLE_V1_SCHEMA.json` | Unchanged |
| `MODEL3_BOOTSTRAP_ANCHOR_V0` | **Not in repo** (mechanics reference only; not used as formal corpus) |
| Simulated anchor in runtime enum | **NO** — sidecar provenance only |

---

## 3. Dataset

| Metric | Value |
|--------|------:|
| Total samples | 100,000 |
| Train | 79,912 |
| Dev | 10,042 |
| Test | 10,046 |
| Certified base pool | 22,177 |
| Excluded (harness/validation) | 0 |

**Paths:** `training/model3_dataset/model3_v1_synthetic_100k/` · `dataset_manifest.json` · `checksums.csv` · `anchor_provenance_sidecar.jsonl`

### Anchors

| Metric | Value |
|--------|------:|
| Anchor-conditioned utterances | 79,227 (79.2%) |
| NO_ANCHOR utterances | 20,773 (20.8%) |
| REAL_DOMAIN | 0 |
| SIMULATED_TRAINING | 79,227 |
| Simulated visible as model feature | **NO** |

### Labels (spans)

| Class | Count |
|-------|------:|
| KEEP | 1,896,795 |
| RETRY | 27,541 |
| MASKED (anchors) | 79,227 |
| Anchor RETRY | **0** |
| RETRY without reachability YES | **0** |
| RETRY ratio (eligible non-anchor) | 1.43% |
| Hard-negative KEEP spans | 58,600 |

### Corruption mix (utterance variant kinds)

| Kind | Count |
|------|------:|
| SINGLE_PHONETIC | 65,014 |
| CLEAN_KEEP | 20,023 |
| DOUBLE_PHONETIC | 14,024 |
| ORTHO_HARD_NEG | 939 |

Phonetic families: `n_l`, `z_zh`, `ch_c`, `sh_s`, `eng_en`, `in_ing`, `h_f` (+ orthographic hard-neg).

---

## 4. Data QA

| Check | Result |
|-------|--------|
| Schema | PASS |
| Alignment | PASS |
| Gate | **PASS** |
| sourceSentenceId split leakage | **0** |
| dialog_200 contamination | **0** |
| Fake acoustic evidence | **0** |
| Human QA sample | 500 — PASS |

Note: `surfacePairKey` cross-split leakage (63/62/57) documented in audit bundle; gate uses sourceSentenceId family only.

Detail: `model3_v1_dataset_audit.json`

---

## 5. Model — MODEL3_V1_SYNTHETIC_BASELINE

| Item | Value |
|------|-------|
| Architecture | Small BiGRU + span head |
| Parameters | 231,618 |
| Weights size | ~909 KB |
| Training epochs | 5 |
| Training time | ~629 s |

**Paths:** `training/model3_dataset/model3_v1_synthetic_bigru/`

### Held-out test metrics

| Metric | Value |
|--------|------:|
| RETRY precision | 1.00 |
| RETRY recall | 1.00 |
| RETRY F1 | 1.00 |
| False RETRY rate | 0.00 |
| Macro F1 | 1.00 |
| TP / FP / FN / TN | 2802 / 0 / 0 / 190451 |

**REAL_DOMAIN subset:** `INSUFFICIENT_REAL_DOMAIN_SAMPLE`

Perfect metrics reflect synthetic feature separability — **not** real ASR validation.

Detail: `model3_v1_training_metrics.json`

---

## 6. Performance & Shadow

| CPU latency | Value |
|-------------|------:|
| p50 | 2.46 ms |
| p95 | 3.74 ms |
| p99 | 4.16 ms |
| Seq length mean | 20.5 |

| Shadow | Value |
|--------|-------|
| One inference per utterance | YES |
| Actual retry triggered | **NO** |
| Production output changed | **NO** |

Trace: `model3_v1_shadow_trace.jsonl` (500 utterances, 9873 span rows)

Detail: `model3_v1_performance_and_shadow.json`

---

## 7. Governance

| Check | Result |
|-------|--------|
| Architecture changed | NO |
| Training schema changed | NO |
| Formal anchor contract changed | NO |
| Domain Vote changed | NO |
| Recall changed | NO |
| Model2 changed | NO |
| JobResult changed | NO |
| Runtime RETRY enabled | NO |

Detail: `model3_v1_governance.json`

---

## 8. Artifact index (this round, ≤10 files)

| File | Contents |
|------|----------|
| `Lingua_Model3_V1_Development_Report_2026_08_24.md` | This report |
| `model3_v1_dataset_audit.json` | QA, leakage, distributions |
| `model3_v1_training_metrics.json` | Training history, eval, buckets |
| `model3_v1_governance.json` | Verdict, isolation, runtime checks |
| `model3_v1_performance_and_shadow.json` | CPU latency + shadow summary |
| `model3_v1_human_qa_500.csv` | Human QA sample |
| `model3_v1_shadow_trace.jsonl` | Shadow diagnostic trace |
