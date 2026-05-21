# API Gateway 对外 API

版本：与当前 `api-gateway` 源码一致。

## 架构

```
Client → API Gateway (8081) → Scheduler (5010) → Electron Node
```

Gateway 不执行 ASR/翻译推理，只做鉴权、限流与协议适配。

## 鉴权

- Header：`Authorization: Bearer <API_KEY>`
- `/health` 无需鉴权
- 未带或错误 key → 401

## REST

### `POST /v1/speech/translate`

上传音频并请求翻译（实现见 `rest_api.rs`）。

- 需鉴权
- 表单字段以当前 handler 为准（常见：`audio`、`src_lang`、`tgt_lang`）
- 由 Gateway 创建/转发 Scheduler 会话与任务

## WebSocket

### `GET /v1/stream`

流式会话（实现见 `main.rs` + stream handler）。

- 需鉴权（`route_layer` + `auth_middleware`）
- 与 Scheduler 会话通道对接，用于实时音频/结果推送

## 配置示例

`api-gateway/config.toml`：

```toml
[server]
port = 8081
host = "0.0.0.0"

[scheduler]
url = "ws://localhost:5010/ws/session"
```

## 租户与限流

- 租户模型与 API Key 存储：见 `src/tenant.rs`、启动时默认租户逻辑
- 限流：见 `src/rate_limit.rs`（若启用）

## 相关

- 启动与 curl 示例：`../QUICK_START.md`
- Scheduler 协议与任务：`../../scheduler/docs/job/JOB.md`
