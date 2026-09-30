# Single-Char Runtime SSOT Status

## Active SSOT (length-1 repair recall content)

**`docs/pinyin-v2/import/single_char_dictionary.tsv` (IME 2510)** mirrored into **`node_runtime/lexicon/v3` `base_lexicon`** via Full Rebuild bundleVersion **13** (2026-08-18).

This is **not** a curated independent lexical repair lexicon.

## Not SSOT / not active

| Artifact | Status |
|---|---|
| CLD Strict v1 CSV | GENERATED_ONLY — HOLD_NO_IMPORT |
| CLD Balanced v1 CSV | GENERATED_ONLY — HOLD_NO_IMPORT |
| CLD Full audit CSV | AUDIT_ONLY |
| Model2 single-char decision | RETIRED (2026-08-20) |

## Product implication

Runtime still admits the **common-character IME universe** into length-1 base recall. Wordhood filtering designed in the CLD audit package **did not land** in sqlite.
