## Scheduler 上线收口 Runbook（Phase2/Phase3）

本文件面向“准备把 Scheduler 改造成果提交/上线”的收口流程，目标是把风险收敛到可控范围，并确保故障可快速定位。

### 1) 一键收口（推荐）

在 `central_server/scheduler` 目录执行：

```powershell
.\scripts\release_gate.ps1 -RedisUrl "redis://127.0.0.1:6379" -WsE2ERepeat 1
```

可选：如果本机可用 Docker（并希望验收 Redis Cluster 场景）：

```powershell
.\scripts\release_gate.ps1 -RunClusterAcceptance
```

### 2) 关键验收点（应满足）

- **基础正确性**：`cargo test` 全绿
- **Phase2 跨实例链路**：`phase2_ws_e2e.ps1` 全绿（node 连 A、session 连 B、Streams 路由正确）
- **可观测**：
  - `/metrics` 可抓取
  - `phase2_redis_op_total`、`phase2_inbox_pending`、`phase2_dlq_moved_total` 可用
  - `phase3_pool_selected_total`、`phase3_pool_attempt_total` 可用（Phase3 启用时）
- **可定位**：
  - `GET /api/v1/phase3/pools` 能看到 pool 的在线/ready，以及核心服务 installed/ready 覆盖与 sample nodes

### 3) Redis schema 对齐（可选兼容层）

如果需要补写文档建议的 v1 keys（不替换现有实现，仅额外写入），在 `config.toml` 打开：

- `[scheduler.phase2.schema_compat]`
  - `stats_snapshot_enabled`：写 `{prefix}:v1:stats:snapshot`（JSON + TTL）
  - `node_caps_enabled`：写 `{prefix}:v1:nodes:caps:{node:<id>}`（Hash）
  - `session_bind_enabled`：写 `{prefix}:v1:sessions:bind:{session:<id>}`（Hash，仅配对节点场景）

### 4) 发生问题时的排查顺序（建议）

- **先看 Phase2 链路**：
  - `phase2_inbox_pending` 是否持续升高
  - `phase2_dlq_moved_total` 是否增长
  - `phase2_redis_op_total{result="err"}` 是否升高
- **再看 Phase3 选择路径（如果启用）**：
  - `phase3_pool_attempt_total{result="fail"}` 的 `reason` 分布（尤其 `missing_core_*`）
  - `GET /api/v1/phase3/pools` 对照 installed/ready 覆盖，判断是“没装”还是“没 ready”


