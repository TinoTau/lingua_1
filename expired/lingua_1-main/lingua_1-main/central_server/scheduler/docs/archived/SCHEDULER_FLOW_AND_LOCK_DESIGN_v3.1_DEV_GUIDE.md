# SCHEDULER_FLOW_AND_LOCK_DESIGN_v3.1_DEV_GUIDE.md
调度服务器流程与锁模型（v3.1 开发实现版指南）
====================================================

本文件是在 v3.0 架构文档基础上的 **开发实现版**，增加了：

- 代码路径 / 模块索引
- 关键结构与函数的落点建议
- Review 时应该重点看的位置

说明：所有文件路径仅为示例，可按你们实际仓库结构调整，但**请保持模块职责与本指南一致**。

---

# 1. 模块与概念映射表

## 1.1 Management Domain（管理域）

| 概念 | Rust 结构 / Trait | 实际文件路径 | 说明 |
|------|-------------------|--------------|------|
| 管理状态 | `ManagementState` | `src/node_registry/management_state.rs` | 节点、池、语言索引、Phase3 索引等集中存放 |
| 管理注册表 | `ManagementRegistry` | `src/node_registry/management_state.rs` | 包含 `RwLock<ManagementState>`，唯一写入口 |
| 节点状态 | `NodeState` | `src/node_registry/management_state.rs` | 节点健康/能力/并发等信息 |
| 池配置 | `Phase3PoolConfig` | `src/core/config/config_types.rs` | Phase3 池的配置结构 |
| 语言索引 | `PoolLanguageIndex` | `src/node_registry/pool_language_index.rs` | 语言 → 池 的索引 |

> 规则：**任何修改节点 / 池 / 索引的操作，都必须通过 `ManagementRegistry.state.write()` 进行。**

---

## 1.2 Runtime Domain（运行域）

| 概念 | Rust 结构 / Trait | 实际文件路径 | 说明 |
|------|-------------------|--------------|------|
| 节点运行快照 | `NodeRuntimeSnapshot` | `src/node_registry/runtime_snapshot.rs` | 调度用的轻量节点视图 |
| 快照 Map | `NodeRuntimeMap` | 同上 | `HashMap<NodeId, Arc<NodeRuntimeSnapshot>>` |
| 运行时快照 | `RuntimeSnapshot` | 同上 | 包含 nodes (Arc) + lang_index (Arc) + pool_members_cache (Arc<RwLock>) |
| 快照管理器 | `SnapshotManager` | `src/node_registry/snapshot_manager.rs` | 内含 `Arc<RwLock<RuntimeSnapshot>>` |

> 规则：**调度路径只读 RuntimeSnapshot，不再访问 ManagementState / NodeState。**

---

## 1.3 Session Domain（会话域）

| 概念 | Rust 结构 / Trait | 实际文件路径 | 说明 |
|------|-------------------|--------------|------|
| Session 运行状态 | `SessionRuntimeState` | `src/core/session_runtime.rs` | preferred_pool / bound_lang_pair / 缓存等 |
| Session 条目 | `SessionEntry` | 同上 | 包含 `Arc<Mutex<SessionRuntimeState>>` |
| Session 管理器 | `SessionRuntimeManager` | 同上 | 内含 `Arc<DashMap<SessionId, Arc<SessionEntry>>>` |

> 规则：**同一个 Session 的调度相关状态只通过 `SessionRuntimeState` 修改，由该 Session 的 Mutex 串行保护。**

---

## 1.4 Redis 与并发控制

| 概念 | Rust 结构 / Trait | 实际文件路径 | 说明 |
|------|-------------------|--------------|------|
| Phase2 运行时 | `Phase2Runtime` | `src/phase2.rs` | Redis 客户端封装、池成员读写 / try_reserve / release |
| 并发 Lua | `try_reserve` / `release_reserve` | `src/phase2/runtime_routing_node_capacity.rs` | 负责 atomic check + increment/decrement |
| Pool 成员同步 | `sync_pool_members_to_redis` | `src/phase2/runtime_routing_pool_members.rs` | 同步 pool → members 到 Redis |

---

## 1.5 Job 管理

| 概念 | Rust 结构 / Trait | 实际文件路径 | 说明 |
|------|-------------------|--------------|------|
| Job 记录 | `Job` | `src/core/dispatcher/job.rs` | 调度器内部 job 表结构 |
| Job 管理 | `JobDispatcher` | `src/core/dispatcher/dispatcher.rs` | 包含 `Arc<RwLock<HashMap<JobId, Job>>>` |
| Job 创建入口 | `create_job` | `src/core/dispatcher/job_creation.rs` | 调度主入口函数 |

---

# 2. 核心流程与代码入口索引

## 2.1 节点注册流程

**入口函数建议：**

```rust
// src/scheduler/api/node_api.rs
pub async fn register_node(req: RegisterNodeRequest) -> Result<RegisterNodeResponse> {
    // 1. 管理域写入
    management::handle_node_register(&management_registry, req).await?;
    // 2. 返回简单 ACK
    Ok(...)
}
```

**管理域处理：**

```rust
// src/scheduler/management/mod.rs
pub async fn handle_node_register(
    registry: &ManagementRegistry,
    req: RegisterNodeRequest,
) -> Result<()> {
    {
        let mut mgmt = registry.state.write().await;
        mgmt.nodes.insert(req.node_id.clone(), NodeState::from(&req));
        mgmt.lang_index.add_node(&req);
        mgmt.update_phase3_pool_for_node(&req);
    } // 释放锁

    // 锁外更新 Redis & RuntimeSnapshot
    runtime::on_node_registered(&req).await?;
    Ok(())
}
```

> Review 时重点看：  
> - 管理锁内是否仅做必要字段更新  
> - Pool 重建/Redis/快照更新是否全部在锁外完成

---

## 2.2 心跳流程

**入口函数建议：**

```rust
// src/scheduler/api/node_api.rs
pub async fn heartbeat(req: HeartbeatRequest) -> Result<HeartbeatResponse> {
    management::handle_heartbeat(&management_registry, &req).await?;
    Ok(...)
}
```

**管理域处理：**

```rust
// src/scheduler/management/mod.rs
pub async fn handle_heartbeat(
    registry: &ManagementRegistry,
    hb: &HeartbeatRequest,
) -> Result<()> {
    {
        let mut mgmt = registry.state.write().await;
        if let Some(state) = mgmt.nodes.get_mut(&hb.node_id) {
            state.apply_heartbeat(hb);
        }
    } // 释放锁

    runtime::on_heartbeat(&hb.node_id).await?;
    Ok(())
}
```

---

## 2.3 RuntimeSnapshot 更新

**入口函数建议：**

```rust
// src/scheduler/runtime/manager.rs
pub async fn on_node_registered(node_id: &NodeId) { update_snapshot_for_node(node_id).await; }
pub async fn on_heartbeat(node_id: &NodeId) { update_snapshot_for_node(node_id).await; }

async fn update_snapshot_for_node(node_id: &NodeId) {
    // 1. 从 ManagementState 读 NodeState
    let state = {
        let mgmt = MANAGEMENT_REGISTRY.state.read().await;
        mgmt.nodes.get(node_id).cloned()
    };
    if state.is_none() { return; }
    let state = state.unwrap();

    // 2. 构建 NodeRuntimeSnapshot（锁外）
    let snap = Arc::new(NodeRuntimeSnapshot::from_state(node_id.clone(), &state));

    // 3. COW 更新 snapshot
    let new_runtime_snapshot = {
        let old = SNAPSHOT_MANAGER.snapshot.read().await;
        let mut cloned = (**old).clone();
        cloned.nodes.insert(node_id.clone(), snap);
        Arc::new(RuntimeSnapshot { nodes: Arc::new(cloned.nodes), ..(**old).clone() })
    };

    {
        let mut w = SNAPSHOT_MANAGER.snapshot.write().await;
        *w = new_runtime_snapshot;
    }
}
```

> Review 点：  
> - COW 是在锁外完成的，锁内仅替换 Arc  
> - snapshot 内部结构是否拷贝合理，避免过重 clone

---

## 2.4 调度主流程（Job 创建 + Node 选择）

**实际实现（job_creation.rs::create_job）：**

```rust
// src/core/dispatcher/job_creation.rs
pub async fn create_job(...) -> Job {
    // 1. 获取快照（无锁克隆）
    let snapshot = {
        let s = snapshot_manager.get_snapshot().await;
        s.clone() // 克隆快照，立即释放读锁
    };

    // 2. 获取 Phase3 配置（锁外，避免在 Session 锁内访问 Management 域）
    let phase3_config = node_registry.get_phase3_config_cached().await;

    // 3. Session 锁内决定 preferred_pool 和绑定 lang_pair
    let preferred_pool = session_manager.decide_pool_for_session(
        &session_id,
        &src_lang,
        &tgt_lang,
        routing_key,
        &snapshot,
        &phase3_config,
    ).await;

    // 4. 节点选择（使用 preferred_pool）
    let (node_id, ...) = select_node_for_job_creation(
        routing_key,
        &session_id,
        &src_lang,
        &tgt_lang,
        &features,
        &pipeline,
        preferred_node_id,
        preferred_pool, // 传递 Session 锁内决定的 preferred_pool
        ...
    ).await;

    // 5. 使用 snapshot.nodes.get(node_id) 无锁访问节点能力

    // 6. 创建 Job（jobs.write() 持锁极短）
    create_job_phase1(...).await
}
```

### Session 决策逻辑（实际实现）：

```rust
// src/core/session_runtime.rs::SessionRuntimeManager
pub async fn decide_pool_for_session(
    &self,
    session_id: &str,
    src_lang: &str,
    tgt_lang: &str,
    routing_key: &str,
    snapshot: &RuntimeSnapshot,
    phase3_config: &Phase3Config,
) -> Option<u16> {
    let entry = self.get_or_create_entry(session_id);
    let mut session_state = entry.get_state().await;
    
    session_state.decide_preferred_pool(
        src_lang,
        tgt_lang,
        routing_key,
        snapshot,
        phase3_config,
    )
}

// src/core/session_runtime.rs::SessionRuntimeState
pub fn decide_preferred_pool(...) -> Option<u16> {
    // 1. 检查 lang_pair 是否改变，如果改变则重置绑定
    if let Some(ref bound_pair) = self.bound_lang_pair {
        if bound_pair.0 != src_lang || bound_pair.1 != tgt_lang {
            self.preferred_pool = None;
            self.bound_lang_pair = None;
        }
    }

    // 2. 如果已有 preferred_pool 且 lang_pair 匹配，直接返回
    if let Some(pool_id) = self.preferred_pool {
        if let Some(ref bound_pair) = self.bound_lang_pair {
            if bound_pair.0 == src_lang && bound_pair.1 == tgt_lang {
                return Some(pool_id);
            }
        }
    }

    // 3. 使用 lang_index 查找候选 pools
    let eligible_pools = if src_lang == "auto" {
        snapshot.lang_index.find_pools_for_lang_set(&[tgt_lang.to_string()])
    } else {
        snapshot.lang_index.find_pools_for_lang_pair(src_lang, tgt_lang)
    };

    // 4. 根据 Phase3Config 决定 preferred_pool
    //    - Tenant override（优先）
    //    - Session affinity（hash-based）
    //    - 随机/第一个匹配的 pool

    // 5. 更新 Session 状态
    self.set_preferred_pool(preferred_pool);
    self.set_bound_lang_pair(src_lang.to_string(), tgt_lang.to_string());

    Some(preferred_pool)
}
```

### 节点选择逻辑（实际实现）：

```rust
// src/node_registry/selection/selection_phase3.rs
pub async fn select_node_with_types_two_level_excluding_with_breakdown(
    ...
    session_preferred_pool: Option<u16>, // Session 锁内决定的 preferred_pool
) -> (...) {
    // 如果提供了 session_preferred_pool，优先使用它
    // 验证该 pool 是否支持当前语言对和 required_types
    // 如果有效，使用它；否则 fallback 到内部决定

    // 1. 从 Redis 读取 pool members（prefetch_pool_members）
    // 2. 过滤健康节点（使用 snapshot.nodes，无锁访问）
    // 3. redis.try_reserve(candidates) 并发控制
    // 4. 返回选中的 node_id
}
```

---

# 3. 锁顺序与禁止事项（开发规范）

## 3.1 锁获取顺序约定

- **Management 锁**：`ManagementRegistry.state`  
- **Snapshot 锁**：`SnapshotManager.snapshot`  
- **Session 锁**：`SessionEntry.mutex`  
- **Job 锁**：`JobRepository` 内部写锁（通常是 Mutex/RwLock）  

推荐顺序：

1. Snapshot 读锁（短时间，仅用于 clone Arc）
2. Session 锁（仅保护 SessionRuntimeState）
3. Job 写锁  
4. Redis 调用（无锁）

**禁止：**

- 在 Session 锁内调用 `ManagementRegistry.state.write/read()`  
- 在任何锁内执行 Redis 或网络 RPC

---

## 3.2 必须删除/禁止的旧用法

开发时需要确认：

- [ ] 不再从调度路径访问 `nodes.read()` / `nodes.write()`  
- [ ] 不再在心跳或调度中使用 `phase3.read()/write()`  
- [ ] 不再对 `language_capability_index` 做直接写锁操作  
- [ ] 不再直接在全局 map 上维护 `last_dispatched_node_by_session`  

所有状态统一进：

- 管理域：`ManagementState`  
- 运行域：`RuntimeSnapshot`  
- 会话域：`SessionRuntimeState`

---

# 4. 开发 TaskList（按模块拆分）

## 4.1 Management 模块

- [ ] 实现 `ManagementState` / `ManagementRegistry`
- [ ] 将节点注册、心跳、池配置更新全部集中到 `ManagementRegistry.state.write()`
- [ ] 移除外部直接操作 nodes/lang_index/phase3 的旧接口
- [ ] Pool 重建采用“两段式”：锁内取数据 + 锁外重建 + 锁内覆盖

## 4.2 Runtime 模块

- [ ] 定义 `NodeRuntimeSnapshot` / `RuntimeSnapshot`
- [ ] 实现 `SnapshotManager`（含 COW 更新逻辑）
- [ ] 心跳 / 注册 / 能力变化调用 `update_snapshot_for_node`
- [ ] 删除调度路径中所有对 NodeState / nodes 的访问

## 4.3 Session 模块

- [x] 实现 `SessionRuntimeManager` + `SessionEntry.mutex`
  - ✅ 实现位置：`src/core/session_runtime.rs`
  - ✅ 使用 `DashMap` 提供并发安全的 session 条目管理
- [x] 实现 `SessionRuntimeState` 中的 preferred_pool / bound_lang_pair 管理
  - ✅ `decide_preferred_pool()`: 在 Session 锁内决定 preferred_pool
  - ✅ `set_bound_lang_pair()`: 绑定语言对，如果改变则重置 preferred_pool
  - ✅ 支持 tenant override、session affinity、随机选择
- [x] 将所有基于 session 的策略迁移到 Session 模块
  - ✅ preferred_pool 决策已迁移到 Session 锁内
  - ✅ bound_lang_pair 绑定已迁移到 Session 锁内
- [x] 移除全局 map 型 session 状态（如 last_dispatched_node_by_session）
  - ✅ 已完全移除 `last_dispatched_node_by_session`
  - ✅ 替换为 `SessionRuntimeManager` + `SessionRuntimeState`

## 4.4 Redis / PoolMembersCache

- [ ] 实现 `PoolMembersCache`（带 TTL，使用 Mutex/RwLock）
- [ ] 封装 `get_or_refresh(pool_id, pool_nodes)`：
  - 先读本地 cache
  - 失效再访问 Redis，并写回 cache
- [ ] 在注册/下线/能力变化时更新 Redis 的 pool members 集合

## 4.5 调度模块

- [x] 实现 `create_job` 调度入口
  - ✅ 实现位置：`src/core/dispatcher/job_creation.rs`
  - ✅ 按照 v3.1 设计流程实现
- [x] 按本指南拆分 session 决策与节点选择逻辑
  - ✅ Session 决策：`session_manager.decide_pool_for_session()` 在 Session 锁内决定 preferred_pool
  - ✅ 节点选择：`select_node_for_job_creation()` 接受 preferred_pool 参数，优先使用它
  - ✅ 节点选择逻辑：`select_node_with_types_two_level_excluding_with_breakdown()` 优先使用 session_preferred_pool
- [x] 确认调度中只使用：
  - ✅ RuntimeSnapshot（使用 `snapshot.clone()` 后无锁访问）
  - ✅ Phase3PoolIndex Snapshot（从 `snapshot.lang_index` 读取）
  - ⚠️ PoolMembersCache（已定义但未实际使用，目前从 Redis 直接读取）
  - ✅ Redis.try_reserve（`phase2.runtime_routing_node_capacity.rs::reserve_node_slot`）

## 4.6 Job 模块

- [ ] 实现 `JobRepository::create_job`
- [ ] 实现 Job 完成 / 失败 / 超时回收逻辑
- [ ] 底层锁使用 Mutex/RwLock，保证写入原子性且锁粒度小

---

# 5. Review Checklist（代码审查使用）

## 5.1 锁相关

- [ ] 管理类操作只在 `ManagementRegistry.state.write()` 中发生
- [ ] 调度路径不依赖任何 Management 锁
- [ ] Snapshot 只通过 COW 更新，不在调度路径中构建
- [ ] Session 锁不持有时间过长（仅修改少量字段）
- [ ] 没有出现 `Session 锁 → Management 锁` 的调用链

## 5.2 性能相关

- [ ] snapshot.clone() 在调度路径上仅做一次
- [ ] PoolMembersCache 的锁使用范围最小
- [ ] Job 写锁仅在创建/更新单条记录时持有
- [ ] Redis 调用集中在 try_reserve / release / pool members 获取上，没有多余 Round Trip

## 5.3 正确性相关

- [x] try_reserve + release 保证节点并发计数准确（含失败路径）
  - ✅ `reserve_node_slot` 使用 Redis Lua 脚本原子性预留
  - ✅ `release_node_slot` 释放预留的槽位
  - ✅ Job 失败时自动调用回滚
- [x] 节点健康状态通过心跳更新 → RuntimeSnapshot 同步
  - ✅ 心跳更新后立即触发 `snapshot_manager.update_node_snapshot()`
  - ✅ 快照中的 `NodeHealth` 从 `ManagementState` 实时同步
- [x] 超时/失败场景下并发配额会回滚
  - ✅ `release_node_slot` 支持超时回滚
  - ✅ TTL 机制自动清理过期的预留
- [x] Session 语言对变化时清理旧的 preferred_pool 绑定
  - ✅ `decide_preferred_pool()` 中检查 lang_pair 是否改变
  - ✅ 如果改变，重置 `preferred_pool` 和 `bound_lang_pair`

---

# 6. 实际实现状态总结

## 6.1 已完成的架构改进

1. **三域模型完全实现**
   - Management Domain：`ManagementRegistry` 统一管理锁 ✅
   - Runtime Domain：`RuntimeSnapshot` + `SnapshotManager` COW 模式 ✅
   - Session Domain：`SessionRuntimeManager` + `SessionRuntimeState` ✅

2. **Session 锁内决定 preferred_pool**
   - ✅ `decide_pool_for_session()`: 在 Session 锁内决定 preferred_pool
   - ✅ 支持 lang_pair 改变时重置绑定
   - ✅ 支持 tenant override、session affinity、随机选择
   - ✅ 使用 `snapshot.lang_index` 查找候选 pools

3. **调度路径零锁化**
   - ✅ 使用 `snapshot.clone()` 后完全无锁访问
   - ✅ Session 锁最小化，仅用于决定 preferred_pool 和绑定 lang_pair
   - ✅ 节点选择逻辑优先使用 Session 锁内决定的 preferred_pool

4. **冗余逻辑清除**
   - ✅ 移除 `last_dispatched_node_by_session` 全局 map
   - ✅ 调度路径上移除所有管理锁

## 6.2 实际代码位置索引

- **ManagementRegistry**: `src/node_registry/management_state.rs`
- **SnapshotManager**: `src/node_registry/snapshot_manager.rs`
- **RuntimeSnapshot**: `src/node_registry/runtime_snapshot.rs`
- **SessionRuntimeManager**: `src/core/session_runtime.rs`
- **Job 创建流程**: `src/core/dispatcher/job_creation.rs`
- **Session 决策**: `src/core/session_runtime.rs::decide_pool_for_session()`
- **节点选择**: `src/node_registry/selection/selection_phase3.rs`
- **Redis try_reserve**: `src/phase2/runtime_routing_node_capacity.rs`

## 6.3 待优化项

1. **PoolMembersCache 实际使用**
   - 目前仍从 Redis 直接读取 pool members
   - 待实现：使用 `PoolMembersCache` 替代直接 Redis 调用

2. **spread 策略实现**
   - Session 锁内预留了 spread 策略处理，但具体逻辑待实现

---

# 7. 总结

这份 v3.1 开发指南在 v3.0 架构规范的基础上，补充了：

- ✅ 模块划分与实际文件路径
- ✅ 关键函数的实际签名与调用顺序
- ✅ 开发任务清单（按模块拆分，标注完成状态）
- ✅ Review 专用 Checklist（标注实现状态）

你可以直接：

1. 将本文件交给开发团队，作为"实现版本设计文档"；  
2. 在代码 Review 时，按第 5 节 Checklist 逐项对照核查；  
3. 后续如有实现细节变更，只需更新相应代码索引与实际代码示例。

（完）
