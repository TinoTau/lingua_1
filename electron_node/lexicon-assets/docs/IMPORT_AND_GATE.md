# Lexicon 导入约束与验收门禁

**Scope：** V1 `node_runtime/lexicon/current`（Legacy Recover）；FW 主链用 `node_runtime/lexicon/v3`。  
**脚本：** `electron-node/scripts/lexicon/` · `import-v3-canonical-asset.mjs` · `validate-seed`

---

## Seed 行约束

| 规则 | 约束 |
|------|------|
| Row type | `canonical_term` only；confusion rows 在 validate 拒绝 |
| `word` (CJK) | ≤ 5 chars（`RECALL_PREFERRED_MAX`） |
| `word` (latin) | compact ≤ 5 |
| Build max | ≤ 8 chars |
| `priorScore` | (0, 1] |
| `domains` | 须在 `data/lexicon/profile-registry.json` |
| Duplicate `word` | 合并 — 高 `priorScore` 胜；其他形 → `aliases` |
| `reviewStatus` (deploy) | `approved` \| `pending` \| `rejected` |

Package 标签映射：`pending_review` / `draft_review_required` → `approved`（`--review-status approved` 时）。

---

## Provenance（strict）

每行须含：`license` · `importBatch` · `normalizedBy` · `reviewStatus`

```json
{
  "type": "canonical_term",
  "word": "GPU",
  "domains": ["tech_ai"],
  "priorScore": 0.92,
  "source": "tech_ai_seed_v1",
  "license": "internal_or_open",
  "importBatch": "2026-05-27",
  "normalizedBy": "prepare-5k-seed",
  "reviewStatus": "approved"
}
```

CLI：`npm run lexicon:source-manager`（`validate-seed --strict`）

---

## V1 Gate（D1–D3）

| 域 | 要点 |
|----|------|
| D1 Runtime | canonical-only；无 `confusionRecallEnabled`；SQLite readonly |
| D2 Build | unknown domain fail；priorScore ∈ (0,1]；manifest checksum；strict provenance |
| D3 Benchmark | `npm run lexicon:phase5-benchmark` |

**FW v3 runtime gate：** `npm run lexicon:gate:v3-runtime`（见 [SCHEMA_V2.md](./SCHEMA_V2.md)）

---

## 命令

```powershell
cd electron_node/electron-node
npm run lexicon:import-v3-5k-assets
npm run lexicon:build:v2-shadow      # FW 默认 recall
npm run lexicon:rebuild-sqlite       # npm start 前
npm run lexicon:v3-gate
npm run lexicon:gate:v3-runtime
```

Post-import：必要时 `npm rebuild better-sqlite3`；重启 Electron node。

---

## SSOT 速查

| 场景 | SSOT |
|------|------|
| 编辑/版本 | `electron_node/docs/lexicon-assets/**/entries.jsonl` |
| FW Runtime 加载 | `node_runtime/lexicon/v3/lexicon.sqlite` + `manifest.json` |
| 合法 domain_id | `data/lexicon/profile-registry.json` |
| Schema 合约 | `scripts/lexicon/lib/build-v2-shadow-bundle.mjs` |

FW v3 + Patch 详见 [docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md](../../../docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md)。
