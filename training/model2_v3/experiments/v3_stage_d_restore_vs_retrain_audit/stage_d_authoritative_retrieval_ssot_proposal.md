# Authoritative Retrieval SSOT Proposal (decision only — not implemented)

## Rule

One Model2 domain-expansion semantic. No Python-vs-Node split.

## Proposed SSOT

**Contract name (proposed):** `StageDDomainConditionedFuzzyUnionV1`

1. Base: existing `base_retrieve_span` / FuzzyPool k=16 — **unchanged**.  
2. Domain action `domain_soft:{d}`: FuzzyPool **gates** on records with `d ∈ domain_ids` (Lexicon tag SSOT).  
3. UNION by StageDRetrievalTargetIdentityV1.  
4. Single downstream cap; soft score; **never hard-filter** other domains out of the base set.  
5. Teacher/eval/runtime execute this same function.

## Explicitly not SSOT for Model2 D

- Current `soft_domain_retrieve` shared-pool rerank  
- Node `queryDomainMultiRowsAtomic` exact pinyin (wrong match type for ASR FineSpan; sim hit 0/38)

## Implementation shape (when user approves)

Replace the **body** of `soft_domain_retrieve` (same action catalog). No second service, no second model, no fallback to the old rerank.
