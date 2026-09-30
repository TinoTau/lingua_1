# SingleCharRepairEligibilityV1

## INCLUDE

A character/row is eligible for Single-Character Repair Lexicon V1 when **all** hold:

1. **Wordhood:** It is an independent one-character **lexical entry** in an authorized lexicon source (here: CLD v2.1 one-character entries), not merely a common Hanzi or multi-character morpheme.
2. **Spoken/common usage gate (V1 conservative):** `FrequencySUBTL >= 10` per million **AND** `FrequencyWeibo >= 10` per million (STRICT gate).
3. **Length:** exactly one CJK character surface.
4. **Pronunciation row:** pinyin + tone metadata present and traceable to the source row.

## EXCLUDE

1. Presence only in IME 2510 / 通用规范 common-character lists without independent lexical-entry evidence.
2. FULL CLD entries failing the V1 frequency gate (EXTENDED / LOW_FREQ tiers) — audit-only.
3. Case-driven membership from dialog_200 / regressions / user corrections.
4. Homophone competition is **not** an exclusion reason.

## REVIEW

1. BALANCED-only band `[5,10)` dual-frequency: valid CLD words but not V1-default; ops may ADD later under this contract with evidence.
2. HIGH morpheme/fallback-risk overlaps (IME fallback role ∩ inventory): audit; do not auto-delete solely for role.
3. License clearance for CLD-derived redistribution before production freeze/import.

## Function-word protection

INCLUDE must **not** require “content noun/verb” POS. Particles/pronouns/directionals/numerals that pass wordhood+gate stay (的/了/吗/我/…).

## Ambiguity

pinyin+tone collision statistics measure Recall behavior only; they must not drive deletions of real words.
