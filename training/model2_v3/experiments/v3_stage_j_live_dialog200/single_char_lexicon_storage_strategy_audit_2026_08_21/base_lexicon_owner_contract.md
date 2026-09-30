# base_lexicon owner contract

## Authoritative purpose

`base_lexicon` is the **FW Repair Lexicon V3 base-tier lexical inventory**: pinyin/tone-keyed enabled terms used by Lexicon Recall (`LexiconRuntimeV2` lookup*).

Authorities:

- Schema SSOT: `electron_node/electron-node/scripts/lexicon/lib/full-rebuild-from-csv.mjs` `SCHEMA_SQL`
- FW_V4_FREEZE Data Contract: table present among lexicon tables
- Lattice CR 1.0.2+ (via Recall Foundation reports): length-1 is **base-only exact** recall into this table
- Runtime: `lexicon-runtime-v2.ts` queries `base_lexicon` for `termLength` 1–5

## Allows length-1 lexical terms?

**YES** — by frozen design, not by accident of current data.

Lattice / Recall Foundation: length-1 inventory lives in `base_lexicon` (base-only, no domain/fuzzy/vote). Empty length-1 before 2026-08-18 was classified `FROZEN_DESIGN_DATA_MISSING`, not “design excludes 1-char”.

## Not the owner of

- Pinyin-IME single-char decode inventory (`single_char_dictionary.tsv`)
- Domain-tagged terms (`domain_lexicon` / `term_domain_tags`)
- Idioms (`idiom_lexicon`)

## Current length-1 content role

**TEMPORARY_OR_UNJUSTIFIED_DATA_ROLE** as repair vocabulary:

IME 2510 was imported as Recall Foundation fill (count ~2000–3000), **not** as an authoritative independent-lexical repair word list.
