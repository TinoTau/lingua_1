# Single-char Repair SSOT proposal (storage strategy only)

## IME SSOT (unchanged)

`docs/pinyin-v2/import/single_char_dictionary.tsv` (+ exported copies under `node_runtime/pinyin-ime-v2/dict/`).

Purpose: IME decode / fallback roles. **Not** FW Repair length-1 universe.

## Repair Single-Char SSOT (proposed under Option B)

One authoritative curated source file (path TBD after list selection + license), imported **only** into `base_lexicon` / `term` length-1 via Full Rebuild.

Runtime authority for FW length-1: **sqlite `base_lexicon` length-1 rows** produced from that file.

## Dual Repair SSOT

**NO** — forbid maintaining Strict CSV + sqlite + manual lists as parallel Repair authorities.

Generated CLD/Strict/Balanced CSVs remain **GENERATED_ONLY** until one is chosen, license-cleared, and becomes the import input.

## Explicit non-goals

- Do not shrink IME 2510 TSV for Repair reasons
- Do not dual-write IME TSV into Repair after Option B cutover
- Do not invent A+B hybrid tables
