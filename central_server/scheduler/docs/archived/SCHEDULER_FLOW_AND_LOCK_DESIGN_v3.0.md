# SCHEDULER_FLOW_AND_LOCK_DESIGN_v3.0.md
调度服务器流程与锁模型（3.0 合并版）
====================================================

本文件为调度服务器的 **最终版流程规范（v3.0）**  
目标：统一架构、消除冗余、补全缺失流程、明确锁模型、提供开发可直接落地的 TaskList & Checklist。

适用范围：节点端翻译服务、调度服务器（多实例）、Redis 共享状态、Web 端实时翻译任务（面对面/会议室）。

---

# 1. 架构总览（Management / Runtime / Session 三域模型）

本架构将调度服务器拆分为三个独立域，消除历史冗余逻辑：

```
┌──────────────────────────────────────────────┐
│ Management Domain（冷路径，唯一真相源）        │
│ - ManagementRegistry.state (RwLock)          │
│ - NodeState / PoolConfig / PoolLanguageIndex │
│ - Phase3PoolIndex / Phase3CoreCache          │
└───────────────┬──────────────────────────────┘
                │ COW 构建快照
                ▼
┌──────────────────────────────────────────────┐
│ Runtime Domain（热路径，无锁/轻锁）            │
│ - RuntimeSnapshot (Arc<NodeRuntimeMap>)       │
│ - lang_index_snapshot (Arc)                   │
│ - PoolMembersCache (小锁)                     │
│ - Redis.try_reserve()                         │
└───────────────┬──────────────────────────────┘
                │ 仅保护 Session 内部状态
                ▼
┌──────────────────────────────────────────────┐
│ Session Domain（可选：每 Session 一把锁）        │
│ - preferred_pool                              │
│ - bound_lang_pair                              │
│ - session-level members cache                 │
└──────────────────────────────────────────────┘
```

---

# 2. 完整流程（v3.0）

## 2.1 节点注册流程

**实际实现（core.rs::upsert_node_from_snapshot）：**

```
1. 节点端请求 /register
2. ManagementRegistry.state.write():
      - 写入 nodes[node_id]: mgmt.update_node(node_id, node, pool_ids)
      - 更新语言索引：mgmt.lang_index（通过 update_node 触发重建）
      - 更新 pool 配置：mgmt.pools（Phase3 配置）
3. 写锁释放（drop(mgmt)）
4. 锁外执行：
      - Phase3: 更新 pool index（phase3_upsert_node_to_pool_index_with_runtime）
      - 更新 Redis: pool → members 列表（通过 phase2_runtime）
      - 更新 RuntimeSnapshot：snapshot_manager.update_node_snapshot(node_id)（COW 模式）
      - 更新 Phase3CoreCache：phase3_core_cache_upsert_node(updated_node)
```

---

## 2.2 心跳流程

**实际实现（core.rs::handle_node_heartbeat）：**

```
1. /heartbeat 上报健康/负载/能力
2. ManagementRegistry.update_node_heartbeat()（写锁，快速操作 < 10ms）:
      - 更新节点状态：cpu_usage, gpu_usage, memory_usage
      - 更新能力：installed_models, installed_services, language_capabilities
      - 更新并发数：current_jobs
      - 更新心跳时间：last_heartbeat
3. 写锁释放
4. 锁外操作（避免阻塞调度路径）：
      - 更新语言能力索引：language_capability_index.update_node_capabilities()
      - 更新 RuntimeSnapshot：snapshot_manager.update_node_snapshot(node_id)（COW 增量更新）
      - Phase3: 更新 pool 归属：phase3_upsert_node_to_pool_index_with_runtime()
      - 更新 Phase3CoreCache：phase3_core_cache_upsert_node()
```

---

## 2.3 Pool 成员管理流程（Redis）

```
节点能力/注册/下线触发 pool 更新 → Redis: pool:{pool_id}:members
调度读取 → Cache → Redis → Cache 更新
```

---

## 2.4 运行时快照（RuntimeSnapshot）

**实际实现（runtime_snapshot.rs）：**

快照包含：
- 节点运行状态：`nodes: Arc<NodeRuntimeMap>`（COW 模式）
  - NodeRuntimeSnapshot：健康、能力、并发、语言对、pool_ids、GPU、服务等
- 池语言索引：`lang_index: Arc<PoolLanguageIndex>`（只读，通过 COW 更新）
- Pool 成员缓存：`pool_members_cache: Arc<RwLock<PoolMembersCache>>`（轻量锁，预留）

更新规则（SnapshotManager）：

```
注册/心跳 → COW 增量更新：
  - snapshot_manager.update_node_snapshot(node_id)
  - 从 ManagementState 读取节点数据
  - 构建 NodeRuntimeSnapshot
  - COW 替换 Arc<NodeRuntimeMap> 中的节点项

能力变化/池配置变化 → 重建 index：
  - ManagementState.update_phase3_config() 重建 lang_index
  - snapshot_manager.update_lang_index_snapshot() 更新快照
```

---

## 2.5 调度流程（热路径零锁化）

**实际实现（job_creation.rs）：**

```
1. snapshot = SnapshotManager.get_snapshot().await.clone()  // 克隆快照，释放读锁
2. session_entry = SessionRuntimeManager.get_or_create_entry(session_id)
3. session_lock.lock():
       - 绑定 lang_pair: session_state.set_bound_lang_pair(src_lang, tgt_lang)
       - preferred_pool: 从 session_state.preferred_pool 读取（目前节点选择逻辑内部决定）
       - exclude_node_id: 根据 spread 策略决定（预留，待实现）
4. 节点选择（select_node_for_job_creation）：
       - 使用 snapshot_clone.lang_index 决定 pool
       - 从 Redis 读取 pool members
       - 过滤健康节点
       - redis.try_reserve(candidates)
5. 使用 snapshot_clone.nodes.get(node_id) 无锁访问节点能力
6. jobs.write() 新建 job（持锁极短）
```

**关键实现细节：**
- ✅ 调度路径完全零管理锁：使用 `snapshot.clone()` 后完全无锁访问
- ✅ Session 锁最小化：仅用于决定 `preferred_pool` 和绑定 `lang_pair`
- ✅ 快照使用 COW 模式：`RuntimeSnapshot.nodes: Arc<NodeRuntimeMap>`

---

## 2.6 Job 生命周期

```
JobCreated → NodeRunning → NodeFinished → Callback → CleanUp
失败时：try_reserve 回滚 + 节点降级
```

---

# 3. 冗余逻辑清除

**已完成：**

- ✅ 移除 `last_dispatched_node_by_session` 全局 map
  - 已替换为 `SessionRuntimeManager`（每个 session 一把锁）
  - 代码位置：`dispatcher.rs`、`job_creation.rs`、`job_management.rs`
  
- ✅ 调度路径零管理锁
  - 已移除调度路径上的 `nodes.read()`
  - 使用 `snapshot.clone()` 后完全无锁访问

**待完成：**

- ⏳ `PoolMembersCache` 替代直接 Redis 调用（目前仍从 Redis 直接读取）
- ⏳ `preferred_pool` 在 Session 锁内决定并存储（目前节点选择逻辑内部决定）

---

# 4. 缺失内容补全

本 v3.0 增补了：

- RuntimeSnapshot 架构 + 更新规则
- Job 生命周期与超时/回滚
- Redis 一致性（try_reserve/release）
- Session 状态绑定与缓存机制

---

# 5. TaskList（开发落地任务）

## 管理域
- [x] 全部节点&池管理改为 ManagementRegistry.state.write()
  - ✅ 实现位置：`management_state.rs::ManagementRegistry`
  - ✅ 节点注册：`core.rs::upsert_node_from_snapshot`
  - ✅ 心跳更新：`management_state.rs::update_node_heartbeat`
- [x] Phase3PoolIndex 并入 ManagementState
  - ✅ 实现位置：`management_state.rs::ManagementState.lang_index`
- [ ] 移除 nodes.write 等旧接口（部分标记为 `allow(dead_code)`，待清理）

## 运行域
- [x] 完整定义 NodeRuntimeSnapshot 字段
  - ✅ 实现位置：`runtime_snapshot.rs::NodeRuntimeSnapshot`
  - ✅ 包含：健康、能力、并发、语言对、pool_ids、GPU、服务、资源使用率等
- [x] 心跳/注册触发 COW 更新
  - ✅ 实现位置：`snapshot_manager.rs::update_node_snapshot`
  - ✅ 增量更新单个节点快照（COW 模式）
- [x] 删除所有调度路径上的 nodes.read
  - ✅ 已移除：`job_creation.rs` 中使用 `snapshot.clone()` 后无锁访问
- [x] 快照同步到 SnapshotManager
  - ✅ 实现位置：`snapshot_manager.rs`
  - ✅ 注册/心跳后调用 `update_node_snapshot`

## Redis
- [x] 实现 Lua try_reserve + release
  - ✅ 实现位置：`phase2/runtime_routing_node_capacity.rs`
  - ✅ `reserve_node_slot`、`release_node_slot`、`commit_node_reservation`
- [ ] PoolMembersCache + Redis 自同步（PoolMembersCache 已定义，但未实际使用）
- [x] Node concurrency rollback（通过 `release_node_slot` 实现）

## 调度路径
- [x] 使用 snapshot.lang_index 决定 pool
  - ✅ 实现位置：`job_creation.rs` 使用 `snapshot_clone.lang_index`
  - ✅ 节点选择逻辑内部使用 `lang_index.find_pools_for_lang_pair()`
- [ ] PoolMembersCache 替代直接 Redis 调用（目前仍从 Redis 直接读取）
- [x] 健康检查与过滤
  - ✅ 节点选择逻辑中过滤健康节点
- [x] 创建 Job 时写锁极小化
  - ✅ `jobs.write()` 持锁时间极短，仅用于创建/更新 job

## Session 层
- [x] SessionManager.get_or_create
  - ✅ 实现位置：`session_runtime.rs::SessionRuntimeManager`
  - ✅ 使用 `DashMap` 提供并发安全的 session 条目管理
- [x] Session-level preferred_pool/绑定状态
  - ✅ 实现位置：`session_runtime.rs::SessionRuntimeState`
  - ✅ `set_preferred_pool()`、`set_bound_lang_pair()`
  - ⚠️ 注意：`preferred_pool` 目前仍在节点选择逻辑内部决定，Session 中仅读取
- [x] 移除全局 last_dispatched map
  - ✅ 已完全移除 `last_dispatched_node_by_session`
  - ✅ 替换为 `SessionRuntimeManager` + `SessionRuntimeState`

## Job 层
- [x] 失败回滚（通过 `release_node_slot` 实现）
- [ ] Job cleanup 定时任务（待实现）

---

# 6. Checklist（设计与代码检查）

### 锁模型
- [x] 管理域只有一个写锁入口
  - ✅ `ManagementRegistry.state.write()` 是唯一写锁入口
  - ✅ 所有节点注册/更新/心跳都通过此入口
- [x] 管理锁内无重计算
  - ✅ 锁内仅更新状态，重计算（如 pool 索引更新）在锁外执行
- [x] 调度路径零管理锁
  - ✅ 使用 `snapshot.clone()` 后完全无锁访问
  - ✅ 调度路径不持有任何管理锁
- [x] Snapshot 用 Arc + COW
  - ✅ `RuntimeSnapshot.nodes: Arc<NodeRuntimeMap>`
  - ✅ `RuntimeSnapshot.lang_index: Arc<PoolLanguageIndex>`
  - ✅ 更新时创建新的 Arc，旧的继续使用
- [x] Session 锁不访问 Redis/管理域
  - ✅ Session 锁仅访问 `SessionRuntimeState`（preferred_pool, bound_lang_pair）
  - ✅ 不访问 Redis 或 ManagementRegistry

### 调度路径
- [x] snapshot.clone() 后完全无锁
  - ✅ 实现位置：`job_creation.rs::create_job`
  - ✅ `let snapshot_clone = snapshot.clone()` 后立即释放读锁
  - ✅ 后续所有操作使用 `snapshot_clone`，完全无锁
- [ ] PoolMembersCache 使用小锁（已定义但未实际使用，目前从 Redis 直接读取）
- [x] try_reserve 为唯一抢占手段
  - ✅ 实现位置：`phase2/runtime_routing_node_capacity.rs::reserve_node_slot`
  - ✅ 使用 Redis Lua 脚本原子性预留节点槽位
- [x] jobs.write 持锁极短
  - ✅ `create_job_phase1` 中 `jobs.write()` 仅用于创建 job，持锁时间 < 1ms

### Redis
- [x] try_reserve 原子性验证
  - ✅ 使用 Redis Lua 脚本实现原子性操作
  - ✅ 检查节点容量、健康状态、并发限制
- [x] failure 自动回滚
  - ✅ `release_node_slot` 释放预留的槽位
  - ✅ Job 失败时自动调用回滚
- [x] pool members 多实例一致性
  - ✅ 通过 Redis Set 存储 pool members
  - ✅ Phase2 运行时负责同步 pool members 到 Redis

### 健康&容错
- [x] 节点 RPC 失败触发降级
  - ✅ 节点选择逻辑中过滤健康节点
  - ✅ 健康检查基于 `NodeHealth` 状态
- [x] 超时回滚并发
  - ✅ `release_node_slot` 支持超时回滚
  - ✅ TTL 机制自动清理过期的预留
- [x] Snapshot.health 及时同步
  - ✅ 心跳更新后立即触发 `update_node_snapshot`
  - ✅ 快照中的 `NodeHealth` 从 `ManagementState` 实时同步

---

# 7. 实现状态总结

## 已完成的架构改进

1. **三域模型完全实现**
   - Management Domain：`ManagementRegistry` 统一管理锁 ✅
   - Runtime Domain：`RuntimeSnapshot` + `SnapshotManager` COW 模式 ✅
   - Session Domain：`SessionRuntimeManager` + `SessionRuntimeState` ✅

2. **调度路径零锁化**
   - 使用 `snapshot.clone()` 后完全无锁访问 ✅
   - Session 锁最小化，仅用于决定 preferred_pool 和绑定 lang_pair ✅

3. **冗余逻辑清除**
   - 移除 `last_dispatched_node_by_session` 全局 map ✅
   - 调度路径上移除所有 `nodes.read()` 调用 ✅

4. **快照机制完善**
   - COW 增量更新节点快照 ✅
   - 语言索引快照实时同步 ✅
   - 注册/心跳后自动触发快照更新 ✅

## 待优化项

1. **PoolMembersCache 实际使用**
   - 目前仍从 Redis 直接读取 pool members
   - 待实现：使用 `PoolMembersCache` 替代直接 Redis 调用

2. **preferred_pool 决定逻辑**
   - 目前在节点选择逻辑内部决定 preferred_pool
   - 待优化：在 Session 锁内根据 `lang_index` 决定 preferred_pool 并存储

3. **spread 策略实现**
   - Session 锁内预留了 spread 策略处理，但具体逻辑待实现

## 代码位置索引

- **ManagementRegistry**: `src/node_registry/management_state.rs`
- **SnapshotManager**: `src/node_registry/snapshot_manager.rs`
- **RuntimeSnapshot**: `src/node_registry/runtime_snapshot.rs`
- **SessionRuntimeManager**: `src/core/session_runtime.rs`
- **Job 创建流程**: `src/core/dispatcher/job_creation.rs`
- **节点选择**: `src/core/dispatcher/job_creation/job_creation_node_selection.rs`
- **Redis try_reserve**: `src/phase2/runtime_routing_node_capacity.rs`

（完）