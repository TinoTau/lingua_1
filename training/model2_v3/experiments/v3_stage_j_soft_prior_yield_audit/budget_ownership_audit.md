# Candidate Budget Ownership Audit

## Owners (Python Stage D eval path)

| Owner | Value | File | Function | Lines |
|-------|------:|------|----------|-------|
| Base FuzzyPool cap | 16 | `training/model2/retrieval/finespan_retrieval.py` | `base_retrieve_span` | 103 |
| Domain FuzzyPool cap | 32 | `training/model2_v3/policy/domain_actions.py` | `soft_domain_retrieve` | 67, 86 |
| Domain soft top-k | 8 | `domain_actions.py` | `soft_domain_retrieve` | 66, 99 |
| ProfileRetrievalConfig.max_total_profile_candidates | 8 | `training/model2/retrieval/spike_retriever.py` | dataclass default | 23 |
| Contract FUZZY_POOL_MAX_CANDIDATES | 16 | `training/model2/contract.py` | constant | 95 |
| Distance threshold | 2 | `contract.py` | `FUZZY_DISTANCE_THRESHOLD` | 96 |
| Length delta | 1 | `contract.py` | `FUZZY_LEN_DELTA_MAX` | 97 |

## Not on Python Stage D path (downstream Node)

| Owner | Value | File | Lines |
|-------|------:|------|-------|
| Domain prior quota slots | 2 | `apply-domain-prior-quota.ts` | 65 |
| Per-span candidate limit | existing Node budget | `per-span-candidate-limit` / assembly | T8/T9 |

## BUDGET_STACKING

**YES.** Same candidate is filtered by:

1. Levenshtein ≤ 2  
2. Surface dedup (one slot per surface)  
3. Pool cap 32  
4. Soft rerank top-8  

No SQL LIMIT on this path.

Among BASE_ABSENT + raw phonetic hit (N=38):

- 25 lost at pool32 (rank > 32 after dedup)  
- 9 lost at top-8 (rerank rank > 8)  
- 4 survive = FINAL INTRODUCED  

## BUDGET_OWNERSHIP_DRIFT

**YES.** Frozen purpose of candidate caps: stop KenLM / Assembly explosion **after** expansion.

Current caps run **inside** the only Stage D “expansion” step, on a shared phonetic list, before any domain-conditioned query exists. The 16-slot window (ranks 17–32) is the entire expansion capacity of Stage D.

Classification: **BUDGET_OWNERSHIP_DRIFT** relative to original expansion-then-budget intent. Soft-prior semantics themselves remain frozen (not converted to a hard domain filter).
