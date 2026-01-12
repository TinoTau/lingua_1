# Speaker Embedding 服务

Speaker Embedding HTTP 服务，用于提取说话者特征向量。

## 功能

- 使用 SpeechBrain ECAPA-TDNN 模型提取说话者特征向量
- 支持 GPU 加速（如果可用）
- HTTP API 接口，易于集成

## 安装

### 1. 创建虚拟环境

```powershell
cd electron_node/services/speaker_embedding
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### 2. 安装依赖

```powershell
pip install -r requirements.txt
```

### 3. 下载模型

模型会自动从 HuggingFace 下载到 `models/speaker_embedding/cache/` 目录。

首次运行时会自动下载，或使用下载脚本：

```powershell
python download_speaker_embedding_model.py
```

## 运行

### 使用 CPU

```powershell
python speaker_embedding_service.py
```

### 使用 GPU

```powershell
python speaker_embedding_service.py --gpu
```

### 自定义端口

```powershell
python speaker_embedding_service.py --port 5003 --host 127.0.0.1
```

## API

### 健康检查

```http
GET /health
```

响应：
```json
{
  "status": "ok",
  "model_loaded": true
}
```

### 提取 Embedding

```http
POST /extract
Content-Type: application/json

{
  "audio": [0.1, 0.2, ...]  # 16kHz 单声道音频数据（f32）
}
```

响应（成功）：
```json
{
  "embedding": [0.1, 0.2, ...],  # 192 维特征向量
  "dimension": 192,
  "input_samples": 16000,
  "sample_rate": 16000,
  "too_short": false,
  "use_default": false
}
```

响应（音频太短）：
```json
{
  "embedding": null,
  "too_short": true,
  "use_default": true,
  "estimated_gender": "male",
  "input_samples": 8000,
  "sample_rate": 16000,
  "message": "Audio too short (8000 samples < 16000 required), using default voice"
}
```

## 端口

默认端口：**5003**

## 模型

- **模型名称**: SpeechBrain ECAPA-TDNN
- **输出维度**: 192
- **输入要求**: 16kHz 单声道音频，至少 1 秒（16000 样本）

## 注意事项

1. 音频太短（< 1 秒）时无法提取 embedding，会返回 `use_default: true`
2. 音频太短时会尝试估计性别（基于音频能量特征）
3. 模型首次加载需要从 HuggingFace 下载，可能需要一些时间

