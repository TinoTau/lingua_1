# Electron 节点客户端（`electron_node`）

Electron 节点客户端是 Lingua 系统的算力提供方，核心由 **Electron 应用（`electron-node`）** + **节点端服务/资源目录（`services/`、模型缓存等）** 组成。

## 从这里开始

- **主文档（以实际代码为准）**：`docs/electron_node/README.md`
- **Electron 应用工程（入口 README）**：`electron-node/README.md`
- **文档索引**：`docs/README.md`

> 说明：本 README 只做导航与总览；每个具体 service 的说明请直接看 `services/` 下对应目录（本文不展开）。

## 目录结构（简版）

```
electron_node/
├── electron-node/          # Electron 应用（主进程 TS + 渲染进程 React）
├── services/               # 节点端服务目录（含 installed/current 注册表等）
├── shared/                 # 跨端共享协议与类型
└── docs/                   # 文档
```
