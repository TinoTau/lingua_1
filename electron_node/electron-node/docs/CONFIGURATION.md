# 配置与依赖

## 1. 节点配置文件

- **路径**：Electron `userData` / `electron-node-config.json`（如 `%APPDATA%\lingua-electron-node\`）
- **示例**：`main/electron-node-config.example.json`
- **加载**：`main/src/node-config.ts`
- **优先级**：配置文件 > 环境变量 > 代码默认值

### 1.1 常用字段

```json
{
  "scheduler": { "url": "ws://127.0.0.1:5010/ws/node" },
  "modelHub": { "url": "http://127.0.0.1:5007" },
  "servicePreferences": {
    "rustEnabled": true,
    "nmtEnabled": true,
    "ttsEnabled": true,
    "yourttsEnabled": false
  }
}
```

| 字段 | 说明 |
|------|------|
| `scheduler.url` | 调度器 WebSocket；`localhost` 在代码中规范为 `127.0.0.1` |
| `modelHub.url` | Model Hub HTTP |
| `servicePreferences.*` | 各子服务启停偏好 |

调度地址也可设环境变量 `SCHEDULER_URL`（覆盖文件）。路径固定 `/ws/node`，协议 `ws://` 或 `wss://`。

## 2. 环境变量（主进程）

| 变量 | 用途 |
|------|------|
| `SCHEDULER_URL` | 调度器 URL |
| `MODEL_HUB_URL` | Model Hub |
| `SERVICES_DIR` | 服务注册表目录 |
| `USER_DATA` | 覆盖 userData 根（模型等） |
| `INFERENCE_SERVICE_URL` / `INFERENCE_SERVICE_PORT` | Rust 推理服务 |
| `LOG_LEVEL` / `LOG_FORMAT` | 日志（`json` / `pretty`） |
| `VITE_PORT` | 开发 Vite 端口（默认 5173） |
| `PROJECT_ROOT` | 词库 bundle、domain_anchor（dist 运行建议设置） |
| `ASR_MODEL` | 默认 `medium` |
| `ASR_COMPUTE_TYPE` | 无 CUDA 时常见 `int8_float16` |
| `LEXICON_BUNDLE_PATH` | 覆盖 V3 bundle 路径 |

## 3. FW / 词库默认（摘要）

完整键表：[main/src/fw-detector/README.md](../main/src/fw-detector/README.md)。  
SSOT 测试：`tests/freeze-config-ssot.json`。

| 键 | 默认 |
|----|------|
| `asr.engine` | `fw_detector_v1` |
| `features.fwDetector.enabled` | `true` |
| `features.lexiconRuntimeV2.enabled` | `true` |
| `features.lexiconRecall.enabled` | `false` |
| `features.semanticRepair.enabled` | `false` |
| `features.phoneticCorrection.enabled` | `false` |
| `features.punctuationRestore.enabled` | `false` |
| `features.fwDetector.kenlmSubprocessTimeoutMs` | `5000` |
| `features.fwDetector.kenlmSubprocessMaxLines` | `17` |

KenLM sentence rerank 为 **batch-only subprocess**（无 serial / fallback）。详见 [`docs/fw-detector/CONFIG.md`](../../../docs/fw-detector/CONFIG.md) · [`docs/fw-detector/kenlm/KENLM_RUNTIME.md`](../../../docs/fw-detector/kenlm/KENLM_RUNTIME.md)。

运行时覆盖：userData 中 `electron-node-config.json`。

## 4. 系统依赖

### 4.1 必需

| 依赖 | 说明 |
|------|------|
| **Python 3.10+** | 各 Python 服务；安装时勾选 PATH |
| **ffmpeg** | Opus 解码（faster-whisper-vad）；**已打包**见下文 |

启动时 `dependency-checker.ts` 检查；缺失时对话框指向本文档。

### 4.2 可选（GPU）

- **CUDA 11.8+**、cuDNN：ONNX / PyTorch GPU
- 安装前用 `nvidia-smi` 确认 CUDA 版本，再按 [PyTorch 官网](https://pytorch.org/) 安装

**各服务 GPU 策略（设计）：**

| 服务 | GPU |
|------|-----|
| faster_whisper_vad | 强制 CUDA（ASR） |
| nmt_m2m100 | 强制 CUDA |
| piper_tts | 默认 GPU（服务内配置） |
| semantic_repair_en_zh | 服务内 LlamaCpp/CUDA |
| phonetic_correction_zh | **仅 CPU**（KenLM） |
| lexicon_intent_cpu | CPU |

节点通过 `cuda-env.ts` 注入 CUDA 路径；Python 依赖由各服务 `requirements.txt` + venv 管理。

## 5. FFmpeg（打包）

- 位置：`tools/ffmpeg/bin/ffmpeg.exe`（Windows）
- 打包：`electron-builder.yml` → `extraFiles`
- 运行时：`python-service-config.ts` 设置 `FFMPEG_BINARY` 与 PATH；`dependency-checker.ts` 优先打包版再回退系统 PATH
- 验证：

```powershell
cd electron_node/electron-node
.\tools\ffmpeg\bin\ffmpeg.exe -version
.\tools\ffmpeg\bin\ffmpeg.exe -codecs | Select-String "opus"
```

手动安装（仅打包不可用时）：[gyan.dev builds](https://www.gyan.dev/ffmpeg/builds/)，解压并将 `bin` 加入 PATH。

## 6. 模型路径

- 主进程：`ModelManager` 使用 userData 下 `models/`
- 子服务：见各 `service.json` 与服务 README

## 7. HTTP 超时（Task Router）

| 调用 | 超时 | 代码 |
|------|------|------|
| 语义修复 | 30s | `task-router-semantic-repair.ts` |
| TTS | 60s | `task-router-tts.ts` |
| 5016 / 5017 步骤 | 10s | `enhancement/*-step.ts` |

语义修复超时与 GPU 仲裁无关；长句可调大超时或服务端生成长度。同音纠错（5016）为 KenLM CPU，无 GPU 依赖。
