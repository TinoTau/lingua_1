# Electron Node 模块文档索引

设计与运维说明已迁入各子模块 `docs/`。本目录 **仅保留词库资产数据**（jsonl / benchmark / gate）。

## 文档位置

| 模块 | 路径 |
|------|------|
| **节点应用**（FW、Recover、Lexicon、聚合） | [electron-node/docs/](../electron-node/docs/README.md) |
| **FW Detector（默认主链）** | [electron-node/docs/FW_DETECTOR.md](../electron-node/docs/FW_DETECTOR.md) |
| **Lexicon mock / 资产说明** | [lexicon-assets/docs/](../lexicon-assets/docs/README.md) |
| **词库 V3 冻结规范** | [docs/lexicon-v3/](../../docs/lexicon-v3/README.md) |
| **Python 服务** | `services/<name>/README.md` |
| **运维脚本** | [scripts/README.md](../scripts/README.md) |
| **常用命令** | [docs/CODING/常用命令](../../docs/CODING/常用命令) |

## 词库资产包（数据）

目录：[lexicon-assets/](./lexicon-assets/)

| 包 | 用途 |
|----|------|
| `Lexicon_V3_5k_Canonical_Assets` | 当前生产 5k seed |
| `Lexicon_V3_Canonical_Asset_Package` | ~1809 seed |
| `Lexicon_Phase5_Evaluation_Package` | benchmark / gate |
| `Lexicon_1k_Pilot_Phase3_Package` | 1k pilot |

导入：`cd electron-node && npm run lexicon:import-v3-5k-assets`

## 已移除

- `fw v2/` 下全部过程文档、测试报告、审计报告（已合并入 `electron-node/docs/FW_DETECTOR.md`）
- 各资产包内独立 README（已合并入 `lexicon-assets/docs/README.md`）

文档以代码为准。
