## Scheduler Phase 2 实现文档（已落地）

本文件用于记录当前仓库中 **Scheduler Phase 2** 已完成的设计落地、配置方式、Redis Key 约定、消息协议变更、测试与验收方法。

> 适用范围：`central_server/scheduler`（Rust / tokio / axum），并包含与 `electron_node` 的协议对齐点。

### 目标与范围
Phase 2 的主目标是让 Scheduler 控制面支持 **横向扩展（多实例）**，并把关键一致性状态 **外置到 Redis**，以避免多实例并发导致：
- 重复调度/重复执行
- 资源占用泄漏（reserved slot 不释放）
- 跨实例 session/node 消息无法投递

### 关键能力概览（现状）
- **实例存在性（presence）**：Scheduler 实例启动后周期性写入 Redis presence key（带 TTL），用于跨实例判断目标实例是否存活。
- **Owner 绑定（node/session -> instance）**：node/ws 与 session/ws 建连时写入 owner key，断开时清除；并由后台续约 TTL。
- **跨实例可靠投递（Redis Streams）**：
  - 业务关键消息使用 Streams（支持 consumer group + pending + failover reclaim）
  - 低一致性通知不依赖 Streams（当前仅实现了 Streams 主链路）
- **Node Snapshot 同步（跨实例全局节点视图）**：每个实例把本地 node 快照写入 Redis；各实例后台拉取全量快照 upsert 到本地 NodeRegistry。
- **Request Id 幂等（Redis binding + lock）**：同一 request_id 在多实例并发下只会生成/绑定一个 job。
- **节点并发占用（Redis reservation）**：用 Redis ZSET + Lua 清理过期，实现跨实例的 reserved slot 保护。
- **Job FSM（Redis）**：Job 生命周期状态外置 Redis，并通过 Lua 做关键迁移的原子与幂等。
- **MODEL_NOT_AVAILABLE 风暴保护（Redis）**：去抖/限流逻辑外置 Redis，保证跨实例一致。
- **Streams 可靠性增强**：
  - XADD `MAXLEN ~` 裁剪
  - 消费成功 `XACK + XDEL`
  - `XAUTOCLAIM` reclaim pending
  - DLQ：通过 `XPENDING + XCLAIM(min-idle)` 将长期 pending 且投递次数过多的消息搬到 dlq stream
- **nodes:all 清理**：用 `nodes:last_seen` ZSET 记录 last_seen_ms，定期清理长期离线节点条目，防止集合长期增长。

---

## 配置（config.toml）
Phase2 的配置入口为：
- `scheduler.phase2`
- `scheduler.phase2.redis`
- `scheduler.phase2.node_snapshot`

关键字段说明（节选）：
- **enabled**：是否启用 Phase 2（默认 false）
- **instance_id**：实例唯一标识（推荐显式配置；也可用 `auto`）
- **redis.mode**：`single` | `cluster`
- **redis.url / redis.cluster_urls**：Redis 连接地址
- **redis.key_prefix**：Redis key 前缀（建议不同环境隔离）
- **owner_ttl_seconds**：owner key TTL（秒）
- **stream_group / stream_block_ms / stream_count**：Streams 读组配置
- **stream_maxlen**：inbox 最大长度（近似裁剪）
- **dlq_*（dlq_enabled/maxlen/max_deliveries/min_idle_ms/scan_interval_ms/scan_count）**：DLQ 策略
- **node_snapshot.enabled/presence_ttl_seconds/refresh_interval_ms/remove_stale_after_seconds**：全局节点视图与清理策略

可以参考：`central_server/scheduler/config.toml` 与 `central_server/scheduler/scripts/phase2_smoketest.ps1`

---

## Redis Key 约定（核心）
以下 key 均带 `scheduler.phase2.redis.key_prefix` 前缀（本文用 `{prefix}` 表示）。
> 注意：当前实现同时存在“**不带 v1**（基础链路）”与“**带 `:v1`**（可演进状态）”两类 key，原因是 Phase2 演进中逐步把热状态外置到 `:v1` schema 下。

### 1) Scheduler 实例 presence
- `{prefix}:schedulers:presence:<instance_id>`（TTL）

### 2) Owner 绑定
- `{prefix}:nodes:owner:{node:<node_id>}` -> `<instance_id>`（TTL）
- `{prefix}:sessions:owner:{session:<session_id>}` -> `<instance_id>`（TTL）

### 3) Streams（跨实例投递）
使用 hash tag：`{instance:<instance_id>}`，便于 Redis Cluster 下 slot 对齐：
- inbox：`{prefix}:streams:{instance:<instance_id>}:inbox`
- dlq ：`{prefix}:streams:{instance:<instance_id>}:dlq`

### 4) Node Snapshot（跨实例全局节点视图）
- `{prefix}:v1:nodes:all`（SET，全量 node_id）
- `{prefix}:v1:nodes:last_seen`（ZSET，member=node_id，score=last_seen_ms）
- `{prefix}:v1:nodes:presence:<node_id>`（TTL）
- `{prefix}:v1:nodes:snapshot:<node_id>`（TTL，JSON）

### 5) Request 幂等 / Lock
- `{prefix}:v1:requests:lock:<request_id>`（SET NX PX）
- `{prefix}:v1:requests:binding:<request_id>`（JSON + TTL）

### 6) 节点并发占用（reservation）
- `{prefix}:v1:nodes:{node:<node_id>}:reserved`（ZSET，member=job_id，score=expire_at_ms）

### 7) Job FSM
为满足 Redis Cluster 脚本 slot 限制，使用 `{job:<job_id>}` hash tag：
- `{prefix}:v1:jobs:{job:<job_id>}:fsm`（HASH + TTL）

---

## Job FSM（Redis）
FSM 状态（当前实现）：
- `CREATED`
- `DISPATCHED`
- `ACCEPTED`（node 已接收/入队）
- `RUNNING`（node 已开始执行；由 `job_started` 推进；保留 `asr_partial` fallback）
- `FINISHED`
- `RELEASED`

迁移要点：
- `create_job` 初始化 `CREATED`
- `mark_job_dispatched`：`CREATED -> DISPATCHED`（带 attempt 校验）
- `job_ack`：`DISPATCHED -> ACCEPTED`
- `job_started`：`DISPATCHED/ACCEPTED -> RUNNING`
- `job_result`：`* -> FINISHED -> RELEASED`（带 attempt 校验 + 释放 reservation）
- timeout/failover：按策略迁移并释放资源

---

## 协议变更（NodeMessage）
Scheduler 与 node 的 websocket 协议新增：
- `job_ack`：node->scheduler，表示已接收/入队（用于 `ACCEPTED`）
- `job_started`：node->scheduler，表示真正开始执行（用于严格 `RUNNING`）

Node 侧实现位置：
- `electron_node/.../src/agent/node-agent.js` 在开始推理前发送 `job_ack` 与 `job_started`（均为“小改动”且向后兼容）。

---

## Streams 投递与可靠性
关键策略摘要（更详细见 `docs/phase2_streams_ops.md`）：
- `XADD MAXLEN ~ stream_maxlen`
- 处理成功后 `XACK + XDEL`
- `XAUTOCLAIM` reclaim 其他 consumer 遗留 pending
- DLQ：`XPENDING` 找到超阈值 + `XCLAIM(min-idle)` 抢占后搬运至 dlq

Prometheus 指标：
- `scheduler_phase2_redis_op_total{op,result}`
- `scheduler_phase2_inbox_pending`
- `scheduler_phase2_dlq_moved_total`

---

## 测试与验收
### 1) 单元/集成测试（含 Redis）
设置环境变量并运行：
- `LINGUA_TEST_REDIS_URL=redis://127.0.0.1:6379`
- `cargo test -q`

#### Cluster 模式（自动化验收标准）
Phase2 的测试已支持通过环境变量切换到 Redis Cluster：
- `LINGUA_TEST_REDIS_MODE=cluster`
- `LINGUA_TEST_REDIS_CLUSTER_URLS=redis://<seed1>:<port>,redis://<seed2>:<port>,...`

为了避免 Windows 主机直连 Cluster 时出现 MOVED 地址不可达的问题，本仓库提供了 **“在 Docker 网络内跑测试”** 的一键脚本：
- 脚本：`scripts/phase2_cluster_acceptance.ps1`
- Compose：`scripts/redis_cluster/docker-compose.yml`（3 masters + init + tests runner）

运行方式（PowerShell）：
1. `cd central_server/scheduler`
2. `.\scripts\phase2_cluster_acceptance.ps1`

清理：
- `docker compose -p lingua-scheduler-cluster-acceptance -f .\scripts\redis_cluster\docker-compose.yml down -v`

关键测试（在 `src/phase2.rs`）：
- `phase2_streams_enqueue_and_readgroup_smoke`
- `phase2_node_snapshot_roundtrip_smoke`
- `phase2_job_fsm_smoke`
- `phase2_cross_instance_delivery_e2e_minimal`
- `phase2_cluster_acceptance_smoke`（Cluster 自动化验收专用）

### 2) 手工多实例 smoke test
脚本：`central_server/scheduler/scripts/phase2_smoketest.ps1`
- 生成两个不同 `instance_id` / `port` 的 config
- 手工启动两个 scheduler 实例
- node 连 A、session 连 B，验证 JobAssign/JobResult 仍能通过 Streams 路由闭环

---

## 已知取舍/后续可选优化
- 当前 DLQ 记录字段已覆盖核心溯源信息；如需更强可观测性，可扩展 DLQ entry 的结构化字段（event_type/node_id/session_id 等）。
- 对 Redis Cluster 的更严格约束（跨 key 原子）目前主要通过 hash tag + Lua 来保证；后续若引入更多跨 key 原子操作，需要继续遵循同 slot 原则。


