# Base + Domain Merge Audit

**Code is authoritative. Design docs were not used as the merge definition.**

## What the Python Stage D path actually does

There is **no union of two query universes**.

| Step | File | Function | Lines | Input | Output |
|------|------|----------|-------|-------|--------|
| 1 Base | `finespan_retrieval.py` | `base_retrieve_span` | 89–107 | FineSpan syllables | term_id list, FuzzyPool k=16 |
| 2 Domain pool | `domain_actions.py` | `soft_domain_retrieve` | 84–87 | **same syllables** | FuzzyPool k=32 (same sort/dedup) |
| 3 Rerank | `domain_actions.py` | `soft_domain_retrieve` | 88–99 | pool32 hits + domain_weights | score = distance − 2.5×match − 1e-4×prior; take 8 |
| 4 n_new | `domain_actions.py` | `soft_domain_retrieve` | 100 | domain top-8 vs base_ids | term_ids in top-8 not in base 16 |

## Merge type (pick one)

**Actual: shared phonetic top-k, then rerank, then cut.**

Not:

- UNION of a domain-tag SQL result with base
- replace of base by domain
- separate domain top-k then merge by term_id (that pattern exists only on the **P** path: `spike_retriever.merge_pools` L157–191)

`n_new` counts phonetic neighbors that sat in ranks 17–32 of the mixed pool and were promoted into the domain top-8. It does **not** mean a new domain query returned unseen lexicon rows.

## Measured

On relation-corrupted observations (N=698):

- EXISTING_CANDIDATES_REWEIGHTED: 638 (91.4%)
- NEW_LEXICAL_CANDIDATES_ADDED: 60 (8.6%) — usually **not** the intended target
- Intended target introduced: 4

On BASE_ABSENT (N=38): 25 never enter pool32 (unlimited-dedup rank > 32). That is **shared top-k**, not merge-drop after a successful domain query.
