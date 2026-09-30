# Lexicon Source Authority Audit

## AVAILABLE authoritative general sources

1. Single-char: `docs/pinyin-v2/import/single_char_dictionary.tsv` (2510 unique surfaces)
2. Multi-char full rebuild SSOT: `electron_node/docs/lexicon-assets/full_rebuild_v1/`
3. Idiom JSONL SSOT (full rebuild pipeline)

## INSUFFICIENT for blind AI generation

Multi-char missing targets from dialog_200 alone do NOT constitute an import list.

## dialog_200 leakage check

dialog200_seen may be true for measurement rows; general_source_supported must be true for import.
