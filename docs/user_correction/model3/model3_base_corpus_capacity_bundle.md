# Model3 Base Corpus Capacity Bundle

**Phase:** `MODEL3_BASE_CORPUS_CAPACITY_AND_STAGE2_PREDEVELOPMENT_AUDIT`  
**Date:** 2026-08-23  
**Companion data:** `model3_base_corpus_data.csv` · `model3_certified_base_pool_summary.json`  
**Normalization:** NFKC + OpenCC t→cn (`opencc-js` / `normalizeForFwRepairInput` equivalent)

---

## A. Spoken-Like Acceptance Contract V1

**Does not change** `MODEL3_TRAINING_SAMPLE_V1` schema.

| Class | Use in certified ≥15k count |
|-------|------------------------------|
| `ACCEPT` | Full credit per exact-normalized unique sentence |
| `ACCEPT_WITH_LIMIT` | Exact unique allowed, but **near-dup / carrier-cap controlled** |
| `REJECT_PRIMARY` | Not counted toward spoken-like gap closure |
| `EVAL_ONLY` | Never train/dev |

### ACCEPT

Real / naturalistic dialogue transcripts; open spoken references **not** dominated by a small carrier skeleton set.

**Finding:** no large pure-`ACCEPT` free-dialogue pool in-repo beyond carrier-filled Model2 TTS pipelines.

### ACCEPT_WITH_LIMIT

Carrier-filled GT from `baseline_v1`, `training_scale_v1`, `pseudo_user_accent_scale_v1`:

- Exact-normalized unique sentences may enter the pool.
- **Near-duplicate control (V1):** per `carrier_id`, at most **30** unique normalized texts credit toward **certified** capacity.
- Report source share; avoid silent single-source dominance.

### REJECT_PRIMARY

| Source type | Reason |
|-------------|--------|
| `carrier_templates_v*` skeletons | Templates, not sentences |
| Uncapped carrier slot expansions | Template inflation |
| Wikipedia / news | Not spoken dialogue |
| Lexicon term lists / single-char TSV | Not sentences |
| Tiny probes | Research only |

### EVAL_ONLY

`dialog_200` — **forbidden** in train/dev base pool.

### Carrier templates

| Question | Answer |
|----------|--------|
| Real sentences? | **No** — `{TERM}` skeletons |
| Each slot fill = high-value unique base? | **No** |
| How they contribute | Only via filled corpora under ACCEPT_WITH_LIMIT + carrier cap |

---

## B. Near-Duplicate Audit

**Methods:** exact normalized dedup · `carrier_id` grouping · digit→`#` pattern (secondary) · **no** embeddings.

| Metric | Value |
|--------|------:|
| baseline_v1 unique | 9775 |
| training_scale_v1 unique | 2723 |
| accent_scale unique | 2826 |
| Exact overlap baseline∩scale | 69 |
| Exact overlap baseline∩accent | 120 |
| Exact overlap scale∩accent | 184 |
| Exact union (3 sources) | **14956** |
| Carrier clusters (filled) | 170 |
| Mean expansions / carrier (baseline) | ~90.9 |
| Rejected by per-carrier cap=30 | 10524 |
| **Certified (cap-controlled)** | **4955** |

Template inflation: template_ratio=1.0 on filled pipelines. Uncapped unique overstates diversity.

---

## C. Gap Closure

| Metric | Count |
|--------|------:|
| Uncapped exact union | **14956** (shortfall **44**) |
| Cap-controlled certified (authoritative) | **4955** (shortfall **10045**) |
| Required minimum | **15000** |

**BASE_CORPUS_GAP: YES** (both interpretations)

Cap-controlled contributions: baseline 3300 (~66.6%) · scale 1655 (~33.4%) · accent 0 (carriers already capped).

### Close later (not this audit)

1. Add non-carrier-dominated spoken-like unique sentences.  
2. Do **not** expand carrier slots to “pass” 15k.  
3. Do **not** use wiki/news as primary.  
4. Keep dialog_200 EVAL_ONLY.  
5. Re-run inventory before claiming gap closed.
