# Electron Node（`electron-node`）文档（以代码为准）

本文档面向 **`electron_node/electron-node`** 这部分代码：一个 Electron 节点客户端（主进程 + 渲染进程），负责：
- 连接调度服务器（Scheduler）收任务、发心跳
- 管理本机推理能力（进程管理、模型/服务资源、健康检查）
- 提供本机 UI（资源监控、服务/模型管理等）

> 说明：本文档 **不展开每个具体 service 的安装与使用细节**；service 的实现/依赖请参考 `electron_node/services/` 及其各自文档。

## 代码位置与进程划分

- **主进程（Electron Main）**：`electron_node/electron-node/main/src/`
  - 启动窗口、初始化 `NodeAgent`、服务/模型管理器、注册 IPC
- **渲染进程（React UI）**：`electron_node/electron-node/renderer/src/`
  - 通过 `preload` 暴露的 `window.electronAPI` 调用主进程能力
- **共享协议**：`electron_node/shared/protocols/`

## 快速开始（开发环境）

### 前置要求

- **Node.js**：建议 Node 18+（Electron 28 对应的 Node 版本链路更匹配）
- （可选）你要在本机启动/调试推理能力时，再按需准备 Rust/Python 等环境（不在本文展开）

### 安装依赖

在仓库根目录下执行：

```powershell
cd electron_node/electron-node
npm install
```

### 启动（需要 2 个终端）

原因：当前代码在未打包时 `app.isPackaged=false`，主进程会认为处于开发模式并尝试加载 Vite Dev Server。

终端 A：启动 TS 增量编译 + Vite Dev Server

```powershell
cd electron_node/electron-node
npm run dev
```

终端 B：启动 Electron

```powershell
cd electron_node/electron-node
npm start
```

如果你的 Vite 端口不是 5173，可通过环境变量覆盖（主进程读取 `VITE_PORT`）：

```powershell
$env:VITE_PORT="5174"
npm start
```

## 配置（配置文件 + 环境变量）

### 配置文件（推荐）

主进程从 Electron 的 `userData` 目录读取：

- **文件名**：`electron-node-config.json`
- **实际路径**：`app.getPath('userData')/electron-node-config.json`（由 Electron 决定，不建议硬编码）

示例配置文件在仓库内：
- `electron_node/electron-node/main/electron-node-config.example.json`

配置结构（与 `main/src/node-config.ts` 一致）：

```json
{
  "servicePreferences": {
    "rustEnabled": true,
    "nmtEnabled": true,
    "ttsEnabled": true,
    "yourttsEnabled": false
  },
  "scheduler": {
    "url": "ws://127.0.0.1:5010/ws/node"
  },
  "modelHub": {
    "url": "http://127.0.0.1:5000"
  }
}
```

### 常用环境变量（按代码实际使用）

- **`SCHEDULER_URL`**：调度服务器 WebSocket URL（默认 `ws://127.0.0.1:5010/ws/node`）
- **`MODEL_HUB_URL`**：Model Hub HTTP URL（默认 `http://127.0.0.1:5000`）
- **`SERVICES_DIR`**：服务注册表/安装目录（见下文“服务目录解析”）
- **`USER_DATA`**：覆盖模型下载用的 userData 根目录（模型目录会落在 `USER_DATA/models`）
- **`INFERENCE_SERVICE_URL`**：推理服务 URL（默认 `http://localhost:5009`）
- **`INFERENCE_SERVICE_PORT`**：Rust 推理服务端口（默认 `5009`）
- **`MODELS_DIR`**：Rust 推理进程使用的模型目录（默认 `<workingDir>/models`）
- **`LOG_LEVEL`**：主进程日志级别（默认 `info`）
- **`LOG_FORMAT`**：主进程日志输出格式（`json` 默认；`pretty` 适合开发）
- **`VITE_PORT`**：开发模式下 Vite 端口（默认 `5173`）
- **`SERVICE_PACKAGE_PUBLIC_KEYS`**：服务包签名校验公钥配置（JSON 字符串，见 `service-package-manager/signature-verifier.ts`）

> 优先级说明：例如 Scheduler/ModelHub URL 的优先级为 **配置文件 > 环境变量 > 默认值**（见 `main/src/node-config.ts` 与相关调用方）。

## 路径与数据目录（非常重要）

### 服务目录解析（Service Registry / Service Packages）

主进程初始化 `ServiceRegistryManager` 时使用的服务目录（见 `main/src/index.ts`）：

1. 若设置 `SERVICES_DIR`：直接使用该路径
2. 否则在开发模式下：从 `__dirname` 向上查找，直到发现 `services/installed.json`，并使用该 `services/` 目录
3. 生产（打包）模式下：默认使用 `userData/services`

### 模型目录（ModelManager）

模型目录默认落在 `userData/models`，但可通过 `USER_DATA` 覆盖根路径（见 `main/src/model-manager/model-manager.ts`）。

### 日志目录

- **Electron 主进程日志**：`process.cwd()/logs/electron-main.log`（见 `main/src/logger.ts`）
  - 开发时通常是 `electron_node/electron-node/logs/`
- **Rust 推理服务日志（由主进程写入）**：`<projectRoot>/electron_node/services/node-inference/logs/node-inference.log`（见 `rust-service-manager/*`）

## 打包与发布（Windows/macOS/Linux）

```powershell
cd electron_node/electron-node
npm run build
npm run package:win
```

打包配置见 `electron_node/electron-node/electron-builder.yml`：
- 会额外带上 `inference-service.exe`
- 也会把部分 `services/` 内容作为 `extraFiles` 一起打包

> 注意：当前主进程在生产模式默认使用 `userData/services` 作为服务注册表目录；如果你希望直接使用“安装目录内置的 services”，需要显式设置 `SERVICES_DIR=<安装目录>/services` 或在首次启动时将安装目录的 services 初始化/拷贝到 `userData/services`（以你的发布策略为准）。

## 测试

在 `electron_node/electron-node` 下：

```powershell
npm test
npm run test:stage3.1
npm run test:stage3.2
```

## 相关实现总结/阶段文档

- `electron_node/electron-node/docs/PLATFORM_READY_IMPLEMENTATION_SUMMARY.md`（服务包平台化与注册表/包管理器实现总结）
- `electron_node/docs/PATH_STRUCTURE.md`（路径结构与解析口径，已对齐现代码）
- `electron_node/docs/electron_node/` 下其它文档多为阶段性方案/评估，阅读时请以本文与代码为准


