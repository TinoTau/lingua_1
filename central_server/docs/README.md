# Central Server 文档

本目录仅索引 **central_server** 组件。Scheduler 实现细节在 `scheduler/docs/`；Model Hub 在 `model-hub/README.md`。

## 快速入口

| 文档 | 说明 |
|------|------|
| [QUICK_START.md](./QUICK_START.md) | 启动顺序、端口、健康检查 |
| [OVERVIEW.md](./OVERVIEW.md) | Scheduler / API Gateway / Model Hub 概览 |
| [MIGRATION.md](./MIGRATION.md) | 路径与目录迁移说明 |

## 子模块

| 模块 | 文档 |
|------|------|
| **Scheduler** | [`../scheduler/docs/README.md`](../scheduler/docs/README.md) |
| **API Gateway** | [api_gateway/README.md](./api_gateway/README.md)、[api_gateway/PUBLIC_API.md](./api_gateway/PUBLIC_API.md) |
| **Model Hub** | [model_hub/README.md](./model_hub/README.md) |
| **模型管理方案** | [modelManager/MODEL_MANAGEMENT.md](./modelManager/MODEL_MANAGEMENT.md) |

## 代码入口

```
central_server/
├── scheduler/     # Rust，默认 5010
├── api-gateway/   # Rust，默认 8081
└── model-hub/     # Python FastAPI，默认 5000
```

文档以代码为准；冲突时以仓库内源码与 `config.toml` 为准。
