# Model2 D candidate wrong-span binding — root cause

**Date:** 2026-08-18  
**Class:** IMPLEMENTATION_DRIFT (not FineSpan architecture)

## Mechanism

1. Stage D FuzzyPool uses `FUZZY_LEN_DELTA_MAX = 1`, so a 1-syllable FineSpan query can return 2-character domain terms.
2. `materializeDomainHits` copied `policyInput` (the FineSpan currently in the per-span loop) onto every hit: `candidateId = m2d:{iteratorSpanId}:…`, ranges, and `windowPinyinKey`.
3. Examples from Stage-J traces:
   - surface `大杯` (`da|bei`) bound to FineSpan 「帮」 / compact pinyin `bang` (d002 / d047 / d137 / d182)
   - surface `预订` bound to 「大」/`da` or 「搭」 (d031 / d121 / d166)
   - surface `少冰` / `小杯` bound to 「红」/`hong` (d183)
   - d001: `机场` / `预订` bound to FineSpan 「一」 / compact pinyin `yi`
4. `mergeProfileIntoActiveCandidates` dedups by `termId` globally, so the first (often 1-char) FineSpan kept the identity.

## Fix (this round)

Bind a Model2 D hit only to the FineSpan that **triggered that retrieval** and whose **syllable-range length equals the hit pinyin length**.

- No first / nearest / fallback FineSpan rebind
- No eligibility relaxation
- No PathFineSpan change
- 2-char term vs 1-char PathFineSpan → not materialized → **EXPECTED CONTRACT REJECTION**

## Not changed

Assembly, KenLM, budget, Domain Vote, FineSpan design, Model2 weights, recall algorithm / `len_delta_max`.
