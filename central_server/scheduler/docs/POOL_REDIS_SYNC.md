# Pool Redis 同步机制

## 文档信息
- **版本**: v2.0
- **日期**: 2026-01-XX
- **状态**: 已实现

---

## 一、设计概述

### 1.1 目标

在多实例环境下，避免每个实例都独立生成 Pool 配置：
- **只有 Leader 实例生成 Pool 配置**
- **其他实例从 Redis 读取 Pool 配置**
- **自动故障转移**：Leader 失效时自动切换

### 1.2 核心机制

1. **Leader 选举**：使用 Redis 分布式锁（`SET NX PX`）
2. **配置同步**：Leader 将 Pool 配置写入 Redis，其他实例读取
3. **版本控制**：使用版本号检测配置更新
4. **定期同步**：非 Leader 实例定期检查配置版本并同步

### 1.3 性能收益

- **CPU 资源节省**：60-67%（只有 Leader 实例生成 Pool）
- **保证一致性**：所有实例使用相同的 Pool 配置
- **自动故障转移**：Leader 失效时自动切换

---

## 二、Redis Key 设计

### 2.1 Key 命名

```
{key_prefix}:v1:phase3:pools:config      -> Pool 配置（JSON，TTL=1小时）
{key_prefix}:v1:phase3:pools:leader     -> Leader 实例 ID（TTL=60秒）
{key_prefix}:v1:phase3:pools:version     -> 配置版本号（递增）
{key_prefix}:v1:pool:{pool_name}:members -> Pool 成员索引（Set，TTL=1小时）
```

### 2.2 数据结构

#### Pool 配置快照（`phase3:pools:config`）

```json
{
  "pools": [
    {
      "pool_id": 1,
      "name": "en-zh",
      "required_services": ["asr", "nmt", "tts", "semantic"],
      "language_requirements": { ... }
    }
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

### 3.1 Leader 选举

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

### 3.2 Pool 配置操作

```rust
// 将 Pool 配置写入 Redis
pub async fn set_pool_config(&self, pools: &[Phase3PoolConfig]) -> bool

// 从 Redis 读取 Pool 配置
pub async fn get_pool_config(&self) -> Option<(Vec<Phase3PoolConfig>, u64)>

// 获取 Pool 配置版本号
pub async fn get_pool_config_version(&self) -> Option<u64>
```

### 3.3 Pool 成员索引操作

```rust
// 同步单个节点的 Pool 成员索引到 Redis
pub async fn sync_node_pools_to_redis(
    &self,
    node_id: &str,
    pool_ids: &[u16],
    pools: &[Phase3PoolConfig],
    pool_index: &HashMap<u16, HashSet<String>>,
) -> bool

// 批量从 Redis 读取 Pool 成员索引
pub async fn get_pool_members_batch_from_redis(
    &self,
    pool_names: &[&str],
) -> HashMap<String, HashSet<String>>
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
    └─ 4. 同步 Pool 成员索引到 Redis
        └─ sync_all_pool_members_to_redis()
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

## 五、节点选择时的 Redis 读取

### 5.1 从 Redis 读取 Pool 成员

**实现**：
```rust
// 如果启用 Phase 2，从 Redis 读取 Pool 成员（保持原子性）
if let Some(rt) = phase2 {
    let members_map = rt.get_pool_members_batch_from_redis(&pool_name_strs).await;
    for (pool_name, pid) in pool_names {
        if let Some(members) = members_map.get(pool_name) {
            pool_candidates.insert(pid, members.iter().cloned().collect());
        }
    }
} else {
    // 向后兼容：从内存读取
    let idx = self.phase3_pool_index.read().await;
    // ...
}
```

**优势**：
- ✅ **原子性**：从 Redis 读取，保证多实例间一致性
- ✅ **实时性**：总是读取最新的 Pool 成员信息
- ✅ **向后兼容**：如果未启用 Phase 2，仍从内存读取

---

## 六、配置与使用

### 6.1 启用条件

Pool 配置 Redis 同步**自动启用**，当满足以下条件时：
1. `phase2.enabled = true`（Phase 2 已启用）
2. `phase3.auto_generate_language_pools = true`（自动生成 Pool 已启用）

### 6.2 配置示例

```toml
[phase2]
enabled = true
instance_id = "scheduler-1"
redis.mode = "cluster"  # 或 "single"
redis.url = "redis://127.0.0.1:6379"
redis.key_prefix = "lingua"

[phase3]
enabled = true
mode = "two_level"
auto_generate_language_pools = true
```

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

## 八、优势与限制

### 8.1 优势

1. **减少重复计算**：只有 Leader 实例生成 Pool，节省 60-67% CPU 资源
2. **保证一致性**：所有实例使用相同的 Pool 配置
3. **自动故障转移**：Leader 失效时自动切换
4. **向后兼容**：单实例模式或 Redis 不可用时，fallback 到本地生成
5. **支持 Redis Cluster**：支持分布式 Redis 集群模式

### 8.2 限制

1. **依赖 Redis**：需要 Redis 可用
2. **Leader 选举开销**：需要分布式锁机制
3. **配置同步延迟**：非 Leader 实例需要定期拉取配置（最多 10 秒延迟）
4. **Leader 切换延迟**：Leader 失效后，最多 60 秒才会切换

---

## 九、代码位置

- **Leader 选举**：`central_server/scheduler/src/phase2/runtime_routing.rs`
- **Pool 配置同步**：`central_server/scheduler/src/node_registry/phase3_pool.rs`
- **定期同步任务**：`central_server/scheduler/src/node_registry/phase3_pool.rs::start_pool_cleanup_task`
- **Pool 成员索引同步**：`central_server/scheduler/src/phase2/runtime_routing.rs`
- **节点选择时 Redis 读取**：`central_server/scheduler/src/node_registry/selection/selection_phase3.rs`

---

**最后更新**: 2026-01-XX
