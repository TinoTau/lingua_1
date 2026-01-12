# Pool 配置缓存更新修复

## 问题总结

**核心问题**: 从 Redis 同步 Pool 配置后，只更新了 `self.phase3`，但没有更新 `phase3_cache`，导致 `get_phase3_config_cached()` 返回旧的空配置。

**影响**:
- 任务创建时，`prefetch_pool_members()` 无法从缓存中找到 Pool 配置
- 节点选择失败，返回 `node_id: None`
- 任务在 pending 状态超时，无法分配

## 修复内容

### 修复1: Redis 同步时更新缓存

**文件**: `central_server/scheduler/src/node_registry/phase3_pool_cleanup.rs`

**位置**: 第46-66行（从 Redis 同步 Pool 配置）

**修复**: 在更新本地配置后，同步到 ManagementRegistry 和缓存：

```rust
// 更新本地配置
{
    let mut phase3 = self.phase3.write().await;
    phase3.pools = redis_pools.clone();
    // ...
}

// 【关键修复】同步 Pool 配置到 ManagementRegistry 和缓存
let cfg = self.phase3.read().await.clone();
self.sync_phase3_config_to_management(cfg.clone()).await;
self.update_phase3_config_cache(&cfg).await;
```

### 修复2: 重试分支时更新缓存

**位置**: 第149-173行（重试从 Redis 读取成功）

**修复**: 同样添加缓存更新

### 修复3: 自动生成 Pool 时更新缓存

**位置**: 第117-128行（自动生成 Pool 配置）

**修复**: 添加缓存更新

### 修复4: 本地模式时更新缓存

**位置**: 第212-217行（本地模式重建 Pool）

**修复**: 添加缓存更新

### 修复5: 定期同步时更新缓存

**位置**: 第356-362行（定期从 Redis 拉取配置）

**修复**: 添加缓存更新

## 测试验证

修复后，需要验证：
1. ✅ 节点注册后，Pool 配置正确同步到缓存
2. ✅ 任务创建时，能够从缓存中找到 Pool 配置
3. ✅ 节点选择成功，任务正确分配
4. ✅ 任务处理完成，结果正确返回

## 相关文件

- `central_server/scheduler/src/node_registry/phase3_pool_cleanup.rs` - Pool 配置同步逻辑
- `central_server/scheduler/src/node_registry/phase3_pool_creation.rs` - Pool 创建逻辑（已修复）
- `central_server/scheduler/src/node_registry/lock_optimization.rs` - 缓存管理
