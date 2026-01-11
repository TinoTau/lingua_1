# 锁使用情况分析

## 文档信息
- **版本**: v1.0
- **日期**: 2026-01-09
- **目的**: 分析当前代码中多个路径调用同一把锁的情况，评估是否可以拆分

---

## 一、当前锁使用情况

### 1.1 `nodes.write()` 使用位置

| 文件 | 函数 | 用途 | 路径类型 |
|------|------|------|----------|
| `core.rs` | `upsert_node_from_snapshot` | 快照同步 | 冷路径 |
| `core.rs` | `register_node_with_policy` | 节点注册 | 冷路径 |
| `core.rs` | `set_node_status` | 状态更新 | 冷路径 |
| `core.rs` | `mark_node_offline` | 节点下线 | 冷路径 |
| `phase3_pool_members.rs` | `phase3_set_node_pools` | Pool 分配 | 冷路径 |

**总结**: 5 个位置，都是**冷路径**（管理操作）

### 1.2 `nodes.read()` 使用位置

| 文件 | 函数 | 用途 | 路径类型 |
|------|------|------|----------|
| `core.rs` | `get_node_snapshot` | 获取快照 | 冷路径 |
| `core.rs` | `is_node_available` | 可用性检查 | **热路径** ⚠️ |
| `core.rs` | `get_node_status` | 状态查询 | 冷路径 |
| `core.rs` | `check_node_has_types_ready` | 类型检查 | **热路径** ⚠️ |
| `node_selection.rs` | `select_node_with_types_excluding` | 节点选择 | **热路径** ⚠️ |
| `phase3_pool_allocation_impl.rs` | `phase3_upsert_node_to_pool_index` | Pool 分配 | 冷路径 |
| `phase3_core_cache.rs` | `phase3_core_cache_upsert_node` | 缓存更新 | 冷路径 |
| `phase3_pool_cleanup.rs` | `cleanup_offline_nodes` | Pool 清理 | 冷路径 |

**总结**: 8 个位置，其中 **3 个是热路径**（调度操作）⚠️

---

## 二、问题分析

### 2.1 锁竞争场景

**场景 1: 热路径 vs 冷路径竞争**

```
时间线：
T0: 节点心跳（冷路径）
    └─> nodes.write().await [获取写锁]
        └─> 更新节点状态 (50-200ms)
    [释放写锁]

T1: 任务分配（热路径）
    └─> nodes.read().await [等待写锁释放]
        └─> 等待 50-200ms ❌
    [获取读锁，选择节点 (10-50ms)]
```

**场景 2: 多个热路径竞争**

```
时间线：
T0: 任务分配请求1（热路径）
    └─> nodes.read().await [获取读锁]
        └─> 选择节点 (10-50ms)

T1: 任务分配请求2（热路径）
    └─> nodes.read().await [等待读锁]
        └─> 等待 10-50ms（虽然可以并发，但仍有开销）

T2: 节点心跳（冷路径）
    └─> nodes.write().await [等待所有读锁释放]
        └─> 等待 10-50ms
    [获取写锁，更新节点 (50-200ms)]
```

### 2.2 关键问题

1. **热路径还在使用 `nodes.read()`**
   - `node_selection.rs` - 节点选择（每次任务分配都调用）
   - `core.rs::is_node_available` - 可用性检查（频繁调用）
   - `core.rs::check_node_has_types_ready` - 类型检查（频繁调用）

2. **冷路径使用 `nodes.write()`**
   - 虽然已经优化，但仍在多个地方使用
   - 应该统一迁移到 `ManagementRegistry`

3. **锁粒度问题**
   - 一个全局锁保护所有节点
   - 无法细粒度控制

---

## 三、是否可以拆分？

### 3.1 技术规范要求

根据 `SCHEDULER_LOCK_AND_PATH_OPTIMIZATION_TECH_SPEC_v1.md`：

1. **热路径（调度）**: 只使用 `RuntimeSnapshot`（无锁或轻量读锁）
2. **冷路径（管理）**: 使用 `ManagementRegistry`（统一管理锁）
3. **不应该**: 热路径访问 `nodes` 锁

### 3.2 当前状态

✅ **已实现**:
- `ManagementRegistry` - 统一管理锁
- `RuntimeSnapshot` - 运行时快照
- `SnapshotManager` - 快照管理器

❌ **未完成**:
- 热路径还在使用 `nodes.read()`
- 冷路径还在使用 `nodes.write()`
- 没有完全迁移到新架构

### 3.3 是否可以拆分？

**答案：可以，而且应该拆分！**

**方案**:

1. **热路径迁移到 RuntimeSnapshot**
   - `node_selection.rs` → 使用 `RuntimeSnapshot.nodes`（无锁）
   - `is_node_available` → 使用 `RuntimeSnapshot`（无锁）
   - `check_node_has_types_ready` → 使用 `RuntimeSnapshot`（无锁）

2. **冷路径迁移到 ManagementRegistry**
   - `register_node_with_policy` → 使用 `ManagementRegistry.write()`（统一锁）
   - `update_node_heartbeat` → 已迁移 ✅
   - `set_node_status` → 使用 `ManagementRegistry.write()`
   - `mark_node_offline` → 使用 `ManagementRegistry.write()`

3. **移除旧的 `nodes` 锁**
   - 如果所有路径都迁移完成，可以移除 `nodes` 锁
   - 或者保留作为向后兼容（但不再使用）

---

## 四、拆分方案

### 4.1 热路径迁移（优先级：高）

#### 4.1.1 节点选择路径

**当前代码** (`node_selection.rs`):
```rust
let nodes = self.nodes.read().await;  // ❌ 热路径使用锁
let candidate_nodes: Vec<(String, Node)> = nodes.iter()
    .filter(|(_, n)| n.online && ...)
    .collect();
```

**优化后**:
```rust
// 使用 RuntimeSnapshot（无锁）
let snapshot = self.snapshot_manager.get_snapshot().await;
let candidate_nodes: Vec<(String, Arc<NodeRuntimeSnapshot>)> = snapshot.nodes
    .iter()
    .filter(|(_, n)| n.health == NodeHealth::Online && ...)
    .map(|(id, n)| (id.clone(), n.clone()))
    .collect();
```

#### 4.1.2 可用性检查

**当前代码** (`core.rs::is_node_available`):
```rust
let nodes = self.nodes.read().await;  // ❌ 热路径使用锁
if let Some(node) = nodes.get(node_id) {
    node.online && node.current_jobs < node.max_concurrent_jobs
}
```

**优化后**:
```rust
// 使用 RuntimeSnapshot（无锁）
let snapshot = self.snapshot_manager.get_snapshot().await;
if let Some(node) = snapshot.nodes.get(node_id) {
    node.health == NodeHealth::Online 
        && node.current_jobs < node.max_concurrency as usize
}
```

#### 4.1.3 类型检查

**当前代码** (`core.rs::check_node_has_types_ready`):
```rust
let nodes = self.nodes.read().await;  // ❌ 热路径使用锁
if let Some(node) = nodes.get(node_id) {
    node_has_required_types_ready(node, required_types, phase2_runtime).await
}
```

**优化后**:
```rust
// 使用 RuntimeSnapshot（无锁）
let snapshot = self.snapshot_manager.get_snapshot().await;
if let Some(node) = snapshot.nodes.get(node_id) {
    // 从快照中检查能力（或从 Redis 检查，但不在锁内）
    check_node_capabilities_from_snapshot(node, required_types, phase2_runtime).await
}
```

### 4.2 冷路径迁移（优先级：中）

#### 4.2.1 节点注册

**当前代码** (`core.rs::register_node_with_policy`):
```rust
let mut nodes = self.nodes.write().await;  // ❌ 使用旧锁
nodes.insert(node_id, node);
```

**优化后**:
```rust
// 使用 ManagementRegistry（统一锁）
let mut mgmt = self.management_registry.write().await;
mgmt.nodes.insert(node_id, NodeState::from(node));
// Pool 分配在锁外进行
```

#### 4.2.2 状态更新

**当前代码** (`core.rs::set_node_status`):
```rust
let mut nodes = self.nodes.write().await;  // ❌ 使用旧锁
if let Some(node) = nodes.get_mut(node_id) {
    node.status = status;
}
```

**优化后**:
```rust
// 使用 ManagementRegistry（统一锁）
let mut mgmt = self.management_registry.write().await;
if let Some(state) = mgmt.nodes.get_mut(node_id) {
    state.node.status = status;
}
```

---

## 五、实施建议

### 5.1 优先级

1. **高优先级**: 热路径迁移（立即实施）
   - 影响：调度性能，锁竞争
   - 收益：消除热路径锁竞争

2. **中优先级**: 冷路径迁移（后续实施）
   - 影响：代码一致性
   - 收益：统一锁模型

3. **低优先级**: 移除旧锁（最后实施）
   - 影响：代码清理
   - 收益：代码简化

### 5.2 实施步骤

**Phase 1: 热路径迁移**（1-2天）
1. 修改 `node_selection.rs` 使用 `RuntimeSnapshot`
2. 修改 `is_node_available` 使用 `RuntimeSnapshot`
3. 修改 `check_node_has_types_ready` 使用 `RuntimeSnapshot`
4. 测试验证

**Phase 2: 冷路径迁移**（2-3天）
1. 修改 `register_node_with_policy` 使用 `ManagementRegistry`
2. 修改 `set_node_status` 使用 `ManagementRegistry`
3. 修改 `mark_node_offline` 使用 `ManagementRegistry`
4. 测试验证

**Phase 3: 清理**（1天）
1. 移除未使用的 `nodes` 锁访问
2. 代码审查
3. 文档更新

---

## 六、结论

### 6.1 当前状态

- ✅ **已优化**: 心跳更新路径
- ✅ **已优化**: 节点注册 Pool 分配
- ❌ **未完成**: 热路径还在使用 `nodes.read()`
- ❌ **未完成**: 冷路径还在使用 `nodes.write()`

### 6.2 是否可以拆分？

**答案：可以，而且应该拆分！**

**原因**:
1. 技术规范已经定义了清晰的架构
2. 基础设施已经实现（`ManagementRegistry`、`RuntimeSnapshot`）
3. 只需要迁移代码，不需要重新设计

### 6.3 拆分收益

1. **消除热路径锁竞争**: 调度路径不再被管理操作阻塞
2. **统一锁模型**: 所有管理操作使用统一锁
3. **代码更清晰**: 热路径和冷路径明确分离

---

## 附录：锁使用统计

### 热路径锁使用（需要迁移）

| 函数 | 文件 | 锁类型 | 调用频率 | 优先级 |
|------|------|--------|----------|--------|
| `select_node_with_types_excluding` | `node_selection.rs` | `nodes.read()` | 每次任务分配 | **高** |
| `is_node_available` | `core.rs` | `nodes.read()` | 每次任务分配 | **高** |
| `check_node_has_types_ready` | `core.rs` | `nodes.read()` | 每次任务分配 | **高** |

### 冷路径锁使用（可以迁移）

| 函数 | 文件 | 锁类型 | 调用频率 | 优先级 |
|------|------|--------|----------|--------|
| `register_node_with_policy` | `core.rs` | `nodes.write()` | 节点注册 | 中 |
| `set_node_status` | `core.rs` | `nodes.write()` | 状态更新 | 中 |
| `mark_node_offline` | `core.rs` | `nodes.write()` | 节点下线 | 中 |
| `upsert_node_from_snapshot` | `core.rs` | `nodes.write()` | 快照同步 | 中 |
