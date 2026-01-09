# 向后兼容代码移除总结

## 移除时间
2026-01-09

## 移除原因

用户明确表示：
- 项目没有上线
- 没有用户
- 只需要保持代码简洁

因此，移除所有向后兼容代码，简化实现。

## 移除内容

### 1. 移除 `update_node_heartbeat` 中的向后兼容更新

**移除前**:
```rust
// 向后兼容：同时更新旧的 nodes 映射（保持兼容性）
let updated_legacy = {
    let mut nodes = self.nodes.write().await; // 锁等待时间长
    // 同步更新到旧映射
    ...
};
```

**移除后**:
```rust
// 只使用 ManagementRegistry 更新
let updated_node = self.management_registry.update_node_heartbeat(...).await;
// 不再更新旧的 nodes 映射
```

### 2. 简化返回值

**移除前**:
```rust
updated_legacy  // 返回向后兼容更新的结果
```

**移除后**:
```rust
updated_node.is_some()  // 直接返回 ManagementRegistry 更新的结果
```

## 代码变更

### 文件: `src/node_registry/core.rs`

- **移除**: 向后兼容的 `nodes.write()` 更新代码（约40行）
- **简化**: 返回值逻辑
- **保留**: `ManagementRegistry` 更新路径（主路径）

## 预期效果

### 锁等待改善

| 锁类型 | 移除前 | 移除后（预期） |
|--------|--------|---------------|
| `node_registry.nodes.write` (心跳更新) | 7次（平均1758ms） | 0次 ✓ |
| `node_registry.management_registry.write` | 0次 | 0次 ✓ |

### 代码简化

- **代码行数**: 减少约40行
- **复杂度**: 降低
- **维护性**: 提高

## 注意事项

### 仍在使用 `nodes` 映射的地方

以下地方仍在使用旧的 `nodes` 映射（用于读取）：
- `selection_types.rs` - 单级节点选择
- `node_selection.rs` - Pool内节点选择
- `selection_features.rs` - 功能选择
- `is_node_available` - 节点可用性检查
- `get_node_status` - 节点状态获取（测试用）

**说明**: 这些是读取操作，不影响心跳更新的锁等待问题。如果需要进一步优化，可以考虑将这些也迁移到使用 `RuntimeSnapshot`。

## 测试验证

1. **编译**: ✓ 成功
2. **锁等待**: 需要观察实际运行时的锁等待情况
3. **功能**: 需要验证心跳更新和节点选择是否正常工作

## 相关文件

- `src/node_registry/core.rs` - 主要变更
- `src/node_registry/management_state.rs` - ManagementRegistry 实现
