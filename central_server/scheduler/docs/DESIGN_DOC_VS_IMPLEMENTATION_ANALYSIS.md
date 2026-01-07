# 设计文档与代码实现对比分析

## 文档信息

- **版本**: v1.0
- **日期**: 2026-01-07
- **目的**: 对比 `SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md` 设计文档与当前代码实现的一致性
- **状态**: 分析完成

---

## 一、执行摘要

### 1.1 总体一致性评估

| 方面 | 一致性 | 说明 |
|------|--------|------|
| **Pool 设计** | ✅ **一致** | 节点可属于多个 Pool，Pool 作为索引 |
| **语义修复服务** | ✅ **一致** | 语义修复为硬门槛，语言可用性以 `semantic_langs` 为准 |
| **Reservation 机制** | ⚠️ **部分一致** | 有 Redis Lua 实现，但有两套机制（Phase 1 内存 + Phase 2 Redis） |
| **节点选择策略** | ❌ **不一致** | 文档要求随机选择无 session affinity，当前实现使用 hash 有 session affinity |
| **多实例支持** | ⚠️ **部分一致** | Phase 2 支持 Redis 同步，但 Reservation 机制选择取决于配置 |

### 1.2 是否需要大规模重构

**结论**：**不需要大规模重构**，但需要**局部调整**。

**主要差异**：
1. **节点选择策略**：需要从 hash-based 改为随机选择（影响较小）
2. **Reservation 机制**：已有 Redis Lua 实现，但需要统一使用（影响中等）

---

## 二、详细对比分析

### 2.1 Pool 设计

#### 设计文档要求

- **Pool 是索引，不是并发控制点**
- **节点可属于多个 Pool（重叠）**
- **Pool 命名格式**：`{src_lang}-{tgt_lang}`（精确池）或 `*-{tgt_lang}`（混合池）

#### 当前实现

**代码位置**：
- `central_server/scheduler/src/node_registry/phase3_pool.rs`
- `central_server/scheduler/src/node_registry/phase3_pool_allocation.rs`

**实现状态**：✅ **完全一致**

```rust
// 数据结构：一个节点可以属于多个 Pool
phase3_node_pool: HashMap<String, HashSet<u16>>  // node_id -> pool_ids
phase3_pool_index: HashMap<u16, HashSet<String>>  // pool_id -> node_ids

// 分配逻辑：返回所有匹配的 Pool
pub(super) fn determine_pools_for_node_auto_mode_with_index(
    cfg: &Phase3Config,
    n: &Node,
    _language_index: &LanguageCapabilityIndex,
) -> Vec<u16>  // 返回所有匹配的 Pool ID
```

**结论**：✅ **无需修改**

---

### 2.2 语义修复服务要求

#### 设计文档要求

- **语义修复（Semantic Repair）为硬门槛**
- **语言可用性以 `semantic_langs` 为准**
- **节点进入池的条件**：`src ∈ semantic_langs(N)` 且 `tgt ∈ semantic_langs(N)`

#### 当前实现

**代码位置**：
- `electron_node/electron-node/main/src/agent/node-agent-language-capability.ts`
- `central_server/scheduler/src/node_registry/phase3_pool_allocation.rs`

**实现状态**：✅ **完全一致**

```typescript
// 节点端：只统计源语言和目标语言都在语义修复服务支持列表中的语言对
if (semanticLanguages.length > 0) {
  const semanticLangSet = new Set(semanticLanguages);
  const filteredPairs = pairs.filter(pair => {
    const srcSupported = semanticLangSet.has(pair.src);
    const tgtSupported = semanticLangSet.has(pair.tgt);
    return srcSupported && tgtSupported;
  });
  pairs = filteredPairs;
} else {
  pairs = []; // 没有语义修复服务，返回空列表
}
```

```rust
// 调度端：检查语义修复服务支持的语言
let semantic_langs = language_index.get_node_semantic_languages(&n.node_id);
if semantic_langs.is_empty() {
    return matched_pools; // 没有语义修复服务，不分配节点
}
// 检查源语言和目标语言是否都在语义修复服务支持列表中
```

**结论**：✅ **无需修改**

---

### 2.3 Reservation 机制

#### 设计文档要求

- **使用 Redis Lua 脚本实现跨实例并发安全的 `try_reserve/commit/release`**
- **必须带 TTL**：避免实例 crash 后 reservation 泄漏
- **原子操作**：检查容量 + 增加 reserved + 写 reservation 记录必须在一个原子事务里完成

#### 当前实现

**代码位置**：
- `central_server/scheduler/src/node_registry/reserved.rs`（Phase 1：内存实现）
- `central_server/scheduler/src/phase2/runtime_routing.rs`（Phase 2：Redis Lua 实现）
- `central_server/scheduler/src/phase2/redis_handle.rs`（Redis Lua 脚本）

**实现状态**：⚠️ **部分一致**

**Phase 1 实现（内存）**：
```rust
// 单实例实现，使用内存 HashMap
pub async fn reserve_job_slot(&self, node_id: &str, job_id: &str, ttl: Duration) -> bool {
    // 使用内存锁保护
    let mut reserved = self.reserved_jobs.write().await;
    // 检查容量
    let effective_jobs = std::cmp::max(current_jobs, reserved_count);
    if effective_jobs >= max_jobs {
        return false;
    }
    // 插入 reservation
    entry.insert(job_id.to_string(), ReservedJobEntry { expire_at_ms });
    true
}
```

**Phase 2 实现（Redis Lua）**：
```rust
// 多实例实现，使用 Redis Lua 脚本
pub async fn reserve_node_slot(
    &self,
    node_id: &str,
    job_id: &str,
    ttl_seconds: u64,
    running_jobs: usize,
    max_jobs: usize,
) -> bool {
    self.redis.zreserve_with_capacity(
        &key,
        job_id,
        ttl_seconds.max(1),
        running_jobs as u64,
        max_jobs.max(1) as u64,
    ).await.unwrap_or(false)
}
```

**Redis Lua 脚本**：
```lua
-- 原子操作：清理过期 + 检查容量 + 添加 reservation
local now = tonumber(ARGV[1])
local ttl_ms = tonumber(ARGV[2])
local running = tonumber(ARGV[3])
local maxj = tonumber(ARGV[4])
local job = ARGV[5]

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now)
local reserved = redis.call('ZCARD', KEYS[1])
local effective = reserved
if running > reserved then effective = running end
if effective >= maxj then
  return 0
end
redis.call('ZADD', KEYS[1], now + ttl_ms, job)
redis.call('EXPIRE', KEYS[1], math.max(60, math.floor(ttl_ms/1000) + 60))
return 1
```

**问题分析**：
1. ✅ **Redis Lua 脚本已实现**：符合设计文档要求
2. ⚠️ **两套实现并存**：Phase 1 使用内存，Phase 2 使用 Redis
3. ⚠️ **缺少 COMMIT 机制**：文档要求 `reserved -> running` 的 commit 操作，当前实现可能不完整

**使用情况**：
- Phase 1 路径：`job_creation_phase1.rs` 使用 `reserve_job_slot`（内存）
- Phase 2 路径：`job_creation_phase2.rs` 使用 `reserve_node_slot`（Redis）

**结论**：⚠️ **需要统一**，建议：
1. 如果启用 Phase 2（多实例），统一使用 Redis Lua 实现
2. 如果单实例，可以继续使用内存实现（但需要确保一致性）
3. 检查并实现完整的 COMMIT 机制（reserved -> running）

---

### 2.4 节点选择策略

#### 设计文档要求

- **默认随机选择节点**（无 session affinity）
- **从池成员集合中做随机采样**：`sample_k`（例如 10～30）
- **对采样结果做轻量排序**：
  - 首要：`effective_load`（running+reserved）
  - 次要：`last_heartbeat` 新鲜度
- **依次尝试 `try_reserve`，成功即选中**

#### 当前实现

**代码位置**：
- `central_server/scheduler/src/node_registry/selection/selection_phase3.rs`

**实现状态**：❌ **不一致**

**当前实现（hash-based，有 session affinity）**：
```rust
// 使用 routing_key (session_id) hash 选择 preferred pool
let preferred_idx = crate::phase3::pick_index_for_key(eligible.len(), cfg.hash_seed, routing_key);
let preferred_pool = eligible[preferred_idx];

// 在 Pool 内选择负载最低的节点（不是随机）
let best_node = nodes.min_by_key(|n| {
    let effective_jobs = std::cmp::max(n.current_jobs, reserved);
    effective_jobs
});
```

**问题分析**：
1. ❌ **有 session affinity**：使用 `routing_key` hash 选择 preferred pool，同一 session 会固定选择同一个 pool
2. ❌ **不是随机采样**：直接遍历所有候选节点，选择负载最低的
3. ✅ **负载均衡正确**：选择 `effective_jobs` 最小的节点

**设计文档要求的伪代码**：
```pseudo
candidates = random_sample_from_set(pool_key, k=20)
shuffle(candidates)  -- 保证随机性
for node_id in candidates:
    ok = try_reserve_redis(node_id, resv_id, ttl_ms=5000, payload=...)
    if ok:
        return node_id
```

**结论**：❌ **需要修改**，建议：
1. 从 Pool 成员中随机采样 `k` 个节点（例如 20 个）
2. 对采样结果按负载排序
3. 依次尝试 `try_reserve`，成功即选中
4. 移除或弱化 `routing_key` hash 的影响（或作为可配置选项）

---

### 2.5 多实例支持

#### 设计文档要求

- **调度服务多实例**，通过 **Redis** 同步状态与并发控制
- **Pool 成员索引存储在 Redis**：`sched:pool:{src}:{tgt}:members`
- **节点并发计数存储在 Redis**：`sched:node:{node_id}:cap`

#### 当前实现

**代码位置**：
- `central_server/scheduler/src/phase2/runtime_routing.rs`
- `central_server/scheduler/src/node_registry/phase3_pool.rs`

**实现状态**：⚠️ **部分一致**

**Pool 配置同步**：
```rust
// Pool 配置同步到 Redis（有实现）
pub async fn try_acquire_pool_leader(&self, ttl_seconds: u64) -> bool {
    // 使用 Redis SET NX PX 实现 leader 选举
}

pub async fn sync_pool_config_to_redis(&self, config: &Phase3Config) -> bool {
    // 同步 Pool 配置到 Redis
}
```

**Pool 成员索引**：
- ❌ **未存储在 Redis**：当前使用内存 `phase3_pool_index: HashMap<u16, HashSet<String>>`
- ⚠️ **设计文档要求**：`sched:pool:{src}:{tgt}:members` Redis Set

**节点并发计数**：
- ⚠️ **部分实现**：Phase 2 使用 Redis ZSET 存储 reservation，但节点元数据（`max_concurrent_jobs`、`running`）可能不在 Redis

**结论**：⚠️ **需要补充**，建议：
1. 如果启用多实例，将 Pool 成员索引同步到 Redis
2. 将节点并发计数（`max`、`running`、`reserved`）同步到 Redis
3. 确保多实例间状态一致性

---

### 2.6 任务状态机

#### 设计文档要求

- `NEW -> SELECTING -> RESERVED -> DISPATCHED -> ACKED -> DONE`
- 异常路径：`RESERVED -> FAILED`、`DISPATCHED -> RETRYING`、`ACKED -> RETRYING`

#### 当前实现

**代码位置**：
- `central_server/scheduler/src/phase2/runtime_job_fsm.rs`

**实现状态**：✅ **基本一致**

```rust
// 状态机实现
pub async fn job_fsm_init(&self, job_id: &str, node_id: Option<&str>, attempt_id: u32, ttl_seconds: u64)
pub async fn job_fsm_to_dispatched(&self, job_id: &str, attempt_id: u32) -> bool
pub async fn job_fsm_to_accepted(&self, job_id: &str, attempt_id: u32) -> bool
pub async fn job_fsm_to_finished(&self, job_id: &str, attempt_id: u32) -> bool
```

**结论**：✅ **无需修改**

---

## 三、需要修改的部分

### 3.1 高优先级（影响功能正确性）

#### 3.1.1 节点选择策略改为随机

**影响**：中等

**修改内容**：
1. 在 `selection_phase3.rs` 中，从 Pool 成员中随机采样 `k` 个节点
2. 对采样结果按负载排序
3. 依次尝试 `try_reserve`，成功即选中
4. 移除或弱化 `routing_key` hash 的影响

**代码位置**：
- `central_server/scheduler/src/node_registry/selection/selection_phase3.rs`

**预估工作量**：2-3 天

---

### 3.2 中优先级（影响多实例一致性）

#### 3.2.1 统一 Reservation 机制

**影响**：中等

**修改内容**：
1. 如果启用 Phase 2（多实例），统一使用 Redis Lua 实现
2. 实现完整的 COMMIT 机制（reserved -> running）
3. 确保单实例和多实例路径的一致性

**代码位置**：
- `central_server/scheduler/src/core/dispatcher/job_creation_phase1.rs`
- `central_server/scheduler/src/core/dispatcher/job_creation_phase2.rs`
- `central_server/scheduler/src/node_registry/reserved.rs`

**预估工作量**：3-5 天

#### 3.2.2 Pool 成员索引同步到 Redis

**影响**：低（仅影响多实例场景）

**修改内容**：
1. 将 Pool 成员索引同步到 Redis Set：`sched:pool:{src}:{tgt}:members`
2. 节点注册/心跳时更新 Redis Set
3. 节点选择时从 Redis Set 读取候选节点

**代码位置**：
- `central_server/scheduler/src/node_registry/phase3_pool.rs`
- `central_server/scheduler/src/phase2/runtime_routing.rs`

**预估工作量**：2-3 天

---

### 3.3 低优先级（优化和增强）

#### 3.3.1 节点并发计数同步到 Redis

**影响**：低（仅影响多实例场景）

**修改内容**：
1. 将节点并发计数（`max`、`running`、`reserved`）同步到 Redis Hash
2. 节点心跳时更新 Redis
3. 节点选择时从 Redis 读取

**代码位置**：
- `central_server/scheduler/src/node_registry/core.rs`
- `central_server/scheduler/src/phase2/runtime_routing.rs`

**预估工作量**：2-3 天

---

## 四、重构建议

### 4.1 是否需要大规模重构？

**结论**：**不需要大规模重构**

**理由**：
1. ✅ **核心设计已实现**：Pool 设计、语义修复服务要求、Reservation 机制（Redis Lua）都已实现
2. ⚠️ **局部调整即可**：主要是节点选择策略和 Reservation 机制的统一
3. ✅ **架构兼容**：当前架构支持单实例和多实例两种模式，可以逐步迁移

### 4.2 建议的重构路径

#### 阶段 1：节点选择策略调整（2-3 天）
- 修改 `selection_phase3.rs`，实现随机采样
- 移除或弱化 `routing_key` hash 的影响
- 测试验证

#### 阶段 2：Reservation 机制统一（3-5 天）
- 统一使用 Redis Lua 实现（如果启用 Phase 2）
- 实现完整的 COMMIT 机制
- 测试验证

#### 阶段 3：多实例支持增强（2-3 天，可选）
- Pool 成员索引同步到 Redis
- 节点并发计数同步到 Redis
- 测试验证

**总预估工作量**：7-11 天（不含测试）

---

## 五、总结

### 5.1 一致性总结

| 模块 | 一致性 | 优先级 | 工作量 |
|------|--------|--------|--------|
| Pool 设计 | ✅ 一致 | - | - |
| 语义修复服务 | ✅ 一致 | - | - |
| 节点选择策略 | ❌ 不一致 | 高 | 2-3 天 |
| Reservation 机制 | ⚠️ 部分一致 | 中 | 3-5 天 |
| 多实例支持 | ⚠️ 部分一致 | 中 | 2-3 天 |
| 任务状态机 | ✅ 一致 | - | - |

### 5.2 建议

1. **优先修改节点选择策略**：这是设计文档明确要求的功能，影响用户体验
2. **统一 Reservation 机制**：确保多实例场景下的正确性
3. **逐步增强多实例支持**：根据实际需求决定是否同步 Pool 成员索引到 Redis

### 5.3 风险评估

- **低风险**：Pool 设计、语义修复服务、任务状态机都已正确实现
- **中风险**：节点选择策略修改可能影响现有负载均衡效果，需要充分测试
- **中风险**：Reservation 机制统一需要确保多实例场景下的正确性

---

**文档结束**
