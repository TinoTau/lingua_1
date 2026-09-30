# Current vs Intended Stage D Action Semantics

**Mode:** AUDIT ONLY / AUDIT_SIMULATION_ONLY  
**Does not implement restoration.**

## Minimal restoration target (not implemented)

```
Model2 domain action id  (unchanged: domain_soft:{slot})
        ↓
domain-conditioned Lexicon retrieval primitive
  = existing FuzzyPool gates (distance≤2, len±1, surface dedup)
    applied only to records whose domain_ids contain the selected slot
        ↓
UNION with unchanged base FuzzyPool
        ↓
one downstream candidate budget (soft score, never hard-filter base out of existence)
```

This is composition of **existing** primitives (`pool.py` + `CandidateRecord.domain_ids`). It is **not** a new retrieval engine.

`queryDomainMultiRowsAtomic` is **not** a drop-in restore for Model2 FineSpan expansion: it is **exact** `pinyin_key` + `length(word)` + `domain_id IN`, `termLength<2` empty, default LIMIT 3. On the 38 BASE_ABSENT corrupted FineSpans it recovered **0**.

## Side-by-side

| | CURRENT | RESTORED (intended) |
|--|---------|---------------------|
| Input | FineSpan syllables + domain action + evidence weights | Same |
| Query universe | Mixed index, all term types | Domain-tagged subset for the selected slot; base universe unchanged |
| Retrieval primitive | `build_fuzzy_pool` k=32 (same query as base) | Same FuzzyPool **gates**, domain-filtered candidate list |
| Ranking | `distance - 2.5*match - 1e-4*prior` then top-8 | UNION then **one** cap with the same soft score |
| Nested budget | pool32 → top8 | none before union |
| Output | 8 ids, often already-visible | base ∪ new domain identities |

## Action intent

`domain_soft:coffee` is a **domain slot identity**, not an encoding of pool32/top8.

- Current executor: rerank shared pool toward coffee  
- Restored executor: query coffee-tagged lexical universe as **soft expansion**, union with base  

**Same action intent, different executor.** Not a new action space.

## Measured yield (BASE_ABSENT N=38, oracle first tag)

| Executor | Raw hit | Final introduced |
|----------|--------:|-----------------:|
| Current pool32/top8 | 38 (shared phonetic) | **4** |
| Node SQL exact (simulation) | **0** | **0** |
| Domain-filtered FuzzyPool ∪ budget16 | **38** | **38** |
| Domain-filtered FuzzyPool ∪ budget8 | 38 | **38** |
