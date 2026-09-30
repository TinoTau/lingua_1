# Model2 V2 Architecture Contract

Markers: `MODEL2_V2_RECALL` / `AUTHORITATIVE` / `SUPERSEDES_MODEL2_V1_CLOSED_SET`

## Core path

```text
ASR → FineSpan → span pronunciation + UserProfile
    → expansion controller (deterministic and/or small neural)
    → FuzzyPool / lexicon primitive
    → PROFILE_RETRIEVAL candidates → merge(term_id) → downstream
```

## Responsibilities

| Component | Owns |
|-----------|------|
| UserProfile | user-specific pronunciation/domain params |
| Lexicon / FuzzyPool | lexical identity & phonetic search |
| Model2 V2 controller | which expansion is justified for this FineSpan |
| FineSpan | authoritative retrieval unit |

## Forbidden

- whole-utterance Model2 query
- Stage A closed-set as Model2 core
- predicting `term_id` classes
- shadow fallback to V1 checkpoints
- ranking Recall@K as primary recall metric

## Legacy

`MODEL2_V1_CLOSED_SET` (Stage A/B Phase 5–7C) = **SUPERSEDED / HISTORICAL / ARCHIVE ONLY**
