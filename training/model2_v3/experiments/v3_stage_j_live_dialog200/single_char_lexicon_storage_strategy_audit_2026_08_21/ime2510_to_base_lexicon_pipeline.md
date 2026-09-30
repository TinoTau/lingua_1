# IME 2510 → base_lexicon import pipeline

```
docs/pinyin-v2/import/single_char_dictionary.tsv
    (2510 IME common-character inventory; weight = IME role weight)
        |
        v
full-rebuild-from-csv.mjs :: loadSingleCharRows()
    - require length==1 CJK
    - skip if surface already in multi-char term set
    - map weight -> prior_score (default 0.12)
    - source from TSV column (common-standard-level-1+pinyin-data*)
    - tier = base; no domain tags
        |
        v
INSERT term + INSERT base_lexicon
        |
        v
bundle outDir (_rebuild_candidate) -> promote -> node_runtime/lexicon/v3
manifest.sourceInputs.singleCharSource = TSV path + recordCount 2510
bundleVersion 13 (2026-08-18 Full Rebuild)
```

## Why imported (2026-08-18)

**temporary Recall foundation / data recovery workaround** to satisfy Lattice length-1 inventory existence (0 → 2510).

Not documented as final production independent-lexical repair vocabulary.

Classification: **TEMPORARY_OR_UNJUSTIFIED_DATA_ROLE** (as Repair SSOT).
