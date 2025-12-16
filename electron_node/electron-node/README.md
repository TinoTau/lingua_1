# Lingua Electron Node 客户端

这是 Lingua 分布式语音翻译系统的 Electron 节点客户端，集成了 Rust 推理服务。

## 功能特性

- ✅ **自动启动 Rust 推理服务**：Electron 应用启动时自动启动 `inference-service.exe`
- ✅ **服务状态监控**：实时显示 Rust 服务运行状态（进程ID、端口、启动时间等）
- ✅ **日志输出**：Rust 服务的日志继续按原有方式输出到文件和控制台
- ✅ **节点管理**：连接到调度服务器，接收和处理翻译任务
- ✅ **模型管理**：下载、安装和管理 AI 模型
- ✅ **系统资源监控**：实时显示 CPU、GPU、内存使用情况

## 开发环境运行

### 前置要求

1. **构建 Rust 服务**：
   ```powershell
   cd node-inference
   cargo build --release
   ```

2. **安装 Node.js 依赖**：
   ```powershell
   cd electron-node
   npm install
   ```

3. **编译 TypeScript**：
   ```powershell
   npm run build
   ```

### 启动应用

```powershell
npm start
```

或者使用开发模式（自动重新编译）：

```powershell
npm run dev
```

## 日志输出

### Rust 服务日志

Rust 服务的日志输出方式保持不变：

- **日志文件**：`node-inference/logs/node-inference.log`（开发环境）或 `%APPDATA%/lingua-electron-node/node-inference/logs/node-inference.log`（生产环境）
- **日志格式**：JSON 格式，包含 RFC3339 时间戳
- **日志轮转**：文件达到 5MB 时自动轮转，保留最近 5 个文件，文件名包含时间戳（格式：`node-inference.log.yyyyMMddTHHmmss`）
- **控制台输出**：INFO 级别及以上的日志会输出到控制台（简洁格式）

### Electron 应用日志

Electron 应用的日志使用 `pino` 记录：

- **开发环境**：Pretty 格式输出到控制台
- **生产环境**：JSON 格式输出到控制台

## 打包应用

### 构建 Rust 服务

首先确保 Rust 服务已构建：

```powershell
cd node-inference
cargo build --release
```

### 打包 Electron 应用

```powershell
cd electron-node
npm run build
npm run package:win
```

打包后的应用会包含：
- Electron 应用文件
- Rust 可执行文件（`inference-service.exe`）在 `resources` 目录

## 配置

### 环境变量

可以通过环境变量配置服务：

- `INFERENCE_SERVICE_PORT`：推理服务端口（默认：5009）
- `SCHEDULER_URL`：调度服务器 WebSocket URL（默认：`ws://localhost:5010/ws/node`）
- `RUST_LOG`：Rust 日志级别（默认：`info`）
- `LOG_FORMAT`：日志格式（`json` 或 `pretty`，默认：`json`）
- `MODELS_DIR`：模型目录路径

### 日志目录

- **开发环境**：`node-inference/logs/`
- **生产环境**：`%APPDATA%/lingua-electron-node/node-inference/logs/`

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
   - 开发环境：`node-inference/target/release/inference-service.exe`
   - 生产环境：`resources/inference-service.exe`

2. 检查端口是否被占用：
   - 默认端口：5009
   - 可以通过 `INFERENCE_SERVICE_PORT` 环境变量修改

3. 查看日志文件：
   - 检查 `node-inference/logs/node-inference.log` 中的错误信息

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

- [功能对比分析](../../docs/electron_node/FEATURE_COMPARISON.md) - 对比产品说明文档与当前实现的功能
- [capability_state 实现说明](../../docs/electron_node/CAPABILITY_STATE_IMPLEMENTATION.md) - capability_state 上报机制的详细实现说明
- [模块热插拔实现分析](../../docs/electron_node/MODULE_HOT_PLUG_IMPLEMENTATION.md) - 节点端功能热插拔实现状态分析
- [Stage 2.2 实现文档](../../docs/electron_node/STAGE2.2_IMPLEMENTATION.md) - Electron Node 客户端 Stage 2.2 实现文档
