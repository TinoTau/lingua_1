# Single-Char Runtime Storage Contract

## Storage

| Field | Value |
|---|---|
| Bundle dir | `node_runtime/lexicon/v3` |
| SQLite | `node_runtime/lexicon/v3/lexicon.sqlite` |
| Manifest | `node_runtime/lexicon/v3/manifest.json` |
| schemaVersion | `lexicon-v3-runtime-v3` |
| bundleVersion | **13** |
| buildTime | 2026-08-18T03:33:16.808Z |
| checksum | sha256:eb7f6e32955c559fc2ce9faf8b46be5071bbf226beb7cb8a0713434f7ac725b7 (MATCH) |

## Table queried by length-1 collector

`base_lexicon` only.

Primary tone-exact query:

```sql
SELECT id, pinyin_key, tone_pinyin_key, word, normalized, prior_score,
       repair_target, enabled, aliases, source, canonical_word, is_alias
FROM base_lexicon
WHERE pinyin_key = ?
  AND tone_pinyin_key = ?
  AND enabled = 1
  AND length(word) = 1
ORDER BY prior_score DESC
LIMIT ?;   -- collector uses 8
```

## Content vs query filter

| Layer | What it does |
|---|---|
| LEXICON CONTENT | All enabled length=1 rows currently = IME 2510 import into `base_lexicon` |
| RUNTIME QUERY FILTER | `enabled=1`, `length(word)=1`, tone exact, base-only, prior>0, !alias, unique-only / surface-exact / fail-closed |

There is **no** wordhood / CLD / Strict membership filter in SQL or collector.

## Import provenance (manifest.sourceInputs.singleCharSource)

- path: `docs/pinyin-v2/import/single_char_dictionary.tsv`
- recordCount: 2510
- sha256: sha256:551b870598de9a4efe4f7e72fcea4dc9a8355941cabbb4a6eeaf57c41b9bf348

CLD Strict / Balanced / Full CSV packages are **not** listed in rebuild sources.
