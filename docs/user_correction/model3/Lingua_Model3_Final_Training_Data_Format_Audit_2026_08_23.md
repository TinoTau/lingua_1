# Lingua Model3 Final Training Data Format Audit

**Date:** 2026-08-23  
**Phase:** `MODEL3_FINAL_TRAINING_DATA_FORMAT_AUDIT`  
**Type:** READ-ONLY data contract audit  
**Verdict:** `BASE_CORPUS_GAP`

**Authoritative inputs:**  
`MODEL3_ARCHITECTURE_CONTRACT_V1.md` · `Lingua_Model3_Contract_and_Training_Design_2026_08_23.md` · Error-text audit + pilot report · `ERROR_TEXT_SAMPLE_V1` · input/output/label/anchor/retry/trace/split contracts

**Not done:** 100k generation · Model3 training · TTS · runtime change

---

## 1. Core answer

**Final training format = `MODEL3_TRAINING_SAMPLE_V1`**

It is **not** `ERROR_TEXT_SAMPLE_V1`. Transformation:

```text
ERROR_TEXT_SAMPLE_V1
  + Domain Vote–equivalent Anchors
  + model2AnchorStatus (UNAVAILABLE allowed; forge FORBIDDEN)
  + offline Recall-equivalent repairability
  + Model3 evidence + featureAvailability masks
  + per-span KEEP | RETRY | MASKED | EXCLUDE
        ↓
MODEL3_TRAINING_SAMPLE_V1  (utterance span sequence)
```

Same schema supports `SYNTHETIC_TEXT` / `TTS_ASR` / `HUMAN_ASR` via availability masks — **no** fake acoustic fills.

---

## 2. Contract conflict check

| Pair | Result |
|------|--------|
| Architecture role vs training unit | Aligned (sequence inference + per-span labels) |
| Input contract evidence vs SYNTHETIC_TEXT | Aligned via ABSENT + masks |
| Label contract vs materialization | Aligned; EXCLUDE for UNKNOWN |
| Draft `model3_training_sample_schema_v1.json` | **Superseded** by `MODEL3_TRAINING_SAMPLE_V1_SCHEMA.json` (camelCase, evidenceLevel, featureAvailability, repairability) — not treated as conflicting live SSOT |

**CONTRACT_CONFLICT:** NO

---

## 3. Training unit

- **Unit:** utterance-level span sequence  
- **Labels:** per-span KEEP / RETRY  
- **Anchors:** MASKED / IGNORE (`targetMask=0`); never train Anchor KEEP as supervision target  

---

## 4. Anchors for first synthetic batch

| Source | Rule |
|--------|------|
| DOMAIN | Offline Domain Vote + retained SameDomain equivalent only |
| MODEL2 | Materialized only; synthetic default `UNAVAILABLE` |
| Fabricated MODEL2 | **FORBIDDEN** |

Domain-only first 100k: **allowed as DATASET_LIMITATION** — Anchor contract unchanged.

---

## 5. Repairability

Authoritative probe = offline read-only equivalent of retry Recall (`recallSpanTopKV2` / `recallTopKForWindows` + retained domains + base).  
**Not** “reference string in lexicon ⇒ YES”.

---

## 6. 100k capacity

| Metric | Value |
|--------|--------|
| Target samples | ~100,000 soft |
| Required unique bases | ~15,000–25,000 |
| Certified unique bases today | ~9,775 (`baseline_v1` GT) |
| **BASE_CORPUS_GAP** | **YES** |
| Safe to generate ~100k now | **NO** |

---

## 7. Local-LM risk

Synthetic-text dominance → model may ignore absent acoustic channels if zeros are faked or text-only diet is exclusive.

**Mitigations (dataset/train, not runtime):** featureAvailability masks; no fake confidence; planned TTS_ASR share; hard negatives; optional text-channel dropout at Stage3.

---

## 8. Artifacts produced

| File |
|------|
| `MODEL3_TRAINING_SAMPLE_V1_SCHEMA.json` |
| `MODEL3_TRAINING_DATASET_V1_CONTRACT.md` |
| `model3_training_feature_mask_contract.md` |
| `model3_training_label_materialization_contract.md` |
| `model3_training_dataset_sharding_contract.md` |
| `model3_training_dataset_manifest_schema.json` |
| `model3_100k_dataset_source_capacity_audit.md` |
| `model3_100k_dataset_distribution_plan.md` |
| `model3_training_loader_contract.md` |
| `model3_100k_dataset_acceptance_contract.md` |
| This report |

---

## 9. Decision

| Item | Value |
|------|--------|
| Format frozen | **YES** |
| Safe to generate ~100k | **NO** |
| Blocking gap | `BASE_CORPUS_GAP` (+ label materializer + offline Domain Vote path still to implement) |
| Next | Close base capacity → then `MODEL3_100K_TRAINING_DATASET_GENERATION` |

**STOP** — audit only.
