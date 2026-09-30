# Candidate SSOT audit

## Today

| Store | Role | Fit for FW Repair length-1? |
|-------|------|------------------------------|
| `single_char_dictionary.tsv` 2510 | IME decoder | NO as repair universe (lexical validity 2026-08-19) |
| `base_lexicon` length=1 rows | imported 2510 | operational recall inventory; not wordhood-validated |
| CLD STRICT/BALANCED/FULL CSVs | proposed independent WORD inventories | grouping audit HOLD — not import-ready; GPL LICENSE_REVIEW_REQUIRED |

## Future

Separate **Single-Char Repair Lexicon** SSOT, owned by Lexicon/Operations, distinct from IME 2510.

Model2 must consume whatever set Recall returns. It is not the SSOT and must not cache a private character list.

## Import

This audit does **not** import sqlite. Previous grouping audit: Production Import Ready = NO.
