# Option A — Separate Single-Char Repair storage (minimal)

## Definition (minimal only)

Keep IME 2510 TSV for IME. Add a **dedicated** Repair single-char table/view/source that `collectBaseOnlySingleCharCandidate` queries instead of `base_lexicon` length-1.

Not designing AmbiguityHead, KenLM, or new disambiguation.

## Benefits

- Clear ownership split if Repair metadata later diverges sharply (POS, wordhood flags, multi-tone PK)
- IME isolation explicit at table level
- Can choose PK including `tone_pinyin_key` for same-syllable heteronyms
- Safer if other unknown length-1 consumers emerge (none found in production beyond Recall + export)

## Costs

- **New table** + schemaVersion bump + migration/rebuild path
- New repository method / collector branch
- New import pipeline + ops docs + tests
- Duplicate field shapes (surface/pinyin/tone/prior/enabled) vs `base_lexicon`
- Risk of **duplicate authority** if any path still reads length-1 from `base_lexicon`
- Extra maintenance forever

## Duplicate authority risk

**HIGH** unless length-1 rows are simultaneously removed/disabled from `base_lexicon` and all queries redirected. Partial dual-write or “compat shadow” is forbidden by this audit.

## Query complexity

Requires new `lookupSingleCharRepairByPinyinAndToneKey` (or equivalent) + collector wiring. **Medium+ runtime code change.**

## Dataset compatibility

Strict/Balanced/other curated lists can import into a new table — same as Option B content-wise. Does not remove LICENSE_REVIEW_REQUIRED for CLD-derived lists.

## Fit to decision principles

Violates “don’t add a table only because single-char feels special” **unless** schema/consumer semantics are incompatible. Current evidence: they are **compatible** with `base_lexicon`.
