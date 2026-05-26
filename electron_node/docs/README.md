# Electron Node 模块文档索引

本目录 **仅保留词库资产数据**（jsonl / benchmark / gate）。设计与运维说明已迁入各子模块 `docs/`。

## 文档位置

| 模块 | 路径 |
|------|------|
| **节点应用**（Recover、Lexicon、聚合、配置） | [electron-node/docs/](../electron-node/docs/README.md) |
| **词库 V3 冻结规范**（仓库级） | [docs/lexicon-v3/](../../docs/lexicon-v3/README.md) |
| **Python 服务** | `services/<name>/README.md` 或 `services/<name>/docs/` |
| **运维脚本** | [scripts/README.md](../scripts/README.md) |
| **常用命令** | [docs/CODING/常用命令](../../docs/CODING/常用命令) |

## 词库资产包（数据，非设计文档）

目录：[lexicon-assets/](./lexicon-assets/)

| 包 | 用途 |
|----|------|
| `Lexicon_V3_5k_Canonical_Assets` | 当前生产 5k canonical seed（导入用） |
| `Lexicon_V3_Canonical_Asset_Package` | ~1809 阶梯 seed |
| `Lexicon_Phase5_Evaluation_Package` | benchmark / gate / baseline |
| `Lexicon_1k_Pilot_Phase3_Package` | 1k pilot seed |

导入：`cd electron-node && npm run lexicon:import-v3-5k-assets`

## 已移除

- 历史测试报告、开发报告、只读审计（与当前代码重复的 v2/v3/v5 过程文档）
- 过期 confusion / Phase4B 方案正文（runtime 已 canonical-only）

文档以代码为准。
