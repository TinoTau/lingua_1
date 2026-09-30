# Lingua Single-Char Repair Lexicon Candidate V1

## Purpose

This package separates **single-character lexical repair words** from the existing 2510-character IME fallback inventory.

It is generated from **Chinese Lexical Database (CLD) v2.1** and does not use dialog_200 expectedText.

## Files

- `Lingua_single_char_repair_lexicon_strict_v1.csv` — recommended initial production candidate set.
- `Lingua_single_char_repair_lexicon_balanced_v1.csv` — broader validation candidate set.
- `Lingua_single_char_repair_lexicon_CLD_audit_v1.csv` — all one-character CLD entries for audit.

## Counts

- CLD one-character lexical entries: 3913
- STRICT: 1125
- BALANCED: 1420
- EXTENDED-only: 562
- LOW_FREQ_AUDIT_ONLY: 1931

## Selection policy

CLD already provides the **wordhood** evidence. The additional frequency gates are not used to decide whether a Chinese character is a word; they are only used to choose a conservative FW Repair candidate universe.

### STRICT

`FrequencySUBTL >= 10 per million` AND `FrequencyWeibo >= 10 per million`

Use this as the recommended initial repair universe.

### BALANCED

`FrequencySUBTL >= 5 per million` AND `FrequencyWeibo >= 5 per million`

Use for offline counterfactual / recall coverage evaluation.

### EXTENDED

Both frequencies >= 1 per million. Audit only initially.

### LOW_FREQ_AUDIT_ONLY

Everything else in the CLD one-character word population.

## Runtime recommendation

Do **not** replace the existing 2510-character IME inventory.

Keep two separate data responsibilities:

1. IME common-character fallback inventory — existing 2510 TSV.
2. FW Repair single-character lexical repair inventory — derived from this CLD list.

The intended FW Repair path should remain conservative:

`length=1 -> repair lexicon -> exact pinyin + exact tone -> unique candidate only -> existing lattice/assembly/KenLM`

No Model2, no fuzzy expansion, no domain expansion, no Top-K.

## Important

The STRICT/BALANCED thresholds are independent corpus-frequency gates, not dialog_200 tuning thresholds. Before production import, run an offline homophone-group and substitution-risk audit.

## License / provenance note

CLD reports release under the GNU GPL. Review the data-license implications for the intended Lingua distribution model before shipping a derived production vocabulary.
