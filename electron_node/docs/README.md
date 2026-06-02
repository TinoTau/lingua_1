# Electron Node 模块文档索引

设计与运维说明已迁入各子模块 `docs/`。本目录保留词库资产数据索引。

## 文档位置

| 模块 | 路径 |
|------|------|
| **节点应用**（架构、配置、排错） | [electron-node/docs/](../electron-node/docs/README.md) |
| **Pipeline / FW 主链** | [electron-node/main/src/pipeline/README.md](../electron-node/main/src/pipeline/README.md) |
| **Lexicon V2**（FW recall） | [lexicon_v2/](./lexicon_v2/README.md) |
| **Lexicon mock / 资产** | [lexicon-assets/docs/](../lexicon-assets/docs/README.md) |
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

文档以代码为准。
