# Industry Expansion Pack V2 — 资产说明

**状态**: Full Wave draft · runtime bundle **v7** · `term=10000`

## 路径

| 文件 | 说明 |
|------|------|
| `entries.industry-pack-v2-full.jsonl` | 正式 Source Package（7483 add + 29 append） |
| `entries.candidates.raw.log.jsonl` | 候选池处理日志（含 skip/filter/dup 统计） |
| `entries.industry-pack-v2-full.generation-report.json` | 生成阶段统计 |
| `domain-theme-map.json` | 行业主题 → 已注册细域映射 |
| `SUGGESTED_NEW_DOMAINS.md` | 建议新增细域（未改 registry） |
| `patches/industry-pack-v2-full.patch.json` | Patch V4 |

## 命令（复用 V1 Builder / Importer 单链路）

```powershell
cd electron_node\electron-node
npm run lexicon:industry-pack-v2:generate
npm run lexicon:industry-pack-v2:build
node scripts/lexicon/lexicon-patch-import-v4-for-electron.mjs `
  ..\docs\lexicon-assets\industry_pack_v2\patches\industry-pack-v2-full.patch.json `
  --source-jsonl ..\docs\lexicon-assets\industry_pack_v2\entries.industry-pack-v2-full.jsonl
npm run lexicon:gate:v3-runtime
```

生成脚本可有多个（`generate-industry-pack-v2-entries.mjs`、`build_vocab_data.py` 等），**Builder / Import / Gate 仅一条冻结链路**。

下一增量 wave 须新 `patchId` + `baseVersion: 7`。
