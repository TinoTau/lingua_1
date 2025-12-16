# Piper TTS 服务

Piper TTS 语音合成服务，提供 HTTP API 接口。

## 安装

### 1. 安装 Piper（方式 1: Python API，推荐）

```powershell
pip install piper-tts
```

### 2. 安装 Piper（方式 2: 命令行工具）

从 [Piper 官方仓库](https://github.com/rhasspy/piper) 下载并安装 piper 命令行工具。

### 3. 安装服务依赖

```powershell
cd services\piper_tts
python -m venv venv  # 可选
.\venv\Scripts\Activate.ps1  # 如果使用虚拟环境
pip install -r requirements.txt
```

### 4. 下载模型

Piper 模型需要单独下载。可以从 [Piper 官方模型库](https://huggingface.co/rhasspy/piper-voices) 下载。

推荐模型：
- 中文: `zh_CN-huayan-medium`
- 英文: `en_US-lessac-medium`

模型应放置在 `~/piper_models` 目录下，或通过环境变量 `PIPER_MODEL_DIR` 指定。

## 运行

### 方式 1: 使用启动脚本

```powershell
.\scripts\start_tts_service.ps1
```

### 方式 2: 手动启动

```powershell
cd services\piper_tts
python piper_http_server.py --host 127.0.0.1 --port 5005 --model-dir ~/piper_models
```

## API 接口

### 健康检查

```bash
GET http://127.0.0.1:5005/health
```

响应：
```json
{
  "status": "ok",
  "service": "piper-tts"
}
```

### 列出可用语音

```bash
GET http://127.0.0.1:5005/voices
```

响应：
```json
{
  "voices": [
    {
      "name": "zh_CN-huayan-medium",
      "path": "C:\\Users\\...\\piper_models\\zh\\zh_CN-huayan-medium.onnx"
    }
  ]
}
```

### TTS 合成接口

```bash
POST http://127.0.0.1:5005/tts
Content-Type: application/json

{
  "text": "你好，世界",
  "voice": "zh_CN-huayan-medium",
  "language": "zh"
}
```

响应：WAV 格式的音频数据（`audio/wav`）

## 配置

### 环境变量

- `PIPER_MODEL_DIR`: 模型目录路径（默认: `~/piper_models`）
- `PIPER_CMD`: piper 命令行工具路径（如果不在 PATH 中）
- `PIPER_USE_GPU`: 是否启用 GPU 加速（默认: "false"）

### 模型目录结构

推荐结构：
```
piper_models/
├── zh/
│   └── zh_CN-huayan-medium.onnx
│   └── zh_CN-huayan-medium.onnx.json
└── en/
    └── en_US-lessac-medium.onnx
    └── en_US-lessac-medium.onnx.json
```

## 注意事项

1. **GPU 支持**: 需要安装支持 CUDA 的 ONNX Runtime 才能使用 GPU 加速
2. **模型缓存**: 使用 Python API 时，模型会被缓存在内存中，提高后续请求速度
3. **性能**: Python API 比命令行工具更快，推荐使用 Python API

