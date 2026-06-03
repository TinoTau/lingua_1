# Pinyin-IME-V1 Single Character Dictionary V2 2500

## Purpose

This file provides a production-candidate single-character dictionary for `pinyin-ime-v1`.

It is intended to solve decoder path breakage by adding controlled single-character support:

- function/time/place/measure single characters may bridge normal sentence structure;
- content single characters are fallback-oriented;
- rare single characters are excluded.

## Files

- `pinyin-ime-v1_single_char_dictionary_v2_2500.tsv`: TSV import file
- `pinyin-ime-v1_single_char_dictionary_v2_2500.csv`: CSV review file
- `pinyin-ime-v1_single_char_dictionary_v2_2500_manifest.json`: metadata and counts

## Row count

Unique characters: **2510**

## Schema

```text
dictionary_type | surface | canonical | pinyin | tone_pinyin | weight | target_boost | domain_id | is_alias | single_char_role | ime_layer | frequency_rank | source
```

## Role counts

```json
{
  "content_single_char": 698,
  "service_content_single_char": 29,
  "function_single_char": 79,
  "time_single_char": 22,
  "place_direction_single_char": 33,
  "measure_single_char": 32,
  "content_single_char_fallback": 1617
}
```

## Important constraints

Do not treat this as a second runtime dictionary. It should be imported into or exported through the existing Lexicon V3.1 management path, or used only as a pinyin-ime-v1 spike input.

Do not allow all single characters to compete equally in the main beam.

Recommended decoder behavior:

```text
function/time/place/measure single chars: low-weight bridge
content single chars: fallback
rare single chars: excluded
```

## Sources

- General Standard Chinese Characters level-1 list.
- mozillazg pinyin-data for Mandarin readings.
