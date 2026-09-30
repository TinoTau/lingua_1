# single_char_dictionary.tsv provenance

## What the file is

`docs/pinyin-v2/import/single_char_dictionary.tsv` is the **Pinyin-IME single-character inventory**, not a single-character **word** dictionary and not an ASR repair dictionary.

It was created **2026-06-02** as `pinyin-ime-v1_single_char_dictionary_v2_2500` to stop **IME decoder path breakage** by adding controlled single-character support. Archive: `docs/pinyin-v1/archive/import/` (README + manifest).

On **2026-08-18** the same file was imported into Lexicon V3 via `full-rebuild-from-csv.mjs` `loadSingleCharRows` to fill Lattice CR 1.0.2’s empty length-1 `base_lexicon` (0 → 2510). That import reused an **IME character list** as the **FW Repair length-1 recall inventory**.

## Sources (manifest)

- Characters: `shengdoushi/common-standard-chinese-characters-table` **level-1**
- Readings: `mozillazg/pinyin-data` `pinyin.txt`
- Tag: `common-standard-level-1+pinyin-data`
- Unique surfaces: **2510** (target 2500)

Generation script is **not in-repo**; only TSV + archived README/manifest remain.

## What it is not

| Hypothesis | Verdict |
|------------|---------|
| IME character inventory | **YES — original purpose** |
| Frequency list of standalone words | **NO** (`frequency_rank` = 通用规范汉字一级 **表序**) |
| Lexical / word dictionary | **NO** (no POS, no wordhood, no token freq) |
| Single-character word dictionary | **NO** |
| ASR repair dictionary | **NO** (repurposed 2026-08-18) |

README: *“This file is a pinyin-ime-v1 import candidate, not a second runtime database.”* Recommended IME behavior: function/time/place/measure = low-weight **bridge**; content = **fallback**; rare excluded.

## Weight (do not guess from the column name)

Manifest `weight_policy` is a **fixed IME decoder role table**:

| Role | N | Weight |
|------|--:|-------:|
| function_single_char | 79 | 0.30 |
| time_single_char | 22 | 0.26 |
| place_direction_single_char | 33 | 0.24 |
| measure_single_char | 32 | 0.22 |
| service_content_single_char | 29 | 0.14 |
| content_single_char | 698 | 0.12 |
| content_single_char_fallback | 1617 | 0.08 |

This is **manual/role IME prior**, not character frequency, not lexical frequency, not input probability from a corpus.

## Wordhood fields in the TSV

None: no POS, no standalone/token frequency, no dictionary identity beyond 通用规范汉字.

**CURRENT_INVENTORY_HAS_NO_WORDHOOD_EVIDENCE.**
