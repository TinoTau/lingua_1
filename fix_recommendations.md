# 修复建议：减少重复的快照获取

## 问题总结

在任务分配流程中，存在**大量重复的快照获取操作**：

- **Phase2 路径**: 至少 5 次快照获取
- **Phase1 路径**: 至少 4 次快照获取

每次快照获取都需要读锁，在心跳更新后的操作正在执行时，这些获取都会被阻塞，导致锁竞争严重。

## 立即修复（高优先级）

### 修复 1: 使用 `phase3_config.enabled` 替代快照获取

**位置**:
- `job_selection.rs:95-96`
- `job_creation_phase2.rs:321-322`

**问题**:
- 只使用 `snapshot.lang_index.is_empty()` 来判断 Phase3 是否启用
- 但 `phase3_config.enabled` 已经包含了这个信息

**修复**:
```rust
// 修改前 (job_selection.rs:95-96)
let snapshot_manager = self.node_registry.get_or_init_snapshot_manager().await;
let snapshot = snapshot_manager.get_snapshot().await;
let phase3_enabled = !snapshot.lang_index.is_empty();

// 修改后
// 接收 phase3_config 作为参数，使用 phase3_config.enabled
// 需要修改函数签名：select_node_with_module_expansion_with_breakdown(&self, ..., phase3_config: &Phase3Config, ...)
let phase3_enabled = phase3_config.enabled;
```

**效果**: 减少 2 次快照获取（Phase2 和 Phase1 路径各 1 次）

## 尽快修复（中优先级）

### 修复 2: 传递快照作为参数（preferred_node_id 验证）

**位置**: `job_creation_node_selection.rs:133-134`

**问题**:
- 在验证 `preferred_node_id` 时，重新获取快照
- 但调用者已经有快照，可以传递下来

**修复**:
```rust
// 修改前 (job_creation_node_selection.rs:133-134)
let snapshot_manager = self.node_registry.get_or_init_snapshot_manager().await;
let snapshot = snapshot_manager.get_snapshot().await;
let snapshot_clone = snapshot.clone();
if !self.check_node_supports_language_pair(&node_id, src_lang, tgt_lang, &snapshot_clone).await {

// 修改后
// 在调用 select_node_with_preferred_node_id 时，传递快照作为参数
// 需要修改函数签名：select_node_with_preferred_node_id(&self, ..., snapshot: &RuntimeSnapshot, ...)
if !self.check_node_supports_language_pair(&node_id, src_lang, tgt_lang, snapshot).await {
```

**效果**: 减少 1 次快照获取

### 修复 3: 传递 lang_index 作为参数（Phase3 节点选择）

**位置**: `selection_phase3.rs:87`

**问题**:
- 在 Phase3 节点选择时，获取快照用于获取 lang_index
- 但 lang_index 可以从调用者的快照中获取，或者从 phase3_config 中获取

**修复**:
```rust
// 修改前 (selection_phase3.rs:87)
let lang_index = {
    let snapshot_manager = self.snapshot_manager.get_or_init(...).await;
    let snapshot_guard = snapshot_manager.get_snapshot().await;
    let lang_index_clone = snapshot_guard.lang_index.clone();
    // ...
};

// 修改后
// 在调用 select_node_with_types_two_level_excluding_with_breakdown 时，传递 lang_index 作为参数
// 需要修改函数签名：select_node_with_types_two_level_excluding_with_breakdown(&self, ..., lang_index: &PoolLanguageIndex, ...)
// 或者从 phase3_config 中获取 lang_index（如果可能）
```

**效果**: 减少 1 次快照获取

## 可选修复（低优先级）

### 修复 4: 保持异步执行的一致性

**位置**: `core.rs:115-116`

**问题**:
- `upsert_node_from_snapshot` 中同步调用 `update_node_snapshot`
- 与 `update_node_heartbeat` 中的异步执行不一致

**修复**:
```rust
// 修改前 (core.rs:115-116)
let snapshot_manager = self.get_or_init_snapshot_manager().await;
snapshot_manager.update_node_snapshot(&node_id).await;

// 修改后
let node_id_clone = node_id.clone();
let registry_clone = self.clone();
tokio::spawn(async move {
    let snapshot_manager = registry_clone.get_or_init_snapshot_manager().await;
    snapshot_manager.update_node_snapshot(&node_id_clone).await;
});
```

**效果**: 保持一致性，减少阻塞（低频操作）

## 修复顺序建议

1. **第一步**: 应用修复 1（使用 `phase3_config.enabled`）
   - 简单，影响大，可以减少 2 次快照获取

2. **第二步**: 应用修复 2（传递快照作为参数）
   - 中等难度，可以减少 1 次快照获取

3. **第三步**: 应用修复 3（传递 lang_index 作为参数）
   - 中等难度，可以减少 1 次快照获取

4. **第四步**: 应用修复 4（保持异步执行一致性）
   - 简单，影响小，主要是保持一致性

## 预期效果

### 修复前
- Phase2 路径: **5 次**快照获取
- Phase1 路径: **4 次**快照获取
- 锁竞争: 严重

### 修复后（应用所有修复）
- Phase2 路径: **1-2 次**快照获取（减少 60-80%）
- Phase1 路径: **1 次**快照获取（减少 75%）
- 锁竞争: 显著减少
