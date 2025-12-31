# Piper TTS 服务

Piper TTS 语音合成服务，提供 HTTP API 接口，支持中文和英文语音合成。

## 功能特性

- ✅ **Piper TTS**: 使用 Piper 进行高质量语音合成
- ✅ **Python API**: 优先使用 Python API，性能更好
- ✅ **模型缓存**: 模型缓存在内存中，提高后续请求速度
- ✅ **GPU 加速**: 支持 CUDA GPU 加速（需要 onnxruntime-gpu）
- ✅ **中文支持**: 支持中文语音合成（标准 Piper 模型和 VITS 模型）
- ✅ **多模型支持**: 支持标准 Piper 模型和 VITS 模型
- ✅ **自动模型查找**: 自动查找和匹配模型文件

## 安装

### 1. 创建虚拟环境

```powershell
cd electron_node/services/piper_tts
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### 2. 安装依赖

```powershell
pip install -r requirements.txt
```

### 3. 安装 Piper Python API（推荐）

```powershell
pip install piper-tts
```

**说明**: Python API 比命令行工具更快，支持模型缓存。

### 4. 下载模型

#### 下载中文模型

使用提供的下载脚本：

```powershell
python download_piper_chinese.py
```

模型将下载到 `models/zh/zh_CN-huayan-medium/` 目录。

#### 模型路径

模型应放置在以下位置之一：
- 默认：`electron_node/services/piper_tts/models/`
- 通过环境变量 `PIPER_MODEL_DIR` 指定
- 服务启动时通过 `--model-dir` 参数指定

## 运行

### 方式 1: 使用启动脚本

```powershell
.\scripts\start_tts_service.ps1
```

### 方式 2: 手动启动

```powershell
cd electron_node/services/piper_tts
.\venv\Scripts\Activate.ps1
python piper_http_server.py --host 127.0.0.1 --port 5006 --model-dir models
```

## API 接口

### 健康检查

```bash
GET http://127.0.0.1:5006/health
```

**响应**：
```json
{
  "status": "ok",
  "service": "piper-tts"
}
```

### 列出可用语音

```bash
GET http://127.0.0.1:5006/voices
```

**响应**：
```json
{
  "voices": [
    {
      "name": "zh_CN-huayan-medium",
      "path": "models/zh/zh_CN-huayan-medium/zh_CN-huayan-medium.onnx"
    }
  ]
}
```

### TTS 合成接口

```bash
POST http://127.0.0.1:5006/tts
Content-Type: application/json

{
  "text": "你好，世界",
  "voice": "zh_CN-huayan-medium",
  "language": "zh"
}
```

**请求参数**:
- `text`: 要合成的文本
- `voice`: 语音模型名称（如 "zh_CN-huayan-medium"）
- `language`: 语言代码（可选，如 "zh", "en"）

**响应**: WAV 格式的音频数据（`audio/wav`）

## 配置

### 环境变量

- `PIPER_MODEL_DIR`: 模型目录路径（默认: `~/piper_models`）
- `PIPER_CMD`: piper 命令行工具路径（如果不在 PATH 中）
- `PIPER_USE_GPU`: 是否启用 GPU 加速（默认: "false"）

### 模型目录结构

推荐结构：
```
models/
├── zh/
│   └── zh_CN-huayan-medium/
│       ├── zh_CN-huayan-medium.onnx
│       └── zh_CN-huayan-medium.onnx.json
└── en/
    └── en_US-lessac-medium/
        ├── en_US-lessac-medium.onnx
        └── en_US-lessac-medium.onnx.json
```

### 模型查找优先级

服务会按以下顺序查找模型：

1. **标准 Piper 模型**:
   - `{model_dir}/zh/{voice}/{voice}.onnx`
   - `{model_dir}/zh/{voice}.onnx`
   - `{model_dir}/{voice}/{voice}.onnx`
   - `{model_dir}/{voice}.onnx`

2. **VITS 模型**（备选）:
   - `{model_dir}/vits-zh-aishell3/vits-aishell3.onnx`（中文）
   - `{model_dir}/vits_en/model.onnx`（英文）

## 实现细节

### Python API vs 命令行工具

- **Python API**（推荐）:
  - 性能更好
  - 支持模型缓存
  - 支持 GPU 加速
  - 自动处理音频格式

- **命令行工具**（备选）:
  - 需要单独安装 piper 命令行工具
  - 性能较慢
  - 不支持模型缓存

### 中文 VITS 模型支持

服务支持中文 VITS 模型（`vits-zh-aishell3`）：

- 使用自定义音素化器（`chinese_phonemizer.py`）
- 使用 `lexicon.txt` 进行音素转换
- 支持特殊音素格式处理

**注意**: VITS 中文模型可能存在兼容性问题，推荐使用标准 Piper 中文模型（`zh_CN-huayan-medium`）。

### 模型缓存

使用 Python API 时，模型会被缓存在内存中：

- 首次加载模型时，会从磁盘加载
- 后续请求直接使用缓存的模型
- 提高响应速度，减少磁盘 I/O

### GPU 支持

- 自动检测 CUDA 可用性
- 需要安装 `onnxruntime-gpu`
- 通过环境变量 `PIPER_USE_GPU=true` 启用
- 日志中会显示 GPU 使用情况

### WAV 文件生成

服务自动生成标准 WAV 文件：

- 采样率：从模型配置读取（通常 22050 Hz）
- 声道：单声道
- 位深：16 bit
- 格式：PCM

## 故障排除

详见 [故障排除指南](./docs/TROUBLESHOOTING.md)

常见问题：
- 模型找不到
- 中文 VITS 模型无法生成可识别音频
- GPU 不可用
- 音频生成失败

## 注意事项

1. **GPU 支持**: 需要安装 `onnxruntime-gpu` 才能使用 GPU 加速
2. **模型缓存**: 使用 Python API 时，模型会被缓存在内存中，提高后续请求速度
3. **性能**: Python API 比命令行工具更快，推荐使用 Python API
4. **中文模型**: 推荐使用标准 Piper 中文模型（`zh_CN-huayan-medium`），VITS 模型可能存在兼容性问题
5. **模型路径**: 确保模型文件完整，包含 `.onnx` 和 `.onnx.json` 文件

## 相关文档

- [故障排除指南](./docs/TROUBLESHOOTING.md): 详细的故障排除说明

