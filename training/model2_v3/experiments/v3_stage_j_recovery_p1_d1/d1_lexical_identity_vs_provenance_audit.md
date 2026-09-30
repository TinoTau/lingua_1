# D1 Lexical Identity vs Provenance Audit

## Schema facts (CandidateIndexMetaV1 / Lexicon-derived)

- `term_id` format: `{term_type}:{domain_or_}:{surface}:{pinyin_key}`
- Same surface may have **multiple** records: `base:_:...` and `domain:{d}:...`
- `CandidateIndexMetaV1.resolve_surface` prefers **domain** over base
- FuzzyPool **dedups by surface**, keeping first after sort `(distance ASC, prior DESC, term_id ASC)`

## Decision

**Lexical identity** for Stage D retrieval correctness =
`StageDRetrievalTargetIdentityV1` = `(surface, pinyin_key)` from CandidateRecord.

**Provenance** (diagnostic only) = `term_id`, `term_type`, `domain_ids`.

## Why not raw term_id?

`domain:coffee:中杯:zhong|bei` and `base:_:中杯:zhong|bei` are the **same lexical item**
with different retrieval provenance. Exact term_id match conflates identity with provenance
and produces false MISS when FuzzyPool keeps the `base:` sibling.

## Why not surface-alone?

Homographs with different pinyin_key must remain distinct. Contract requires surface **and** pinyin_key.

## Production change?

**NO** FuzzyPool dedup change. Dedup is frozen pool design (one surface slot). Metric/identity
must follow lexical identity; do not add production conversion layers to chase term_id.

Contract id: `StageDRetrievalTargetIdentityV1`
