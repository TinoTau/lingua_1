# Electron 节点端集成总结

## 文档定位

本文件用于记录“节点端集成”做过哪些改动与能力点，**不作为最新使用指南**。

- **主文档（以代码为准）**：`../docs/electron_node/README.md`
- **平台化服务包/注册表改造总结**：`docs/PLATFORM_READY_IMPLEMENTATION_SUMMARY.md`

## ✅ 已实现的集成能力（概览）

### 1) 节点端运行时（Main Process）

- ✅ 初始化 `NodeAgent`，连接 Scheduler 并发送注册/心跳
- ✅ 初始化模型管理（Model Hub 拉取、下载/校验/安装、capability_state 计算）
- ✅ 初始化服务注册表与服务包管理（installed/current 注册表、下载与安装）
- ✅ 通过 IPC 暴露 UI 需要的能力（见 `main/src/preload.ts` 与 `main/src/ipc-handlers/*`）

### 2) UI 集成（Renderer）

- ✅ 系统资源监控面板
- ✅ 服务/模型管理面板（具体服务细节不在本文展开）
- ✅ 节点连接状态展示

## 📝 重要说明（与代码对齐）

- **开发环境启动**：需要 Vite Dev Server + Electron 两个进程配合（见主文档）
- **服务目录**：主进程的 `servicesDir` 可用 `SERVICES_DIR` 覆盖；开发模式会向上查找 `services/installed.json`
