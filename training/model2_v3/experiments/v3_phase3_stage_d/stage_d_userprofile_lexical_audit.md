# Stage D UserProfile Lexical Audit

## Existing UserProfileV1 fields (API Gateway SSOT)

| Field | Present | Role |
|-------|---------|------|
| personal_terms | YES | ordered common / personal term surfaces |
| personal_term_evidence | YES | evidence scores for Top-K eviction |
| domain_bias | YES | sparse user domain preference weights |
| phonetic_bias | YES | Stage P (not Stage D ownership) |
| tone_bias | YES | HOLD / deferred |
| confusion_bias | YES | deferred |

## Long-term vs session

- Long-term: `personal_terms` + `personal_term_evidence` → Lexicon `term_domain_tags` → derived domain evidence
- Session: separate `session_domain_prior` (training field); must not overwrite long-term

## What UserProfile MUST NOT store

- Full term→domain mapping (Lexicon SSOT only)

## Minimal extensibility (no schema break)

Reuse existing fields; optional future:

```text
personal_term_evidence[term]  # already confidence/usage proxy
domain_bias[domain_id]        # already soft prior slot
```

No new one-term-one-domain table.
