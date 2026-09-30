# Model2 V3 — Trainable User-Conditioned Retrieval Policy Contract

Markers: `MODEL2_V3_RETRIEVAL_POLICY` / `TRAINABLE_CORE_REQUIRED` / `USER_CONFIRMED`

## Frozen ownership

| Component | Owns |
|-----------|------|
| FineSpan | authoritative retrieval unit |
| UserProfile | user long-term state |
| Lexicon / FuzzyPool | lexical identity & searchable memory |
| **Trainable Model2** | **retrieval policy** (what to call, order, budget) |
| Deterministic transforms | **primitives / teacher / baseline** — NOT final architecture |

## Explicit prohibitions (without Architecture Change Proposal)

```text
DETERMINISTIC-ONLY MODEL2          = NOT APPROVED
RULE ENGINE REPLACING MODEL2       = NOT APPROVED
MODEL2_NEURAL_COMPONENT_NOT_NEEDED = SUPERSEDED (see decision record)
term_id classification             = FORBIDDEN
whole-utterance Model2 query       = FORBIDDEN
```

## What Model2 learns

```text
FineSpan + UserProfile (+ retrieval-state)
  → which primitives to invoke
  → combination / priority / budget
  → NOT which term_id to emit
```

## Deterministic role

```text
RETRIEVAL PRIMITIVE + TEACHER + BASELINE + DIAGNOSTIC ORACLE
```

Exhaustive profile expansion (B1) = high-recall / high-cost teacher baseline.  
Model2 V3 must approach B1 recall at materially lower query/candidate/latency cost.

## Architecture ID

```text
FINESPAN_USERPROFILE_TRAINABLE_RETRIEVAL_POLICY
```
