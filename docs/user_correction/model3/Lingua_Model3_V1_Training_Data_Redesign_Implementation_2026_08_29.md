# Lingua — Model3 V1 Training Data Redesign Implementation

**Phase:** MODEL3_V1_TRAINING_DATA_REDESIGN_IMPLEMENTATION  
**Date:** 2026-08-29  
**Mode:** TRAINING-DATA IMPLEMENTATION + DATASET QA  
**Model trained:** NO  
**Production architecture changed:** NO

---

## MAIN VERDICT

| Field | Verdict |
|-------|---------|
| **Verdict** | **V2_DATASET_READY_FOR_TRAINING** |
| **Architecture changed** | **NO** |
| **Training executed** | **NO** |
| **Training execution gate** | **OPEN** (next phase may train after user review) |
| **Next phase** | **MODEL3_V1_V2_DATASET_TRAINING** (not executed) |

---

## IMPLEMENTED LABEL CONTRACT

| Label | Implementation |
|-------|----------------|
| **KEEP** | Non-Anchor plausible; outside malformed region or aligned reference |
| **RETRY** | `regionRetryApplicable == true`; inside training `malformedRegion`; **not** gated by `phoneticCompatible` or exact-span `referenceReachable` |
| **EXCLUDE** | `AMBIGUOUS_EXCLUDE`, `DELETION_GAP`; never silent KEEP |
| **MASKED** | Anchor spans; `targetMask=0` |

**Code:** `training/model3_dataset/scripts/stage2_v2_label.py`  
**Entry:** `stage2_common.label_spans()` → `label_spans_v2()`

---

## OLD → NEW LABEL LOGIC

### Removed hard gates
- `phoneticCompatible == true` **removed** as RETRY requirement → **DEMOTE_TO_SAMPLE_EVIDENCE**
- `referenceReachable == YES` **removed** → **RETIRE_FROM_RETRY_LABEL** (diagnostic only)
- `validate_sample`: `retry_without_yes` **retired** → `retry_without_region`

### New region logic
- `derive_malformed_regions(current, reference, corruptions, anchors)` via `difflib` + corruption bounds
- Anchor-clipped intervals; supports **length-changing** regions (`lengthChanging: true`)
- `REGION_BOUNDED_FULL_COVERAGE`: all non-Anchor FineSpans overlapping region → RETRY
- **No** fake per-char reference mapping for length-changing mismatches

---

## MALFORMED REGION IMPLEMENTATION

| Item | Detail |
|------|--------|
| **Files** | `stage2_v2_label.py` (`derive_malformed_regions`, `region_retry_applicable`, `label_spans_v2`) |
| **Length-changing support** | **PASS** (716 samples with `lengthChanging` regions; synthetic `m3v2syn_lenchg_001` validated) |
| **Production API** | None (training-only metadata in `provenance.malformedRegions`) |

---

## REGION → FINESPAN PROJECTION

Existing harness FineSpans unchanged. Projection uses current-text overlap with `malformedRegion` only. Runtime may remain 1-char sequence (e.g. `顺|便|向|木|李`).

---

## DATA RELABEL

| Metric | Value |
|--------|------:|
| **Source samples processed** | 114,413 |
| **Relabelled samples** (≥1 span label change) | 4,905 |
| **Unchanged samples** | 109,508 |
| **Synthetic gap-fill added** | 5 |
| **dialog_200 excluded** | 0 (none in source shards) |
| **Failed / validation rejected** | 0 |

### Span label transitions (eligible)
| Transition | Count |
|------------|------:|
| KEEP → RETRY | 2,173 |
| RETRY → KEEP | 3,717 |

**Interpretation:** V2 unlocks region-level RETRY (+2,173); some former exact-span RETRY become KEEP when region semantics do not apply (−3,717 net span flips).

---

## PARTIAL REGENERATION

| Item | Count |
|------|------:|
| **New synthetic samples** | 5 |
| **Families** | length-changing region (2), tone RETRY (1), ambiguous EXCLUDE (1), deletion control (1) |

No dialog_200 memorization. No per-case hardcoding (d160/d099).

---

## FINAL V2 DATA DISTRIBUTION

**Dataset:** `MODEL3_V2_LABELED` / `model3_v2_labeled_20260829`  
**Path:** `training/model3_dataset/model3_v2_labeled/`

| Split | Samples |
|-------|--------:|
| train | 80,034 |
| dev | 11,777 |
| test | 22,607 |
| **Total** | **114,418** |

### Span labels (all spans)
| Label | Count |
|-------|------:|
| KEEP | 2,139,954 |
| RETRY | 18,302 |
| MASKED | 94,851 |
| EXCLUDE_FROM_SUPERVISED | 1 |

### Eligible non-Anchor spans
| Metric | Value |
|--------|------:|
| Eligible | 2,158,236 |
| **RETRY ratio** | **0.848%** (was ~0.37% V1 eligible RETRY on comparable sources) |
| RETRY without `referenceReachable==YES` | **2,123** spans |

### Family distribution (eligible)
| Family | Count |
|--------|------:|
| CLEAN_KEEP | 2,139,270 |
| PHONETIC_RETRY | 14,336 |
| MALFORMED_REGION_RETRY | 3,953 |
| HARD_KEEP | 684 |
| ANCHOR_ADJACENT_RETRY | 12 |
| TONE_RETRY | 1 |

### FineSpan lengths (eligible)
| Length | Count |
|--------|------:|
| 1-char | 2,158,256 |
| 2-char | 0 |

*(V2 relabel preserves existing FineSpan surfaces; no forced multi-char spans.)*

---

## LABEL QA

| Check | Status |
|-------|--------|
| Anchor never RETRY-supervised | **PASS** |
| Ambiguous not silent KEEP | **PASS** |
| RETRY not gated by exact-span reachability | **PASS** (2,123 RETRY with reach≠YES) |
| `phoneticCompatible` not hard gate | **PASS** |
| Length-changing malformed regions | **PASS** |
| Region safety (no RETRY outside region / cross Anchor) | **PASS** |
| Schema validation | **PASS** |

---

## COVERAGE QA

| Family | Status |
|--------|--------|
| PHONETIC RETRY | **PASS** |
| TONE RETRY | **PASS** (minimal synthetic + relabeled pool) |
| MALFORMED REGION | **PASS** |
| ANCHOR ADJACENT | **PASS** |
| HARD KEEP | **PASS** |
| EXCLUDE / out-of-scope control | **PASS** (1 EXCLUDE span in corpus; synthetic control present) |

**Note:** Natural EXCLUDE rate is low in relabeled V1 sources; most ambiguity was previously forced to KEEP. Future eval-set build may expand EXCLUDE inventory.

---

## PRODUCTION ARCHITECTURE

All **NO** change: Model3 runtime, FineSpan, Retry, Recall, Lattice, Domain Vote, Model2, Assembly, JobResult.

---

## OLD BASELINE

**MODEL3_SYNTHETIC_V1** / seed `2026082520` — **preserved** (V1 datasets untouched).

---

## GATES

| Gate | Status |
|------|--------|
| ARCHITECTURE_TRAINING_GATE | **OPEN** |
| DEVELOPMENT_SEQUENCE_GATE | **OPEN** |
| TRAINING_EXECUTION_GATE | **OPEN** |

---

## Artifacts

1. This report  
2. `docs/user_correction/model3/model3_v2_dataset_qa.csv`  
3. `docs/user_correction/model3/model3_v2_label_examples.csv`  
4. `docs/user_correction/model3/model3_v2_dataset_summary.json`  
5. `docs/user_correction/model3/model3_v2_dataset_governance.json`

---

## Implementation files touched

| File | Change |
|------|--------|
| `scripts/stage2_v2_label.py` | **NEW** — V2 contract |
| `scripts/stage2_common.py` | V2 `label_spans`, validation, provenance |
| `scripts/run_v2_dataset_build.py` | **NEW** — relabel + synthetic gap-fill |
| `scripts/qa_v2_dataset.py` | **NEW** — dataset QA gate |

**STOP.** No Model3 training in this phase.
