# Single-char polyphonic schema audit

## Can lexicon store multiple pinyin/tone for one character?

**YES at row level. NO as a nested pronunciations array on one term.**

`base_lexicon` / rebuild (`full-rebuild-from-csv.mjs`):

- `PRIMARY KEY (pinyin_key, word)`
- `tone_pinyin_key` nullable column + index `(pinyin_key, tone_pinyin_key)`

A character such as 行 can exist as two rows: `(xing, 行)` and `(hang, 行)` with distinct `tone_pinyin_key` (e.g. `xing2`, `hang2`).

`term` table similarly indexes `(pinyin_key, tone_pinyin_key)`.

## Collector behavior

Length-1 lookup is `lookupBaseByPinyinAndToneKey(key, tonePinyinKey, 1, limit)`.

It does **not** expand to other readings of the same hanzi. Polyphonic ambiguity across different pinyin is therefore **not** present in one collector group.

## Gap classification

| Item | Status |
|------|--------|
| Multi-reading storage | SUPPORTED (multi-row) |
| Nested `pronunciations[]` on one record | ABSENT — not required if multi-row is SSOT |
| Runtime union of all readings for context choice | ABSENT — `RUNTIME_POLYPHONE_UNION_NOT_IN_CONTRACT` |
| LEXICON_SCHEMA_GAP | **NO** for storage; do not change schema this round |

Proposed Model2 task should consume **the set already returned by the acoustic query**, not walk the whole lexicon for 行.
