# Lingua Model2 V3 — Stage J Production Benchmark Expansion Report
# Date: 2026-08-17

**Benchmark version:** `STAGE_J_PRODUCTION_BENCHMARK_V1`  
**Artifacts:** `training/model2_v3/experiments/v3_stage_j_j1_prod/`

---

## Executive

Expanded production-facing Stage J test coverage under **frozen** contracts:

- `MODEL2_FEATURE_HASH_V1`
- `StageDRetrievalTargetIdentityV1`
- Soft domain prior (no hard filter)
- Execute-validated D teacher
- No invented term→domain mappings

**Statistical coverage: LIMITED** — unique D-only intro events remain sparse under soft prior; row-level expansion via profile variants reaches ≥100 rows but unique terms/spans do not.

---

## Scale summary

| Slice | N | Notes |
|-------|---|-------|
| P-only hard | **699** | Unchanged / not shrunk |
| P held-out (approx) | **439** | Stage J shape |
| D-only eligible rows | **132** | 33 unique terms / 16 unique FineSpans + profile variants |
| P+D eligible intro | **132** | Built from D FineSpans + inferred ACTIVE_SET_V1 phonetic bias |
| Negatives | **146** | base-sufficient / empty / irrelevant |
| Counterfactual rows | **165** | Correct/Empty/Wrong/Swapped (+ variants) |
| Held-out terms | **5** | term_id hash split |
| Held-out spans | **3** | alternate corruptions |

---

## Why D-only unique recovery stays small

1. Exact-syllable domain spans are **base-visible** under identity → excluded by contract.
2. Soft prior reorders FuzzyPool; pool surface-dedup often keeps `base:` sibling — works only when multitag enrich puts domain tags on that sibling (`policy_stage_d2` index).
3. Soft prior + FineSpan noise yield rate ≈ **33/655** domain terms (~5%).
4. **Did not** relax base-absent, identity, soft prior, or invent mappings to inflate N.

**Flag:** `REAL_D_ONLY_COVERAGE_LIMITATION = YES`

---

## P+D construction note

Phase2 REAL_ASR target surfaces have **zero overlap** with domain lexicon surfaces.  
P+D cases attach phonetic bias (inferred from observation vs canonical syllables) onto execute-validated D FineSpans — contract-valid combined ambiguity without fake domain links.

---

## Audits

| Audit | Result |
|-------|--------|
| Dedup | PASS |
| Leakage (held-out term vs train) | PASS |
| Oracle TIR on eligible | PASS (=1.0) |
| Soft prior | UNCHANGED |
| FuzzyPool production change | NO |

---

## Domain / relation coverage

- Domains: partial; low-count slots marked in `stage_j_prod_domain_coverage.json`
- Relations: P hard coverage SUFFICIENT (≥30 each); weak focus `in_ing`, `ch_c` retained

---

## Readiness for J1 training

- `ALLOW_J1_TRAINING`: YES (exploration)
- `DATA_COVERAGE_LIMITED`: YES
- Production-quality Stage J acceptance: **not** claimed from this benchmark alone

---

## Files

See `stage_j_prod_*` artifacts under `v3_stage_j_j1_prod/` and `dataset/*.jsonl`.
