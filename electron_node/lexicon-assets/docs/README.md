# Lexicon 资产模块

**模块根：** `electron_node/lexicon-assets/`（mock 测试集）  
**生产资产包：** `electron_node/docs/lexicon-assets/`（导入脚本硬编码路径，勿移动）

---

## 文档

| 文档 | 说明 |
|------|------|
| [SCHEMA_V2.md](./SCHEMA_V2.md) | FW Runtime V2 五表 schema · build · gate |
| [IMPORT_AND_GATE.md](./IMPORT_AND_GATE.md) | V1 导入约束 · provenance · 验收门禁 |

**FW 算法 / Domain：** [docs/fw-detector/README.md](../../../docs/fw-detector/README.md)  
**DSU / Context Prior：** [DOMAIN_SOURCE_UNIFICATION.md](../../../docs/fw-detector/DOMAIN_SOURCE_UNIFICATION.md) · [CONTEXT_PRIOR.md](../../../docs/fw-detector/CONTEXT_PRIOR.md)

---

## Mock 测试集（`tests/`）

| 文件 | 用途 |
|------|------|
| `restaurant_homophone.jsonl` | FW homophone 门禁 |
| `false_repair_golden.jsonl` | 误修回归 |
| `tech_ai_mixed.jsonl` | 混合域样例 |
| `multi_candidate_conflict.jsonl` | 多候选冲突 |

运行：`electron-node/tests/run-fw-detector-*-acceptance.js`

---

## 生产资产包

| 目录 | 用途 |
|------|------|
| `Lexicon_V3_5k_Canonical_Assets` | **当前生产** ~5k canonical |
| `Lexicon_V3_Canonical_Asset_Package` | ~1809 阶梯 seed |
| `Lexicon_Phase5_Evaluation_Package` | benchmark / gate |
| `Lexicon_1k_Pilot_Phase3_Package` | 1k pilot |

### P1.3 整包（FW V2 shadow）

```text
electron_node/docs/lexicon-assets/p1_3_generic_zh_lexicon_v2_fw_domains/p1_3_lexicon_zh_v2/
  base_zh_v2/          ~50k
  idiom_zh_v2/         ~22k
  domain_patch_multidomain_v1/   107 条 multidomain seed
  domain_patch_zh_v2/            可选行业 patch
```

`domains` / `domain_tags` 须在 `profile-registry.json` 登记；multidomain 格式见 SCHEMA_V2 §4。

---

## 导入主链（FW）

```text
entries.jsonl  →  validate  →  lexicon:build:v2-shadow  →  lexicon:prepare:v3-runtime
  →  lexicon:gate:v3-runtime  →  lexicon:rebuild-sqlite  →  Runtime load
```

```powershell
cd electron_node/electron-node
npm run lexicon:build:v2-shadow
npm run lexicon:gate:v3-runtime
npm run lexicon:rebuild-sqlite
```

Patch 运行时：`main/src/lexicon-patch-v3/`（term-centric，不修改 `domain_hierarchy`）。

---

## 关联

| 模块 | 文档 |
|------|------|
| Lexicon V3 SSOT | [docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md](../../../docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md) |
| Lexicon Runtime V2 | [docs/lexicon_v2/LEXICON_RUNTIME_V2.md](../../docs/lexicon_v2/LEXICON_RUNTIME_V2.md) |
| 脚本命令 | [electron-node/scripts/lexicon/README.md](../electron-node/scripts/lexicon/README.md) |
| FW Lexicon 运维 | [docs/fw-detector/LEXICON_OPERATIONS.md](../../../docs/fw-detector/LEXICON_OPERATIONS.md) |
