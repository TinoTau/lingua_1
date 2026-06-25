# Electron Node 文档索引

**节点应用与词库资产入口。** 各模块文档放在对应模块目录内。

## 应用与主链

| 模块 | 文档 |
|------|------|
| **Electron 节点**（架构、配置、排错） | [electron-node/docs/](../electron-node/docs/README.md) |
| Pipeline | [electron-node/main/src/pipeline/README.md](../electron-node/main/src/pipeline/README.md) |
| FW Detector | [electron-node/main/src/fw-detector/README.md](../electron-node/main/src/fw-detector/README.md) |
| Lexicon Runtime V2 | [electron-node/main/src/lexicon-v2/README.md](../electron-node/main/src/lexicon-v2/README.md) |
| Lexicon Patch V4 | [electron-node/scripts/lexicon/README.md](../electron-node/scripts/lexicon/README.md) |

## 词库资产（数据 + 运维）

| 模块 | 路径 |
|------|------|
| 资产包目录 | [lexicon-assets/](./lexicon-assets/)（生产 seed、benchmark JSONL） |
| 资产运维说明 | [lexicon-assets/docs/](../lexicon-assets/docs/README.md) |
| Industry Pack V1 | [lexicon-assets/industry_pack_v1/README.md](./lexicon-assets/industry_pack_v1/README.md) |
| Industry Pack V2 | [lexicon-assets/industry_pack_v2/README.md](./lexicon-assets/industry_pack_v2/README.md) |

## 仓库级规范

| 主题 | 路径 |
|------|------|
| Lexicon V3 SSOT | [docs/lexicon-v3/](../../docs/lexicon-v3/README.md) |
| FW 冻结 | [docs/fw-detector/freeze/FROZEN.md](../../docs/fw-detector/freeze/FROZEN.md) |
| 常用命令 | [docs/CODING/常用命令](../../docs/CODING/常用命令) |

## Python / Rust 服务

`services/<name>/README.md` 或 `services/<name>/docs/`

## 导入示例

```powershell
cd electron_node\electron-node
npm run lexicon:gate:v3-runtime
```

文档以代码为准。
