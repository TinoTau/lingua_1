# Model3 100k Dataset — Source Capacity Audit

**Date:** 2026-08-23  
**Phase:** `MODEL3_FINAL_TRAINING_DATA_FORMAT_AUDIT`  
**Verdict flag:** `BASE_CORPUS_GAP`

---

## Requirement (frozen this audit)

| Requirement | Target |
|-------------|--------|
| Training samples (utterance sequences) | ~100,000 (soft) |
| Unique spoken-like base sentences | **≥ ~15,000–25,000** |
| Mechanical near-duplicate inflation from ~10k bases | **FORBIDDEN** |

---

## Current primary clean capacity

| Source | Approx capacity | Role |
|--------|-----------------|------|
| `baseline_v1` GT | ~10k rows / **~9,775 unique** clean sentences | Primary spoken-like base (error-text audit) |
| Pilot already used | 800 stratified unique from baseline | Research only |
| `training_scale_v1` / accent_scale / probes | Additional but overlapping / style variance TBD | Candidate supplement — not yet certified as spoken-like unique pool |
| `carrier_templates_v3` | Template carriers | Not full natural dialogue bases |
| dialog_200 | ~65 unique clean | **EVALUATION ONLY** — not train/dev |

---

## Gap analysis

```text
Required unique bases:  15,000 – 25,000
Available certified:    ~9,775 (baseline_v1 unique GT)
Shortfall:              ~5,000 – 15,000+ unique spoken-like sentences
```

**BASE_CORPUS_GAP = YES**

Filling ~100k samples by generating 10–20 near-duplicate corruptions per base from only ~9.8k sentences **without** new unique bases violates quality rules and increases memorization / surface-pair leakage.

---

## Allowed path to close gap (future — not this phase)

1. Inventory & dedupe additional spoken-like corpora (scale/accent **after** dialogue-fit QA).  
2. Add new licensed / project dialogue GT — **not** wiki/news as primary.  
3. Only after unique bases ≥ ~15k: scale corruption variants toward ~100k **utterance samples**.  
4. Still forbid dialog_200 in train/dev.

---

## Implication for 100k generation

| Decision | Value |
|----------|--------|
| Format freeze | Allowed (separate) |
| Safe to generate ~100k **now** | **NO** |
| Prerequisite | Close `BASE_CORPUS_GAP` (+ label materializer + Domain Vote offline path) |
