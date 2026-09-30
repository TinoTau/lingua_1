# Single-Char Repair Lexicon V1 — Source Contract

## Authoritative FW Repair single-char SSOT

**ONE file:** `docs/user_correction/single_char/single_char_repair_lexicon_v1.csv`

- Content = approved STRICT 1125 (Final Selection Audit 2026-08-21).
- Do not also treat `Lingua_single_char_repair_lexicon_strict_v1.csv` as a second live SSOT after cutover; that file may remain as historical generation artifact, or be replaced by the V1 filename (same bytes).
- No manual patch list, no SQLite edits, no JSON override, no runtime filter list.

## IME SSOT (separate)

`docs/pinyin-v2/import/single_char_dictionary.tsv` — IME ONLY.

## Build-ready columns (minimum)

Must supply what `base_lexicon` / `loadSingleCharRows` need (names may be aliased in loader):

| Field | Required | Notes |
|-------|----------|-------|
| surface (or word) | YES | one CJK char |
| canonical_surface | YES | usually = surface |
| pinyin | YES | syllable; tone digit optional if tone column present |
| tone / tone_pinyin | YES | digit 1–5 or tone-marked key |
| source | YES | `single-char-repair-v1-strict` |
| prior_score or import constant | YES | per Prior Contract — not IME weight |
| enabled | default 1 | |

Forbidden V1 columns: `manual_include`, `manual_exclude`, `dialog_override`, `special_case`.

Optional offline-only (not required in sqlite): CLD frequencies (for audit/prior later).

## Provenance (build source / manifest)

Record selection rule version + file sha256 in `manifest.sourceInputs.singleCharSource`. Runtime schema need not add wordhood columns.
