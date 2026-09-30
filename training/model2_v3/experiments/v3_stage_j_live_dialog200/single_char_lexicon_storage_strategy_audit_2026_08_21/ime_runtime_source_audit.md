# IME runtime source audit

## Verdict

**IME Depends On SQLite Length-1: NO** (production IME V2 decode path).

## Production load path

`pinyin-ime-v2-dict-load.ts` → `loadPinyinImeV2Dictionaries`:

1. `node_runtime/pinyin-ime-v2/dict/base_dictionary.txt` (layer files)
2. domain / target layers
3. **`single_char_dictionary.tsv`** via `defaultSingleCharDictPath` (docs import or dict-dir copy)

Single-char roles (`function_single_char`, `content_single_char_fallback`, …) come from the **TSV**, not from `base_lexicon`.

Authoritative doc: `docs/pinyin-v2/DICTIONARY.md` — IME and Lexicon v3 **must not** share one data source.

## Secondary coupling (not runtime SSOT)

`export-ime-dict.mjs` / `dict-export-core.mjs` `exportPinyinImeV1Layer`:

- Reads **all** enabled `base_lexicon` rows with **no length filter** into IME base layer files.
- This is an **export tooling** path. It does **not** make SQLite the IME single-char SSOT.
- Option B rebuild of length-1 content would change next export contents unless export adds `length(word)>=2` filter (recommended hygiene; not required to keep IME single-char roles alive).

## Conclusion for storage strategy

IME isolation is already achieved by TSV SSOT. Removing mirrored 2510 rows from Repair `base_lexicon` does **not** remove IME inventory, provided `single_char_dictionary.tsv` is preserved.
