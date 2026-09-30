# Term identity contract

## Generation (existing)

`loadSingleCharRows`:
- `id = slugTermId(surface, pinyinKey)`
- collision → `sc-<sha256(surface|pinyinKey)[:16]>`

## Rules for V1 rebuild

- Do **not** preserve old IME 2510 row ids.
- Identities regenerate from STRICT surfaces + pinyin keys.
- PK remains `(pinyin_key, word)` on `base_lexicon`.
- Matching `term` rows inserted with `tier=base`.
