# Current IME 2510 → base_lexicon build flow

```
docs/pinyin-v2/import/single_char_dictionary.tsv
  (surface, canonical, pinyin, tone_pinyin, weight, source, single_char_role, ...)
        |
        v
full-rebuild-from-csv.mjs
  DEFAULT_SINGLE_CHAR_TSV() or opts.singleCharTsvPath
  loadSingleCharRows()
    - TAB header
    - surface/canonical length==1 CJK
    - skip if surface already in multi-char term set
    - weight -> prior_score (default 0.12)
    - source column or common-standard-level-1+pinyin-data
    - id = slugTermId / sc-<hash>
        |
        v
INSERT term + INSERT base_lexicon (tier=base, no domain tags)
        |
        v
manifest.sourceInputs.singleCharSource = { path, sha256, recordCount:2510, skipped }
bundleVersion (currently 13), checksum of lexicon.sqlite
        |
        v
promote -> node_runtime/lexicon/v3/
```

Injection point (unique): `loadSingleCharRows` + default path `DEFAULT_SINGLE_CHAR_TSV`.
