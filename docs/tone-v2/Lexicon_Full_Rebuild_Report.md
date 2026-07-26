# Lexicon Full Rebuild Report

**Date:** 2026-07-18  
**Mode:** FULL REBUILD  
**PatchId:** `lexicon-full-rebuild-v1`  
**Status:** COMPLETE · 停止开发 · 等待验收

## Declaration

```text
本次采用 Full Rebuild。
不存在任何旧数据 Merge / Append / Upsert / Patch 残留写入。
term / term_domain_tags / domain_lexicon / base_lexicon 均由修正包重建。
domain_lexicon / routing / ngrams 由 term + term_domain_tags 重新 materialize。
base_lexicon 由 term 全量重新 materialize。
未导入 terms_to_remove_or_rebuild.csv。
```

## Sources

- `lexicon_full_corrected_review.csv`（排除 REMOVE_TERM **12** 条）
- `term_domain_tags_corrected.csv`
- `supplemental_terms.csv`（+**73** term / +**73** tag）

## Backup（重建前正式 Bundle）

- `D:\Programs\github\lingua_1\node_runtime\lexicon\v3\backup_before_full_rebuild\2026-07-18T11-23-19-934Z`
- sha256: `d98ecd41b6c5bef930709e064aabf8d161246d718d5610f922aac3fc7b5bc9be`

## Counts

| Metric | Before（正式 v8） | After（v9 rebuild） |
|--------|------------------:|--------------------:|
| term | 10000 | **10061** |
| term_domain_tags | 10092 | **1033** |
| domain_lexicon | 10100 | **1033** |
| base_lexicon | 50000 | **10061** |
| domain_hierarchy | 8 | **8** |
| industry_routing_lexicon | 10085 | **1033** |
| term_pinyin_ngrams | 220242 | **4200** |
| idiom_lexicon (untouched) | 22192 | 22192 |
| tagged terms | 9984 | **956** |
| tagless terms（合同 Base） | 16 | **9105** |

## Import / Materialize

| Item | Value |
|------|------:|
| terms imported from corrected（excl REMOVE） | 9988 |
| REMOVE_TERM excluded | 12 |
| supplemental new terms | 73 |
| tags from corrected（excl remove ids） | 960 |
| supplemental tags | 73 |
| **term after** | **10061** (=9988+73) |
| **tag after** | **1033** (=960+73) |
| domain terms rematerialized | 956 |
| domain_lexicon rows（canonical） | 1033 |
| base_lexicon rows（1:1 term） | 10061 |

## Bundle

| Item | Value |
|------|-------|
| bundleVersion | 8 → **9** |
| lastPatchId | **lexicon-full-rebuild-v1** |
| checksum | **sha256:829a3e3f8af97168073574b0db5f47c215697fb001f0a63c53fd620b962f77d5** |
| checksum.txt match | **YES** |

## domainAvailability（after）

```json
{
  "bakery": 90,
  "coffee": 107,
  "food_order": 88,
  "medical": 178,
  "meeting": 61,
  "milk_tea": 53,
  "tech_ai": 142,
  "tourism_hotel": 79,
  "tourism_pickup": 52,
  "tourism_route": 111,
  "tourism_transport": 67,
  "transport": 5
}
```

## Consistency

- domain_lexicon canonical ⊆ term_domain_tags: **PASS**（orphan=0）
- every term_domain_tags has domain_lexicon canonical: **PASS**（missing=0）
- every base_lexicon.word ∈ term.word: **PASS**
- every term has ≥1 base_lexicon row: **PASS**
- domain_hierarchy preserved: **8**

## Notes

1. `base_lexicon` 从旧 50000（外部高频物化）改为 **仅由当前 term 重建**（10061），符合「只来源于 corrected SSOT」原则。  
2. Meeting / Tech_AI inflation 已随 Full Rebuild 消除（meeting 61 / tech_ai 142）。  
3. `idiom_lexicon` 未纳入 corrected 三文件源，保持原表。  
4. 重建脚本：`electron_node/electron-node/scripts/lexicon/run-lexicon-full-rebuild.mjs`  
5. **停止开发，等待验收。**

```text
FULL REBUILD COMPLETE — STOP
Await acceptance.
```
