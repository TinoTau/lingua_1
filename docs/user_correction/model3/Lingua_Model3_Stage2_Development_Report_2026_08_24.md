# Lingua Model3 Stage2 Development Report

**Date:** 2026-08-24  
**Phase:** `MODEL3_BASE_CORPUS_GAP_CLOSURE_AND_STAGE2_DEVELOPMENT`  
**Verdict:** `PASS_WITH_DATA_GAPS`

---

## 1. Base corpus gap closure

| Metric | Value |
|--------|------:|
| Previous certified | 4955 |
| New candidates | 18000 (`MODEL3_SPOKEN_BASE_SUPPLEMENT_V1`) |
| New accepted | 17222 |
| New rejected | 778 |
| **Total certified** | **22177** |
| >=15000 | **YES** |
| dialog_200 contamination | **0** |

Class: `ACCEPT_WITH_LIMIT` (LLM synthetic — not real dialogue).  
Details: `model3_spoken_base_supplement_v1_acceptance_report.md`

---

## 2. Stage2 implementation

### Package

| Path | Role |
|------|------|
| `training/model3_dataset/offline_harness/stage2_materialize.cjs` | Electron-as-Node harness |
| `training/model3_dataset/scripts/run_stage2_labeled_pilot.py` | ERROR_TEXT → labels → shards |
| `training/model3_dataset/scripts/accept_spoken_base_supplement_v1.py` | Corpus acceptance |

### Reuse (no Python clones)

- `runLatticeFineSpanGeneration`
- `voteUtteranceDomainFromPool`
- SameDomain via production `isSameDomainCandidate` predicate
- `recallTopKForWindows` (+ `recallSpanTopKV2` fallback)
- `normalizeForFwRepairInput`
- `LexiconRuntimeV2.loadFromBundleDir(v3)`

### Model2

All `model2AnchorStatus=UNAVAILABLE` (no forge).

### Schema

Authority: `MODEL3_TRAINING_SAMPLE_V1_SCHEMA.json` — **unchanged**.  
Old draft reference fixed in `model3_stage2_target_list.csv`.

### Runtime

**No** production algorithm / behavior changes.

---

## 3. Labeled pilot

| Metric | Value |
|--------|------:|
| Samples | 6000 |
| KEEP spans | 115283 |
| RETRY spans | 1009 |
| MASKED spans | 0 |
| EXCLUDE spans | 0 |
| Anchor RETRY | 0 |
| RETRY without reachability YES | 0 |
| Schema pass | 100% |
| Split leakage | 0 |
| dialog_200 | 0 |
| Loader smoke | PASS |

Shards: `training/model3_dataset/model3_training_sample_v1_pilot/{train,dev,test}/`

---

## 4. Data gaps (not contract failures)

1. **MASKED=0:** Domain Vote `retainedDomains` empty on most SYNTHETIC_TEXT utterances (no domain_term SameDomain membership) → Domain-anchor-primary training diet under-supplied.  
2. **RETRY sparse:** ~1009 / 116k spans; many phonetic corruptions still `referenceReachable=NO` under offline Recall.  
3. **Human QA** on supplement 500: PENDING.  
4. Near-dup acceptance of LLM supplement is explainable but still synthetic-biased.

---

## 5. 100k readiness

| Gate | Result |
|------|--------|
| Base corpus ≥15k | **PASS** |
| Stage2 implementation | **PASS** (reuse OK) |
| Labeled pilot critical checks | **PASS** |
| Overall | **PASS_WITH_DATA_GAPS** — Safe To Generate ~100K: **NO** until Domain Anchor yield / RETRY density / human QA addressed |

**Recommended next:** improve Domain Anchor materialization coverage on synthetic bases (real domain terms / offline SameDomain richness) + human QA on supplement → then reconsider 100k.

**STOP** — no 100k, no BiGRU train, no TTS, no runtime Model3.
