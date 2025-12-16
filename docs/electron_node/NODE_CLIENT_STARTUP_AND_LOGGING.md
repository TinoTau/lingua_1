# 节点端 Electron 客户端启动与日志说明

本文档说明节点端最终形态（Electron 客户端）的启动流程、打包结构，以及各服务的日志路径。

## 1. 节点端最终形态

- 节点端对用户暴露的最终形态是 **一个 Electron 桌面程序：Lingua Node Client**。
- 用户只需要安装并启动这个 Electron 程序，即可：
  - 在后台启动/停止 **Rust 推理服务**（`inference-service.exe`）
  - 在后台启动/停止 **Python 服务**：NMT（M2M100）、Piper TTS、YourTTS
  - 按照**上一次的功能选择**自动启动对应服务（热插拔：只启用用户勾选的能力）

## 2. 开发环境启动流程

在项目根目录：`d:\Programs\github\lingua_1`。

### 2.1 一次性准备

```powershell
cd .\electron-node
npm install
```

如果是首次构建，或者 main/renderer 改动较大，建议先执行：

```powershell
npm run build   # 等价于 tsc + vite build
```

### 2.2 本地调试启动

方式一：直接启动打包后的 main + renderer（更接近生产）

```powershell
cd .\electron-node
npm start       # 等价于 electron .
```

方式二：开发模式（main 监听编译 + renderer Vite dev server）

```powershell
cd .\electron-node
npm run dev     # main: tsc -w, renderer: vite dev
```

启动后：

- Electron 主窗体会显示节点客户端 UI
- Electron 主进程会根据服务偏好，自动在后台启动 Rust 推理服务和 Python 服务
- 所有服务日志会写入各自的 logs 目录（见下文）

## 3. Electron 打包与安装结构

### 3.1 electron-builder 配置

配置文件：`electron-node/electron-builder.yml`

关键部分：

- 主程序打包内容：
  - `main/**/*`（Electron 主进程编译后的 JS）
  - `renderer/dist/**/*`（React 前端打包产物）
- 额外打包的后端服务（相对当前仓库根目录）：
  - Rust 推理服务可执行文件：
    - `../../node-inference/target/release/inference-service.exe` → `inference-service.exe`
  - Python NMT 服务：
    - `../../services/nmt_m2m100` → `services/nmt_m2m100`
  - Piper TTS 服务：
    - `../../services/piper_tts` → `services/piper_tts`
  - YourTTS 服务：
    - `../../services/your_tts` → `services/your_tts`

### 3.2 安装后的目录结构（示意）

假设安装目录为：`C:\Program Files\Lingua Node Client`，则结构大致为：

```text
C:\Program Files\Lingua Node Client\
  Lingua Node Client.exe           # Electron 客户端
  inference-service.exe            # Rust 推理服务
  resources\...                    # Electron 资源
  services\
    nmt_m2m100\...                 # NMT 服务（Python + venv + 脚本）
    piper_tts\...                  # Piper TTS 服务
    your_tts\...                   # YourTTS 服务
  logs\
    electron-main.log              # Electron 主进程日志
```

> 约定：**所有节点端服务和日志，都以“安装路径”为根目录**，不依赖某台 PC 的绝对路径（如 `D:\...`）。

## 4. 主进程与各服务的日志路径

### 4.1 Electron 主进程（main）

实现位置：`electron-node/main/src/logger.ts`

- 日志目录：
  - 以当前进程工作目录为根目录：`<安装路径>/logs`
- 日志文件：
  - `electron-main.log`
- 格式：
  - `LOG_FORMAT=pretty` 时：
    - 控制台使用 `pino-pretty` 彩色输出
    - 同时将 JSON 日志写入 `logs/electron-main.log`
  - 其他情况（默认）：
    - 只写 JSON 日志到 `logs/electron-main.log`

### 4.2 Rust 推理服务（inference-service.exe）

实现位置：`electron-node/main/src/rust-service-manager.ts`

#### 根目录与工作目录

- 开发环境：
  - `projectRoot = <repo_root>` ≈ `d:\Programs\github\lingua_1`
  - 可执行文件：`<projectRoot>/node-inference/target/release/inference-service.exe`
  - 工作目录：`<projectRoot>/node-inference`
- 生产环境（安装后）：
  - `projectRoot = path.dirname(process.execPath)` ≈ 安装路径
  - 可执行文件：`<projectRoot>/inference-service.exe`
  - 工作目录：`<projectRoot>/node-inference`

> 无论开发还是生产，**工作目录统一为 `<根目录>/node-inference`**。

#### 日志与模型目录

- 日志目录：`<projectRoot>/node-inference/logs`
  - 日志文件：`node-inference.log`（由 Rust 内部 `file-rotate` 控制 5MB 轮转）
- 模型目录（环境变量 `MODELS_DIR` 未覆盖时）：
  - `MODELS_DIR = <projectRoot>/node-inference/models`
- 目录初始化：
  - 如果 `node-inference/`、`logs/`、`models/` 不存在，会在启动时自动创建。

### 4.3 Python NMT 服务（services/nmt_m2m100）

实现位置：`electron-node/main/src/python-service-manager.ts`

- 根目录：
  - 开发：`projectRoot = <repo_root>`
  - 生产：`projectRoot = path.dirname(process.execPath)`
- 服务目录：
  - `<projectRoot>/services/nmt_m2m100`
- 日志目录与文件：
  - 目录：`<projectRoot>/services/nmt_m2m100/logs`
  - 文件：`nmt-service.log`
- 启动方式：
  - 使用 venv 下的 `python.exe` + `uvicorn nmt_service:app`
  - `PYTHONIOENCODING = utf-8`
  - `HF_TOKEN` 从 `services/nmt_m2m100/hf_token.txt` 读取
  - `HF_LOCAL_FILES_ONLY = true`，不自动联网下载模型。

### 4.4 Piper TTS 服务（services/piper_tts）

- 服务目录：
  - `<projectRoot>/services/piper_tts`
- 日志目录与文件：
  - 目录：`<projectRoot>/services/piper_tts/logs`
  - 文件：`tts-service.log`
- 模型目录：
  - 默认：`<projectRoot>/node-inference/models/tts`
  - 可通过环境变量 `PIPER_MODEL_DIR` 覆盖。

### 4.5 YourTTS 服务（services/your_tts）

- 服务目录：
  - `<projectRoot>/services/your_tts`
- 日志目录与文件：
  - 目录：`<projectRoot>/services/your_tts/logs`
  - 文件：`yourtts-service.log`
- 模型目录：
  - 默认：`<projectRoot>/node-inference/models/tts/your_tts`
  - 可通过环境变量 `YOURTTS_MODEL_DIR` 覆盖。

## 5. 服务热插拔与自动启动

实现位置：
- Electron 主进程：`electron-node/main/src/index.ts`
- 配置：`electron-node/main/src/node-config.ts`
- UI：`electron-node/renderer/src/components/ServiceManagement.tsx`

### 5.1 用户偏好（ServicePreferences）

- 配置文件：`electron-node-config.json`（存储在用户数据目录）
- 字段：
  - `rustEnabled`: 是否自动启动 Rust 推理服务
  - `nmtEnabled`: 是否自动启动 NMT 服务
  - `ttsEnabled`: 是否自动启动 Piper TTS
  - `yourttsEnabled`: 是否自动启动 YourTTS
- 默认值：
  - `rustEnabled: true`
  - `nmtEnabled: true`
  - `ttsEnabled: true`
  - `yourttsEnabled: false`（YourTTS 资源较重，默认关闭）

### 5.2 启动行为

- Electron 启动时：
  - 读取上次保存的 `ServicePreferences`
  - 按照偏好自动启动对应服务（Rust + 各 Python 服务）
- 用户在 UI 中手动启动/停止服务后：
  - 当前运行状态会同步回 `ServicePreferences`
  - 下次启动时会按新的偏好自动启动。

> 说明：**不做自动卸载/冷启动管理**，服务是否启动完全由用户选择 + 上次状态决定，符合“热插拔”的使用场景。

## 6. 调度服务器与 Web 端日志（对比）

虽然调度服务器和 Web 前端不包含在 Electron 安装包内，但其日志路径也遵循“相对项目目录”的规范，便于部署：

- 调度服务器（Rust，`scheduler`）：
  - 启动脚本：`scripts/start_scheduler.ps1`
  - 日志目录：`<projectRoot>/scheduler/logs`
  - 日志文件：`scheduler.log`（Rust 内部使用 `file-rotate` 做 5MB 轮转）
- Web 前端（`web-client`）：
  - 启动脚本：`scripts/start_web_client.ps1`
  - 日志目录：`<projectRoot>/web-client/logs`
  - 日志文件：`web-client.log`（带时间戳 + 5MB 轮转）

## 7. 快速查找各类日志

- Electron 主进程：
  - 开发：`electron-node/logs/electron-main.log`
  - 生产：`<安装路径>/logs/electron-main.log`
- 节点 Rust 推理服务：
  - 开发：`node-inference/logs/node-inference.log`
  - 生产：`<安装路径>/node-inference/logs/node-inference.log`
- NMT 服务：`services/nmt_m2m100/logs/nmt-service.log`
- Piper TTS：`services/piper_tts/logs/tts-service.log`
- YourTTS：`services/your_tts/logs/yourtts-service.log`
- 调度服务器：`scheduler/logs/scheduler.log`
- Web 前端：`web-client/logs/web-client.log`

通过以上约定，可以在任意机器上基于**安装路径 / 项目根目录**快速定位所有节点端相关的日志文件。