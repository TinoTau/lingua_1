# Stage D Budget Semantics Audit

## Current stack

| Owner | Stage | Value | Purpose | Frozen? | Origin |
|-------|-------|------:|---------|---------|--------|
| `base_retrieve_span` | T1 | 16 | base FuzzyPool cap | contract `FUZZY_POOL_MAX_CANDIDATES` | Phase 5A |
| `soft_domain_retrieve` pool_size | T3 | 32 | larger shared phonetic list | function default | Stage D Python |
| `soft_domain_retrieve` max_cands | T4 | 8 | domain output | function default | Stage D Python |
| D eval action budget | T2 | 2 | how many domain actions J1 may fire | eval harness | J1 eval |
| `cand_budget_head` | model | 4-way | P-path candidate budget | model | unused for D eval |
| Node `maxDomainCandidates` | Node SQL | 3 | exact domain SQL LIMIT | Node config | LexiconRuntimeV2 |
| Node prior quota | T8 | 2 | assembly prior slots | Node | not Python D |

## Original purpose

Candidate caps exist to stop **per-span / KenLM / Assembly explosion after expansion**. They were not meant to be the domain retrieval query itself.

Current 32→8 on a mixed phonetic list is **BUDGET_OWNERSHIP_DRIFT**.

## Minimal restored budget (design only)

```
base recall (unchanged k=16)
+ selected domain-conditioned fuzzy recall (no nested 32/8)
→ UNION / surface identity dedup
→ single per-span cap (soft score; do not hard-delete the base set as a class)
```

Simulation used cap 16 and cap 8 after union: **both introduced 38/38** BASE_ABSENT targets because the domain-filtered universe is small. Do not add a domain-specific nested top-k maze.

Model `cand_budget_head` stays as P-path output. D eval today ignores it. Restoration does **not** require redefining that head.
