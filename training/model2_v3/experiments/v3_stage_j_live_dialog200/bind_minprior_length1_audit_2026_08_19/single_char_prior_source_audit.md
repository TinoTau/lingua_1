# Single-char priorScore source audit

## Source TSV

Path: `docs/pinyin-v2/import/single_char_dictionary.tsv`

Columns: `['dictionary_type', 'surface', 'canonical', 'pinyin', 'tone_pinyin', 'weight', 'target_boost', 'domain_id', 'is_alias', 'single_char_role', 'ime_layer', 'frequency_rank', 'source']`

| Field | Present |
|-------|---------|
| weight | True |
| frequency_rank | True |
| score | False |
| prior / prior_score | False |

TSV **does not** contain an operational `prior` column. It contains IME-layer `weight` plus `frequency_rank` and `single_char_role`.

TSV weight distribution: min=0.08 p50=0.08 max=0.3 unique=[0.08, 0.12, 0.14, 0.22, 0.24, 0.26, 0.3]

Roles: {'content_single_char': 698, 'service_content_single_char': 29, 'function_single_char': 79, 'time_single_char': 22, 'place_direction_single_char': 33, 'measure_single_char': 32, 'content_single_char_fallback': 1617}

## Transformation (full-rebuild-from-csv.mjs `loadSingleCharRows`)

```
weight = Number(cells[weight] || 0.12)
prior_score = finite(weight) && weight > 0 ? weight : 0.12
```

No normalization to 0–1 beyond the TSV's own scale.  
No clamp to ≥ minPrior.  
No remap onto the 0.85 Patch/CSV default.

## Multi-char contrast

CSV review terms: `prior_score` from file, else **0.9**.  
Supplemental terms: **0.9**.  
Idiom JSONL: `parsed.priorScore ?? 0.9`.

## Runtime

`lexicon-runtime-v2.ts` copies `row.prior_score` → `hotword.priorScore`.  
`bindLexiconHitsToWindow` compares that number to `minPrior` (0.5).

## Semantic meaning

| Object | Meaning |
|--------|---------|
| TSV `weight` | IME / frequency-class ranking mass (observed 0.08–0.30) |
| Operational `prior_score` (Patch/CSV) | Lexicon authority / recall ranking on a scale where default 0.85–0.9 ≥ minPrior 0.5 |
| Bind `minPrior` | Floor on operational prior before WindowCandidate materialization |

Storing IME `weight` in `prior_score` **mixes two score meanings**. The 0.08–0.30 band is therefore an **import mapping artifact**, not a sqlite clamp bug and not a hidden runtime rewrite.

## Matches which contract?

- Matches Aug-18 rebuild **code** that produced frozen inventory 2510: **YES**
- Matches July-27 operational canonical single-char prior **0.85–0.95**: **NO** (that contract was for a small connectivity whitelist, later superseded as inventory source by the 2510 TSV without remapping scores)
- Overall frozen-contract match: **UNCLEAR** (two contracts, different eras/inventories)
