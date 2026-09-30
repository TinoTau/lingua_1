# Model3 Error-Text Generator Design

## Pipeline (offline)

```text
Clean Corpus (baseline_v1 gt / carriers)
→ Normalize
→ Authoritative Pinyin/Tone annotate (Node pinyin-pro SSOT)
→ Eligible span select (prefer non-anchor-candidate regions for RETRY-oriented)
→ ACTIVE_SET_V1 family corruption (seeded)
→ Lexicon replacement search (base_lexicon pinyin+tone)
→ Build errorText
→ Validate + quarantine
→ Dedup
→ ERROR_TEXT_SAMPLE_V1 record
→ Group split keys
→ QA report
```

## Properties

- Deterministic + seeded
- Offline / no runtime dependency
- Stateless where practical
- **Not** a generic NLP corruption platform

## Minimum CREATE (future pilot)

| Module | Role |
|--------|------|
| `training/model3_error_text/generator/` | Orchestrator |
| corruption apply (import ACTIVE families) | Thin wrapper over existing syllable apply |
| lexicon surface resolve (sqlite readonly) | Prefer LexiconRuntime or SQL CLI |
| validators + split key assigner | QA |

## DO NOT

- Copy Model2 business decision logic
- Duplicate pinyin implementations
- Wire corruption maps into production Model3

## Corruption density V1

Primary: **0 / 1 / 2** corruptions per sentence.  
`>2` only if REAL ASR stats justify (baseline often has localized errors — default avoid mass over-corrupt).
