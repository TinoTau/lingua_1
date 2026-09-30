# Single-Char Repair Lexicon V1 — Final Build Source Contract (FROZEN)

## Authoritative Repair SSOT (ONE)

| Item | Value |
|------|-------|
| Path | `docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv` |
| Format | TAB-separated, UTF-8 (BOM optional), **loader-native** |
| Rows | 1125 |
| Content | EXACT surface set of approved STRICT 1125 |
| Status | CREATE on implement (not generated this audit round) |

## Audit artifact (NOT build authority)

`docs/user_correction/single_char/Lingua_single_char_repair_lexicon_strict_v1.csv`
— selection provenance / frequencies. **RAW/AUDIT ONLY** after V1 TSV exists.

## Required columns (match `loadSingleCharRows`)

| Column | Required | V1 value |
|--------|----------|----------|
| `surface` | YES | one CJK char |
| `canonical` | YES | = surface |
| `pinyin` | YES | syllable **without** tone digit (e.g. `de`, `wo`) |
| `tone_pinyin` | YES | syllable **with** tone digit (e.g. `de5`, `wo3`) — derive from STRICT `pinyin` column |
| `weight` | YES | constant `0.9` (see Prior Contract) |
| `source` | YES | `single-char-repair-v1-strict` |

Do **not** include SUBTL/Weibo/tier/diagnostics in build SSOT.

## Loader contract (verified in code)

- File: `electron_node/electron-node/scripts/lexicon/lib/full-rebuild-from-csv.mjs`
- Function: `loadSingleCharRows(tsvPath, ...)`
- Delimiter: TAB
- Encoding: UTF-8, strips BOM
- Duplicate: skip duplicate `(pinyin_key, surface)` within file
- Skip if surface already in multi-char term set
- Sort: `word` then `id` localeCompare
- Term id: `slugTermId(surface, pinyinKey)` or `sc-<hash>`
- enabled: always 1 at insert
- repair_target: 0

## Injection (verified)

`runFullRebuildFromSources` → `opts.singleCharTsvPath || DEFAULT_SINGLE_CHAR_TSV()` → `loadSingleCharRows`.

Production CLI `run-lexicon-full-rebuild.mjs` does **not** pass `singleCharTsvPath` today; minimum fix = change `DEFAULT_SINGLE_CHAR_TSV()` to V1 path (or add CLI flag).

## Dual source: FORBIDDEN

Only `single_char_repair_lexicon_v1.tsv` is runtime build authority. No parallel patch JSON/CSV.
