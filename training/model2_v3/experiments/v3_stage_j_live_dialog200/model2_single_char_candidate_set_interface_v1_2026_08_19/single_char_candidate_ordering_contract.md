# Candidate ordering contract

**Id:** `SINGLE_CHAR_CANDIDATE_ORDERING_CONTRACT_V1`

Sort key (all ascending, locale `en` string compare):

1. `term_id`
2. `canonical_surface` (NFC)
3. pinyin syllables joined by `|`
4. `tone_pinyin_key`

Then slice to cap **8**.

Must not depend on SQLite return order. Recall must not rank by frequency, prior, domain, or context.

Truncated SQL page (`returned >= LIMIT 8`): **empty internal set** (CR 1.0.4 uniqueness). Ambiguity is not invoked on a truncated page.
