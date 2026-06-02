# Lingua 项目文档

版本：v2.2.0  
**各平台文档在对应代码目录下**；本目录保留项目级决策、环境、排查与规范。

## 文档位置（按模块）

| 模块 | 文档路径 |
|------|----------|
| **公司端（调度/网关/模型库）** | `central_server/docs/` |
| **调度服务器** | `central_server/scheduler/docs/` |
| **节点端（Electron + 服务）** | `electron_node/docs/` → [electron-node/docs/](../electron_node/electron-node/docs/README.md) |
| **Web 端** | `webapp/docs/`、`webapp/web-client/docs/` |

## 本目录（docs/）内容

| 目录 | 说明 |
|------|------|
| [CODING/](./CODING/) | 代码规范、常用命令 |
| [decision/](./decision/) | 架构决策与审议 |
| [setup/](./setup/) | 环境与部署 |
| [logging/](./logging/) | 日志规范 |
| [troubleshooting/](./troubleshooting/) | 问题排查 |
| [lexicon-v3/](./lexicon-v3/) | **Lexicon V3.1** — [Lexicon_V3_1_Final_SSOT.md](./lexicon-v3/Lexicon_V3_1_Final_SSOT.md) |
| [user/](./user/) | 用户与计费 PRD |
| [reference/](./reference/) | 参考与状态对比 |
| [train/](./train/)、[trainning/](./trainning/) | 训练相关 |

## 快速开始

- **节点端主链：** [electron_node/electron-node/docs/PIPELINE.md](../electron_node/electron-node/docs/PIPELINE.md)
- **Web 客户端：** `webapp/docs/README.md`
- **调度服务器：** `central_server/docs/README.md`

## 项目结构

```
lingua_1/
├── central_server/docs/
├── electron_node/
│   ├── docs/              # 模块级（lexicon_v2、lexicon-assets）
│   └── electron-node/docs/  # 节点应用（PIPELINE、配置、聚合）
├── webapp/docs/
└── docs/                  # 本目录：规范、决策、环境、排查
```

过程性完成报告、测试报告、文档整理记录已移除；以各模块 `docs/` 内 README 为准。
