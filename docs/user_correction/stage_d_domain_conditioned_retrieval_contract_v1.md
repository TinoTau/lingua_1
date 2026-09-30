# Stage D Domain-Conditioned Retrieval Contract V1

**Contract id:** `StageDDomainConditionedRetrievalContractV1`  
**Status:** FROZEN for train teacher / eval / future Node runtime parity  
**Date:** 2026-08-17  
**Nature:** restore original Model2 Stage D design. Not a new architecture.

Train teacher/eval and future Node runtime MAY differ in language. They MUST share this business contract.

---

## 1. Input

| Field | Source | Role |
|-------|--------|------|
| FineSpan syllables | lattice FineSpan (1–5) | phonetic query |
| selected action | ONE RetrievalPolicyV3 domain head | `domain_none` or `domain_soft:{slot}` |
| Lexicon records | Lexicon SSOT / CandidateIndex | searchable universe |
| `domain_ids` | `term_domain_tags` | universe predicate |
| base recall | existing `base_retrieve_span` FuzzyPool k=16 | unchanged |

UserProfile `long_term_domain_evidence` is Model2 **input**, not an executor default. The executor does **not** auto-select a domain from empty evidence and does **not** apply `max(0.35, selected)`.

---

## 2. Domain semantics

```
domain_soft:{slot}
  → search universe = records where slot ∈ domain_ids
  → existing FuzzyPool phonetic gates
  → domain candidate set
```

`domain_none` → **no** domain expansion. Base recall only.

Empty / missing `allowed_domain_ids` → no domain expansion.

---

## 3. Fuzzy semantics

ONE algorithm: `build_fuzzy_pool` (`training/model2/fuzzy/pool.py`).

Reused unchanged:

- distance threshold
- length delta
- syllable normalization
- surface dedup inside the pool
- phonetic / tone handling already in FuzzyPool

Optional request field: `allowed_domain_ids`.

- `None` = mixed universe (base / pronunciation path)
- non-empty = universe restricted by tag membership
- empty tuple = empty universe

No `DomainFuzzyEngineV2`. No forked `build_domain_fuzzy_pool`.

Node `queryDomainMultiRowsAtomic` remains exact lookup. It is **not** a Model2 Stage D branch.

---

## 4. Multi-tag

One term may carry multiple `domain_ids`.

A selected slot matches if it appears in **any** tag, not first-tag-only.

---

## 5. Union / soft prior

```
base_candidates
UNION
domain_candidates
→ identity dedup
→ ONE candidate budget
```

Domain **adds** candidates. It does **not** replace base. It does **not** delete other-domain base hits from the base stream.

Soft score after union (single budget, not nested 32→8):

```
score = distance - 2.5 * domain_match - 1e-4 * prior
```

`domain_match` is tag membership in the selected slot(s). This is ranking, not a hard filter.

---

## 6. Dedup identity

Lexical identity = `StageDRetrievalTargetIdentityV1` = `(surface, pinyin_key)`.

Same identity from BASE and DOMAIN appears **once**. Provenance may list both:

- `BASE_FUZZY`
- `PROFILE_DOMAIN_RETRIEVAL`

Production candidate uses authoritative lexical identity. `term_id` is provenance.

`base:` vs `domain:` `term_id` ASC preference is `NON_BLOCKING_UNJUSTIFIED_BEHAVIOR` (identity must not be lost).

---

## 7. Budget ownership

| Cap | Kind | Value | Owner |
|-----|------|------:|-------|
| Base FuzzyPool | existing base recall | 16 | `base_retrieve_span` |
| Domain FuzzyPool | `IMPLEMENTATION_SAFETY_CAP` | 256 | `build_fuzzy_pool.max_pool_size` when domain-conditioned |
| Union output | **business** single budget | 8 | `execute_domain_action.max_cands` |

Retired: nested domain pool 32 → rerank top-8.

Do not expand the final business cap to restore Stage D.

Model budget heads remain unused this round.

The safety cap must be large enough that it is not the recall bottleneck (proven on the frozen 38 BASE_ABSENT cases).

---

## 8. Failure semantics

| Case | Behavior |
|------|----------|
| `domain_none` | n_queries=0, term_ids empty, base unchanged |
| empty syllables | no domain query |
| selected slot with zero lexicon coverage | empty domain set; base remains |
| empty UserProfile | executor does not open a domain; Model2 may still emit `domain_none` |
| phonetic miss in domain universe | target not introduced; teacher = not useful |

---

## 9. Provenance

Diagnostic only. Does not create a second candidate type.

| Token | Meaning |
|-------|---------|
| `BASE_FUZZY` | present in unchanged base recall |
| `PROFILE_DOMAIN_RETRIEVAL` | present in domain-conditioned FuzzyPool |

---

## 10. Train / runtime parity

Python teacher/eval MUST call this executor (`soft_domain_retrieve` body).

Future Node runtime MUST implement the same:

FineSpan phonetic query + selected `domain_ids` + same fuzzy gates → domain candidates → UNION base → one budget.

Not: shared mixed pool + domain rerank.  
Not: exact SQL as Model2 Stage D.  
Not: dual domain recall paths.
