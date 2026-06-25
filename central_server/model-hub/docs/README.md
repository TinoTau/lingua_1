# Model Hub

Python FastAPI 模型库服务：元数据、文件下载、服务包索引。

| 项 | 值 |
|----|-----|
| 默认端口 | **5000** |
| 代码 | `central_server/model-hub/src/main.py` |
| 依赖 | `requirements.txt` |
| OpenAPI | `http://localhost:5000/docs` |

## 启动

```powershell
# 仓库根目录
.\scripts\start_model_hub.ps1
```

或手动：

```bash
cd central_server/model-hub
python -m venv venv && .\venv\Scripts\activate
pip install -r requirements.txt
# 可选: $env:MODELS_DIR = "D:\path\to\models"
python src/main.py
```

## API 摘要

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/api/models` | 模型列表 |
| GET | `/api/models/{model_id}` | 模型详情 |
| GET | `/storage/models/{model_id}/{version}/{file_path}` | 下载（支持 Range） |
| GET | `/api/services` | 服务包列表（Scheduler 仪表盘用） |
| GET | `/storage/services/{service_id}/{version}/{platform}/service.zip` | 服务包下载 |
| GET | `/api/model-usage/ranking` | 热门模型排行 |

服务包索引：`{MODELS_DIR}/services/services_index.json`，由 `scripts/generate_services_index.py` 生成。

## 配置

| 变量 | 说明 |
|------|------|
| `MODELS_DIR` | 模型根目录（默认 `./models`） |

目录结构：

```text
models/
  storage/{model_id}/{version}/...
  metadata.json          # 可选
  services/services_index.json
```

## 客户端集成规范

节点端模型下载、registry、缺模型上报等见 [MODEL_MANAGEMENT.md](./MODEL_MANAGEMENT.md)。

## 相关

- [../../docs/README.md](../../docs/README.md) — 中央服务索引
