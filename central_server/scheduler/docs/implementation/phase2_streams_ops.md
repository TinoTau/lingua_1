## Phase2 Streams / DLQ 运维排查指引

本文件用于 Phase2 多实例模式下 Redis Streams 的排查与验收。

> Phase2 总览与配置请先看：`docs/phase2_implementation.md`

### 关键概念
- **Inbox Stream**：每个 Scheduler 实例一个 inbox（可靠投递）
- **Consumer Group**：同一个 `stream_group` 下，多实例可接管对方 pending（failover）
- **Pending**：已投递给某个 consumer 但未 `XACK` 的消息
- **DLQ**：长期 pending 且投递次数过多的消息会被搬运到 DLQ stream

### Redis Key 约定（默认 key_prefix=lingua）
- **Inbox**：`{prefix}:streams:{instance:<instance_id>}:inbox`
- **DLQ**：`{prefix}:streams:{instance:<instance_id>}:dlq`
- **Consumer Group**：`{scheduler.phase2.stream_group}`

> 注：key 使用 `{instance:<id>}` hash tag，确保在 Redis Cluster 下同一实例的 inbox/dlq 落在同一 slot（便于 Lua/原子操作扩展）。

### 常用 redis-cli 命令（单机）
查看 stream 基本信息：

```bash
redis-cli XINFO STREAM lingua:streams:{instance:scheduler-1}:inbox
redis-cli XINFO GROUPS lingua:streams:{instance:scheduler-1}:inbox
redis-cli XINFO CONSUMERS lingua:streams:{instance:scheduler-1}:inbox scheduler
```

查看 pending summary（总数/范围/各 consumer）：

```bash
redis-cli XPENDING lingua:streams:{instance:scheduler-1}:inbox scheduler
```

查看 pending 明细（前 10 条）：

```bash
redis-cli XPENDING lingua:streams:{instance:scheduler-1}:inbox scheduler - + 10
```

查看 DLQ：

```bash
redis-cli XLEN lingua:streams:{instance:scheduler-1}:dlq
redis-cli XRANGE lingua:streams:{instance:scheduler-1}:dlq - + COUNT 10
```

### Scheduler 侧策略（实现要点）
- **Inbox 裁剪**：`XADD MAXLEN ~ stream_maxlen`，防止无界增长
- **消费清理**：消费成功后 `XACK` + `XDEL`，避免 stream 堆积
- **Failover reclaim**：周期性 `XAUTOCLAIM(min_idle=5s)` 抢占并重试处理 pending
- **DLQ 搬运**：
  - 先 `XPENDING` 获取 deliveries/idle_ms
  - 满足 `deliveries >= dlq_max_deliveries` 且 `idle_ms >= dlq_min_idle_ms` 才处理
  - 搬运前使用 `XCLAIM(min_idle)` 做保护（避免搬走正在处理的消息）

### Prometheus 指标
- **`scheduler_phase2_redis_op_total{op,result}`**
  - 观察 Redis 命令错误率（如 `xreadgroup/xautoclaim/xpending/xclaim/dlq_move`）
- **`scheduler_phase2_inbox_pending`**
  - inbox pending 总量（来自 `XPENDING summary`）
- **`scheduler_phase2_dlq_moved_total`**
  - 搬运进入 DLQ 的累计数量

### 常见问题与建议
- **pending 长期增长**：
  - 先确认对应 session/node 是否长期离线
  - 查看 `XINFO CONSUMERS` 是否有异常 consumer 堆积
  - 观察 `phase2_redis_op_total{op="xautoclaim",result="err"}` 是否异常
- **DLQ 增长**：
  - 通常表示目标不在线导致反复投递失败
  - 可从 DLQ payload 反序列化，定位是 `DispatchToNode` 还是 `SendToSession`

