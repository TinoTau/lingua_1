# M2M100 NMT 服务

M2M100 机器翻译服务，提供 HTTP API 接口。

## 安装

### 1. 创建虚拟环境

```powershell
cd services\nmt_m2m100
python -m venv venv
.\venv\Scripts\Activate.ps1
```

### 2. 安装依赖

```powershell
pip install -r requirements.txt
```

### 3. 配置 HuggingFace Token（可选）

如果需要从 HuggingFace Hub 下载模型，可以：

- 设置环境变量：`$env:HF_TOKEN = "your_token"`
- 或创建 `hf_token.txt` 文件，将 token 写入其中

如果模型已完全下载到本地，可以设置环境变量：
```powershell
$env:HF_LOCAL_FILES_ONLY = "true"
```

## 运行

### 方式 1: 使用启动脚本

```powershell
.\scripts\start_nmt_service.ps1
```

### 方式 2: 手动启动

```powershell
cd services\nmt_m2m100
.\venv\Scripts\Activate.ps1
uvicorn nmt_service:app --host 127.0.0.1 --port 5008
```

## API 接口

### 健康检查

```bash
GET http://127.0.0.1:5008/health
```

响应：
```json
{
  "status": "ok",
  "model": "facebook/m2m100_418M",
  "device": "cuda"
}
```

### 翻译接口

```bash
POST http://127.0.0.1:5008/v1/translate
Content-Type: application/json

{
  "src_lang": "zh",
  "tgt_lang": "en",
  "text": "你好",
  "context_text": null
}
```

响应：
```json
{
  "ok": true,
  "text": "Hello",
  "model": "facebook/m2m100_418M",
  "provider": "local-m2m100",
  "extra": {
    "elapsed_ms": 150,
    "num_tokens": 10,
    "tokenization_ms": 5,
    "generation_ms": 140,
    "decoding_ms": 5
  }
}
```

## 配置

### 环境变量

- `HF_TOKEN`: HuggingFace token（可选）
- `HF_LOCAL_FILES_ONLY`: 如果设置为 "true"，只使用本地模型文件，不进行网络请求

### 模型

默认使用 `facebook/m2m100_418M` 模型。模型会在首次运行时自动下载到 HuggingFace 缓存目录。

## 注意事项

1. **GPU 支持**: 如果系统有 CUDA GPU，服务会自动使用 GPU 加速
2. **模型加载**: 首次启动时模型加载可能需要几分钟时间
3. **内存要求**: 建议至少 8GB 内存，使用 GPU 时建议至少 4GB 显存

