# API Gateway

对外 REST / WebSocket 网关：鉴权、限流、转发至 Scheduler。

## 运行

```bash
cd central_server/api-gateway
cargo run --release
```

- 默认端口：**8081**（`config.toml`）
- 健康检查：`GET /health`（无需鉴权）
- Scheduler 地址：`config.toml` → `[scheduler].url`

## API Key（开发）

- 环境变量 `LINGUA_API_KEY`：启动时绑定默认租户
- 未设置：启动日志打印随机 key（仅开发）

## 文档

- [PUBLIC_API.md](./PUBLIC_API.md) — 端点、鉴权、与 Scheduler 关系

## 代码

| 文件 | 职责 |
|------|------|
| `src/main.rs` | 路由挂载、`/health`、`/v1/stream` |
| `src/rest_api.rs` | `POST /v1/speech/translate` |
| `src/auth.rs` | Bearer API Key |
| `src/scheduler_client.rs` | 转发会话/任务 |
