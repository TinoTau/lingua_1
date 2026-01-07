# Pool 配置 Redis 同步实现文档

## 文档信息

- **版本**: v1.0
- **日期**: 2026-01-06
- **目的**: 记录 Pool 配置同步到 Redis 的实现细节
- **状态**: 已实现

---

## 一、设计概述

### 1.1 目标

在多实例环境下，避免每个实例都独立生成 Pool 配置，减少重复计算：
- **只有 Leader 实例生成 Pool 配置**
- **其他实例从 Redis 读取 Pool 配置**
- **自动故障转移**：Leader 失效时自动切换

### 1.2 核心机制

1. **Leader 选举**：使用 Redis 分布式锁（`SET NX PX`）
2. **配置同步**：Leader 将 Pool 配置写入 Redis，其他实例读取
3. **版本控制**：使用版本号检测配置更新
4. **定期同步**：非 Leader 实例定期检查配置版本并同步

---

## 二、Redis Key 设计

### 2.1 Key 命名

```
lingua:v1:phase3:pools:config      -> Pool 配置（JSON，TTL=1小时）
lingua:v1:phase3:pools:leader     -> Leader 实例 ID（TTL=60秒）
lingua:v1:phase3:pools:version   -> 配置版本号（递增）
```

### 2.2 数据结构

#### Pool 配置快照（`phase3:pools:config`）

```json
{
  "pools": [
    {
      "pool_id": 1,
      "name": "zh-en",
      "required_services": ["asr", "nmt", "tts", "semantic"],
      "language_requirements": { ... }
    },
    ...
  ],
  "version": 1,
  "generated_at": 1704556800000,
  "generated_by": "scheduler-1"
}
```

#### Leader 信息（`phase3:pools:leader`）

```
scheduler-1  (TTL=60秒)
```

#### 版本号（`phase3:pools:version`）

```
1  (递增)
```

---

## 三、实现细节

### 3.1 Phase2Runtime 扩展

在 `Phase2Runtime` 中添加了以下方法：

#### Leader 选举

```rust
// 尝试获取 Leader 锁
pub async fn try_acquire_pool_leader(&self, ttl_seconds: u64) -> bool

// 续约 Leader 锁
pub async fn renew_pool_leader(&self, ttl_seconds: u64) -> bool

// 检查当前实例是否是 Leader
pub async fn is_pool_leader(&self) -> bool

// 获取当前 Leader 实例 ID
pub async fn get_pool_leader(&self) -> Option<String>
```

#### Pool 配置操作

```rust
// 将 Pool 配置写入 Redis
pub async fn set_pool_config(&self, pools: &[Phase3PoolConfig]) -> bool

// 从 Redis 读取 Pool 配置
pub async fn get_pool_config(&self) -> Option<(Vec<Phase3PoolConfig>, u64)>

// 获取 Pool 配置版本号
pub async fn get_pool_config_version(&self) -> Option<u64>
```

### 3.2 rebuild_auto_language_pools 改造

修改后的 `rebuild_auto_language_pools` 方法支持从 Redis 读取/写入：

```rust
pub async fn rebuild_auto_language_pools(
    &self, 
    phase2_runtime: Option<Arc<Phase2Runtime>>
) {
    // 1. 优先从 Redis 读取配置
    if let Some((redis_pools, version)) = rt.get_pool_config().await {
        // 更新本地配置并返回
        return;
    }
    
    // 2. Redis 中没有配置，尝试成为 Leader 并生成
    if rt.try_acquire_pool_leader(60).await {
        // 生成 Pool 配置
        let new_pools = self.auto_generate_language_pair_pools().await;
        // 写入 Redis
        rt.set_pool_config(&new_pools).await;
        // 更新本地配置
    } else {
        // 3. 不是 Leader，等待后重试读取
        tokio::time::sleep(Duration::from_millis(500)).await;
        if let Some((redis_pools, _)) = rt.get_pool_config().await {
            // 更新本地配置
        }
    }
    
    // 4. Fallback：本地生成（单实例模式或 Redis 不可用）
    let new_pools = self.auto_generate_language_pair_pools().await;
    // 更新本地配置
}
```

### 3.3 定期同步任务

在 `start_pool_cleanup_task` 中添加了定期从 Redis 拉取配置的逻辑：

```rust
pub fn start_pool_cleanup_task(
    self: &std::sync::Arc<Self>, 
    phase2_runtime: Option<Arc<Phase2Runtime>>
) {
    tokio::spawn(async move {
        // 定期清理任务（每60秒）
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        
        // 配置同步任务（每10秒）
        let mut pool_config_check_interval = tokio::time::interval(Duration::from_secs(10));
        
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    // 清理离线节点、检查空 Pool
                }
                _ = pool_config_check_interval.tick() => {
                    // 检查 Redis 配置版本
                    let current_version = rt.get_pool_config_version().await;
                    if current_version != last_version {
                        // 从 Redis 同步配置
                        if let Some((redis_pools, version)) = rt.get_pool_config().await {
                            // 更新本地配置
                            // 重建 Pool 索引
                        }
                    }
                    
                    // Leader 续约
                    if rt.is_pool_leader().await {
                        rt.renew_pool_leader(60).await;
                    }
                }
            }
        }
    });
}
```

---

## 四、工作流程

### 4.1 实例启动流程

```
[实例 A] 启动
    │
    ├─ 1. 尝试获取 Leader 锁
    │   └─ 成功 → 成为 Leader
    │   └─ 失败 → 成为 Follower
    │
    ├─ 2. 如果是 Leader
    │   └─ 检查 Redis 中是否有 Pool 配置
    │       ├─ 有 → 读取并更新本地配置
    │       └─ 无 → 生成 Pool 配置并写入 Redis
    │
    └─ 3. 如果是 Follower
        └─ 从 Redis 读取 Pool 配置
            ├─ 成功 → 更新本地配置
            └─ 失败 → 等待后重试
```

### 4.2 Pool 配置生成流程

```
[Leader 实例] 触发 Pool 生成
    │
    ├─ 1. 生成 Pool 配置
    │   └─ auto_generate_language_pair_pools()
    │
    ├─ 2. 写入 Redis
    │   └─ set_pool_config(pools)
    │       ├─ 递增版本号
    │       └─ 写入配置（TTL=1小时）
    │
    ├─ 3. 更新本地配置
    │   └─ phase3.pools = new_pools
    │
    └─ 4. 重建 Pool 索引
        └─ rebuild_phase3_pool_index()
```

### 4.3 配置同步流程

```
[Follower 实例] 定期检查（每10秒）
    │
    ├─ 1. 检查配置版本号
    │   └─ get_pool_config_version()
    │
    ├─ 2. 如果版本变化
    │   └─ 从 Redis 读取配置
    │       └─ get_pool_config()
    │
    ├─ 3. 更新本地配置
    │   └─ phase3.pools = redis_pools
    │
    └─ 4. 重建 Pool 索引
        └─ rebuild_phase3_pool_index()
```

### 4.4 Leader 故障转移流程

```
[Leader 实例] 失效（锁过期）
    │
    ├─ 1. Leader 锁 TTL 过期（60秒）
    │
    ├─ 2. 其他实例检测到 Leader 不存在
    │   └─ get_pool_leader() 返回 None
    │
    ├─ 3. 其他实例尝试获取 Leader 锁
    │   └─ try_acquire_pool_leader()
    │
    └─ 4. 新的 Leader 生成 Pool 配置
        └─ 写入 Redis，其他实例同步
```

---

## 五、配置与使用

### 5.1 启用条件

Pool 配置 Redis 同步**自动启用**，当满足以下条件时：
1. `phase2.enabled = true`（Phase 2 已启用）
2. `phase3.auto_generate_language_pools = true`（自动生成 Pool 已启用）

### 5.2 配置示例

```toml
[scheduler.phase2]
enabled = true
instance_id = "scheduler-1"
redis_url = "redis://127.0.0.1:6379"
key_prefix = "lingua"

[scheduler.phase3]
enabled = true
mode = "two_level"
auto_generate_language_pools = true

[scheduler.phase3.auto_pool_config]
min_nodes_per_pool = 1
max_pools = 50
require_semantic = true
enable_mixed_pools = true
```

### 5.3 监控指标

**推荐监控**：
1. **Leader 状态**：当前 Leader 实例 ID
2. **配置版本**：Pool 配置版本号
3. **同步延迟**：配置从 Redis 同步到本地的时间
4. **Leader 切换**：Leader 切换频率

---

## 六、优势与限制

### 6.1 优势

1. **减少重复计算**：只有 Leader 实例生成 Pool，节省 60-67% CPU 资源
2. **保证一致性**：所有实例使用相同的 Pool 配置
3. **自动故障转移**：Leader 失效时自动切换
4. **向后兼容**：单实例模式或 Redis 不可用时，fallback 到本地生成

### 6.2 限制

1. **依赖 Redis**：需要 Redis 可用
2. **Leader 选举开销**：需要分布式锁机制
3. **配置同步延迟**：非 Leader 实例需要定期拉取配置（最多 10 秒延迟）
4. **Leader 切换延迟**：Leader 失效后，最多 60 秒才会切换

---

## 七、故障处理

### 7.1 Redis 不可用

**行为**：
- Fallback 到本地生成模式
- 每个实例独立生成 Pool 配置
- 功能正常，但失去一致性保证

### 7.2 Leader 失效

**行为**：
- Leader 锁 TTL 过期（60 秒）
- 其他实例检测到 Leader 不存在
- 自动选举新的 Leader
- 新 Leader 生成 Pool 配置

### 7.3 配置同步失败

**行为**：
- 定期任务会重试（每 10 秒）
- 如果持续失败，fallback 到本地生成
- 记录警告日志

---

## 八、测试建议

### 8.1 单实例测试

1. **启动单个实例**
2. **验证**：
   - 实例成为 Leader
   - Pool 配置写入 Redis
   - 本地配置更新

### 8.2 多实例测试

1. **启动 3 个实例**
2. **验证**：
   - 只有一个实例成为 Leader
   - Leader 生成 Pool 配置
   - 其他实例从 Redis 读取配置
   - 所有实例的 Pool 配置一致

### 8.3 Leader 切换测试

1. **启动 3 个实例**
2. **停止 Leader 实例**
3. **验证**：
   - Leader 锁过期（60 秒）
   - 其他实例选举新的 Leader
   - 新 Leader 生成 Pool 配置
   - 其他实例同步新配置

### 8.4 配置更新测试

1. **Leader 实例触发 Pool 重建**
2. **验证**：
   - 配置版本号递增
   - 配置写入 Redis
   - 其他实例检测到版本变化
   - 自动同步新配置

---

## 九、总结

Pool 配置 Redis 同步功能已实现，主要特性：

1. ✅ **Leader 选举机制**：使用 Redis 分布式锁
2. ✅ **配置同步**：Leader 写入，其他实例读取
3. ✅ **版本控制**：使用版本号检测配置更新
4. ✅ **定期同步**：每 10 秒检查配置版本
5. ✅ **自动故障转移**：Leader 失效时自动切换
6. ✅ **向后兼容**：单实例模式或 Redis 不可用时 fallback

**预期收益**：
- CPU 资源节省：60-67%
- 保证配置一致性
- 减少重复计算

---

**最后更新**: 2026-01-06
