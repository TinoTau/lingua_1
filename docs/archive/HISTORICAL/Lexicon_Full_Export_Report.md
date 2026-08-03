<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: docs/current/INDEX.md
Archive Path: docs/archive/HISTORICAL/Lexicon_Full_Export_Report.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: docs/current/INDEX.md

# Lexicon Full Export Report

**exported_at:** 2026-07-18T22:56:39  
**export_version:** v1  
**readonly:** true  
**patch_plan_used:** false  
**projection_used:** false  

## 1. Runtime Bundle Path

- **Actual Runtime V2 bundle:** `d:\Programs\github\lingua_1\node_runtime\lexicon\v3\lexicon.sqlite`
- **Config:** `features.lexiconRuntimeV2.bundlePath = node_runtime/lexicon/v3`
- **Config file:** `%APPDATA%/lingua-electron-node/electron-node-config.json`
- **Rejected alternate:** `node_runtime/lexicon/current` (different DB; not used)

## 2. Integrity

| Item | Value |
|------|-------|
| SQLite SHA256 | `d98ecd41b6c5bef930709e064aabf8d161246d718d5610f922aac3fc7b5bc9be` |
| checksum.txt | `sha256:d98ecd41b6c5bef930709e064aabf8d161246d718d5610f922aac3fc7b5bc9be` |
| SHA256 match checksum.txt | YES |
| bundleVersion | 8 |
| lastPatchId | lexicon-cleanup-phase1 |

## 3. SQLite Schema (relevant tables)

### `term`

| name | type | notnull | pk | dflt |
|------|------|--------:|---:|------|
| id | TEXT | 0 | 1 | None |
| word | TEXT | 1 | 0 | None |
| pinyin_key | TEXT | 1 | 0 | None |
| tone_pinyin_key | TEXT | 0 | 0 | None |
| prior_score | REAL | 1 | 0 | None |
| repair_target | INTEGER | 1 | 0 | None |
| enabled | INTEGER | 1 | 0 | None |
| source | TEXT | 0 | 0 | None |
| tier | TEXT | 1 | 0 | None |

### `term_domain_tags`

| name | type | notnull | pk | dflt |
|------|------|--------:|---:|------|
| term_id | TEXT | 1 | 1 | None |
| domain_id | TEXT | 1 | 2 | None |
| weight | REAL | 1 | 0 | None |

### `domain_lexicon`

| name | type | notnull | pk | dflt |
|------|------|--------:|---:|------|
| id | TEXT | 1 | 0 | None |
| domain_id | TEXT | 1 | 1 | None |
| pinyin_key | TEXT | 1 | 0 | None |
| tone_pinyin_key | TEXT | 0 | 0 | None |
| word | TEXT | 1 | 2 | None |
| normalized | TEXT | 1 | 0 | None |
| prior_score | REAL | 1 | 0 | None |
| repair_target | INTEGER | 1 | 0 | None |
| enabled | INTEGER | 1 | 0 | None |
| aliases | TEXT | 0 | 0 | None |
| source | TEXT | 0 | 0 | None |
| canonical_word | TEXT | 0 | 0 | None |
| is_alias | INTEGER | 1 | 0 | 0 |

### `base_lexicon`

| name | type | notnull | pk | dflt |
|------|------|--------:|---:|------|
| id | TEXT | 1 | 0 | None |
| pinyin_key | TEXT | 1 | 1 | None |
| tone_pinyin_key | TEXT | 0 | 0 | None |
| word | TEXT | 1 | 2 | None |
| normalized | TEXT | 1 | 0 | None |
| prior_score | REAL | 1 | 0 | None |
| repair_target | INTEGER | 1 | 0 | None |
| enabled | INTEGER | 1 | 0 | None |
| aliases | TEXT | 0 | 0 | None |
| source | TEXT | 0 | 0 | None |
| canonical_word | TEXT | 0 | 0 | None |
| is_alias | INTEGER | 1 | 0 | 0 |

### `domain_hierarchy`

| name | type | notnull | pk | dflt |
|------|------|--------:|---:|------|
| parent_domain_id | TEXT | 1 | 1 | None |
| child_domain_id | TEXT | 1 | 2 | None |

## 4. Row Counts

| Table | Rows |
|-------|-----:|
| term | 10000 |
| term_domain_tags | 10092 |
| domain_lexicon | 10100 |
| base_lexicon | 50000 |
| domain_hierarchy | 8 |

## 5. Logical Counts

| Metric | Value |
|--------|------:|
| term 总数（逻辑词） | 10000 |
| unique word 数 | 10000 |
| tagged term 数 | 9984 |
| tagless term 数（合同 Base） | 16 |
| tag 总行数 | 10092 |
| 多领域词数 | 68 |
| duplicate word 数 | 0 |
| base_lexicon 物化行数 | 50000 |

> **说明：** `term` 逻辑词 ≈10000；`base_lexicon` 物化检索行 ≈50000。二者不是同一粒度。

## 6. Per-domain Tag Counts (current truth)

| Domain | tag rows |
|--------|---------:|
| meeting | 4809 |
| tech_ai | 2537 |
| medical | 444 |
| coffee | 407 |
| tourism_hotel | 307 |
| tourism_route | 282 |
| food_order | 265 |
| tourism_pickup | 258 |
| tourism_transport | 247 |
| bakery | 227 |
| milk_tea | 194 |
| transport | 115 |

## 7. Hierarchy Summary

- **coarse domains:** restaurant, travel
- **fine in hierarchy:** bakery, coffee, food_order, milk_tea, tourism_hotel, tourism_pickup, tourism_route, tourism_transport
- **available fine (DISTINCT tags):** bakery, coffee, food_order, medical, meeting, milk_tea, tech_ai, tourism_hotel, tourism_pickup, tourism_route, tourism_transport, transport
- **fine not in hierarchy:** medical, meeting, tech_ai, transport
- **hierarchy covers all available fine:** False

## 8. Consistency Diff Counts

- tags ∉ domain_lexicon: **47**
- domain_lexicon ∉ tags: **43**

## 9. Export Files

| File | Rows | Bytes | SHA256 |
|------|-----:|------:|--------|
| `lexicon_terms_full.jsonl` | 10000 | 2317136 | `19fd21d5dcbd62649857a8eb7cca03baad4ba41406d59e5536551e1df4be9cee` |
| `lexicon_term_domain_tags_full.jsonl` | 10092 | 896510 | `4ace2f72b519491879dfc44bd9c1960e56f3dac09cd5639549997741e74d90dc` |
| `lexicon_term_domain_tags_full.csv` | 10092 | 442404 | `192560a3e0133b739b2e261bd85e6a213b5c63e25d3961777b51c4aa5081b078` |
| `lexicon_domain_lexicon_full.csv` | 10100 | 1903580 | `d7d516419a827200798f60e68c3e3db464a80bf53af4380cffe1274a74f17a82` |
| `lexicon_base_lexicon_full.csv` | 50000 | 7738803 | `43b701907596a8ad3ec504b690f8f7d22419da5173f21d624da29ca21308ce89` |
| `lexicon_domain_hierarchy_full.csv` | 8 | 406 | `abbc2fef8ce50b0f443f29e22a394c067d3ff94cb50e7921a92a98c33464979e` |
| `lexicon_full_joined_review.jsonl` | 10000 | 14548354 | `34ded047ed41741a86f87dd395591a9cd359537442f8601d8dfd4f4f524f3a5f` |
| `lexicon_full_joined_review.csv` | 10000 | 9138617 | `b2a853750c47c794175e2b6fa757f4f2d196ed83b87c88fce43c47916802e5d7` |
| `lexicon_duplicate_words.csv` | 0 | 65 | `c1aae1b8737fee9c534d5ab4265ac7cd5488178611cb3e81da95ac4f27fb6a37` |
| `lexicon_multi_domain_terms.csv` | 68 | 6705 | `cd53e9bacc18da2985a6445791b6a76b14a5fe2c2aac54b449b06640be072194` |
| `lexicon_tagless_terms.csv` | 16 | 1413 | `e18d3bd64f7c86f01dc864afb8ceb189ee6fd5d135e81269f0806116e57c2bd6` |
| `lexicon_tags_without_domain_lexicon.csv` | 47 | 7231 | `6592e12aa4c525b953047cec4733093a2154bfbd6668bc3632ff1c646d5c4d41` |
| `lexicon_domain_lexicon_without_tags.csv` | 43 | 16812 | `1e24d476361579f443d6912157fe805032bd870e2a0c16919dbc4012577595f9` |
| `lexicon_suspicious_term_shapes.csv` | 1087 | 123165 | `fe952c4d4e78a2f91e271c658148142ed5b053c325706c94406c4caafc4cd059` |
| `lexicon_per_domain_terms.zip` | 10092 | 164774 | `3bd3212634475f0d195ba3628554776dd3eb605d17ccab346c78ac17127a8038` |
| `lexicon_export_manifest.json` | 1 | 16905 | `9c43e3466712eb5759e384d933a63a68a0a34a3435a0935860d33fe8e550c06e` |

## 10. Declarations

1. 本轮 **未修改** 任何数据库、`term_domain_tags`、`domain_lexicon`、`base_lexicon`、Runtime、Vote、DTO、Assembly、配置、manifest、checksum。
2. 导出数据是 **当前正式 Bundle 真实状态**，**不是** `lexicon_domain_evidence_patch_plan.json` 投影结果。
3. 未使用 patch plan 作为过滤条件；未自动清洗 / 纠正 / 删除 / 补标签。
4. SQLite 以 `mode=ro` + `PRAGMA query_only=ON` 打开。

## 11. ZIP Package

- **path:** `d:\Programs\github\lingua_1\tmp\lexicon_full_export_20260718_225622.zip`
- **bytes:** 4130950
- **sha256:** `0d6748b952ea0cc94411467965d84dc620cb2b1359058351a4590abdf1684c3b`

## 12. Validation

**PASS** — all integrity checks succeeded.

```text
EXPORT COMPLETE — STOP
Await external full review.
```

---

**Final ZIP:** `d:\Programs\github\lingua_1\tmp\lexicon_full_export_20260718_225622.zip`  
**ZIP SHA256:** `c2e5d5780d0206dcdd63eaf288b3665a0a986ed3f729bb28b2ad5080367fef74`  
**ZIP bytes:** 4131233  
