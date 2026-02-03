# Lingua Electron Node 客户端

这是 Lingua 分布式语音翻译系统的 **Electron 节点客户端应用**（主进程 + 渲染进程）。

更完整的开发、配置与架构说明见本目录下 [docs/](docs/)（如 `docs/ARCHITECTURE.md`、`docs/CONFIGURATION.md`、`docs/TROUBLESHOOTING.md`）。

## 功能特性

- ✅ **自动启动 Rust 推理服务**：Electron 应用启动时自动启动 `inference-service.exe`
- ✅ **服务状态监控**：实时显示 Rust 服务运行状态（进程ID、端口、启动时间等）
- ✅ **日志输出**：Rust 服务的日志继续按原有方式输出到文件和控制台
- ✅ **节点管理**：连接到调度服务器，接收和处理翻译任务
- ✅ **模型管理**：下载、安装和管理 AI 模型
- ✅ **系统资源监控**：实时显示 CPU、GPU、内存使用情况

## 开发环境运行

### 前置要求

1. **安装 Node.js 依赖**：
   ```powershell
   cd electron-node
   npm install
   ```

### 启动应用

当前代码在未打包时 `app.isPackaged=false`，主进程会按开发模式加载 Vite Dev Server，因此需要 **两个终端**：

终端 A（编译主进程 TS + 启动 Vite）：

```powershell
cd electron-node
npm run dev
```

终端 B（启动 Electron）：

```powershell
cd electron-node
npm start
```

## 日志输出

### Electron 应用日志

Electron 应用的日志使用 `pino` 记录：

- **文件**：`<process.cwd()>/logs/electron-main.log`
- **格式**：由 `LOG_FORMAT` 控制（`json` 默认；`pretty` 更适合开发）

## 打包应用

### 打包 Electron 应用

```powershell
cd electron-node
npm run build
npm run package:win
```

打包后的内容由 `electron-builder.yml` 决定（包含 `inference-service.exe` 以及部分 `services/` 相关文件）。

## 配置

### 环境变量

可以通过环境变量配置服务：

- `INFERENCE_SERVICE_PORT`：推理服务端口（默认：5009）
- `SCHEDULER_URL`：调度服务器 WebSocket URL（默认：`ws://127.0.0.1:5010/ws/node`）
- `RUST_LOG`：Rust 日志级别（默认：`info`）
- `LOG_FORMAT`：日志格式（`json` 或 `pretty`，默认：`json`）
- `MODELS_DIR`：模型目录路径

## UI 界面

应用界面包含以下部分：

1. **顶部状态栏**：
   - Rust 服务状态（运行中/已停止、进程ID、端口、启动时间）
   - 节点连接状态（已连接/未连接、节点ID）

2. **左侧面板**：
   - 系统资源监控（CPU、GPU、内存使用率）

3. **右侧面板**：
   - 模型管理（查看已安装模型、下载新模型）

## 故障排查

### Rust 服务启动失败

1. 检查可执行文件是否存在：
   - 开发环境：`electron_node/services/node-inference/target/release/inference-service.exe`
   - 生产环境：`<安装目录>/inference-service.exe`

2. 检查端口是否被占用：
   - 默认端口：5009
   - 可以通过 `INFERENCE_SERVICE_PORT` 环境变量修改

3. 查看日志文件：
   - 检查 `electron_node/services/node-inference/logs/node-inference.log` 中的错误信息（开发）

### 日志文件未生成

1. 检查日志目录权限
2. 检查磁盘空间
3. 查看 Electron 应用的控制台输出

## 技术架构

- **主进程**：管理 Rust 服务进程、Node Agent、模型管理器
- **渲染进程**：React UI 界面
- **Rust 服务**：独立的推理服务进程，通过 HTTP/WebSocket 通信
- **日志系统**：
  - Rust 服务：使用 `tracing` + `file-rotate`，输出到文件和控制台
  - Electron 应用：使用 `pino`，输出到控制台

## 相关文档

- `../docs/electron_node/README.md`（主文档）
- `docs/PLATFORM_READY_IMPLEMENTATION_SUMMARY.md`
