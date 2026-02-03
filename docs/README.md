# Lingua 项目文档

版本：v2.1.0  
文档已按模块归位：**各平台文档在对应代码目录下**，此处仅保留项目级与跨模块文档索引。

## 文档位置（按模块）

| 模块 | 文档路径 |
|------|----------|
| **公司端（调度/网关/模型库）** | `central_server/docs/` |
| **调度服务器（Pool、节点注册、设计）** | `central_server/scheduler/docs/`（含 `design/` 子目录） |
| **节点端（Electron + 服务）** | `electron_node/docs/`（含 `architecture/` 等） |
| **Web 端（含会议室、IOS、WebRTC）** | `webapp/docs/` |
| **Web 客户端（会话/播放/连接）** | `webapp/web-client/docs/` 及 `webapp/web-client/src/*/docs/` |

## 本目录（docs/）保留内容

- **[请从这里开始.md](./请从这里开始.md)** — 调度新架构与决策入口（若存在引用文档，可能在 `decision/` 或 `project_summaries/`）
- **decision/** — 决策与审议文档
- **changelog/** — 变更记录
- **project/** — 项目完整性、阶段说明
- **project_management/** — 硬编码清除、文档统一、Phase 报告等
- **project_summaries/** — 优化完成、SSOT、清理报告等
- **reference/** — 参考与状态对比
- **setup/** — 环境与部署
- **user/** — 用户与计费相关（PRD/可行性）
- **testing/** — 测试策略与总结
- **troubleshooting/** — 问题排查与修复说明
- **logging/** — 日志规范
- **train/** — 训练与集成测试（如近音纠错、繁体流程）
- **trainning/** — 训练相关（拼写为 trainning 的目录）

## 快速开始

- **Web 客户端**：`webapp/docs/README.md`、`webapp/web-client/docs/README.md`
- **调度服务器**：`central_server/docs/README.md`、`central_server/scheduler/docs/README.md`
- **节点端**：`electron_node/docs/README.md`

## 项目结构（代码与文档对应）

```
lingua_1/
├── central_server/          # 公司端
│   ├── docs/                # 公司端总文档（API 网关、模型库、项目阶段等）
│   └── scheduler/docs/      # 调度器文档（架构、Pool、节点注册、design/）
├── electron_node/           # 节点端
│   └── docs/                # 节点端文档（含 architecture/）
├── webapp/                  # Web 端
│   ├── docs/                # Web 总文档（会议室、IOS、WebRTC、API）
│   └── web-client/docs/     # Web 客户端入口与架构
└── docs/                    # 本目录：决策、变更、项目治理、排查、训练等
```

过期的“文档整理记录”类文件已合并或移除，具体以各模块 `docs/` 内 README 为准。
