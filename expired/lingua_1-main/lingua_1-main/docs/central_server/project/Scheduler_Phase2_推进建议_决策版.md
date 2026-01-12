# Scheduler Phase 2 推进建议（决策版）

> 文档版本：v1.0  
> 更新日期：2025-12-19  
> 适用对象：决策部门 / 基础设施 / 后端架构评审  
> 关联文档：  
> - `central_server/docs/project/Scheduler_当前架构与Phase1拆分优化说明_决策版.md`  
> - `central_server/docs/project/Scheduler_Phase1_补充技术规范与实现清单_v1.1.md`  
> - `central_server/docs/project/Scheduler_扩展与容量规划说明_含Redis设计.md`  

---

## 1. 一页结论（Executive Summary）

### 1.1 当前系统状态（可交付性）

- **当前 Scheduler（Phase 1）可单机稳定运行**：具备节点注册/心跳、节点选择、任务创建与派发、结果回传、统计接口与 Dashboard 支撑能力。
- **Phase 1 已完成“纯控制面化的关键拆分”**：将统计与 ModelHub 外部 IO 从请求路径移除，控制面路径更短更稳定，为 Phase 2 的 Redis/多实例做了接口预留。

### 1.2 当前改造目标（Phase 2）

Phase 2 的目标不是“单纯引入 Redis”，而是实现两项能力：

1. **控制面可水平扩展**：支持多实例 Scheduler 并发处理调度请求，关键状态外置到 Redis，并具备原子一致性（幂等绑定 + 并发占用）。
2. **在多实例下保持全链路可用**：由于当前 Scheduler 同时承载 WebSocket（session/node）与任务下发/结果回传，多实例必须解决**跨实例消息投递**（否则会出现“选中节点不在本实例连接上”的断链）。

### 1.3 关键建议（决策点）

- **Redis Cluster 可以“单机部署”并按集群标准开发**：在一台机器上启动多个 `redis-server` 端口组成 Cluster。建议这样做，以便从一开始就按 Cluster 约束（hash slot/Lua）设计，避免后续返工。
- **Scheduler 多实例在“单机环境”同样可推进**：同机跑 2–4 个 Scheduler 进程 + 本机 LB + 本机 Redis（Cluster）。但必须补齐“连接归属 + 跨实例投递”机制，否则多实例不可用。
- **推荐推进路线**：先完成 Redis 状态外置与 Lua 原子提交（即便 Scheduler 仍单实例也可收益明显），再补齐跨实例投递能力，最后启用多 Scheduler 副本与 LB。

---

## 2. 已完成的开发进度（Phase 1 落地项）

以下内容已在代码侧落地（与 Phase 1 文档一致）：

### 2.1 Dashboard/统计快照化（控制面稳定性提升）

- `/api/v1/stats` 改为只读后台生成的快照（避免每次请求遍历全量状态）。
- 冷启动兜底遵循 SingleFlight + 频率约束思想（不阻塞请求路径）。

### 2.2 ServiceCatalogCache 缓存化（移除外部网络 IO 依赖）

- 服务目录从 ModelHub 定期后台刷新，统计生成时只读缓存，避免控制面请求路径出现外部 HTTP 调用。
- 支持本地 `services_index.json` 兜底（单机冷启动/离线场景可用）。

### 2.3 MODEL_NOT_AVAILABLE 事件处理（异步入队 + 快速纠偏）

- 主路径只入队（不做重计算/阻塞），后台 worker 对节点服务做短 TTL 的“暂不可用标记”，调度选择时跳过。
- 支持节点级限流与去抖窗口（Phase 1 先在进程内完成）。

### 2.4 任务级幂等 request_id + lease（避免重复派发/重复占用）

- `request_id` 在 lease 内重试复用同一 Job（避免重复创建/重复派发）。
- 并发占用采用 `reserved_jobs` 机制补强心跳滞后，降低超卖风险（Phase 1 单实例语义一致性成立）。

---

## 3. 当前架构现实约束（为什么 Phase 2 不止是“加 Redis”）

### 3.1 Scheduler 仍是“控制面 + 连接面（部分数据面）”合体

当前实现中，Scheduler 同时承担：

- WebSocket 会话入口（Web 客户端 session）
- WebSocket 节点入口（node 连接）
- 任务下发（Scheduler → node）与结果回传（node → Scheduler → session）

因此一旦启用多实例：

- **调度与下发可能落在不同实例**：实例 A 选中 node X，但 X 的连接在实例 B → A 无法下发 job。
- **结果回传与推送可能落在不同实例**：node 的回传到 B，但对应 session 在 A → B 无法将结果推送给 session。

结论：要实现 Scheduler 多实例，必须有跨实例“消息投递/转发/路由”能力；仅靠 Redis 外置状态不足以让链路可用。

---

## 4. Phase 2 的改造目标与范围

### 4.1 Phase 2 目标（对齐容量规划文档）

对齐《Scheduler_扩展与容量规划说明_含Redis设计.md》中 Phase 2 的定义：

- Scheduler 实例尽量无状态（或轻状态）
- Redis 承载热状态（可过期、可恢复）
- 调度流程：**快照读取 → 本地评分 → 原子提交（Lua/CAS）**
- Dashboard 读取统计快照（允许 5–10 秒延迟）

### 4.2 必须落地的最小能力（MVP）

1. **节点状态外置（Presence + Caps）**
2. **会话/任务绑定外置（request_id 幂等 + lease）**
3. **并发槽计数外置，并与绑定原子一致（Lua）**
4. **MODEL_NOT_AVAILABLE 去抖/限流跨实例一致（Redis key）**
5. **stats snapshot 可外置（Redis snapshot + TTL，或独立聚合器）**

---

## 5. 关键技术决策：Redis Cluster “单机部署”可行性与注意事项

### 5.1 结论

- **可行**：Redis Cluster 可以在一台机器上用多个实例组成，满足“当前单机完成整个系统功能”的运行诉求，同时让开发直接面向集群约束。

### 5.2 必须提前确认的硬约束（否则会返工）

- **Lua/事务原子更新限制**：在 Redis Cluster 中，Lua 脚本访问的所有 key 必须落在同一个 hash slot，否则脚本无法执行。
- 因此，Phase 2 的核心原子操作（例如“session bind + node jobs 计数扣减”）必须从一开始就采用 **hash tag `{...}`** 设计 key，使脚本涉及 key 强制落在同 slot。

> 备注：上述约束已在决策版文档与容量规划文档中明确列出，Phase 2 实施必须严格遵守。

---

## 6. 推荐推进路线（单机环境先跑通，随后自然扩展到多机）

### 6.1 路线总览（分三段，逐步启用）

**阶段 A：Redis Cluster-ready 的状态外置（Scheduler 仍可单实例运行）**

- 目标：先把“状态一致性与原子性”做对，单实例也直接受益（避免超卖、幂等、风暴控制）。
- 交付：Presence/Caps、Bind、Jobs 计数、MODEL_NOT_AVAILABLE 去抖 key、stats snapshot key（可选）。

**阶段 B：补齐 Scheduler 多实例的跨实例投递能力（仍在单机运行）**

- 目标：让多个 Scheduler 副本在同机运行时链路不断（job 下发与结果推送可跨实例投递到持有连接的一方）。
- 交付：连接归属表（node/session owner）+ 跨实例投递通道 + 本地消费/投递 worker。

**阶段 C：启用 LB 与多副本（同机 → 多机可平移）**

- 目标：在一台机器上先以 2–4 副本运行（验证并发/容错），随后可直接迁移到多机部署。

### 6.2 阶段 A：状态外置与原子一致（建议最先做）

- **外置节点状态**
  - presence：TTL + jitter（在线判断以 key 是否存在为准）
  - caps：扁平化字段，避免大 JSON
- **外置绑定与并发计数（核心）**
  - request_id 幂等 + lease
  - “绑定成功 ≈ 并发占用”必须用 Lua 原子脚本合并提交
  - 释放操作必须幂等，防止负数与泄漏
- **MODEL_NOT_AVAILABLE**
  - 去抖/限流 key：`SET NX EX window`，将“昂贵操作预算”跨实例一致化

验收标准（示例）：

- 同 request_id 重试不会重复创建/重复占用
- 并发占用不会超卖（高并发压测下 `current_jobs <= max_jobs`）
- MODEL_NOT_AVAILABLE 风暴不拖垮调度主路径（主路径仅入队/轻操作）

### 6.3 阶段 B：连接归属 + 跨实例投递（启用 Scheduler 多实例的前置）

为兼容“当前 Scheduler 持有 WebSocket 连接”的现实，推荐采用：

- **连接归属（owner）写入 Redis（带 TTL）**
  - `nodes:owner:<node_id> -> instance_id`
  - `sessions:owner:<session_id> -> instance_id`
- **跨实例投递通道（按 instance_id 分流）**
  - 选项 1：Redis Pub/Sub（实现简单、低延迟；可靠性较弱）
  - 选项 2：Redis Streams（可重放、可消费组；实现复杂度更高）

验收标准（示例）：

- 多实例下，A 实例可将 job 下发“投递”到 B 实例，由 B 通过 node WebSocket 发送成功
- node 回传结果可投递到拥有 session 连接的实例并推送到客户端

### 6.4 阶段 C：LB + 多副本运行（同机验证 → 多机平移）

- 同机启动多个 Scheduler 进程，使用本地 LB（可先 sticky，后逐步取消对控制面请求的强依赖）
- 先灰度 5% 流量验证，再全量

---

## 7. 风险清单与规避建议

### 7.1 最大风险：多实例下 WebSocket 连接分散导致链路断裂

- 规避：必须落地“连接归属 + 跨实例投递”，否则无法启用 Scheduler 多副本。

### 7.2 Redis Cluster 下 Lua 脚本跨 slot 失败

- 规避：从 Phase 2 开始就采用 hash tag 设计 key，确保原子脚本访问 key 同 slot。

### 7.3 热 key / 写放大

- 规避：避免单 key 聚合写；需要索引时采用分片/惰性清理；统计聚合不要在 Redis 上做重 OLAP。

---

## 8. 建议的决策结论（供评审会议直接拍板）

建议决策部门确认以下事项，以便 Phase 2 快速推进：

1. **采用 Redis Cluster（单机部署）作为 Phase 2 的目标运行形态**：开发直接面向 Cluster 约束，减少后续迁移成本。
2. **Phase 2 分两步交付**：
   - 先交付“状态外置 + 原子一致”（Scheduler 可仍单实例运行）
   - 再交付“连接归属 + 跨实例投递”（使 Scheduler 多实例真正可用）
3. **跨实例投递通道的选择**：优先 Pub/Sub（快），若对可靠性/可追溯要求更高则选 Streams。


