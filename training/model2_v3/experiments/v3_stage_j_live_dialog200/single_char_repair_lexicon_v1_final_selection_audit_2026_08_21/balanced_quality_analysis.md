# BALANCED quality analysis

## Definition

CLD one-character lexical entries with FrequencySUBTL>=5 AND FrequencyWeibo>=5.

## Size

- rows: 1420
- unique characters: 1420
- BALANCED-STRICT unique chars: 295

## Strength

- Broader recall coverage for evaluation.
- Still CLD-wordhood-based (not IME 2510).

## Main precision risk

- Adds 295 mid-band characters without POS/spoken-only evidence that they are required for V1.
- Class breakdown (deterministic): {'A_clearly_useful_standalone_spoken': 118, 'B_valid_but_uncommon': 19, 'D_morpheme_dominant_or_fallback_risk': 141, 'C_written_literary_leaning': 10, 'F_uncertain': 7}
- Increases ambiguous pinyin+tone groups (326 vs STRICT 237) — measured only; not used to reject BALANCED by itself.

## Production suitable as default V1?

**NO** as first freeze — prefer STRICT simplicity unless ops later promotes specific BALANCED-only items under EligibilityV1.
