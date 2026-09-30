# Export tooling impact

## Runtime IME (product)

`pinyin-ime-v2-dict-load.ts` reads `single_char_dictionary.tsv` — **NOT affected** if IME TSV preserved.

## Export tool

`scripts/pinyin-ime-v2/lib/dict-export-core.mjs` → `fetchRows(db, 'base_lexicon')` with **no length filter**.

After V1 rebuild, exported IME base layer would include 1125 Repair singles unless filtered.

| | |
|--|--|
| Runtime dependency | NO (IME decode uses TSV) |
| Must fix in same development | **RECOMMENDED** (add `AND length(word) >= 2`) |
| Reason to keep 2510 mirror | **FORBIDDEN** |
