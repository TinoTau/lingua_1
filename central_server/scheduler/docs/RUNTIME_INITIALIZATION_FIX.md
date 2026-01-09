# 运行时初始化修复

## 问题描述
调度服务器启动时报错：
```
thread 'main' (59232) panicked at src\node_registry\core.rs:49:47:
Cannot start a runtime from within a runtime. This happens because a function (like `block_on`) attempted to block the current thread while the thread is being used to drive asynchronous tasks.
```

## 问题原因
在 `NodeRegistry::new()` 和 `with_resource_threshold()` 中，使用了 `tokio::runtime::Handle::current().block_on()` 来初始化 `SnapshotManager`。但 `block_on()` 不能在已经运行的 Tokio 运行时中调用，这会导致 panic。

## 解决方案
使用 `tokio::sync::OnceCell` 实现延迟初始化，让 `SnapshotManager` 在首次使用时（异步上下文中）初始化。

### 修改内容

1. **字段类型修改**
   - **文件**: `src/node_registry/mod.rs`
   - **之前**: `snapshot_manager: Arc<SnapshotManager>`
   - **之后**: `snapshot_manager: Arc<tokio::sync::OnceCell<SnapshotManager>>`

2. **构造函数修改**
   - **文件**: `src/node_registry/core.rs`
   - **之前**: 使用 `block_on()` 同步初始化
   - **之后**: 创建空的 `OnceCell`，延迟初始化

3. **添加辅助方法**
   - **文件**: `src/node_registry/lock_optimization.rs`
   - **新增**: `get_or_init_snapshot_manager()` 方法，使用 `OnceCell::get_or_init()` 进行延迟初始化

4. **更新使用位置**
   - **文件**: `src/node_registry/lock_optimization.rs`
   - 所有使用 `self.snapshot_manager` 的地方改为先调用 `get_or_init_snapshot_manager()`
   
   - **文件**: `src/node_registry/selection/selection_phase3.rs`
   - 直接使用 `self.snapshot_manager.get_or_init()` 进行延迟初始化

## 代码对比

### 之前（会导致 panic）
```rust
pub fn new() -> Self {
    let snapshot_manager = Arc::new(
        tokio::runtime::Handle::current().block_on(
            SnapshotManager::new((*management_registry).clone())
        )
    );
    // ...
}
```

### 之后（延迟初始化）
```rust
pub fn new() -> Self {
    // 创建空的 OnceCell，延迟初始化
    let snapshot_manager = Arc::new(tokio::sync::OnceCell::new());
    // ...
}

// 在异步方法中使用
async fn get_or_init_snapshot_manager(&self) -> &SnapshotManager {
    self.snapshot_manager.get_or_init(|| async {
        SnapshotManager::new((*self.management_registry).clone()).await
    }).await
}
```

## 优势

1. **避免 panic**: 不再在同步上下文中调用 `block_on()`
2. **延迟初始化**: `SnapshotManager` 只在首次使用时初始化，减少启动时间
3. **线程安全**: `OnceCell` 保证只初始化一次，多线程安全
4. **性能优化**: 如果某些代码路径不使用快照管理器，则不会初始化

## 编译状态
✅ **编译通过** - 所有代码已编译通过，无错误

## 测试建议
1. 启动调度服务器，确认不再 panic
2. 执行调度操作，确认快照管理器正常初始化
3. 验证性能，确认延迟初始化不影响功能
