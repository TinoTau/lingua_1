# Option B — Rebuild length-1 rows inside base_lexicon

## Definition

- Keep table `base_lexicon` as FW Repair lexical SSOT (including length-1).
- **Stop** importing IME `single_char_dictionary.tsv` into Repair sqlite.
- Import **curated** single-char repair vocabulary as length-1 `base_lexicon` (+ matching `term`) rows.
- Keep IME 2510 in `docs/pinyin-v2/import/single_char_dictionary.tsv` for IME only.

## Benefits

- **No new table**
- Existing collector / `lookupBaseByPinyinAndToneKey(..., termLength=1)` **fully reusable**
- Single Repair lexical SSOT for 1-char and 2+ char base terms
- Lower ops/docs/test surface
- Prior semantics can be reset at import (must not copy IME weights)
- Aligns with Lattice design: length-1 already belongs in `base_lexicon`

## Risks

- IME export tooling currently dumps all `base_lexicon` (including length-1) → next export contents change (mitigate with length filter; IME single-char roles still from TSV)
- Full rebuild pipeline today always loads DEFAULT single-char TSV → must change `loadSingleCharRows` **source path** (or gate) before rebuild
- Length-1 integration tests / acceptance expectations tied to 2510 must update
- Schema PK `(pinyin_key, word)` is **PARTIAL** for same-syllable multi-tone (pre-existing; not introduced by B)
- Must not leave IME TSV and curated list both claiming to be Repair SSOT

## Safety precondition (Rule 52)

No production consumer depends on the **IME-mirrored** length-1 rows as IME data. Confirmed: IME V2 uses TSV. Only FW length-1 Recall (intended) plus secondary export/tests depend on sqlite length-1.

## Schema reuse

**SCHEMA_REUSE_SUPPORTED** for surface, canonical, pinyin, tone, enabled, prior, source, term id, aliases.

## Collector delta

**None required** if curated rows remain in `base_lexicon` with same columns and eligibility (`enabled`, `prior>0`, length 1, non-alias).

## Fit to decision principles

Preferred: fewer tables, clearer Repair SSOT, IME TSV preserved, no dual write.
