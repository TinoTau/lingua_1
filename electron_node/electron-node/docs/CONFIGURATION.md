# 配置说明

## 主进程配置（electron-node）

- **文件**：`electron-node-config.json`，位于 Electron userData（如 `%APPDATA%\lingua-electron-node\`）。
- **示例**：`electron_node/electron-node/main/electron-node-config.example.json`。
- **优先级**：配置文件 > 环境变量 > 代码默认值。

常用字段（与 `main/src/node-config.ts` 一致）：

- `scheduler.url`：调度器 WebSocket URL（如 `ws://127.0.0.1:5010/ws/node`）。
- `modelHub.url`：Model Hub HTTP URL。
- `servicePreferences`：各服务开关（如 rustEnabled、nmtEnabled、ttsEnabled、yourttsEnabled 等）。

## 环境变量（常用）

- `SCHEDULER_URL`：调度器 URL，覆盖配置文件。
- `MODEL_HUB_URL`：Model Hub URL。
- `SERVICES_DIR`：服务注册表/安装目录；未设时开发模式会向上查找含 `services/installed.json` 的 `services/`。
- `USER_DATA`：覆盖 userData 根目录（模型等会落在其下）。
- `INFERENCE_SERVICE_URL` / `INFERENCE_SERVICE_PORT`：Rust 推理服务地址与端口。
- `LOG_LEVEL` / `LOG_FORMAT`：主进程日志级别与格式。
- `VITE_PORT`：开发模式 Vite 端口（默认 5173）。

## GPU 与 PyTorch（各 Python 服务）

- **必须 GPU**：semantic_repair_zh、semantic_repair_en（启动会检查 CUDA）。
- **可选 GPU**：nmt_m2m100、your_tts、speaker_embedding。
- **不用 PyTorch**：faster_whisper_vad（faster-whisper + onnxruntime）、piper_tts（onnxruntime）、en_normalize。

安装 CUDA 版 PyTorch 前请用 `nvidia-smi` 确认 CUDA 版本，再按 [PyTorch 官网](https://pytorch.org/) 选择对应安装命令。各服务依赖见 `electron_node/services/<服务名>/` 下文档。

## 模型路径

- 主进程模型目录默认在 userData 下（可由 `USER_DATA` 覆盖），ModelManager 使用该根路径。
- 各子服务（NMT、TTS、语义修复等）的模型路径见其 `service.json` 或各自 README。
