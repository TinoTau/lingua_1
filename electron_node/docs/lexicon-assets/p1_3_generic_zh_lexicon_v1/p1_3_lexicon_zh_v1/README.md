# P1.3 Generic Chinese Lexicon Seed v1

Generated: 2026-05-30T10:21:06.121161+00:00

This package contains three generic lexicon seed layers in the existing `canonical_term` JSONL format confirmed by the P1.3 audit. It is intended as input to the existing `lexicon:build` pipeline, which compiles JSONL seed entries into `lexicon.sqlite` + `manifest.json` + `checksum.txt`.

## Layers

| Layer | File | Count | Rule |
|---|---:|---:|---|
| Base | `base_zh_v1/entries.jsonl` | 50000 | 2/3-character common modern Chinese terms only |
| Idiom | `idiom_zh_v1/entries.jsonl` | 22192 | 4-character idiom layer from Jieba POS `i` |
| Common5 | `common5_zh_v1/entries.jsonl` | 897 | Generic five-character terms, separate from base |
| Combined | `combined_entries.jsonl` | 73089 | Base + idiom + common5 |

## Hard Rules Applied

- No single-character entries in base.
- Base only contains 2/3-character terms.
- Ordinary 4-character combinations are not placed in base.
- 4-character idioms are isolated in `idiom_zh_v1`.
- 5-character terms are isolated in `common5_zh_v1`.
- Per-layer pinyin bucket cap: 20 candidates.
- All entries use `type=canonical_term`.
- All entries set `repairTarget=true`, because the current FW pick path requires repair-target candidates.
- All entries use `domains=["general"]`; before runtime use, ensure `general` is a valid/enabled domain in the FW lexicon configuration, or adapt the domain strategy.

## Source

- Jieba default dictionary (`dict.txt`), MIT license.

## Important Runtime Note

The audit found the runtime does not load `entries.jsonl` directly. The production path is:

```text
entries.jsonl -> lexicon:build -> node_runtime/lexicon/current/{manifest.json, lexicon.sqlite, checksum.txt}
```

Do not place these seed files directly in `node_runtime/lexicon/current` without compiling them through the existing bundle builder.
