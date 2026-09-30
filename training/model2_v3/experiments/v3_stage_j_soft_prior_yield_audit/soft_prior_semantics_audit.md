# Soft Domain Prior — Code Semantics

Soft prior is **frozen product semantics**. This file defines what the **current code** does, not what it should become.

Source of truth: `training/model2_v3/policy/domain_actions.py` `soft_domain_retrieve` L59–108 and `execute_domain_action` L111–154.

## Checklist (multi-select)

| Code | Meaning | Applies? | Evidence |
|------|---------|----------|----------|
| A | Add a domain query / retrieval branch | **PARTIAL** | A second `build_fuzzy_pool` call exists, but query key = **same FineSpan syllables**. No `domain_id` predicate. |
| B | Widen query scope | **NO** | Syllables, distance=2, len_delta=1 unchanged vs base. Only `max_pool_size` 16→32. |
| C | Increase candidate score (promote) | **YES** | `score = distance - 2.5 * domain_match - 1e-4 * prior` (L96) |
| D | Rerank already-returned candidates | **YES** | Rerank is over pool32 hits only (L88–99) |
| E | Affect top-k | **YES** | `ranked[:max_cands]` with max_cands=8 (L99) |
| F | Affect candidate budget allocation | **YES** | Domain output is 8 slots; n_new = those not in base 16 (L100) |
| G | Other | **YES** | `focused[selected] = max(0.35, sel)` even if evidence is 0 (L141–142); residual other domains ×0.05; **never hard-filter** (L70–73) |

## What UserProfile changes

Measured on 38 BASE_ABSENT oracle-action cases:

- Query set identical: **YES** (`pool.py` L84–85: UserProfile does not affect generation)
- Raw phonetic hits identical: **YES**
- Final top-8 identical Correct vs Empty: **37/38**
- Identity hit Correct / Empty / Wrong: **4 / 4 / 4**

Profile changes **weights on an already-built phonetic list**. It does not change the candidate universe.

## Must not conclude

Do **not** conclude that soft prior should become a hard domain filter. If yield is low, the reason is: there is no domain-conditioned recall branch, and base mixed-pool already contains the identity. That is an architecture-conflict fact, not a license to harden the prior.
