# Scheduler 扩展与容量规划说明（含 Redis 设计）

> 文档版本：v1.1  
> 更新日期：2025-12-18（Pacific/Auckland）  
> 适用对象：后端 / 基础设施 / 调度系统 / 节点端开发  
> 目的：用于开发部门讨论与实施调度服务器（Scheduler）的扩展、容量规划与演进路线，并补充 Redis 状态外置方案（Phase 2）。

---

## 1. 背景与目标

当前系统采用中心化调度服务器（Scheduler）负责：

- 节点注册与在线状态维护
- 节点能力（功能位 / 模型 / 资源）校验
- 会话到节点的分配（调度决策）
- 模型缺失回调（MODEL_NOT_AVAILABLE）处理
- 基础运行状态统计（Dashboard）

在当前规模下（少量节点、有限并发），该设计运行良好；但在节点数、会话数、模型规模增长后，Scheduler 存在成为系统瓶颈与单点的风险。

本说明的目标是：

1. 明确 Scheduler 在不同规模阶段的容量边界
2. 给出可落地、分阶段的扩展方案
3. 在不推翻现有实现的前提下，为未来规模化做好架构预留
4. 补充 Phase 2 需要的 Redis 状态设计与原子操作策略

---

## 2. 当前 Scheduler 架构概览（Phase 0）

### 2.1 当前职责边界

Scheduler 当前承担的核心职责：

- **控制面（Control Plane）**
  - 节点选择与调度决策
  - 功能感知节点匹配
  - 资源阈值过滤（CPU / GPU / 内存）
- **状态维护**
  - 节点在线状态（心跳）
  - 节点当前任务数
  - 节点能力快照
- **运行期统计**
  - WebSocket 活跃用户数
  - 语言使用统计
  - 模型/服务包算力提供统计

### 2.2 当前实现特征

- 单实例 Scheduler
- NodeRegistry 位于内存（RwLock 保护）
- 节点选择算法复杂度：O(n)
- 调度策略：最少连接数 + 功能校验 + 资源阈值过滤
- Dashboard 为近实时轮询刷新

> 结论：这是正确的第一阶段（Phase 0）实现，短期无需引入分布式复杂度。

---

## 3. Scheduler 成为瓶颈的触发条件（经验阈值）

Scheduler 并非一开始就是瓶颈，但在以下任一条件出现时，风险会迅速上升：

| 维度 | 风险阈值（经验值） |
|---|---:|
| 节点数量 | > 100 |
| 并发会话数 | > 1,000 |
| 调度请求频率（控制面） | > 数千 QPS |
| 心跳频率 | < 5 秒 / 节点 |
| 服务器职责 | 同时承担调度 + 统计 + 同步失败处理 |

典型瓶颈来源：

1. NodeRegistry 全局锁争用（RwLock）
2. 高频 O(n) 节点遍历与评分
3. 实时统计聚合与调度主流程耦合
4. MODEL_NOT_AVAILABLE 回调风暴（热点模型/版本切换/冷启动）

---

## 4. 扩展总体原则

1. **控制面与数据面严格分离**（Scheduler 不转发音频/大 payload）
2. **调度主路径必须短、同步、可预测**（少 IO、少阻塞、少跨服务调用）
3. **状态可外置，决策逻辑可本地化**（拉快照→本地评分→原子提交）
4. **统计允许近实时而非强实时**（5–10 秒延迟可接受）
5. **优先横向扩展，不优先堆单机配置**

---

## 5. 阶段化扩展方案

### Phase 0：单体 Scheduler（当前）

适用规模：节点 ≤ 数十，并发会话 ≤ 数百。

- 内存 NodeRegistry
- 同步调度
- 最少连接数 + 功能位匹配 + 资源阈值过滤

结论：可继续开发；不建议在此阶段引入 Redis/etcd 等分布式依赖，避免工程复杂度前置。

---

### Phase 1：纯控制面化（强烈建议优先实施）

目标：让 Scheduler **只做调度决策，不承担高成本附加职责**。

建议剥离：

- Dashboard 的实时计算与聚合逻辑
- 同步处理 MODEL_NOT_AVAILABLE 后的复杂逻辑
- 大量统计计数更新

实现建议：

- 引入异步事件通道（in-process channel 或轻量队列）
- 调度主路径固定为：

```
请求 → 节点选择 → 写入绑定 → 返回 node_id
```

- 下列事件改为异步处理：
  - 节点上线/下线
  - 模型缺失（MODEL_NOT_AVAILABLE）
  - 统计计数更新（写入聚合模块）

**落地提示（兼容“现在单机、未来 cluster”）：**

- **Dashboard/统计必须改为读“快照”**：后台任务每 5–10 秒刷新一次快照，HTTP 请求只读快照，避免请求路径遍历全量状态。
- **Model Hub 服务包列表必须做缓存**：后台刷新（例如 30 秒一次），统计快照生成时只读缓存，避免控制面请求路径出现外部网络 IO。
- **这些模块建议以可替换接口/组件形态存在**：单机时用进程内缓存，未来 cluster 时可替换为 Redis/独立聚合器，而无需改调度主路径。

---

### Phase 2：多实例 Scheduler（横向扩展）

当节点 > 100 或并发会话 > 1,000，建议切入 Phase 2：

#### 5.1 目标架构

```
        [API Gateway / LB]
              |
   ┌──────────┴──────────┐
   │     Scheduler A     │
   │     Scheduler B     │  ← 多副本（无状态/轻状态）
   │     Scheduler C     │
   └──────────┬──────────┘
              |
         [Redis Cluster]
   (节点状态 / 会话绑定 / 令牌 / 去抖)
```

#### 5.2 核心策略

- Scheduler 实例尽量无状态
- Redis 承载热状态（可过期、可恢复）
- 调度流程：**快照读取 → 本地评分 → 原子提交（CAS/Lua）**
- Dashboard 读取统计快照（来自统计聚合器或 Redis 的 snapshot keys）

#### 5.3 当前落地状态（实现已完成）

Phase 2 已在代码侧完成落地，并提供 Redis Cluster 自动化验收入口：

- 实现总览：`central_server/scheduler/docs/phase2_implementation.md`
- Streams/DLQ 运维：`central_server/scheduler/docs/phase2_streams_ops.md`
- Cluster 一键验收脚本：`central_server/scheduler/scripts/phase2_cluster_acceptance.ps1`

#### 5.4 上线前建议开发顺序（扩展改造的“收口路径”）

在 Phase 2 主干已完成的前提下，建议按以下顺序推进“可上线”的扩展改造（比直接进入 Phase 3 更稳）：

1. **真实链路自动化 E2E + 故障注入**
   - 两个 Scheduler + 真实 node + 真实 session（node 连 A，session 连 B），验证 JobAssign/partial/result/timeout/failover 全链路
   - 故障注入：kill 一个 scheduler、断 Redis、断 node/ws，验证恢复与重复执行是否受控
2. **压测与长稳（soak）**
   - 控制面调度请求压测：QPS/延迟/P95/P99 与“线性扩展”验证
   - 心跳/快照/Streams 写入压测：Redis 写放大/slot 分布/热点 key 检查
   - 长稳运行：观察 pending、DLQ、key 增长与资源泄漏风险
3. **监控告警 + 运维 SOP**
   - Prometheus/Grafana：pending、DLQ、reclaim、redis op 错误率等指标面板
   - 告警阈值与处置手册（含 DLQ 分析/清理/回放建议）
4. **再进入 Phase 3（分片/两级调度/多区域隔离）**
   - 在已有监控与压测基线下推进 Phase 3，更容易量化收益与控制风险

---

### Phase 3（可选）：调度分片 / 两级调度

仅在：节点 > 1,000、多区域、多租户、需隔离故障域时考虑。

- 方案 A：按 room_id / tenant_id 分片（consistent hashing）
- 方案 B：两级调度（Global 选资源池，Pool 选具体节点）

#### 方案 B 的“强隔离 + 长期演进”落地形态（推荐）

为实现 **按能力做强隔离**、同时保持 **运维成本低 / 问题可快速定位 / 功能可验证**，建议将两级调度拆成两层概念：

- **能力池（capability pools）**：用配置显式定义 pool（pool_id/name/required_services），节点按“已安装服务包 installed_services”匹配进入某个 pool  
  - 若一个节点同时匹配多个 pool：使用 node_id + hash_seed 做稳定 hash 分配（避免所有节点都落到第一个 pool）
- **租户隔离（tenant override）**：可将 tenant_id 显式绑定到某个 pool_id，实现强隔离（故障域/容量/灰度）
- **资格匹配范围（pool_match_scope）**：
  - `core_only`：只按 ASR/NMT/TTS 核心服务做 pool 级过滤（兼容性最好）
  - `all_required`：按 required_model_ids 全量做 pool 级过滤（最强隔离；需要 pool.required_services 覆盖完整）
- **严格模式（strict_pool_eligibility）**：当 pools 非空但没有 eligible pool 时直接失败（避免“隐式回退”破坏隔离）

> 兼容性：若 `scheduler.phase3.pools` 为空，则继续沿用“hash 分桶（pool_count/hash_seed）”的旧模式。

#### 运维与可观测（关键）

- Prometheus：
  - `phase3_pool_selected_total{pool,outcome,fallback}`：是否命中 pool，是否发生 fallback
  - `phase3_pool_attempt_total{pool,result,reason}`：每次 pool 尝试的结果与原因（支持 `missing_core_*_installed/not_ready` 低基数细分）
- Debug API：
  - `GET /api/v1/phase3/pools`：查看每个 pool 的 total/online/ready，以及核心服务 installed/ready 覆盖与示例节点（用于快速定位）

#### 配置示例（节选）

参考：`central_server/scheduler/config.toml` 中的 `[scheduler.phase3]` 注释示例（pools / tenant_overrides / pool_match_scope / strict_pool_eligibility）。

---

## 6. 容量规划建议（参考值）

> 注意：以下为控制面指标参考，需结合实际 CPU、网络、Redis 延迟以及调度请求模式（新建/重连/切换频率）进行压测校准。

### 6.1 单实例 Scheduler（Phase 0 / 1）

| 指标 | 建议上限（参考） |
|---|---:|
| 调度请求（控制面） | ~5k QPS |
| 节点数 | ~100 |
| 并发会话 | ~1k |
| 心跳总写入（如由 Scheduler 处理） | 建议 < 5k/s（需 jitter） |

### 6.2 多实例 Scheduler（Phase 2）

- Scheduler 实例数：按控制面 QPS 线性扩展（例如 3–5 副本起步）
- Redis：建议 cluster 模式；避免单点与热 key
- 统计模块：允许 5–10 秒延迟，避免压垮控制面

---

## 7. Redis 设计（Phase 2 关键补充）

### 7.1 设计目标与约束

**目标：**

- 支持多实例 Scheduler 并发调度
- 支持节点在线 TTL 与快速过滤
- 支持会话→节点绑定的原子写入与租约（lease）
- 支持去抖/限流，抑制 MODEL_NOT_AVAILABLE 风暴
- 支持轻量统计快照（可选）

**约束：**

- 避免在 Redis 上做重 OLAP 聚合
- 避免单 key 热点（高并发写同一 key）
- 所有关键写操作必须原子化（Lua 或 CAS）
- 所有控制面接口必须幂等（request_id）

---

### 7.2 Key Space 规划与命名规范

建议统一前缀与版本：

- 前缀：`lingua:`
- schema 版本：`v1`（便于未来迁移）

Key 族示例：

- `lingua:v1:nodes:*`
- `lingua:v1:sessions:*`
- `lingua:v1:locks:*`
- `lingua:v1:events:*`
- `lingua:v1:stats:*`

#### 7.2.1 与当前实现对齐的 Key 约定（重要）

当前实现中，Redis key 分为两类（均由 `scheduler.phase2.redis.key_prefix` 控制前缀）：

- **基础链路 key（不带 v1）**：用于 owner/presence/streams（多实例路由与投递）
  - `{prefix}:schedulers:presence:<instance_id>`
  - `{prefix}:nodes:owner:{node:<node_id>}`
  - `{prefix}:sessions:owner:{session:<session_id>}`
  - `{prefix}:streams:{instance:<instance_id>}:inbox`
  - `{prefix}:streams:{instance:<instance_id>}:dlq`

- **v1 schema key（带 `:v1`）**：用于可演进的状态外置（snapshot/binding/reserved/job fsm）
  - `{prefix}:v1:nodes:all`
  - `{prefix}:v1:nodes:last_seen`
  - `{prefix}:v1:nodes:presence:<node_id>`
  - `{prefix}:v1:nodes:snapshot:<node_id>`
  - `{prefix}:v1:requests:lock:<request_id>`
  - `{prefix}:v1:requests:binding:<request_id>`
  - `{prefix}:v1:nodes:{node:<node_id>}:reserved`
  - `{prefix}:v1:jobs:{job:<job_id>}:fsm`

> 注：`{...}` 为 Redis hash tag，用于 Redis Cluster 下把相关 key 固定到同一 slot，确保 Lua/原子操作可用。

---

### 7.3 节点状态（Node Presence & Capability）

#### 7.3.1 在线状态（Presence）

**Key：**

- `lingua:v1:nodes:presence:<node_id>`（String）

**Value：**建议存简化内容（避免大 JSON）：

- `ts=<epoch_ms>;region=<optional>`

**TTL：**

- `ttl = heartbeat_interval * 3`（例如 10s 心跳 → TTL 30s）

**写入：**

- `SET key value EX <ttl>`（或 `SETEX`）
- 心跳加 jitter（±20%）避免同秒集中写入

**在线判断：**

- 以 presence key 是否存在为准

---

#### 7.3.2 能力快照（Capabilities Snapshot）

**Key：**

- `lingua:v1:nodes:caps:<node_id>`（Hash）

**字段建议（扁平化）：**

- `cpu_usage`（0–100）
- `gpu_usage`（0–100；无 GPU 或未知用 -1）
- `mem_usage`（0–100）
- `current_jobs`（整数）
- `max_jobs`（整数）
- `features`（bitset 或逗号分隔，例如 `emotion,speaker_id,...`）
- `models_digest`（摘要字符串；如过大请改为索引集合）
- `services_digest`（服务包摘要；如过大请改为索引集合）
- `region` / `zone`（可选）
- `updated_at`（epoch_ms）

**TTL：**

- 可不设 TTL（由 presence 决定在线）
- 或设较长 TTL（10–30 分钟）用于诊断与快速恢复

---

### 7.4 候选节点索引（Candidate Index）

> 当节点数量增长，单次调度遍历全量 nodes 会变慢，可引入“轻索引”以减少候选集。建议先快照过滤，后索引化。

#### 7.4.1 按 region 的在线节点集合（可选）

- `lingua:v1:nodes:online:set:<region>`（Set：node_ids）

维护注意：

- Set 成员不随 presence TTL 自动删除
- 调度时必须二次校验 presence（惰性剔除）
- 或由后台任务周期清理（需锁/leader）

#### 7.4.2 按模型/服务包的索引（中后期再做）

- `lingua:v1:index:model:<model_id>@<version>`（Set：node_ids）
- `lingua:v1:index:service:<service_id>@<version>`（Set：node_ids）

权衡：

- 优点：候选集显著变小，调度更快
- 代价：写放大、索引一致性维护成本

---

### 7.5 会话绑定（Session → Node Binding）

#### 7.5.1 绑定 Key

- `lingua:v1:sessions:bind:<session_id>`（Hash）

字段：

- `node_id`
- `lease_id`
- `lease_expire_ts`
- `request_id`（幂等）
- `updated_at`

TTL：

- 建议 TTL 为会话超时 2–3 倍（或由业务显式释放）

#### 7.5.2 原子写入要求

存在并发：重连、重试、多实例同时处理。要求：

- 同一 `request_id` 重试必须返回同一结果（幂等）
- 有效 lease 不应被非抢占请求覆盖
- 绑定写入必须用 Lua 或 CAS 实现原子检查与写入

**Lua 逻辑（示意）：**

1. 读取现有 bind
2. 若 `request_id` 相同 → 返回现有 `node_id`
3. 若 lease 未过期 → 返回“已绑定”（附 node_id）
4. 否则写入新 bind，并设置 lease

> 实现时建议使用 Redis TIME 或统一 server_ts，避免时钟漂移。

---

### 7.6 并发控制（节点容量扣减）

仅依赖节点自报 `current_jobs` 会有“超卖”风险。建议引入原子计数：

#### 7.6.1 计数 Key

- `lingua:v1:nodes:jobs:<node_id>`（Hash 或 String）

字段：

- `current_jobs`
- `max_jobs`

#### 7.6.2 调度时原子扣减

推荐 Lua：

- 检查 `current_jobs < max_jobs`
- `current_jobs += 1`
- 写入 session bind
- 返回成功

释放时：

- `current_jobs -= 1`（确保不为负）

> 必须保证“绑定成功”和“计数扣减”在同一原子脚本中完成，否则容易资源泄漏或超卖。

#### 7.6.3 Redis Cluster 重要约束（必须提前写进方案）

如果 Phase 2 采用 **Redis Cluster**，则使用 Lua/事务进行原子更新时存在关键限制：

- **同一个 Lua 脚本中访问的所有 Key 必须落在同一个 hash slot**（否则会直接报错，无法执行）。
- 因此，“session bind + node jobs 计数”这类需要同脚本原子完成的操作，Key 设计必须使用 **hash tag**（`{...}`）来强制同 slot。

示例（按 node_id 归并到同 slot，仅示意命名结构）：

- `lingua:v1:{node:<node_id>}:jobs`
- `lingua:v1:{node:<node_id>}:session_bind:<session_id>`

或（按 shard 归并）：

- `lingua:v1:{shard:<k>}:nodes:jobs:<node_id>`
- `lingua:v1:{shard:<k>}:sessions:bind:<session_id>`

> 建议：**现在单机部署可先用单实例 Redis（主从/哨兵）** 简化落地；当确需 Redis 本身横向扩展时，再引入 Cluster 并同步完成 hash tag 的 Key 重构与迁移策略。

---

### 7.7 MODEL_NOT_AVAILABLE 风暴防护（去抖 / 限流）

#### 7.7.1 模型版本去抖（推荐）

- `lingua:v1:debounce:model_unavailable:<model_id>@<version>`（String）

写入：

- `SET key 1 NX EX <window>`（window 推荐 3–10s）

行为：

- SET 成功 → 触发一次“昂贵操作”（例如重调度策略更新/广播/降级）
- SET 失败 → 仅计数，不做昂贵操作

#### 7.7.2 节点级限流（可选）

- `lingua:v1:ratelimit:node:<node_id>:model_na`（String counter）

可用 INCR + EX 实现固定窗口限流，或更成熟的令牌桶。

---

### 7.8 锁（可选：后台任务/清扫/聚合）

- `lingua:v1:locks:<task_name>`
- `SET key <owner> NX PX <ttl>`

用途：

- 后台清扫过期 set 成员
- 统计聚合 leader
- 分片路由表维护

---

### 7.9 统计快照（建议）

Dashboard 不应实时聚合海量状态。建议：

- 聚合器每 5–10 秒写一次 snapshot
- Dashboard 只读 snapshot

Key：

- `lingua:v1:stats:snapshot`（String：JSON；TTL 30–60s）

---

## 8. 最小可行落地清单（Phase 2）

建议按最小切片逐步落地：

1. Presence + Caps 外置（Redis）
2. Session Bind 外置 + 幂等 request_id
3. 绑定与节点并发计数的原子化 Lua
4. MODEL_NOT_AVAILABLE 去抖 key
5. Dashboard 改为读取 snapshot（统计与调度主路径解耦）

---

## 9. 风险与注意事项

1. 不要在早期过度引入分布式复杂度：Phase 0/1 以交付为主
2. 控制面扩展优先于算法微优化（先解耦、再优化评分）
3. Dashboard 必须与调度主路径解耦
4. 所有调度接口必须幂等（request_id）
5. Redis key 设计要避免热点与大 value（模型列表建议摘要/索引化）

---

## 10. 总结

- 当前 Scheduler 设计是正确且专业的第一阶段实现
- 扩展风险可预测，且存在清晰演进路径
- 推荐优先实施 Phase 1（纯控制面化）
- Phase 2（多实例 + Redis 状态外置）可在业务增长时平滑引入
- 本文补充了 Phase 2 所需的 Redis key schema 与原子操作策略，足以支撑开发部门评审与实现
