## Scheduler Phase 2 开发进度记录（2025-12-19）

> 目的：记录当前已落地的 Phase 2 改造点、测试方式、以及重启电脑后如何继续开发。  
> 基线文档：  
> - `central_server/docs/project/Scheduler_Phase2_推进建议_决策版.md`  
> - `central_server/docs/project/Scheduler_Phase2_决策补充_v1.1_Instance_Job_Redis.md`

---

## 1. 已完成的功能（已落地到代码 / 已通过 Cluster 自动化验收）

### 1.1 Phase 2 多实例“链路不断”主干能力（已完成）

- **Scheduler instance_id + presence（TTL）**
  - 启动时生成或使用配置指定的 `instance_id`
  - 周期性写入 `schedulers:presence:<instance_id>` 并设置 TTL（= `2 * scheduler.heartbeat_interval_seconds`）
  - 投递前校验目标实例 presence，避免“幽灵实例”

- **node/session owner（带 TTL）**
  - session 建连后写入 `sessions:owner:{session:<id>} -> instance_id`（TTL）
  - node 注册后写入 `nodes:owner:{node:<id>} -> instance_id`（TTL）
  - 断开连接时主动清理 owner key（同时 TTL 兜底）

- **跨实例投递（Redis Streams inbox，可靠链路）**
  - 每个实例消费自己的 inbox stream：`streams:{instance:<id>}:inbox`
  - 使用 consumer group + pending + ack（支持 failover reclaim）
  - **可靠性增强（已落地）**：
    - `XADD MAXLEN ~ stream_maxlen`（防止 stream 无界增长）
    - 成功消费后 `XACK + XDEL`（避免 stream 堆积）
    - `XAUTOCLAIM` reclaim pending（同 group 的 consumer 挂掉后可接管）
    - **DLQ（已落地）**：`XPENDING + XCLAIM(min-idle)` 将长期 pending 且投递次数过多的消息搬到 `dlq` stream

### 1.2 关键路径路由改造（已完成）

- **Job 下发（Scheduler -> Node）**
  - 本地 node 有连接：直接通过本地 WebSocket 发送
  - 否则：查 `node owner`，把 `NodeMessage` 投递到 owner 实例的 Streams inbox

- **结果/事件推送（Scheduler -> Session）**
  - 本地 session 有连接：直接发送
  - 否则：查 `session owner`，把 `SessionMessage` 投递到 owner 实例的 Streams inbox

### 1.3 MODEL_NOT_AVAILABLE 风暴防护跨实例一致（已完成）

对齐《扩展与容量规划说明》中的思路，已在 Phase2 启用时把去抖/限流迁移到 Redis（跨实例一致）：

- **去抖（debounce）**：`SET key <instance_id> NX PX <window_ms>`
- **节点级限流（ratelimit）**：窗口首次 `SET NX EX`，窗口内 `INCRBY`

当 Phase2 未启用时，仍回退为 Phase1 的进程内去抖/限流（兼容单实例）。

### 1.4 Node Snapshot（全局节点视图）+ nodes:all 清理（已完成）

- **节点快照外置到 Redis（跨实例可见）**
  - 每个实例将本地 node 快照写入 Redis（presence + snapshot + nodes:all）
  - 各实例后台定期拉取 nodes:all，并将快照 upsert 到本地 NodeRegistry（允许跨实例“选到非本机连接的 node”）
- **nodes:all 长期增长治理（已完成）**
  - 写入时更新 `nodes:last_seen`（ZSET，score=last_seen_ms）
  - 后台周期性清理长期离线节点条目（可配置 `remove_stale_after_seconds`）

### 1.5 request_id 幂等 + 节点并发占用（reservation）（已完成）

- **request lock（分布式锁）**：避免同一 `request_id` 在多实例并发创建/占用
- **request binding（带 lease）**：`request_id -> job_id/node_id` 的幂等绑定外置 Redis
- **node reservation（Lua + ZSET）**：跨实例并发占用保护，防止超卖

### 1.6 Job FSM（Redis）+ Node Ack/Started（已完成）

- Job FSM 状态外置 Redis，并通过 Lua 实现关键迁移的幂等与约束：
  - `CREATED -> DISPATCHED -> ACCEPTED -> RUNNING -> FINISHED -> RELEASED`
- 协议补齐：
  - `job_ack`：node 接收/入队（推进 `ACCEPTED`）
  - `job_started`：node 真正开始执行（推进严格 `RUNNING`）

### 1.7 Cluster 自动化验收（已完成）

- 新增一键脚本：`central_server/scheduler/scripts/phase2_cluster_acceptance.ps1`
  - 自动启动 Redis Cluster（Docker Compose）
  - 容器内运行 `cargo test -q phase2_cluster_acceptance_smoke`
- 该脚本在 Windows 环境已跑通（避免主机直连 cluster 的 MOVED 地址不可达问题）。

---

## 2. Phase 3（两级调度 / 强隔离）现状（已落地）

Phase 3 已在代码侧落地“方案 B：两级调度（Global 选 pool，pool 内选 node）”，并进一步支持 **按能力做强隔离** 与长期演进：

- **capability pools（强隔离）**：配置 `scheduler.phase3.pools`（pool_id/name/required_services），节点按 installed_services 匹配进入 pool；多 pool 匹配时按 node_id hash 稳定分配
- **tenant 强绑定**：配置 `scheduler.phase3.tenant_overrides` 将 tenant_id 显式绑定到 pool_id（隔离故障域/容量/灰度）
- **pool 资格过滤范围**：`pool_match_scope=core_only|all_required`，可在“兼容/强隔离”之间选择
- **严格模式**：`strict_pool_eligibility=true` 时，eligible pools 为空直接失败（避免隐式回退破坏隔离）
- **可观测**：
  - `phase3_pool_selected_total`、`phase3_pool_attempt_total`
  - `/api/v1/phase3/pools` 运维接口用于快速定位 pool 缺口（installed vs ready）

---

## 2. 新增/修改的关键文件清单（核心）

### 2.1 修改（M）

- `central_server/scheduler/Cargo.toml`（新增 redis 依赖）
- `central_server/scheduler/config.toml`（新增 `[scheduler.phase2]` 配置示例）
- `central_server/scheduler/src/config.rs`（新增 `Phase2Config/Phase2RedisConfig`）
- `central_server/scheduler/src/lib.rs`（导出 `phase2` 模块）
- `central_server/scheduler/src/app_state.rs`（新增 `phase2: Option<Arc<Phase2Runtime>>`）
- `central_server/scheduler/src/main.rs`（初始化 Phase2Runtime + 启动后台任务 + 注入 model_not_available worker）
- `central_server/scheduler/src/connection_manager.rs`（增加 list_session_ids/list_node_ids 用于 owner 续约）
- `central_server/scheduler/src/websocket/session_message_handler/core.rs`（session init 时写 owner）
- `central_server/scheduler/src/websocket/node_handler/message.rs`（node register 时写 owner；结果推送改为 routed）
- `central_server/scheduler/src/websocket/session_handler.rs`（session disconnect 清 owner）
- `central_server/scheduler/src/websocket/node_handler/connection.rs`（node disconnect 清 owner）
- `central_server/scheduler/src/websocket/session_message_handler/utterance.rs`（job 下发改为 routed）
- `central_server/scheduler/src/websocket/session_message_handler/audio.rs`（job 下发改为 routed）
- `central_server/scheduler/src/job_timeout.rs`（job_cancel 与 failover 下发改为 routed；timeout 通知改为 routed）
- `central_server/scheduler/src/model_not_available.rs`（Phase2 启用时去抖/限流改为 Redis）
- `central_server/scheduler/src/prometheus_metrics.rs`（新增 Phase2 Streams/DLQ 指标）
- `central_server/scheduler/src/main.rs`（补齐跨平台 file-rotate 签名差异，确保 Docker/Linux 编译通过）

### 2.2 新增（核心）

- `central_server/scheduler/src/phase2.rs`（Phase2Runtime + Streams inbox + routed send + Redis 去抖/限流 + 可选集成测试）
- `central_server/scheduler/scripts/phase2_smoketest.ps1`（双实例手工 smoke test 引导脚本）
- `central_server/scheduler/scripts/phase2_cluster_acceptance.ps1`（Redis Cluster 自动化验收一键脚本）
- `central_server/scheduler/scripts/redis_cluster/docker-compose.yml`（Redis Cluster（3 masters）+ tests runner）
- `central_server/scheduler/docs/phase2_implementation.md`（Phase2 实现总览文档）
- `central_server/scheduler/docs/phase2_streams_ops.md`（Streams/DLQ 运维排查文档）

### 2.3 需要注意的“非核心”未跟踪文件（请在提交前处理）

- `electron_node/services/test/chinese.wav`
- `electron_node/services/test/english.wav`

以及一个**疑似文件名编码异常**的未跟踪 md（表现为 git status 里中文文件名乱码/转义）。建议重启后优先确认是否产生了重复文件或路径异常，然后决定保留/删除/重命名。

---

## 3. 如何测试（验收入口）

### 3.1 编译与单测（推荐先跑）

在 Scheduler 目录下：

```powershell
cd D:\Programs\github\lingua_1\central_server\scheduler
cargo test -q
```

### 3.2 Phase2 Redis Streams 集成 smoke test（需要可用 Redis）

该测试默认使用 `redis://127.0.0.1:6379`，也可通过环境变量指定：

```powershell
cd D:\Programs\github\lingua_1\central_server\scheduler
$env:LINGUA_TEST_REDIS_URL="redis://127.0.0.1:6379"
cargo test -q
```

说明：
- 若 Redis 不可用，测试会 `skip`（不会导致整体失败）

### 3.3 Phase2 Redis Cluster 自动化验收（推荐：一键）

该脚本会启动 Redis Cluster 并在容器网络内执行验收测试：

```powershell
cd D:\Programs\github\lingua_1\central_server\scheduler
.\scripts\phase2_cluster_acceptance.ps1
```

清理：

```powershell
docker compose -p lingua-scheduler-cluster-acceptance -f .\scripts\redis_cluster\docker-compose.yml down -v
```

### 3.4 本机双实例手工 smoke test（建议用于验证“跨实例链路不断”）

脚本会生成两份临时 config，并提示你在两个终端分别启动两个 scheduler：

```powershell
cd D:\Programs\github\lingua_1\central_server\scheduler
.\scripts\phase2_smoketest.ps1 -RedisUrl "redis://127.0.0.1:6379" -KeyPrefix "lingua_smoke"
```

### 3.5 真实 WebSocket 自动化 E2E（mock node + mock session，但走真实 WS 路由）

该测试会在测试进程内启动两个 scheduler 实例，并使用 tokio-tungstenite 模拟 node 与 session：

```powershell
cd D:\Programs\github\lingua_1\central_server\scheduler
.\scripts\phase2_ws_e2e.ps1 -RedisUrl "redis://127.0.0.1:6379"
```

---

## 4. 当前结论（按“Cluster 自动化验收”为标准）

- **Phase 2 主干已完成**：并已通过 `phase2_cluster_acceptance_smoke` 验收测试。
- 如需进一步“生产级增强”，建议后续补充：
  - DLQ 的结构化字段与回放工具（可选）
  - 更完善的告警/仪表盘（pending、DLQ、reclaim 次数等）
  - 多实例真实端到端（启动两个 scheduler + node + session）的自动化 E2E（可选）

## 5. 建议的后续开发顺序（扩展改造收口）

在进入 Phase 3（分片/两级调度/多区域隔离）之前，建议先按顺序补齐：

1. **真实链路自动化 E2E + 故障注入**
2. **压测与长稳（soak）**
3. **监控告警 + 运维 SOP**
4. **再进入 Phase 3**


