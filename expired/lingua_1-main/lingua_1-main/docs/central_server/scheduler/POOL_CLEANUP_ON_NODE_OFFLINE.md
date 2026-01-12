# Pool 清理机制：节点离线时的处理

## 当前实现状态

### 1. 节点离线处理

**文件**: `central_server/scheduler/src/node_registry/core.rs`

```rust
pub async fn mark_node_offline(&self, node_id: &str) {
    let mut updated: Option<super::Node> = None;
    {
        let mut nodes = self.nodes.write().await;
        if let Some(node) = nodes.get_mut(node_id) {
            node.online = false;  // 标记为离线
            updated = Some(node.clone());
        }
    }
    if let Some(n) = updated {
        self.phase3_core_cache_upsert_node(n).await;  // 更新 core cache
    } else {
        self.phase3_core_cache_remove_node(node_id).await;  // 移除缓存
    }
}
```

**问题**：
- ✅ 节点被标记为 `online = false`
- ✅ Core cache 被更新
- ❌ **没有从 Pool 索引中移除节点**
- ❌ **没有检查 Pool 是否需要重建**

### 2. Pool 索引清理机制

**文件**: `central_server/scheduler/src/node_registry/phase3_pool.rs`

```rust
pub(super) async fn phase3_set_node_pool(&self, node_id: &str, desired: Option<u16>) {
    // ...
    if let Some(old_pid) = old {
        if let Some(set) = idx.get_mut(&old_pid) {
            set.remove(node_id);
            if set.is_empty() {
                idx.remove(&old_pid);  // ✅ 空 Pool 会被删除
            }
        }
    }
}
```

**功能**：
- ✅ 当节点从 Pool 移除时，如果 Pool 变空，会自动删除该 Pool
- ❌ 但 `mark_node_offline` **没有调用** `phase3_remove_node_from_pool_index`

### 3. 自动 Pool 重建

**文件**: `central_server/scheduler/src/node_registry/phase3_pool.rs`

```rust
pub async fn rebuild_auto_language_pools(&self) {
    // 重新生成所有 Pool
    let new_pools = self.auto_generate_language_pair_pools().await;
    // 更新配置
    phase3.pools = new_pools.clone();
    // 重建索引
    self.rebuild_phase3_pool_index().await;
}
```

**触发时机**：
- ✅ 节点注册时（如果 pools 为空）
- ✅ 配置变更时
- ❌ **节点离线时不会触发**

## 当前行为总结

### ✅ 已实现的功能

1. **节点离线标记**：节点会被正确标记为 `online = false`
2. **空 Pool 自动删除**：如果 Pool 变空，会被自动删除（但需要先调用 `phase3_remove_node_from_pool_index`）
3. **Pool 索引维护**：`phase3_set_node_pool` 方法支持清理空 Pool

### ❌ 缺失的功能

1. **节点离线时未从 Pool 移除**：`mark_node_offline` 没有调用 `phase3_remove_node_from_pool_index`
2. **不会自动重建 Pool 配置**：节点离线后，即使 Pool 变空，也不会自动重建 Pool 配置
3. **没有定期清理机制**：没有定期扫描和清理无效 Pool 的机制

## 改进方案

### 方案 1：节点离线时立即清理（推荐）

**修改 `mark_node_offline` 方法**：

```rust
pub async fn mark_node_offline(&self, node_id: &str) {
    let mut updated: Option<super::Node> = None;
    {
        let mut nodes = self.nodes.write().await;
        if let Some(node) = nodes.get_mut(node_id) {
            node.online = false;
            updated = Some(node.clone());
        }
    }
    
    // 从 Pool 索引中移除节点
    self.phase3_remove_node_from_pool_index(node_id).await;
    
    if let Some(n) = updated {
        self.phase3_core_cache_upsert_node(n).await;
    } else {
        self.phase3_core_cache_remove_node(node_id).await;
    }
    
    // 如果启用自动生成，检查是否需要重建 Pool
    let cfg = self.phase3.read().await.clone();
    if cfg.auto_generate_language_pools {
        // 检查是否有 Pool 变空
        let pool_sizes = self.phase3_pool_sizes().await;
        let empty_pools = pool_sizes.iter().filter(|(_, size)| *size == 0).count();
        
        if empty_pools > 0 {
            info!(
                empty_pools = empty_pools,
                "检测到 {} 个空 Pool，触发重建",
                empty_pools
            );
            // 可选：延迟重建，避免频繁重建
            // 或者：只在所有节点都离线时重建
            self.rebuild_auto_language_pools().await;
        }
    }
}
```

**优点**：
- 立即清理，Pool 索引保持最新
- 自动重建 Pool 配置

**缺点**：
- 如果节点频繁上下线，可能导致频繁重建 Pool

### 方案 2：定期扫描清理（更稳定）

**添加定期清理任务**：

```rust
pub async fn start_pool_cleanup_task(&self) {
    let registry = self.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60)); // 每60秒扫描一次
        loop {
            interval.tick().await;
            
            let cfg = registry.phase3.read().await.clone();
            if !cfg.auto_generate_language_pools {
                continue;
            }
            
            // 1. 清理离线节点
            let nodes = registry.nodes.read().await;
            let offline_nodes: Vec<String> = nodes
                .iter()
                .filter(|(_, n)| !n.online)
                .map(|(id, _)| id.clone())
                .collect();
            drop(nodes);
            
            for node_id in offline_nodes {
                registry.phase3_remove_node_from_pool_index(&node_id).await;
            }
            
            // 2. 检查空 Pool
            let pool_sizes = registry.phase3_pool_sizes().await;
            let empty_pools = pool_sizes.iter().filter(|(_, size)| *size == 0).count();
            
            if empty_pools > 0 {
                info!(
                    empty_pools = empty_pools,
                    "检测到 {} 个空 Pool，触发重建",
                    empty_pools
                );
                registry.rebuild_auto_language_pools().await;
            }
        }
    });
}
```

**优点**：
- 避免频繁重建
- 更稳定，适合生产环境

**缺点**：
- 有延迟（最多60秒）

### 方案 3：混合方案（推荐）

**结合方案 1 和方案 2**：
1. 节点离线时立即从 Pool 索引移除（方案 1）
2. 定期扫描并重建 Pool 配置（方案 2，延迟重建）

## 建议实现

### 优先级 1：立即修复

修改 `mark_node_offline` 方法，添加 Pool 索引清理：

```rust
pub async fn mark_node_offline(&self, node_id: &str) {
    // ... 现有代码 ...
    
    // 从 Pool 索引中移除节点
    self.phase3_remove_node_from_pool_index(node_id).await;
    
    // ... 其余代码 ...
}
```

### 优先级 2：添加定期清理

添加定期清理任务，在应用启动时调用：

```rust
// 在 initialize_app 中调用
node_registry.start_pool_cleanup_task().await;
```

### 优先级 3：优化重建策略

添加重建策略配置：

```toml
[scheduler.phase3.auto_pool_config]
# 是否在节点离线时立即重建 Pool
rebuild_on_node_offline = false  # 默认 false，避免频繁重建
# 定期清理间隔（秒）
cleanup_interval_seconds = 60
# 最小 Pool 节点数（低于此值会触发重建）
min_nodes_per_pool = 1
```

## 测试建议

1. **测试节点离线**：
   - 启动多个节点，创建多个 Pool
   - 停止一个节点
   - 验证节点是否从 Pool 索引中移除
   - 验证空 Pool 是否被删除

2. **测试 Pool 重建**：
   - 启动节点，生成 Pool
   - 停止所有节点
   - 验证 Pool 配置是否被清理
   - 重新启动节点
   - 验证 Pool 是否重新生成

3. **测试定期清理**：
   - 启动节点，生成 Pool
   - 停止节点
   - 等待定期清理任务执行
   - 验证 Pool 是否被清理

## 总结

**当前状态**：
- ❌ 节点离线时不会从 Pool 索引中移除
- ❌ 不会自动重建 Pool 配置
- ✅ 空 Pool 删除机制已实现（但需要先移除节点）

**建议**：
1. 立即修复：在 `mark_node_offline` 中添加 `phase3_remove_node_from_pool_index` 调用
2. 添加定期清理任务，避免频繁重建
3. 添加配置选项，控制重建策略
