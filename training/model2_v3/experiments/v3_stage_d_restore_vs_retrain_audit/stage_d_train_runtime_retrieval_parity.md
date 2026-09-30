# Train / Runtime Retrieval Parity

## Current

| Side | Primitive |
|------|-----------|
| Python Stage D teacher / J1 eval | `soft_domain_retrieve`: shared FuzzyPool k=32, domain rerank, top-8 |
| Node runtime Lexicon | `queryDomainMultiRowsAtomic`: `domain_id IN` + **exact** `pinyin_key` + `length(word)`, LIMIT 3, no length-1 |

**TRAIN_RUNTIME_RETRIEVAL_DRIFT: YES.**

J1 is not wired to runtime. If it were wired today, training would teach shared-pool rerank while Node exact SQL does something else (and recovers **0/38** BASE_ABSENT corrupted FineSpans in simulation).

## Restoration SSOT (decision only)

One production semantic for Model2 domain expansion:

**domain-conditioned FuzzyPool (existing `pool.py` gates + `domain_ids`) UNION base, then one budget.**

Node exact SQL remains a **different** exact-lookup primitive. It must not stay as a second Model2 D path (shadow / double recall).

Training teacher/eval must execute the **same** domain-conditioned fuzzy UNION contract as runtime. That is why teacher/data rebuild is required after restore, even though action ids do not change.
