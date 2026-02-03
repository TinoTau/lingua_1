# Scheduler Phase 2 总览

**状态**: ✅ **已完成**

## 概述

Phase 2 实现了 Scheduler 多实例部署和 Redis 状态外置，支持水平扩展和跨实例消息投递。

## 核心能力

### 1. 多实例"链路不断"主干能力

- **Scheduler instance_id + presence（TTL）**
  - 启动时生成或使用配置指定的 `instance_id`
  - 周期性写入 `schedulers:presence:<instance_id>` 并设置 TTL
  - 投递前校验目标实例 presence，避免"幽灵实例"

- **node/session owner（带 TTL）**
  - session 建连后写入 `sessions:owner:{session:<id>} -> instance_id`（TTL）
  - node 注册后写入 `nodes:owner:{node:<id>} -> instance_id`（TTL）
  - 断开连接时主动清理 owner key（同时 TTL 兜底）

- **跨实例投递（Redis Streams inbox，可靠链路）**
  - 每个实例消费自己的 inbox stream：`streams:{instance:<id>}:inbox`
  - 使用 consumer group + pending + ack（支持 failover reclaim）
  - 可靠性增强：MAXLEN、XACK+XDEL、XAUTOCLAIM、DLQ

### 2. 关键路径路由改造

- **Job 下发（Scheduler -> Node）**
  - 本地 node 有连接：直接通过本地 WebSocket 发送
  - 否则：查 `node owner`，把 `NodeMessage` 投递到 owner 实例的 Streams inbox

- **结果/事件推送（Scheduler -> Session）**
  - 本地 session 有连接：直接发送
  - 否则：查 `session owner`，把 `SessionMessage` 投递到 owner 实例的 Streams inbox

### 3. MODEL_NOT_AVAILABLE 风暴防护跨实例一致

- **去抖（debounce）**：`SET key <instance_id> NX PX <window_ms>`
- **节点级限流（ratelimit）**：窗口首次 `SET NX EX`，窗口内 `INCRBY`

### 4. Node Snapshot（全局节点视图）

- **节点快照外置到 Redis（跨实例可见）**
  - 每个实例将本地 node 快照写入 Redis
  - 各实例后台定期拉取 nodes:all，并将快照 upsert 到本地 NodeRegistry
- **nodes:all 长期增长治理**
  - 写入时更新 `nodes:last_seen`（ZSET）
  - 后台周期性清理长期离线节点条目

### 5. request_id 幂等 + 节点并发占用（reservation）

- **request lock（分布式锁）**：避免同一 `request_id` 在多实例并发创建/占用
- **request binding（带 lease）**：`request_id -> job_id/node_id` 的幂等绑定外置 Redis
- **node reservation（Lua + ZSET）**：跨实例并发占用保护，防止超卖

### 6. Job FSM（Redis）+ Node Ack/Started

- Job FSM 状态外置 Redis，并通过 Lua 实现关键迁移的幂等与约束：
  - `CREATED -> DISPATCHED -> ACCEPTED -> RUNNING -> FINISHED -> RELEASED`
- 协议补齐：
  - `job_ack`：node 接收/入队（推进 `ACCEPTED`）
  - `job_started`：node 真正开始执行（推进严格 `RUNNING`）

## 工程规范

### Instance 生命周期规范

1. **每个 Scheduler 实例必须具备唯一 instance_id**
2. **instance_id 必须显式声明在线状态（presence）**
3. **任何 owner 投递前，必须校验实例仍然存活**

### 跨实例事件投递的可靠性分级

| 事件类型 | 推荐机制 | 可靠性要求 | 说明 |
|---|---|---|---|
| Job 下发（Scheduler → Node） | **Redis Streams** | 不可丢 | 可重放 |
| Job 执行结果回传 | **Redis Streams** | 不可丢 | 业务正确性依赖 |
| Session 状态 / 文本推送 | Pub/Sub | 可短暂丢失 | 弱一致 |
| 心跳 / 辅助信号 | Pub/Sub | 可丢 | 低成本 |

### Job FSM 规范

最小 Job FSM 定义（必须遵守）：

```
CREATED -> DISPATCHED -> ACCEPTED -> RUNNING -> FINISHED -> RELEASED
```

### Redis Cluster Hash Slot 与 Lua 约束

- **Lua 仅用于"单实体一致性"，不用于全局逻辑**
- 使用 hash tag 确保单脚本操作始终命中同一 slot：
  - session 相关 key：`{session:<id>}:*`
  - job 相关 key：`{job:<id>}:*`
  - node 相关 key：`{node:<id>}:*`

## 测试与验收

### 编译与单测

```powershell
cd central_server/scheduler
cargo test -q
```

### Phase2 Redis Streams 集成测试

```powershell
$env:LINGUA_TEST_REDIS_URL="redis://127.0.0.1:6379"
cargo test -q
```

### Phase2 Redis Cluster 自动化验收

```powershell
cd central_server/scheduler
.\scripts\phase2_cluster_acceptance.ps1
```

### 双实例手工测试

```powershell
cd central_server/scheduler
.\scripts\phase2_smoketest.ps1 -RedisUrl "redis://127.0.0.1:6379" -KeyPrefix "lingua_smoke"
```

## 配置

```toml
[scheduler.phase2]
enabled = true
redis_url = "redis://localhost:6379"
key_prefix = "lingua:v1"
instance_id = "auto"
```

## 相关文档

- [Phase 2 实现文档](../../scheduler/docs/phase2_implementation.md)
- [Streams/DLQ 运维文档](../../scheduler/docs/phase2_streams_ops.md)
- [Scheduler 扩展与容量规划](./SCHEDULER_CAPACITY_AND_SCALING.md)

---

**最后更新**: 2025-01-XX

