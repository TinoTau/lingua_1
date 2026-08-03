<!-- Documentation Hierarchy Metadata
Status: **HISTORICAL**
Superseded By: CURRENT SSOT + Acceptance Records
Archive Path: docs/archive/HISTORICAL/Lexicon_Rebuild_PreImport_Audit.md
-->

> **HISTORICAL** — 非 CURRENT。阅读顺序：Framework Snapshot → `docs/current/` → Supporting → Acceptance → Archive。  
> Superseded By: CURRENT SSOT + Acceptance Records

# Lexicon Rebuild PreImport Audit

**Date:** 2026-07-18  
**Type:** Full Rebuild · Pre-Audit  
**Mode:** 正式重建前基线（以首次完整备份为准）

## Runtime Bundle

- **bundlePath (config):** `node_runtime/lexicon/v3`
- **sqlite:** `D:\Programs\github\lingua_1\node_runtime\lexicon\v3\lexicon.sqlite`
- **manifest:** `D:\Programs\github\lingua_1\node_runtime\lexicon\v3\manifest.json`
- **checksum.txt:** `D:\Programs\github\lingua_1\node_runtime\lexicon\v3\checksum.txt`

## Current Counts（重建前 · Phase1 清理前正式 Bundle）

| Table | Rows |
|-------|-----:|
| term | 10000 |
| term_domain_tags | 10092 |
| domain_lexicon | 10100 |
| base_lexicon | 50000 |
| domain_hierarchy | 8 |
| industry_routing_lexicon | 10085 |
| term_pinyin_ngrams | 220242 |
| idiom_lexicon | 22192 |

## Bundle Metadata（重建前）

| Item | Value |
|------|-------|
| bundleVersion | 8 |
| lastPatchId | lexicon-cleanup-phase1 |
| manifest.checksum | sha256:d98ecd41b6c5bef930709e064aabf8d161246d718d5610f922aac3fc7b5bc9be |
| checksum.txt | sha256:d98ecd41b6c5bef930709e064aabf8d161246d718d5610f922aac3fc7b5bc9be |
| sqlite sha256 | sha256:d98ecd41b6c5bef930709e064aabf8d161246d718d5610f922aac3fc7b5bc9be |
| checksum match | YES |

## domainAvailability（重建前）

```json
{
  "bakery": 227,
  "coffee": 407,
  "food_order": 265,
  "medical": 444,
  "meeting": 4809,
  "milk_tea": 194,
  "tech_ai": 2537,
  "tourism_hotel": 307,
  "tourism_pickup": 258,
  "tourism_route": 282,
  "tourism_transport": 247,
  "transport": 115
}
```

## Corrected Import Sources（confirmed present）

- `tmp/lexicon_corrected_review_20260718_extract/lexicon_full_corrected_review.csv`
- `tmp/lexicon_corrected_review_20260718_extract/term_domain_tags_corrected.csv`
- `tmp/lexicon_corrected_review_20260718_extract/supplemental_terms.csv`

**Will NOT import:** `terms_to_remove_or_rebuild.csv`

## Rebuild Intent

- FULL REBUILD（no merge / append / upsert of old term/tag/materialize rows）
- Clear: `term`, `term_domain_tags`, `domain_lexicon`, `base_lexicon`
- Also clear materialized orphans: `industry_routing_lexicon`, `term_pinyin_ngrams`
- Keep: `domain_hierarchy`（`idiom_lexicon` 未纳入 corrected SSOT，保持不动）

## True Pre-Rebuild Backup

- `node_runtime/lexicon/v3/backup_before_full_rebuild/2026-07-18T11-23-19-934Z`
- sqlite sha256: `d98ecd41b6c5bef930709e064aabf8d161246d718d5610f922aac3fc7b5bc9be`
