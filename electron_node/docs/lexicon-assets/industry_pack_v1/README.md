# Industry Expansion Pack V1 — JSONL SSOT

Patch-First 词库扩展资产（Framework Frozen）。

## 路径

| 文件 | 说明 |
|------|------|
| `entries.industry-pack-v1-full.jsonl` | **Full Wave SSOT**（2000 add + 7 append，bundle v6） |
| `entries.capacity-validation.jsonl` | Capacity 验证批次（387 add，bundle v5） |
| `entries.jsonl` | Wave1 pilot 词条源 |
| `word_banks/` · `word_banks_curated/` | 行业词库（curated 优先生成） |
| `package.manifest.json` | 包元数据 |
| `patches/` | Patch V4 JSON（`industry-pack-v1-full.patch.json` 等） |

## Full Wave 生成与验证

```powershell
cd electron_node\electron-node
npm run lexicon:industry-pack-v1:generate-full
npm run lexicon:industry-pack-v1:build:electron -- --patch-id industry-pack-v1-full --entries ..\docs\lexicon-assets\industry_pack_v1\entries.industry-pack-v1-full.jsonl
npm run lexicon:industry-pack-v1:full-suite
```

增量 wave 须使用**新 patchId** 且 `baseVersion` 等于当前 manifest `bundleVersion`（当前 **6**）。

## 导入（正式）

```powershell
node scripts/lexicon/lexicon-patch-import-v4-for-electron.mjs `
  ..\docs\lexicon-assets\industry_pack_v1\patches\industry-pack-v1-full.patch.json `
  --source-jsonl ..\docs\lexicon-assets\industry_pack_v1\entries.industry-pack-v1-full.jsonl
```

导入前须 `dry-run`；Runtime Gate FAIL 后禁止叠 patch。

## 字段

见 `FW_Repair_V4_Industry_Expansion_Pack_V1_Final_Development_Plan_V1.1_Addendum.md` §4。

可选 `mutation`: `add` | `append` | `auto`（默认 `auto`：sqlite 已有则 append）。

可选 `wave`: 构建时 `--wave` 过滤。

## DENY LIST

与 `EXPANSION_DENY_LIST` 8 词一致，不得自行扩展。
