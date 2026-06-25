# Scheduler 运维与发布

## 发布门禁（推荐）

在 `central_server/scheduler` 目录：

```powershell
.\scripts\release_gate.ps1 -RedisUrl "redis://127.0.0.1:6379" -WsE2ERepeat 1
```

可选 Redis Cluster 验收：

```powershell
.\scripts\release_gate.ps1 -RunClusterAcceptance
```

### 验收点

- `cargo test` 全绿
- `phase2_ws_e2e.ps1` 全绿（跨实例 WS 路由）
- `/metrics` 可抓取；`phase2_*`、`phase3_*` 指标可用
- `GET /api/v1/phase3/pools` 可查看 pool 在线/ready

### 排查顺序

1. Phase2：`phase2_inbox_pending`、`phase2_dlq_moved_total`、`phase2_redis_op_total{result="err"}`
2. Phase3：`phase3_pool_attempt_total{result="fail"}` 的 `reason`；对照 `/api/v1/phase3/pools`

### Redis schema 兼容（可选）

`config.toml` → `[scheduler.phase2.schema_compat]` 可启用 v1 key 兼容写入。

## 配置

主配置：`scheduler/config.toml`（server、redis_runtime、Pool、job_timeout、web_task_segmentation 等）。

Redis Key 前缀与 TTL 见 [architecture/POOL.md](architecture/POOL.md)。
