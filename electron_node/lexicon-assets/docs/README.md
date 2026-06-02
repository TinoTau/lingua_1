# Lexicon 资产与 Mock 集

**模块根：** `electron_node/lexicon-assets/`  
**生产资产包（jsonl / benchmark / gate）：** `electron_node/docs/lexicon-assets/`（导入脚本硬编码路径，勿随意移动）

## Mock 测试集（`tests/`）

| 文件 | 用途 |
|------|------|
| `restaurant_homophone.jsonl` | FW homophone 门禁（mock pipeline） |
| `false_repair_golden.jsonl` | 误修回归 |
| `tech_ai_mixed.jsonl` | 混合域样例 |
| `multi_candidate_conflict.jsonl` | 多候选冲突 |

运行：`electron-node/tests/run-fw-detector-*-acceptance.js`

## 生产资产包（`docs/lexicon-assets/`）

| 目录 | 用途 |
|------|------|
| `Lexicon_V3_5k_Canonical_Assets` | **当前生产** ~5k canonical seed |
| `Lexicon_V3_Canonical_Asset_Package` | ~1809 阶梯 seed |
| `Lexicon_Phase5_Evaluation_Package` | benchmark / gate / baseline |
| `Lexicon_1k_Pilot_Phase3_Package` | 1k pilot seed |

### 常用导入

```powershell
cd electron_node\electron-node
npm run lexicon:import-v3-5k-assets
npm run lexicon:build
npm run lexicon:rebuild-sqlite   # npm start 前
npm run lexicon:v3-gate
```

### V2 shadow（FW 默认 recall）

```powershell
cd electron_node\electron-node
npm run lexicon:build:v2-shadow
```

Seed：`data/lexicon/10k/`、`confusions.jsonl`、`hotwords.jsonl`。详见 [../docs/lexicon_v2/LEXICON_RUNTIME_V2.md](../docs/lexicon_v2/LEXICON_RUNTIME_V2.md)。

### P1.3 资产包（`docs/lexicon-assets/p1_3_*`）

- `combined_entries.jsonl`：base + idiom + common5，domains 须为 FW 四域（禁止 `general`）
- `domain_patch_zh_v2/`：可选行业 patch（如餐饮同音），不含于 combined 默认包

### Seed 约束（摘要）

- `priorScore` ∈ (0, 1]；`domains` 须在 profile-registry
- `repair_target` / `anchor` 标注影响 FW Detector（见 [PIPELINE.md](../electron-node/docs/PIPELINE.md)）
- Production **canonical-only**；无 confusion 进候选链

## 相关

- [IMPORT_CONSTRAINTS.md](./IMPORT_CONSTRAINTS.md) — V1 import 约束
- [V3_ACCEPTANCE_GATE.md](./V3_ACCEPTANCE_GATE.md) — V1 gate
- [docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md](../../../docs/lexicon-v3/Lexicon_V3_1_Final_SSOT.md) — FW v3 + Patch SSOT
- [electron-node/scripts/lexicon/README.md](../electron-node/scripts/lexicon/README.md) — 脚本命令
