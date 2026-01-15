# 锁竞争问题详细分析报告

## 问题概述

任务在节点选择过程中阻塞，根本原因是**管理锁（management_registry）的严重竞争**。

## 锁竞争场景分析

### 场景 1: 心跳更新 vs 节点选择

**心跳更新流程** (`handle_node_heartbeat` → `update_node_heartbeat` → `update_node_snapshot`):

```
1. handle_node_heartbeat (register.rs:164)
   └─> update_node_heartbeat (core.rs:286)
       ├─> management_registry.update_node_heartbeat() [WRITE LOCK] (management_state.rs:290)
       │   └─> 持有写锁，更新节点状态 (< 10ms，应该是快的)
       └─> update_node_snapshot() [在锁外调用] (core.rs:348)
           ├─> management.read().await [READ LOCK] (snapshot_manager.rs:77)
           │   └─> ❌ 如果此时还有其他心跳更新持有写锁，这里会阻塞！
           └─> snapshot.write().await [WRITE LOCK] (snapshot_manager.rs:87)
               └─> ❌ 如果此时节点选择正在读取 snapshot，这里会阻塞！
   └─> phase3_upsert_node_to_pool_index_with_runtime() [可能很慢，包含 Redis 操作]
```

**节点选择流程** (`select_node_with_module_expansion_with_breakdown`):

```
1. select_node_with_module_expansion_with_breakdown (job_selection.rs:16)
   └─> get_or_init_snapshot_manager() (job_selection.rs:95)
       └─> 如果是首次初始化，调用 SnapshotManager::new()
           └─> management.read().await [READ LOCK] (snapshot_manager.rs:25)
               └─> ❌ 如果此时心跳更新持有写锁，这里会阻塞！
   └─> get_snapshot().await [READ LOCK] (job_selection.rs:96)
       └─> snapshot.read().await (snapshot_manager.rs:39)
           └─> ❌ 如果此时 update_node_snapshot() 持有 snapshot 写锁，这里会阻塞！
   └─> select_node_with_types_two_level_excluding_with_breakdown() (job_selection.rs:110)
       └─> get_phase3_config_cached() (selection_phase3.rs:37)
       └─> get_or_init_snapshot_manager() [再次调用] (selection_phase3.rs:84)
           └─> ❌ 如果此时心跳更新持有写锁，这里会阻塞！
       └─> get_snapshot().await [再次调用] (selection_phase3.rs:87)
           └─> ❌ 如果此时 update_node_snapshot() 持有 snapshot 写锁，这里会阻塞！
```

### 关键问题点

#### 问题 1: 心跳更新时持有写锁时间过长

**位置**: `management_registry.update_node_heartbeat()` (management_state.rs:290)

**问题**:
- 虽然 `update_node_heartbeat()` 本身应该很快（< 10ms），但实际日志显示锁持有时间超过 1000ms
- 可能的原因：
  1. 锁等待时间：在获取写锁之前，有其他操作持有写锁，导致等待时间过长
  2. 锁释放延迟：获取写锁后，虽然在锁内操作很快，但锁释放可能被延迟（Rust 的 RwLock 行为）

#### 问题 2: `update_node_snapshot()` 在心跳更新后立即调用，导致二次锁竞争

**位置**: `update_node_heartbeat()` → `update_node_snapshot()` (core.rs:347-348)

**问题**:
- `update_node_heartbeat()` 释放写锁后，立即调用 `update_node_snapshot()`
- `update_node_snapshot()` 需要：
  1. 获取 `management.read()` 锁
  2. 获取 `snapshot.write()` 锁
- 如果此时有多个心跳更新同时发生，会导致：
  - 多个线程同时竞争 `management.read()` 锁
  - 多个线程同时竞争 `snapshot.write()` 锁
  - 节点选择线程被阻塞，无法获取 `snapshot.read()` 锁

#### 问题 3: `get_or_init_snapshot_manager()` 首次初始化时的锁竞争

**位置**: `get_or_init_snapshot_manager()` (lock_optimization.rs:10)

**问题**:
- 首次调用时，需要初始化 `SnapshotManager`
- `SnapshotManager::new()` 会调用 `management.read().await` (snapshot_manager.rs:25)
- 如果此时心跳更新持有写锁，这里会阻塞
- 多个线程可能同时尝试初始化，导致重复初始化或竞争

## 占用管理锁的操作统计

### 写锁占用（按频率和影响排序）

1. **心跳更新** (`management_registry.update_node_heartbeat`)
   - **频率**: 每 15 秒/节点（高频）
   - **锁持有时间**: 预期 < 10ms，实际 1000ms+（从日志看）
   - **位置**: management_state.rs:290
   - **操作内容**: 更新节点的 CPU、GPU、内存使用率、当前任务数、最后心跳时间等
   - **锁内操作**: 快速更新节点状态（应该 < 1ms）
   - **锁外操作**: 
     - `update_node_snapshot()` 需要获取 `management.read()` (snapshot_manager.rs:77)
     - `phase3_core_cache_upsert_node()` 需要获取 `phase3_core_cache.write()` (phase3_core_cache.rs:173)
   - **影响**: ⚠️⚠️⚠️ **极高** - 频繁且持续时间长
   - **阻塞原因**: 虽然锁内操作很快，但锁等待时间很长（1000ms+），说明有其他操作持有写锁

2. **心跳处理后的 Pool 分配** (`phase3_upsert_node_to_pool_index_with_runtime`)
   - **频率**: 每次心跳更新后（如果语言能力变化或节点不在 Pool 中）
   - **锁持有时间**: 未知（可能很长，包含多次 Redis 查询）
   - **位置**: phase3_pool_allocation_impl.rs:15
   - **操作内容**: 从 Redis 读取节点能力，分配节点到 Pool
   - **锁内操作**: 
     - `management.read()` 多次调用 (Line 33, 111, 183)
     - `phase3.read()` (Line 20)
     - `phase3.write()` (Line 90) - 如果 Pool 配置为空，从 Redis 读取后写入
     - `phase3_node_pool.read()` (Line 28)
     - `language_capability_index.read()` (Line 152, 187)
   - **Redis 操作**: 
     - `has_node_capability()` 多次调用 (Line 43-45, 125-127) - 可能很慢
     - `get_pool_config()` (Line 80) - 可能很慢
   - **影响**: ⚠️⚠️⚠️ **极高** - 在心跳更新后立即调用，包含多次锁操作和 Redis 查询

3. **节点注册** (`register_node_with_policy`)
   - **频率**: 节点上线时（低频）
   - **锁持有时间**: 未知
   - **位置**: core.rs:157
   - **影响**: ⚠️ **低** - 低频操作

4. **从快照更新节点** (`upsert_node_from_snapshot`)
   - **频率**: 节点快照同步时（低频）
   - **锁持有时间**: 未知
   - **位置**: core.rs:76
   - **影响**: ⚠️ **低** - 低频操作

5. **标记节点离线** (`mark_node_offline`)
   - **频率**: 节点离线时（低频）
   - **锁持有时间**: 未知
   - **位置**: core.rs:379
   - **影响**: ⚠️ **低** - 低频操作

6. **更新 Phase3 配置** (`update_phase3_config`)
   - **频率**: 配置更新时（低频）
   - **锁持有时间**: 未知
   - **位置**: management_state.rs:259
   - **影响**: ⚠️ **低** - 低频操作

### 读锁占用（按频率和影响排序）

1. **节点选择** (`get_or_init_snapshot_manager()` → `SnapshotManager::new()`)
   - **频率**: 每次任务创建（高频）
   - **锁等待时间**: 如果心跳更新持有写锁，会阻塞
   - **位置**: lock_optimization.rs:12, snapshot_manager.rs:25
   - **操作内容**: 首次初始化 SnapshotManager 时需要读取 `management.read()` 获取 `lang_index`
   - **影响**: ⚠️⚠️⚠️ **极高** - 高频且容易阻塞
   - **阻塞原因**: 如果此时心跳更新持有写锁，这里会阻塞

2. **更新快照** (`update_node_snapshot()` → `management.read()`)
   - **频率**: 每次心跳更新后（高频，每 15 秒/节点）
   - **锁等待时间**: 如果心跳更新持有写锁，会阻塞
   - **位置**: snapshot_manager.rs:77
   - **操作内容**: 读取节点状态，更新 snapshot
   - **后续操作**: 需要获取 `snapshot.write()` (Line 87)，如果节点选择正在读取 snapshot，会阻塞
   - **影响**: ⚠️⚠️⚠️ **极高** - 高频且容易阻塞
   - **阻塞原因**: 如果此时心跳更新持有写锁，这里会阻塞；如果节点选择正在读取 snapshot，`snapshot.write()` 会阻塞

3. **心跳处理后的 Pool 分配** (`phase3_upsert_node_to_pool_index_with_runtime()` → `management.read()`)
   - **频率**: 每次心跳更新后（如果语言能力变化或节点不在 Pool 中）
   - **锁等待时间**: 如果心跳更新持有写锁，会阻塞
   - **位置**: phase3_pool_allocation_impl.rs:33, 111, 183
   - **操作内容**: 多次读取节点状态，检查节点能力和 Pool 分配
   - **影响**: ⚠️⚠️⚠️ **极高** - 在心跳更新后立即调用，包含多次读锁操作
   - **阻塞原因**: 如果此时心跳更新持有写锁，这里会阻塞；包含多次 Redis 查询，可能很慢

4. **重建 Phase3 核心缓存** (`rebuild_phase3_core_cache()` → `management.read()`)
   - **频率**: 缓存重建时（低频）
   - **锁等待时间**: 未知
   - **位置**: phase3_core_cache.rs:129
   - **操作内容**: 读取所有节点信息，重建缓存
   - **影响**: ⚠️ **中** - 低频但可能影响性能

5. **其他读取操作** (各种查询操作)
   - **频率**: 各种查询操作（中频）
   - **锁等待时间**: 通常很快
   - **影响**: ⚠️ **低** - 读锁可以并发，影响较小

## 根本原因分析

### 1. 心跳更新时锁持有时间过长（主要原因）

**证据**:
- 日志显示"管理锁写锁等待时间较长" (lock_wait_ms=1000ms+)
- 日志显示"心跳更新锁持有时间较长" (lock_hold_ms=1000ms+)

**原因分析**:
从代码看，心跳更新的完整流程：
```
handle_node_heartbeat (register.rs:164)
├─> update_node_heartbeat() (core.rs:286)
│   └─> management_registry.update_node_heartbeat() [WRITE LOCK] (management_state.rs:290)
│       └─> 持有写锁，更新节点状态 (< 10ms，应该是快的)
│   └─> update_node_snapshot() [在锁外调用] (core.rs:348)
│       └─> management.read() [READ LOCK] (snapshot_manager.rs:77) ⚠️ 阻塞点 1
│       └─> snapshot.write() [WRITE LOCK] (snapshot_manager.rs:87) ⚠️ 阻塞点 2
│   └─> phase3_core_cache_upsert_node() [在锁外调用] (core.rs:354)
│       └─> phase3_core_cache.write() [WRITE LOCK] (phase3_core_cache.rs:173)
└─> phase3_upsert_node_to_pool_index_with_runtime() [在锁外调用] (register.rs:224)
    ├─> management.read() [READ LOCK] (phase3_pool_allocation_impl.rs:33) ⚠️ 阻塞点 3
    ├─> Redis 查询 (has_node_capability × 3) (Line 43-45) ⚠️ 可能很慢
    ├─> management.read() [READ LOCK] (Line 111) ⚠️ 阻塞点 4
    ├─> Redis 查询 (has_node_capability × 3) (Line 125-127) ⚠️ 可能很慢
    ├─> Redis 查询 (get_pool_config) (Line 80) ⚠️ 可能很慢
    ├─> phase3.write() [WRITE LOCK] (Line 90) - 如果 Pool 配置为空
    ├─> language_capability_index.read() [READ LOCK] (Line 152, 187)
    └─> management.read() [READ LOCK] (Line 183) ⚠️ 阻塞点 5
```

**关键发现**:
1. **心跳更新后立即调用多个操作**：`update_node_snapshot()` 和 `phase3_upsert_node_to_pool_index_with_runtime()` 都在心跳更新后立即调用
2. **多次获取读锁**：`phase3_upsert_node_to_pool_index_with_runtime()` 需要**至少 3 次**获取 `management.read()` 锁
3. **包含多次 Redis 查询**：`phase3_upsert_node_to_pool_index_with_runtime()` 包含**至少 7 次** Redis 查询（has_node_capability × 6 + get_pool_config × 1）
4. **写锁竞争**：虽然心跳更新时写锁很快释放，但如果多个心跳更新同时发生，会导致写锁竞争

### 2. 心跳更新后的操作导致锁竞争严重（主要原因）

**问题**:
- `update_node_heartbeat()` 释放写锁后，**立即**调用 `update_node_snapshot()`
- `update_node_snapshot()` 需要获取 `management.read()` 锁
- 如果此时有其他心跳更新正在获取写锁，会导致：
  - 写锁请求优先于读锁请求（Rust RwLock 的公平性）
  - 节点选择线程被阻塞，无法获取读锁
- **更严重的是**：`phase3_upsert_node_to_pool_index_with_runtime()` 需要**至少 3 次**获取 `management.read()` 锁，每次之间还有 Redis 查询，整个流程可能持续**数百毫秒到数秒**

### 3. `phase3_upsert_node_to_pool_index_with_runtime()` 操作耗时过长（关键问题）

**问题**:
- 在心跳更新后**立即**调用 `phase3_upsert_node_to_pool_index_with_runtime()`
- 这个操作需要：
  1. **至少 3 次**获取 `management.read()` 锁 (Line 33, 111, 183)
  2. **至少 7 次** Redis 查询（has_node_capability × 6 + get_pool_config × 1）
  3. **可能**获取 `phase3.write()` 锁 (Line 90)
  4. **多次**获取其他锁（phase3_node_pool.read(), language_capability_index.read()）
- 整个操作可能持续**数百毫秒到数秒**，在这个期间：
  - 如果其他心跳更新持有写锁，节点选择会被阻塞
  - 如果节点选择正在读取 snapshot，`update_node_snapshot()` 的 `snapshot.write()` 会阻塞

### 4. 多个操作同时竞争同一把锁

**问题**:
- `management_registry` 的写锁被多个操作竞争：
  - 心跳更新（高频，每 15 秒/节点）
  - 节点注册（低频）
  - 节点离线（低频）
- 读锁被多个操作竞争：
  - 节点选择（高频，每次任务创建）
  - 快照更新（高频，每次心跳更新后）
  - Pool 分配（高频，每次心跳更新后，如果语言能力变化）
  - 其他查询操作（中频）

**锁竞争矩阵**:

| 操作 | 写锁占用 | 读锁占用 | 频率 | 持续时间 | 阻塞风险 |
|------|---------|---------|------|---------|---------|
| 心跳更新 (update_node_heartbeat) | ✅ | ❌ | 高（每 15 秒/节点） | < 10ms（锁内） | ⚠️⚠️⚠️ 高 |
| 心跳更新后的快照更新 (update_node_snapshot) | ❌ | ✅ (management) + ✅ (snapshot.write) | 高（每次心跳后） | 未知 | ⚠️⚠️⚠️ 高 |
| 心跳更新后的 Pool 分配 (phase3_upsert_node_to_pool_index_with_runtime) | ❌ | ✅ (management × 3) | 高（每次心跳后，如果条件满足） | 数百毫秒到数秒 | ⚠️⚠️⚠️ 极高 |
| 心跳更新后的缓存更新 (phase3_core_cache_upsert_node) | ❌ | ❌ | 高（每次心跳后） | 未知 | ⚠️ 中 |
| 节点选择 (get_or_init_snapshot_manager) | ❌ | ✅ (management) | 高（每次任务创建） | 未知 | ⚠️⚠️⚠️ 高 |
| 节点选择 (get_snapshot) | ❌ | ✅ (snapshot) | 高（每次任务创建） | 未知 | ⚠️⚠️⚠️ 高 |

## 解决方案

### 方案 1: 延迟 `update_node_snapshot()` 调用（推荐）

**思路**: 将 `update_node_snapshot()` 的调用延迟到心跳更新的最后，或者使用后台任务异步执行。

**实现**:
- 在 `update_node_heartbeat()` 中，不立即调用 `update_node_snapshot()`
- 使用 `tokio::spawn` 在后台异步执行 `update_node_snapshot()`
- 或者使用队列，批量更新快照

### 方案 2: 优化心跳更新的锁持有时间

**思路**: 减少心跳更新时锁内的操作，将非关键操作移到锁外。

**实现**:
- 只更新关键字段（cpu_usage, gpu_usage, memory_usage, current_jobs, last_heartbeat）
- 将 `installed_models`、`installed_services`、`language_capabilities` 等非关键字段的更新移到锁外
- 或者使用更细粒度的锁，避免全局写锁

### 方案 3: 使用无锁数据结构或原子操作

**思路**: 对于只读频繁的数据（如节点列表），使用无锁数据结构或原子操作。

**实现**:
- 使用 `Arc<HashMap<...>>` + `AtomicUsize` 版本号
- 使用 Copy-on-Write (COW) 模式，避免写锁竞争

### 方案 4: 添加超时机制

**思路**: 在获取锁时添加超时机制，避免永久阻塞。

**实现**:
- 使用 `tokio::time::timeout()` 包装锁获取操作
- 如果超时，记录警告并继续执行（可能使用旧数据）

## 问题总结

### 核心问题：心跳更新后的操作导致锁竞争严重

**问题链路**:
1. **心跳更新**：获取写锁，更新节点状态（< 10ms）
2. **心跳更新后立即调用**：
   - `update_node_snapshot()` 需要获取 `management.read()` + `snapshot.write()`（可能阻塞节点选择）
   - `phase3_upsert_node_to_pool_index_with_runtime()` 需要**至少 3 次**获取 `management.read()` + **至少 7 次** Redis 查询（可能持续数百毫秒到数秒）
   - `phase3_core_cache_upsert_node()` 需要获取 `phase3_core_cache.write()`
3. **节点选择**：需要获取 `management.read()` + `snapshot.read()`，被阻塞

### 关键数据

**占用管理锁的操作统计**:

| 操作 | 写锁 | 读锁 | 频率 | 持续时间 | Redis 查询 | 阻塞风险 |
|------|-----|------|------|---------|-----------|---------|
| `update_node_heartbeat()` | ✅ | ❌ | 高（每 15 秒/节点） | < 10ms | 0 | ⚠️⚠️⚠️ 高 |
| `update_node_snapshot()` | ❌ | ✅ (management) + ✅ (snapshot.write) | 高（每次心跳后） | 未知 | 0 | ⚠️⚠️⚠️ 高 |
| `phase3_upsert_node_to_pool_index_with_runtime()` | ❌ | ✅ (management × **3**) | 高（每次心跳后，如果条件满足） | **数百毫秒到数秒** | **至少 7 次** | ⚠️⚠️⚠️ **极高** |
| `phase3_core_cache_upsert_node()` | ❌ | ❌ | 高（每次心跳后） | 未知 | 0 | ⚠️ 中 |
| `get_or_init_snapshot_manager()` | ❌ | ✅ (management) | 高（每次任务创建） | 未知 | 0 | ⚠️⚠️⚠️ 高 |
| `get_snapshot()` | ❌ | ✅ (snapshot) | 高（每次任务创建） | 未知 | 0 | ⚠️⚠️⚠️ 高 |

**总计**:
- **写锁占用**：1 个操作（心跳更新）
- **读锁占用**：至少 5 个操作，其中 `phase3_upsert_node_to_pool_index_with_runtime()` 需要**至少 3 次**读锁
- **Redis 查询**：`phase3_upsert_node_to_pool_index_with_runtime()` 包含**至少 7 次** Redis 查询

### 阻塞时间线（推测）

```
时间点 0ms:   心跳更新获取写锁 (management.write())
时间点 0-10ms: 持有写锁，更新节点状态
时间点 10ms:   释放写锁
时间点 10ms:   update_node_snapshot() 尝试获取读锁 (management.read()) ⚠️ 可能阻塞
时间点 10ms:   phase3_upsert_node_to_pool_index_with_runtime() 尝试获取读锁 (management.read()) ⚠️ 可能阻塞
时间点 10ms:   节点选择尝试获取读锁 (management.read()) ⚠️ 被阻塞
时间点 10-1000ms+: 如果多个心跳更新同时发生，写锁竞争导致读锁等待时间过长
时间点 1000ms+: 读锁获取成功，但 phase3_upsert_node_to_pool_index_with_runtime() 还在执行 Redis 查询
时间点 1000-3000ms+: Redis 查询完成，但可能还有其他操作需要获取锁
```

## 推荐修复方案

### 方案 1: 延迟心跳更新后的操作（推荐，立即实施）

**思路**: 将心跳更新后的耗时操作（`update_node_snapshot()`, `phase3_upsert_node_to_pool_index_with_runtime()`）改为后台异步执行，不阻塞心跳更新主流程。

**实现**:
```rust
// 在 update_node_heartbeat() 中，不立即调用 update_node_snapshot()
// 而是使用 tokio::spawn 在后台异步执行
if let Some(ref n) = updated_node {
    let node_id_clone = node_id.to_string();
    let node_clone = n.clone();
    let registry_clone = self.clone();
    
    // 后台异步执行快照更新和 Pool 分配
    tokio::spawn(async move {
        let snapshot_manager = registry_clone.get_or_init_snapshot_manager().await;
        snapshot_manager.update_node_snapshot(&node_id_clone).await;
        
        // 只在需要时更新 Pool 分配（避免每次都执行）
        // 可以通过检查语言能力是否变化来决定
    });
    
    // 缓存更新可以保留在锁外，但应该快速执行
    self.phase3_core_cache_upsert_node(n.clone()).await;
}
```

**优点**:
- 心跳更新主流程不会阻塞
- 节点选择不会被心跳更新后的操作阻塞
- 实现简单，风险低

**缺点**:
- 快照更新可能有延迟（但影响不大，因为是增量更新）

### 方案 2: 优化 `phase3_upsert_node_to_pool_index_with_runtime()` 的锁使用（推荐，中期实施）

**思路**: 减少 `phase3_upsert_node_to_pool_index_with_runtime()` 中的读锁获取次数，提前克隆节点信息，避免多次获取锁。

**实现**:
```rust
// 在 phase3_upsert_node_to_pool_index_with_runtime() 中
// 1. 提前克隆节点信息，只获取一次读锁
let node_clone = {
    let mgmt = self.management_registry.read().await;
    mgmt.nodes.get(node_id).map(|state| state.node.clone())
};
drop(mgmt); // 立即释放读锁

// 2. 在锁外进行 Redis 查询
if let Some(rt) = phase2_runtime {
    let has_asr = rt.has_node_capability(node_id, &ServiceType::Asr).await;
    let has_nmt = rt.has_node_capability(node_id, &ServiceType::Nmt).await;
    let has_tts = rt.has_node_capability(node_id, &ServiceType::Tts).await;
    // ... 使用克隆的节点信息进行后续操作
}

// 3. 只在最后需要更新 Pool 分配时获取写锁
```

**优点**:
- 减少读锁获取次数（从 3 次减少到 1 次）
- 避免在持有锁时进行 Redis 查询
- 减少锁竞争

**缺点**:
- 需要重构代码，可能影响其他逻辑

### 方案 3: 添加超时机制（推荐，立即实施）

**思路**: 在节点选择时添加超时机制，避免永久阻塞。

**实现**:
```rust
// 在 get_or_init_snapshot_manager() 和 get_snapshot() 调用时添加超时
let snapshot_manager = tokio::time::timeout(
    Duration::from_millis(5000), // 5 秒超时
    self.node_registry.get_or_init_snapshot_manager()
).await;

match snapshot_manager {
    Ok(sm) => {
        let snapshot = tokio::time::timeout(
            Duration::from_millis(1000), // 1 秒超时
            sm.get_snapshot()
        ).await;
        // ... 处理 snapshot
    },
    Err(_) => {
        warn!("获取快照管理器超时，使用默认配置");
        // 使用默认配置或返回错误
    }
}
```

**优点**:
- 避免永久阻塞
- 可以提供降级方案

**缺点**:
- 超时可能导致任务失败或使用旧数据

### 方案 4: 优化心跳更新的锁持有时间（长期优化）

**思路**: 减少心跳更新时锁内的操作，将非关键操作移到锁外。

**实现**:
- 只更新关键字段（cpu_usage, gpu_usage, memory_usage, current_jobs, last_heartbeat）
- 将 `installed_models`、`installed_services`、`language_capabilities` 等非关键字段的更新移到锁外
- 或者使用更细粒度的锁，避免全局写锁

**优点**:
- 减少锁持有时间
- 减少锁竞争

**缺点**:
- 需要重构代码，可能影响数据一致性

## 推荐实施顺序

1. **立即实施**（方案 3）：添加超时机制，避免永久阻塞
2. **立即实施**（方案 1）：将心跳更新后的操作改为后台异步执行
3. **中期实施**（方案 2）：优化 `phase3_upsert_node_to_pool_index_with_runtime()` 的锁使用
4. **长期优化**（方案 4）：优化心跳更新的锁持有时间

## 预期效果

实施方案 1 + 方案 3 后：
- 心跳更新不会阻塞节点选择
- 节点选择不会永久阻塞（有超时机制）
- 锁竞争显著减少

实施方案 2 后：
- `phase3_upsert_node_to_pool_index_with_runtime()` 的锁使用优化
- 读锁获取次数减少（从 3 次减少到 1 次）
- Redis 查询在锁外进行，不会阻塞其他操作
