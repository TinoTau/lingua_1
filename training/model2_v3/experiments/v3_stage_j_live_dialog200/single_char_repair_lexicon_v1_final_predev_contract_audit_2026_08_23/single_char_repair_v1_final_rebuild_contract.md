# Single-Char Repair Lexicon V1 — Final Rebuild Contract (FROZEN)

## Strategy

**REUSE FULL REBUILD (OPTION 1)** — no length-1 patch tool.

## Before → After

| | Before | After |
|--|--------|-------|
| singleCharSource | `docs/pinyin-v2/import/single_char_dictionary.tsv` | `docs/user_correction/single_char/single_char_repair_lexicon_v1.tsv` |
| length-1 count | 2510 | 1125 |
| IME TSV in Repair | YES (wrong) | NO |

## Minimum code changes (implement phase)

1. **CREATE** `single_char_repair_lexicon_v1.tsv` (1125 rows, loader shape)
2. **MODIFY** `DEFAULT_SINGLE_CHAR_TSV()` → V1 path
3. **MODIFY** manifest `rebuild.sources` hardcoded string (metadata only, line ~862)
4. **OPTIONAL RECOMMENDED** `dict-export-core.mjs` — `length(word) >= 2` on base export

## Preserved by Full Rebuild (unchanged inputs)

- `lexicon_full_corrected_review.csv` and other full_rebuild_v1 CSVs
- idiom JSONL, profile-registry, domain tags
- length>=2 base terms: **IDENTICAL** if those sources unchanged
- domain / term_domain_tags / aliases: rebuilt from same sources — **no business change expected**

## Forbidden

- Runtime filter keeping 2510 in sqlite
- Second import pipeline
- SQLite manual edits
- IME TSV as Repair fallback (must **fail closed** if V1 missing)

## Post-rebuild acceptance

- Set equality: enabled length-1 surfaces == V1 TSV surfaces == STRICT 1125
- Net delta: -1385 rows (auxiliary; set equality is primary)
- bundleVersion bump + checksum match
- 毫/涡/皿 NOT ACTIVE
- 的/吗/我 ACTIVE
