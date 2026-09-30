# Lexicon Frozen Policy Reconstruction

Source: FW Repair V4 Multi-Path Lexical Lattice Implementation Contract V1.0.2+

| Length | Policy |
|--------|--------|
| 1-char | base_lexicon only; exact-first; cap=1; no domain/fuzzy/vote; target ~2000–3000 chars |
| 2–3 char | primary lexical vocabulary (base + domain) |
| 4–5 char | idiom / proper noun / necessary fixed expressions only |
| multi-domain | term_domain_tags[] multi-row; not one-term-one-domain |
| duplicates | reject duplicate lexical identities (surface/normalized/canonical) |
| pinyin/tone | required for recall indexing |

## Current data gap

- enabled length-1 rows in production sqlite: base=0, term=0
- Historical design requires general single-char base inventory; this is **FROZEN_DESIGN_DATA_MISSING**, not cancelled design.

## Authoritative general single-char source

- `docs/pinyin-v2/import/single_char_dictionary.tsv` (~2510 rows)
- Source tag: common-standard-level-1+pinyin-data (NOT dialog_200)

## Full rebuild classifier note

`v2-classify-row.mjs` rejects generic 1-char CSV rows (`one_char`). Single-char import requires
a dedicated authoritative ingest path into `base_lexicon`, not supplemental multi-char CSV rows.
