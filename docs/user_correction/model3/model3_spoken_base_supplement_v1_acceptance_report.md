# MODEL3_SPOKEN_BASE_SUPPLEMENT_V1 Acceptance Report

**Date:** 2026-08-24  
**Phase:** `MODEL3_BASE_CORPUS_GAP_CLOSURE_AND_STAGE2_DEVELOPMENT`  
**Class:** `ACCEPT_WITH_LIMIT` (`LLM_SYNTHETIC_SPOKEN_BASE` — not real dialogue)

## Normalization

NFKC + OpenCC t→cn via `electron_node` `opencc-js` (equivalent to `normalizeForFwRepairInput`).

## Counts

| Metric | Value |
|--------|------:|
| Candidates | 18000 |
| Previous certified (carrier-cap v1) | 4955 |
| New accepted unique | 17222 |
| New rejected | 778 |
| **Total certified spoken-like** | **22177** |
| >=15000 | **YES** |
| dialog_200 contamination | **0** |

## Gates

- Exact dedup: new↔new, baseline, scale, accent, prior certified  
- Near-dup: structural signature cap (discourse frames stripped) ≤8; pattern-key cap ≤8; prefix/suffix affinity  
- **No** blind `carrier_id=30` (supplement has no carrier_id)  
- Spoken-like class: ACCEPT_WITH_LIMIT only  

## Artifacts

- `model3_spoken_base_supplement_v1_stats.json`  
- `model3_spoken_base_supplement_v1_overlap.csv`  
- `model3_spoken_base_supplement_v1_rejected.csv`  
- `model3_spoken_base_supplement_v1_human_qa_500.csv` (PENDING human fill)  
- `model3_certified_base_pool_v2_summary.json`  
- `model3_certified_base_pool_v2.jsonl`  

## Human QA

500 stratified rows emitted; review columns blank → **HUMAN_QA_PENDING**.
