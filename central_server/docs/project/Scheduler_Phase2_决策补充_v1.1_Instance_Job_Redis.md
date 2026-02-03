
# Scheduler Phase 2 决策补充说明（v1.1）
## Instance 生命周期 · 跨实例投递 · Job 状态机 · Redis Slot 约束

> 目标：补齐 Phase 2 方案中**必须在生产环境前明确的工程规范**，  
> 避免多实例调度在真实运行中出现“幽灵实例 / 丢消息 / 重复执行 / Lua 失效”等结构性问题。  
>  
> 本文档内容为 **强约束规范**，建议与《Scheduler Phase 2 推进建议（决策版）》一并作为 Phase 2 实施基线。

---

## 1. Scheduler Instance Identity & Lifecycle 规范

### 1.1 背景与问题

在 Phase 2 中：

- Scheduler 以 **多实例** 方式运行
- Node / Session 通过 `owner` 机制绑定到某个 Scheduler 实例
- 跨实例事件（dispatch / notify）需要定向投递

若 **Scheduler 实例自身没有明确的生命周期声明**，将产生以下风险：

- 实例崩溃后 owner 指向“幽灵实例”
- 消息被投递到已不存在的 Scheduler
- 重启后 instance_id 冲突或状态污染

### 1.2 规范要求（必须）

1. **每个 Scheduler 实例必须具备唯一 instance_id**
2. **instance_id 必须显式声明在线状态（presence）**
3. **任何 owner 投递前，必须校验实例仍然存活**

### 1.3 Redis Key 规范

```text
schedulers:presence:<instance_id> -> {
  started_at,
  hostname,
  pid,
  version
} (TTL = 2 * scheduler_heartbeat_interval)
```

- presence 由 Scheduler 周期性续约
- TTL 到期即视为实例失效

### 1.4 行为约束

- 若 `schedulers:presence:<instance_id>` 不存在：
  - owner 绑定 **必须被视为无效**
  - 需触发重新选举或 failover 路径
- ❌ 禁止向不存在的 instance 投递任何事件

---

## 2. 跨实例事件投递的可靠性分级策略

### 2.1 背景

Phase 2 中引入 Redis 作为实例间通信中介，常见机制包括：

- Redis Pub/Sub
- Redis Streams

若不加区分地混用，将导致：

- 不该丢的消息被丢
- 不该重放的消息被重放
- 语义混乱，难以排错

### 2.2 强制分级规范

| 事件类型 | 推荐机制 | 可靠性要求 | 说明 |
|---|---|---|---|
| Job 下发（Scheduler → Node） | **Redis Streams** | 不可丢 | 可重放 |
| Job 执行结果回传 | **Redis Streams** | 不可丢 | 业务正确性依赖 |
| Session 状态 / 文本推送 | Pub/Sub | 可短暂丢失 | 弱一致 |
| 心跳 / 辅助信号 | Pub/Sub | 可丢 | 低成本 |

### 2.3 规范约束

- ❌ 禁止使用 Pub/Sub 传递 **业务结果或 Job 指令**
- Streams 消费必须支持：
  - ack
  - pending 重分配（failover）

---

## 3. Job 生命周期状态机（FSM）规范

### 3.1 背景

在多实例 + 重试 + 失败恢复场景中：

- 若 Job 状态未显式建模
- 将不可避免地产生重复执行或资源泄漏

### 3.2 最小 Job FSM 定义（必须遵守）

```text
CREATED
  ↓ (bind ok)
DISPATCHED
  ↓ (node ack)
RUNNING
  ↓ (result ok)
FINISHED
  ↓
RELEASED
```

### 3.3 状态语义说明

- **CREATED**：调度请求已生成 job
- **DISPATCHED**：job 已成功投递给 node
- **RUNNING**：node 确认开始执行
- **FINISHED**：执行完成，结果已生成
- **RELEASED**：资源（并发槽/lease）已释放

### 3.4 原子性要求

- 以下状态变迁 **必须原子完成（Lua / 单事务）**：
  - CREATED → DISPATCHED
  - DISPATCHED → RUNNING（与并发计数关联）
- 其余状态允许异步补偿

### 3.5 禁止行为

- ❌ 已进入 FINISHED 的 job 被再次 DISPATCH
- ❌ 未进入 RUNNING 即释放资源

---

## 4. Redis Cluster Hash Slot 与 Lua 约束规范

### 4.1 背景

Redis Cluster 下：

- Lua 脚本 **只能操作同一 hash slot 的 key**
- 违反将直接执行失败

### 4.2 设计原则（必须遵守）

> **Lua 仅用于“单实体一致性”，不用于全局逻辑。**

### 4.3 明确允许的 Lua 操作

- 单 session：
  - session bind
  - lease 校验
- 单 job：
  - job 状态推进
- 单 node：
  - 并发计数增减

### 4.4 明确禁止的 Lua 操作

- ❌ 同一 Lua 中操作：
  - session + node caps
  - node jobs + 全局 stats
- ❌ 在 Lua 中遍历 / 排序节点集合
- ❌ 在 Lua 中做跨实体协调

### 4.5 Hash Tag 建议

- session 相关 key：`{session:<id>}:*`
- job 相关 key：`{job:<id>}:*`
- node 相关 key：`{node:<id>}:*`

确保单脚本操作始终命中同一 slot。

---

## 5. 总结

通过补齐以下 4 个方面：

1. Scheduler 实例生命周期与 presence
2. 跨实例事件的可靠性分级
3. Job 生命周期 FSM 显式化
4. Redis Cluster + Lua 的硬约束边界

Phase 2 的 Scheduler 将具备：

- 可多实例稳定运行
- 可容错、可恢复
- 可水平扩展
- 与真实生产环境一致的行为模型

> 本文档建议作为 Phase 2 的 **不可回避工程规范**，在编码前完成共识。
