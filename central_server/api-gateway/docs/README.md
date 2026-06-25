# API Gateway

对外 REST / WebSocket 网关：鉴权、限流、转发至 Scheduler。

```
Client → API Gateway (:8081) → Scheduler (:5010) → Electron Node
```

Gateway 不执行 ASR/翻译推理，只做鉴权、限流与协议适配。

## 运行

```bash
cd central_server/api-gateway
cargo run --release
```

| 项 | 默认 |
|----|------|
| 端口 | **8081**（`config.toml` `[server]`） |
| Scheduler | `config.toml` → `[scheduler].url`（如 `ws://localhost:5010/ws/session`） |
| 健康检查 | `GET /health`（无需鉴权） |

### API Key（开发）

- 环境变量 `LINGUA_API_KEY`：启动时绑定默认租户
- 未设置：启动日志打印随机 key（仅开发）

## 鉴权

- Header：`Authorization: Bearer <API_KEY>`
- `/health` 无需鉴权；错误或未带 → 401

## REST — `POST /v1/speech/translate`

实现：`src/rest_api.rs`

- 需鉴权
- 表单字段以 handler 为准（常见：`audio`、`src_lang`、`tgt_lang`）
- Gateway 创建/转发 Scheduler 会话与任务

```bash
curl -X POST http://localhost:8081/v1/speech/translate \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "audio=@audio.wav" -F "src_lang=zh" -F "tgt_lang=en"
```

## WebSocket — `GET /v1/stream`

实现：`src/main.rs`、`src/ws_api.rs`

- 需鉴权（`auth_middleware`）
- 与 Scheduler 会话通道对接，实时音频/结果

## 配置示例

```toml
[server]
port = 8081
host = "0.0.0.0"

[scheduler]
url = "ws://localhost:5010/ws/session"
```

## 代码

| 文件 | 职责 |
|------|------|
| `src/main.rs` | 路由、`/health`、`/v1/stream` |
| `src/rest_api.rs` | `POST /v1/speech/translate` |
| `src/auth.rs` | Bearer API Key |
| `src/tenant.rs` | 租户与默认租户 |
| `src/rate_limit.rs` | 限流 |
| `src/scheduler_client.rs` | 转发会话/任务 |

## 相关

- 中央服务索引：[../../docs/README.md](../../docs/README.md)
- Scheduler 任务：[../scheduler/docs/job/JOB.md](../scheduler/docs/job/JOB.md)
