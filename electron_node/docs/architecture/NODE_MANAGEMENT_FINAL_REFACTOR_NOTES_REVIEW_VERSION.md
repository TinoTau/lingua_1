# NODE_MANAGEMENT_FINAL_REFACTOR_NOTES_REVIEW_VERSION.md

# 节点管理最终重构方案（正式评审稿）
版本：2026-01-22  
状态：评审中（Review Draft）  
适用范围：调度服务器（Scheduler）Node Management 子系统  
关联文档：
- 《决策部门审议文档_新架构》
- 《Pool 管理流程与架构矛盾技术报告》
- 《SCHEDULER_DETAILED_FLOW_2026_01_21》
- 《POOL_REFACTOR_REDIS_BACKED_LAYERED_SHARDING_DESIGN》
- 《POOL_LAYERED_SHARDING_SUPPLEMENT_MULTILANG_AND_CODE_SKELETON》

---

# 目录
1. 概述  
2. 设计目标  
3. 当前架构问题总结  
4. 最终架构设计  
5. 接口与数据结构  
6. 核心流程（Register / Heartbeat / Offline）  
7. 可选增强与风险控制  
8. Task List（落地执行）  
9. 附录：流程图与 Redis Key Schema  

---

# 1. 概述

本评审稿旨在对调度服务器的“节点管理（Node Management）”进行全面重构，以实现：

- 逻辑最简化（Simple）  
- 状态统一来源（Single Source of Truth）  
- 无冲突（No Divergence）  
- 易排查（Debuggable）  
- 高可扩展（Future-Proof）

节点管理被认定为调度服务器最基础的模块，其行为会直接影响：

- Pool 生成与 Pool 分配  
- 各类服务发现  
- 调度决策正确性  
- 多语言集群扩容能力

故本模块必须保持干净、无历史负债、无隐藏状态。

---

# 2. 设计目标

## 2.1 单一真实来源（SSOT）
节点所有关键状态必须唯一存放在 **Redis**：

- 在线状态  
- TTL  
- 语言能力（LangSets）  
- region  
- gpu_tier  
- Pool 归属（node:pools）  

非 Redis 的本地结构必须视为“缓存”，不可被依赖作决策。

## 2.2 去状态化（Stateless）
节点管理不得维护：

- 本地 pool 索引  
- 本地 pool_ids  
- 本地语言索引  
- 本地服务类型索引  

所有“跨节点、跨服务”的信息都必须通过 Redis 查询。

## 2.3 异常路径可预测
Node 重启、进程崩溃、网络抖动等异常情况必须有：

- 明确的 Redis TTL 行为  
- 符合预期的下线清理逻辑  
- 可追踪的快照  

避免“看起来在线但不接受任务”的状态漂移。

---

# 3. 当前架构问题总结（Before → After）

| 问题类型 | Before（旧架构） | After（新架构） |
|---------|------------------|------------------|
| Pool 归属双源冲突 | Redis + management_registry | **只看 Redis** |
| 本地 pool_ids | 经常过期、不同步、误导 UI | **删除** |
| 心跳逻辑夹杂 Pool 更新 | 心跳 → 多模块联动 → 难排查 | **Lua 原子更新** |
| 下线逻辑不一致 | disconnect 触发本地清理 vs TTL | **Redis TTL 主导** |
| 节点在线判定不一致 | WebSocket 在线 ≠ 可调度在线 | **明确职责分离** |
| Phase3 遗留结构 | 部分调用已无意义 | **全部移除** |

---

# 4. 最终架构设计

## 4.1 架构总览（Node Management 部分）

```
┌──────────────────────────┐
│       Node（节点端）      │
└──────────────┬───────────┘
                 WebSocket
┌─────────────────▼──────────────────┐
│     Scheduler：MinimalScheduler     │
│  (只处理注册/心跳/下线，不做 Pool)   │
└──────────────┬────────────────────┘
                调用 Lua
         ┌──────▼────────────────────┐
         │       Redis + Lua          │
         │  (节点状态 + Pool 分配)    │
         └──────┬────────────────────┘
                只读
┌────────────────▼───────────────────┐
│  Scheduler：PoolService / NodeIndex│
│  (从 Redis 构建 PoolView / Shards) │
└────────────────┬───────────────────┘
                 只读
┌────────────────▼───────────────────┐
│ Scheduler：SnapshotManager (UI用)  │
└─────────────────────────────────────┘
```

核心原则：

### 4.1.1 MinimalSchedulerService → 只做写  
- 注册：写 Redis  
- 心跳：Lua atomic 更新 TTL + Pool 分配  
- 下线：Lua atomic 清理  

### 4.1.2 PoolService / NodeIndex → 只做读  
- 不存本地状态  
- 所有信息从 Redis 读取  

### 4.1.3 SnapshotManager → 无 Pool 状态  
- 若 UI 需展示 Pool → 调 PoolService API，从 Redis 获取  

---

# 5. 接口与数据结构

## 5.1 Redis Node结构（规范）

Key: `lingua:v1:node:{node_id}`  
结构（Hash）：

```json
{
  "region": "ap-southeast-2",
  "gpu_tier": "standard",
  "lang_sets": "[["en","zh"],["en","ja","zh"]]",
  "last_heartbeat_ts": 1737443211,
  "status": "online"
}
```

## 5.2 Redis Pool结构（规范）

Key: `lingua:v1:node:{id}:pools`  
Value: Set  
内容：PoolShardIDs（或 JSON 表示）

---

# 6. 核心流程说明

## 6.1 注册流程（RegisterNode）

```
WS: register  
→ MinimalSchedulerService.handle_node_register  
    → Lua: register_node_v2.lua  
    → 写 Redis Hash  
    → ManagementRegistry.update(node_base_info)  
← 返回成功
```

无 Pool 分配、无快照更新。

## 6.2 心跳流程（Heartbeat）

```
WS: heartbeat
→ MinimalSchedulerService.handle_node_heartbeat  
    → Lua: heartbeat_with_pool_assign.lua  
        * 更新 last_heartbeat  
        * 更新 TTL  
        * 更新 node:pools  
    → ManagementRegistry.update_heartbeat(node_id)
```

**注意：**  
Pool 分配只发生在 Lua，不允许本地逻辑干预。

## 6.3 下线流程（Offline）

```
WS disconnect (best effort)
→ MinimalSchedulerService.on_node_disconnect  
    → Lua: node_offline.lua （清理 Pool）  
    → ManagementRegistry.mark_offline
```

Redis TTL 仍是最终线下判定。

---

# 7. 可选增强与风险控制

## 7.1 在线状态对账任务（可选）

每 30 秒对 Redis → ManagementRegistry 进行单向同步，避免 UI 看到错误“在线”。

## 7.2 PoolSnapshot 不缓存（强制）

为了减少状态漂移，PoolSnapshot 在每次 GET pool snapshot 时实时从 Redis 构建。

## 7.3 多语言超集匹配（可选）

若节点支持 `["en","zh","ja"]`  
调度请求为 zh→en  
PoolService 需允许超集匹配。

---

# 8. Task List（落地执行）

## 8.1 删除字段

- [ ] 删除 NodeState.pool_ids  
- [ ] 删除 NodeSnapshot.pool_ids  
- [ ] 删除任何 pool 相关本地缓存  
- [ ] 删除 Phase3 遗留结构

## 8.2 调整节点管理逻辑

- [ ] MinimalSchedulerService：取消任何本地 pool 更新  
- [ ] ManagementRegistry：明确 online 字段语义（WebSocket 状态）  
- [ ] SnapshotManager：不再从本地生成 Pool 信息

## 8.3 Redis/Lua

- [ ] register_node_v2.lua：写 lang_sets / region / gpu_tier  
- [ ] heartbeat_with_pool_assign.lua：执行 Pool 分配  
- [ ] node_offline.lua：执行 Pool 清理  

## 8.4 PoolService / NodeIndex

- [ ] 引入 LangSet（多语言互译）  
- [ ] 支持 region × gpu_tier 分层  
- [ ] 支持多语言超集匹配  
- [ ] 生成 PoolView + Shards  

---

# 9. 附录：流程图与 Redis Key Schema

（流程简图略，按需扩展）

Redis Key Schema：

```
lingua:v1:node:{id}            // 节点哈希
lingua:v1:nodes:all            // 在线节点集合
lingua:v1:node:{id}:pools      // Set，节点所属 Pool
lingua:v1:pools:{langset}:{region}:{gpu}:{shard_id} // Shard 内容
lingua:v1:pools:snapshot       // 最终快照(JSON)
```

---

# 结语

通过本次重构，节点管理模块将实现：

- 无矛盾状态  
- 无双源冲突  
- 逻辑干净、易排查  
- 完整支持未来多语言、多区域、多算力池化架构  

本评审稿建议作为调度服务器新架构的**最终节点管理规范**执行。

