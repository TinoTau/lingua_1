# Electron Node 路径结构文档

## 项目结构

Electron Node 客户端采用统一的目录结构，所有服务都位于 `electron_node/services/` 目录下。

## 目录结构

```
electron_node/
├── electron-node/              # Electron 应用
│   ├── main/                  # 主进程代码（编译后）
│   ├── main/src/              # 主进程源代码（TypeScript）
│   │   ├── rust-service-manager.ts    # Rust 服务管理器
│   │   ├── python-service-manager.ts  # Python 服务管理器
│   │   └── ...
│   ├── renderer/              # 渲染进程代码（React）
│   ├── tests/                 # 测试文件
│   └── logs/                  # Electron 主进程日志
│
├── services/                  # 所有节点端服务（统一目录）
│   ├── node-inference/       # 节点推理服务（Rust）
│   │   ├── src/              # 源代码
│   │   ├── tests/            # 测试文件
│   │   ├── target/           # 编译输出
│   │   │   └── release/
│   │   │       └── inference-service.exe
│   │   ├── models/           # 模型文件
│   │   └── logs/             # 日志文件
│   │
│   ├── nmt_m2m100/           # NMT 服务（Python）
│   │   ├── nmt_service.py
│   │   ├── venv/             # 虚拟环境
│   │   ├── logs/             # 日志文件
│   │   └── requirements.txt
│   │
│   ├── piper_tts/            # TTS 服务（Python）
│   │   ├── piper_http_server.py
│   │   ├── venv/
│   │   ├── logs/
│   │   └── requirements.txt
│   │
│   └── your_tts/             # YourTTS 服务（Python）
│       ├── yourtts_service.py
│       ├── venv/
│       ├── logs/
│       └── requirements.txt
│
└── docs/                      # 文档
```

## 路径解析逻辑

### 开发环境

在开发环境中，服务管理器通过智能查找方式确定项目根目录：

1. **从 `process.cwd()` 向上查找**：从当前工作目录开始，向上最多查找 3 级
2. **从 `__dirname` 向上查找**：从编译后的 JS 文件位置（`electron-node/main`）开始，向上最多查找 3 级

服务管理器会检查每个候选路径是否包含 `electron_node/services/` 或 `electron_node/services/node-inference` 目录，以确认项目根目录。

**查找逻辑**：
- 收集所有候选路径（从 `cwd` 和 `__dirname` 向上查找）
- 去重后依次检查每个路径
- 第一个包含 `electron_node/services/` 目录的路径即为项目根目录
- 如果都找不到，抛出错误（不会使用默认路径，确保路径正确性）

### 服务路径

所有服务路径都基于项目根目录：

- **Rust 推理服务**:
  - 可执行文件: `<projectRoot>/electron_node/services/node-inference/target/release/inference-service.exe`
  - 工作目录: `<projectRoot>/electron_node/services/node-inference`
  - 日志目录: `<projectRoot>/electron_node/services/node-inference/logs`
  - 模型目录: `<projectRoot>/electron_node/services/node-inference/models`

- **Python NMT 服务**:
  - 服务目录: `<projectRoot>/electron_node/services/nmt_m2m100`
  - 日志目录: `<projectRoot>/electron_node/services/nmt_m2m100/logs`

- **Python TTS 服务**:
  - 服务目录: `<projectRoot>/electron_node/services/piper_tts`
  - 日志目录: `<projectRoot>/electron_node/services/piper_tts/logs`
  - 模型目录: `<projectRoot>/electron_node/services/node-inference/models/tts`

- **Python YourTTS 服务**:
  - 服务目录: `<projectRoot>/electron_node/services/your_tts`
  - 日志目录: `<projectRoot>/electron_node/services/your_tts/logs`
  - 模型目录: `<projectRoot>/electron_node/services/node-inference/models/tts/your_tts`
  - **注意**: 启动时会通过 `--model-dir` 参数明确传递模型路径

### 生产环境

在生产环境中（打包后），所有路径都基于应用安装目录：

- 项目根目录: `path.dirname(process.execPath)`
- 服务路径: 由 `electron-builder` 打包配置决定

## 环境变量

可以通过环境变量覆盖默认路径：

- `MODELS_DIR`: 覆盖模型目录路径
- `PIPER_MODEL_DIR`: 覆盖 Piper TTS 模型目录
- `YOURTTS_MODEL_DIR`: 覆盖 YourTTS 模型目录
- `INFERENCE_SERVICE_PORT`: Rust 推理服务端口（默认 5009）

## 日志路径

所有服务的日志都使用相对路径，存储在各自服务目录下的 `logs/` 文件夹：

- Electron 主进程: `electron_node/electron-node/logs/electron-main_*.log`（带时间戳）
- Rust 推理服务: `electron_node/services/node-inference/logs/node-inference.log`（5MB 自动轮转）
- NMT 服务: `electron_node/services/nmt_m2m100/logs/nmt-service.log`（追加模式）
- TTS 服务: `electron_node/services/piper_tts/logs/tts-service.log`（追加模式）
- YourTTS 服务: `electron_node/services/your_tts/logs/yourtts-service.log`（追加模式）

### 日志格式

**Python 服务日志格式**（NMT、TTS、YourTTS）：
- 统一格式：`时间戳 [级别] 内容`
- 时间戳：ISO 8601 格式（`YYYY-MM-DDTHH:mm:ss.sssZ`）
- 日志级别：智能识别 `[INFO]`、`[WARN]`、`[ERROR]`
- 按行分割，每行独立记录
- 追加模式写入，不自动轮转

**Rust 服务日志格式**：
- 使用 `file-rotate` 库，5MB 自动轮转
- 支持 JSON 格式和 pretty 格式

**Electron 主进程日志**：
- 使用 `pino` 日志库
- 支持 JSON 格式和 pretty 格式
- 带时间戳的文件名

## 相关文档

- **迁移文档**: `MIGRATION.md`
- **项目完整性**: `../PROJECT_COMPLETENESS.md`
- **启动和日志**: `electron_node/NODE_CLIENT_STARTUP_AND_LOGGING.md`
