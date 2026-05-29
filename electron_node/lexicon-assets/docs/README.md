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

### Seed 约束（摘要）

- `priorScore` ∈ (0, 1]；`domains` 须在 profile-registry
- `repair_target` / `anchor` 标注影响 FW Detector（见 [FW_DETECTOR.md](../electron-node/docs/FW_DETECTOR.md)）
- Production **canonical-only**；无 confusion 进候选链

## 相关

- [electron-node/docs/LEXICON.md](../electron-node/docs/LEXICON.md) — 运行时
- [docs/lexicon-v3/](../../docs/lexicon-v3/README.md) — V3 冻结规范
