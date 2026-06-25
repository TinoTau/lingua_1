# Central Server 文档

Rust Scheduler + API Gateway + Python Model Hub。文档以**各模块 `docs/`** 为准。

## 组件与端口

| 组件 | 路径 | 默认端口 | 文档 |
|------|------|----------|------|
| **Scheduler** | `scheduler/` | 5010 | [scheduler/docs/README.md](../scheduler/docs/README.md) |
| **API Gateway** | `api-gateway/` | 8081 | [api-gateway/docs/README.md](../api-gateway/docs/README.md) |
| **Model Hub** | `model-hub/` | 5000 | [model-hub/docs/README.md](../model-hub/docs/README.md) |

## 启动顺序

1. Model Hub → 2. Scheduler → 3. API Gateway

### Model Hub

```powershell
.\scripts\start_model_hub.ps1
# 或: cd model-hub && python src/main.py
```

### Scheduler

```powershell
.\scripts\start_scheduler.ps1
# 或: cd scheduler && cargo run --release
```

配置：`scheduler/config.toml`

### API Gateway

```bash
cd api-gateway && cargo run --release
```

配置：`api-gateway/config.toml` · API Key：`LINGUA_API_KEY`（未设置则日志打印开发用 key）

## 健康检查

```bash
curl http://localhost:5000/health   # Model Hub
curl http://localhost:5010/health   # Scheduler
curl http://localhost:8081/health   # API Gateway
```

## 测试

```bash
cd scheduler && cargo test
```

发布门禁见 [scheduler/docs/OPS.md](../scheduler/docs/OPS.md)。

## 日志

| 服务 | 位置 |
|------|------|
| Scheduler | `scheduler/logs/scheduler.log` |
| API Gateway / Model Hub | 控制台（可重定向） |

## 故障排除

- **端口占用**：`netstat -ano | findstr :5010`（Windows）
- **Rust 构建**：`cargo clean && cargo build`
- **Python 依赖**：`pip install -r requirements.txt --upgrade`
- 确保启动顺序与 `config.toml` 中 Scheduler URL 一致

冲突时以源码与 `config.toml` 为准。
