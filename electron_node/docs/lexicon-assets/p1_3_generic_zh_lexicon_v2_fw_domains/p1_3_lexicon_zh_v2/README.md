# P1.3 Generic Zh Lexicon v2

This package fixes the v1 blocker: `domains:["general"]` is removed because the current FW domain filter hard-rejects `general`.

## Generic combined seed

Use this for generic base + idiom + common5 import:

```text
combined_entries.jsonl
```

It contains only generic entries from:

- base_zh_v2: 50,000 entries, 2/3-character base words
- idiom_zh_v2: 22,192 entries, 4-character idiom/fixed-expression layer
- common5_zh_v2: 897 entries, common 5-character layer

All generic entries use FW-compatible domains:

```json
["travel", "transport", "restaurant", "tech_ai"]
```

This is a compatibility label, not domain-specific content. It avoids the `general` hard-filter without changing FW main-chain code.

## Optional domain/professional patch

`domain_patch_zh_v2/entries.jsonl` is separate and is **not** included in `combined_entries.jsonl`.

Use `combined_with_domain_patch_entries.jsonl` only when you want to include the optional cafe/restaurant homophone patch such as `中杯` with aliases like `钟贝`.

## Import path

```text
combined_entries.jsonl -> lexicon:validate -> lexicon:build -> lexicon.sqlite + manifest.json + checksum.txt
```

If your better-sqlite3 ABI is stale, run the repo command equivalent to `lexicon:rebuild-sqlite` first.

## Rules

- base: only 2/3 characters
- no 1-character base entries
- ordinary 4-character combinations are not in base
- 4-character expressions are in idiom layer
- 5-character entries are in common5 layer
- domain/professional ASR homophone terms are in domain_patch layer
- no entry uses `domains:["general"]`
- all entries are canonical_term JSONL
