# Prior generation pipeline (length-1)

```
single_char_dictionary.tsv
  columns: surface, pinyin, tone_pinyin, weight, frequency_rank, single_char_role, ...
    → loadSingleCharRows (full-rebuild-from-csv.mjs)
        prior_score := weight || 0.12
    → INSERT term / base_lexicon
    → promote _rebuild_candidate → node_runtime/lexicon/v3/lexicon.sqlite (bundle 13)
    → LexiconRuntimeV2 row.prior_score → hotword.priorScore
    → collectBaseOnlySingleCharCandidate (does not gate on 0.5)
    → bindLexiconHitsToWindow: drop if priorScore < minPrior(0.5)
```

Default if weight missing/invalid: **0.12** (still < 0.5).

No training. No runtime normalization. No length-specific remap.
