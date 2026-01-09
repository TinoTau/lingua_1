# 调度路径改造计划

## 改造目标

根据 `SCHEDULER_LOCK_OPTIMIZATION_COMBINED_DESIGN_v1.md` 的要求，改造调度路径以使用：
1. RuntimeSnapshot（无锁读取）
2. PoolLanguageIndex（O(1) 查找）
3. SessionRuntimeManager（Session 级别状态管理）

## 改造步骤

### 阶段 1：在 NodeRegistry 中添加新组件（可选字段）

**文件**: `src/node_registry/mod.rs`

添加可选的新组件字段，保持向后兼容：
```rust
pub struct NodeRegistry {
    // ... 现有字段 ...
    
    // 新增：锁优化组件（可选，用于渐进式迁移）
    /// 管理注册表（统一管理锁）
    management_registry: Option<Arc<management_state::ManagementRegistry>>,
    /// 快照管理器（调度快路径）
    snapshot_manager: Option<Arc<snapshot_manager::SnapshotManager>>,
    /// Session 运行时管理器（每个 session 一把锁）
    session_runtime_manager: Option<Arc<crate::core::SessionRuntimeManager>>,
}
```

### 阶段 2：修改 pool_selection 使用 PoolLanguageIndex

**文件**: `src/node_registry/selection/pool_selection.rs`

将 O(N) 遍历改为使用 PoolLanguageIndex 的 O(1) 查找：
- 使用 `lang_index.find_pools_for_lang_pair()` 替代遍历 `cfg.pools`
- 使用 `lang_index.find_pools_for_mixed_lang()` 处理 "auto" 场景

### 阶段 3：修改 selection_phase3 使用 RuntimeSnapshot

**文件**: `src/node_registry/selection/selection_phase3.rs`

改造点：
1. 使用 `snapshot_manager.get_snapshot().await` 替代 `self.nodes.read().await`
2. 使用 `snapshot.lang_index` 替代 `cfg.pools` 遍历
3. 使用 `snapshot.pool_members_cache` 替代直接读取 Redis
4. 集成 `session_runtime_manager` 进行 session 级别状态管理

### 阶段 4：初始化新组件

**文件**: `src/node_registry/core.rs`

在 NodeRegistry 初始化时创建新组件（如果启用锁优化）：
```rust
// 如果启用锁优化，创建新组件
let management = ManagementRegistry::new(phase3_config, core_services);
let snapshot_manager = SnapshotManager::new(management.clone()).await;
let session_manager = SessionRuntimeManager::new();
```

## 向后兼容策略

1. **可选字段**：新组件使用 `Option` 包装，默认 `None`
2. **渐进式迁移**：先添加新组件，然后逐步迁移调度路径
3. **功能开关**：可以通过配置决定是否使用新组件

## 改造顺序

1. ✅ 基础设施已就绪（ManagementRegistry、SnapshotManager、SessionRuntimeManager）
2. ⏳ 在 NodeRegistry 中添加新组件字段
3. ⏳ 修改 pool_selection 使用 PoolLanguageIndex
4. ⏳ 修改 selection_phase3 使用 RuntimeSnapshot
5. ⏳ 集成 SessionRuntimeManager
6. ⏳ 测试和验证

## 注意事项

1. **死锁安全**：严格遵守锁顺序
   - 调度路径不得在 session 锁内访问管理锁
   - 管理域逻辑不得访问 SessionManager

2. **性能考虑**：
   - 快照更新使用 COW 机制，不阻塞调度
   - Session 锁应该是轻量级的

3. **测试**：
   - 需要测试并发场景
   - 需要测试快照更新的正确性
   - 需要测试 Session 锁的正确性
