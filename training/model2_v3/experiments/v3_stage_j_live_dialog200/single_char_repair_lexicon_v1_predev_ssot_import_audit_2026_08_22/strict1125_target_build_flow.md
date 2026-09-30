# Target STRICT 1125 build flow (proposed; not executed)

```
Authoritative Repair SSOT (ONE file):
  docs/user_correction/single_char/single_char_repair_lexicon_v1.csv
  (= STRICT 1125 content, build-ready columns; see source contract)
        |
        v
full-rebuild-from-csv.mjs  (SAME pipeline)
  singleCharTsvPath / DEFAULT path -> Repair V1 SSOT
  loadSingleCharRows (reuse; minimal field-map if needed)
    - prior_score: MUST NOT use IME weight
    - prior_score: value per Prior Contract (not frozen this audit — CONTRACT_GAP)
    - source: single-char-repair-v1-strict
        |
        v
term + base_lexicon length=1 = 1125
manifest.singleCharSource.path != IME TSV
recordCount = 1125
bundleVersion++
        |
        v
node_runtime/lexicon/v3/

IME remains:
  docs/pinyin-v2/import/single_char_dictionary.tsv  (IME ONLY; not Repair input)
```

No second import pipeline. No length-1 patch tool. Prefer Full Rebuild.
