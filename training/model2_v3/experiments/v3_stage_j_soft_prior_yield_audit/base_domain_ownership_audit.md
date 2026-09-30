# Base / Domain Ownership Audit

**Mode:** READ ONLY  
**Index:** `training/model2_v3/dataset/policy_stage_d2/candidate_index_stage_d2.jsonl` (9914 records; 655 domain-type / 9259 base-type)

## Question

Does a domain-tagged term also belong to the base searchable universe?

**Answer: YES, in the current Python Stage D path.**

## Evidence (code, not docs)

| Step | File | Function | Lines | Behavior |
|------|------|----------|-------|----------|
| Index build | `training/model2/candidates/index.py` | `build_candidate_index_from_sqlite` | 96–151 | Inserts `domain:` rows from `domain_lexicon`, then **separate** `base:` siblings from `base_lexicon` with `domain_ids=[]`. Comment L137–138: keep base even if surface already has domain. |
| D2 enrich | `training/model2_v3/policy/multitag.py` | `enrich_index_multitag` | 28–85 | Copies sibling + SSOT tags onto records; does **not** remove domain rows from the mixed index. |
| Base recall | `training/model2/retrieval/finespan_retrieval.py` | `base_retrieve_span` | 89–107 | `build_fuzzy_pool` over the **entire** index. No `term_type==base` filter. |
| Domain action | `training/model2_v3/policy/domain_actions.py` | `soft_domain_retrieve` | 84–87 | Same `build_fuzzy_pool`, only `max_pool_size=32` vs base 16. |

## Measurement

- Unique domain identities: **588**
- Exact FineSpan = term syllables: **588 / 588 = BASE_VISIBLE_SIBLING_IDENTITY**
- Mechanism: distance-0 identity is always inside FuzzyPool; surface dedup keeps `base:` sibling (`term_id` ASC: `"base:" < "domain:"`).

## Frozen design vs later implementation

- **Owning both a `domain_lexicon` row and a `base_lexicon` sibling** is the Lexicon schema / index builder, not a Stage D invention.
- **Searching both in one phonetic pool** is the FuzzyPool V1 mixed-index implementation (`pool.py` + `base_retrieve_span`).
- There is **no** frozen product rule that “domain terms must be invisible to base recall.”
- There **is** an original Model2 rule that domain/profile signals should **expand** the candidate set. Putting domain terms in the same base pool makes exact-match domain targets **already visible**, so Stage D has nothing to introduce.

Classification: **EXPECTED_IMPLEMENTATION** of mixed FuzzyPool, which makes Stage D opportunity **naturally sparse** on exact FineSpans. Combined with no domain-tag query, this is the substrate of **ARCHITECTURE_DRIFT** toward reweighting.

## Do not weaken base recall

Base already retrieving the lexical identity is **system success**. This audit does not recommend shrinking base recall to manufacture Stage D cases.
