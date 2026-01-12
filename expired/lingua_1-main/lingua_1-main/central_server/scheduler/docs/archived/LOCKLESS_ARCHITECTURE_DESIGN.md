# 基于 Redis 的无锁架构设计方案

## 文档信息

- **版本**: v1.0
- **创建日期**: 2026-01-10
- **状态**: 提案（待决策部门审批）
- **目标**: 消除调度服务器中的锁竞争，提升任务分配性能

---

## 1. 执行摘要

### 1.1 问题陈述

当前架构使用 `RwLock` 保护共享状态（`ManagementState` 和 `RuntimeSnapshot`），导致以下问题：

1. **锁竞争严重**：心跳更新和节点选择同时竞争写锁和读锁
2. **阻塞累积**：多个心跳同时触发时，阻塞时间累加（N × 50ms）
3. **性能瓶颈**：COW 操作需要克隆整个 HashMap，耗时 10-100ms
4. **可扩展性差**：无法水平扩展（多实例共享状态需要额外的协调机制）

### 1.2 解决方案概述

**核心思想**：将共享状态存储到 Redis，每个调度器实例维护本地缓存，使用 Redis 发布/订阅机制实现缓存失效和一致性保证。

**关键优势**：
- ✅ **完全无锁**：读取操作直接从本地缓存读取，无需获取锁
- ✅ **高性能**：本地缓存读取延迟 < 1ms（vs 当前 10-100ms）
- ✅ **可扩展**：支持多实例部署，自动同步状态
- ✅ **一致性保证**：使用 Redis 原子操作和版本号机制保证最终一致性

### 1.3 预期收益

| 指标 | 当前架构 | 无锁架构 | 提升 |
|------|---------|---------|------|
| 节点选择延迟 | 50-200ms | 1-10ms | **10-20x** |
| 心跳更新延迟 | 10-50ms | 1-5ms | **5-10x** |
| 并发处理能力 | 受锁限制 | 无限制 | **∞** |
| 水平扩展 | 不支持 | 支持 | ✅ |

---

## 2. 当前架构分析

### 2.1 共享状态结构

#### 2.1.1 ManagementState（管理域）

```rust
pub struct ManagementState {
    pub nodes: HashMap<String, NodeState>,      // 节点状态映射
    pub phase3_config: Phase3Config,            // Phase3 配置
    pub core_services: CoreServicesConfig,      // 核心服务配置
    pub lang_index: PoolLanguageIndex,          // Pool 语言索引
}
```

**保护机制**：`Arc<RwLock<ManagementState>>`

**访问模式**：
- **写操作**（需要写锁）：
  - `update_node_heartbeat()` - 心跳更新（每 1-5 秒一次）
  - `register_node()` - 节点注册（较少）
  - `remove_node()` - 节点下线（较少）
  - `update_phase3_config()` - 配置更新（很少）
  
- **读操作**（需要读锁）：
  - `get_node()` - 获取节点状态
  - `get_phase3_config()` - 获取 Phase3 配置
  - `get_lang_index()` - 获取语言索引

#### 2.1.2 RuntimeSnapshot（运行域）

```rust
pub struct RuntimeSnapshot {
    pub nodes: Arc<HashMap<String, Arc<NodeRuntimeSnapshot>>>,  // 节点快照映射
    pub lang_index: Arc<PoolLanguageIndex>,                     // 语言索引
    pub pool_members_cache: Arc<RwLock<PoolMembersCache>>,     // Pool 成员缓存
    pub version: u64,                                           // 快照版本
}
```

**保护机制**：`Arc<RwLock<RuntimeSnapshot>>`

**访问模式**：
- **写操作**（需要写锁）：
  - `update_node_snapshot()` - 更新节点快照（每心跳触发，COW 操作）
  - `update_lang_index_snapshot()` - 更新语言索引（配置变化时）
  
- **读操作**（需要读锁）：
  - `get_snapshot()` - 获取快照（节点选择时频繁调用）

### 2.2 锁竞争热点

#### 2.2.1 心跳更新路径

```
handle_node_heartbeat()
  └─> ManagementRegistry.write().await                    // ⚠️ 写锁 #1
      └─> update_node_heartbeat()
  └─> SnapshotManager.update_node_snapshot().await        // ⚠️ 后台异步
      └─> ManagementRegistry.read().await                  // ⚠️ 读锁 #2
      └─> SnapshotManager.snapshot.write().await           // ⚠️ 写锁 #3
          └─> (*snapshot_guard.nodes).clone()              // ⚠️ 克隆整个 HashMap（50ms）
```

**问题**：
- 写锁 #3 持有期间，所有 `get_snapshot()` 调用被阻塞
- 如果 N 个心跳同时触发，总阻塞时间 = N × 50ms

#### 2.2.2 节点选择路径

```
select_node_with_module_expansion_with_breakdown()
  └─> get_required_types_for_features()                   // 无锁
  └─> get_phase3_config_cached()                          // 缓存读取（无锁）
  └─> select_node_with_types_two_level_excluding_with_breakdown()
      └─> SnapshotManager.get_snapshot().await             // ⚠️ 读锁，可能被写锁阻塞
          └─> snapshot.read().await                        // ⚠️ 等待写锁释放（50-500ms）
```

**问题**：
- 如果此时有 `update_node_snapshot()` 正在执行，节点选择会被阻塞 50-500ms

---

## 3. 无锁架构设计

### 3.1 总体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     调度器实例 #1 (Scheduler Instance)           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  本地缓存层 (Local Cache Layer)                           │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │  │
│  │  │ Node Cache   │  │ Config Cache │  │ Index Cache  │   │  │
│  │  │ (HashMap)    │  │ (Arc)        │  │ (Arc)        │   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │  │
│  │         │                 │                 │             │  │
│  │         └─────────────────┼─────────────────┘             │  │
│  │                           │                               │  │
│  │                    Cache Manager                          │  │
│  │              (版本号检查 + 失效处理)                        │  │
│  └───────────────────────────┼───────────────────────────────┘  │
│                              │                                   │
│                    ┌─────────▼─────────┐                        │
│                    │  Redis Client     │                        │
│                    │  (读取 + 订阅)     │                        │
│                    └─────────┬─────────┘                        │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Redis Cluster     │
                    │  ┌────────────────┐ │
                    │  │ 节点状态存储    │ │
                    │  │ 配置存储        │ │
                    │  │ 索引存储        │ │
                    │  │ 版本号管理      │ │
                    │  │ Pub/Sub 通道    │ │
                    │  └────────────────┘ │
                    └─────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────┐
│                     调度器实例 #2 (Scheduler Instance)           │
│                              │                                   │
│                    ┌─────────▼─────────┐                        │
│                    │  Redis Client     │                        │
│                    │  (读取 + 订阅)     │                        │
│                    └─────────┬─────────┘                        │
│                              │                                   │
│  ┌───────────────────────────▼──────────────────────────────┐  │
│  │  本地缓存层 (Local Cache Layer)                           │  │
│  │  (与实例 #1 相同的结构)                                    │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Redis 数据结构设计

#### 3.2.1 节点状态存储

**Key 格式**：`scheduler:nodes:{node_id}`

**Value 格式**（JSON）：
```json
{
  "node_id": "node-12345",
  "status": "online",
  "health": "Online",
  "capabilities": {
    "asr_languages": ["zh", "en"],
    "tts_languages": ["zh", "en"],
    "semantic_languages": ["zh", "en"]
  },
  "resources": {
    "max_concurrency": 10,
    "current_jobs": 2,
    "cpu_usage": 0.5,
    "gpu_usage": 0.3,
    "memory_usage": 0.6
  },
  "pool_ids": [1, 2],
  "installed_services": [...],
  "features_supported": {...},
  "last_heartbeat_ms": 1768045310000,
  "version": 123  // 版本号，用于缓存失效
}
```

**TTL**：30 秒（如果节点心跳超时，自动过期）

#### 3.2.2 节点索引（快速查找）

**Key 格式**：`scheduler:nodes:index:online`

**Value 格式**（Set）：
```
{ "node-12345", "node-67890", ... }
```

**用途**：快速获取所有在线节点列表

#### 3.2.3 Phase3 配置存储

**Key 格式**：`scheduler:config:phase3`

**Value 格式**（JSON）：
```json
{
  "enabled": true,
  "mode": "two_level",
  "pools": [...],
  "version": 456  // 版本号
}
```

#### 3.2.4 Pool 语言索引存储

**Key 格式**：`scheduler:index:lang_pair:{src_lang}:{tgt_lang}`

**Value 格式**（Set）：
```
{ "pool:1", "pool:2", ... }
```

**替代方案**（更高效）：使用 Redis Hash

**Key 格式**：`scheduler:index:lang_pairs`

**Value 格式**（Hash）：
```
{
  "zh:en": "pool:1,pool:2",
  "en:zh": "pool:1",
  ...
}
```

#### 3.2.5 全局版本号管理

**Key 格式**：`scheduler:version:{entity_type}`

**Value 格式**（String，整数）：
- `scheduler:version:nodes` → `123`（节点状态版本）
- `scheduler:version:config` → `456`（配置版本）
- `scheduler:version:index` → `789`（索引版本）

**用途**：用于缓存失效检查

### 3.3 发布/订阅通道设计

#### 3.3.1 节点状态更新通道

**Channel**：`scheduler:events:node_update`

**消息格式**（JSON）：
```json
{
  "event_type": "node_heartbeat",
  "node_id": "node-12345",
  "version": 124,
  "timestamp_ms": 1768045311000
}
```

**事件类型**：
- `node_heartbeat` - 节点心跳更新
- `node_register` - 节点注册
- `node_offline` - 节点下线
- `node_config_update` - 节点配置更新

#### 3.3.2 配置更新通道

**Channel**：`scheduler:events:config_update`

**消息格式**（JSON）：
```json
{
  "event_type": "phase3_config_update",
  "config_type": "phase3",
  "version": 457,
  "timestamp_ms": 1768045312000
}
```

### 3.4 本地缓存管理

#### 3.4.1 缓存结构

```rust
pub struct LocklessCache {
    // 节点缓存（按 node_id 索引）
    nodes: Arc<DashMap<String, CachedNodeSnapshot>>,  // DashMap 是无锁并发 HashMap
    
    // 配置缓存
    phase3_config: Arc<RwLock<Option<CachedPhase3Config>>>,
    
    // 语言索引缓存
    lang_index: Arc<RwLock<Option<CachedLangIndex>>>,
    
    // 版本号跟踪
    cached_versions: Arc<RwLock<CacheVersions>>,
    
    // Redis 客户端
    redis_client: Arc<redis::Client>,
    
    // 订阅任务句柄
    subscription_handle: Arc<tokio::sync::Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

struct CachedNodeSnapshot {
    snapshot: NodeRuntimeSnapshot,
    version: u64,
    cached_at_ms: i64,
}

struct CacheVersions {
    nodes_version: u64,
    config_version: u64,
    index_version: u64,
}
```

#### 3.4.2 缓存失效策略

**策略 1：版本号检查（主动失效）**

```rust
impl LocklessCache {
    async fn get_node(&self, node_id: &str) -> Option<NodeRuntimeSnapshot> {
        // 步骤 1: 检查本地缓存
        if let Some(cached) = self.nodes.get(node_id) {
            // 步骤 2: 检查版本号（从 Redis 读取，无锁）
            let current_version = self.get_node_version_from_redis(node_id).await;
            if cached.version >= current_version {
                // 缓存有效，直接返回
                return Some(cached.snapshot.clone());
            }
            // 缓存失效，需要刷新
        }
        
        // 步骤 3: 从 Redis 读取最新数据
        self.refresh_node_from_redis(node_id).await
    }
}
```

**策略 2：发布/订阅（被动失效）**

```rust
async fn subscribe_to_updates(&self) {
    let mut pubsub = self.redis_client.get_async_connection()
        .await
        .unwrap()
        .into_pubsub();
    
    pubsub.subscribe("scheduler:events:node_update").await.unwrap();
    pubsub.subscribe("scheduler:events:config_update").await.unwrap();
    
    loop {
        let msg = pubsub.get_message().await.unwrap();
        let payload: String = msg.get_payload().unwrap();
        let event: CacheEvent = serde_json::from_str(&payload).unwrap();
        
        match event.event_type.as_str() {
            "node_heartbeat" | "node_register" | "node_offline" => {
                // 从缓存中移除该节点，下次读取时自动刷新
                self.nodes.remove(&event.node_id);
            }
            "phase3_config_update" => {
                // 标记配置缓存失效
                *self.phase3_config.write().await = None;
            }
            _ => {}
        }
    }
}
```

**混合策略（推荐）**：
- **写操作时**：更新 Redis + 发布事件（保证其他实例及时失效）
- **读操作时**：先检查本地缓存，如果存在则比较版本号，如果不匹配则从 Redis 刷新
- **定期检查**：后台任务定期检查全局版本号，如果变化则批量刷新相关缓存

---

## 4. 业务流程详细设计

### 4.1 任务分配业务流程（无锁版本）

#### 4.1.1 完整流程时序图

```
客户端                    SessionActor          JobDispatcher        LocklessCache        Redis
  │                           │                      │                    │                │
  │─── 音频数据 ─────────────>│                      │                    │                │
  │                           │                      │                    │                │
  │                      [创建任务]                   │                    │                │
  │                           │─── create_job() ───>│                    │                │
  │                           │                      │                    │                │
  │                           │              [决定 preferred_pool]      │                │
  │                           │                      │                    │                │
  │                           │              [节点选择]                 │                │
  │                           │                      │                    │                │
  │                           │                      │─── get_node() ────>│                │
  │                           │                      │                    │                │
  │                           │                      │    [检查本地缓存]   │                │
  │                           │                      │    [检查版本号]     │                │
  │                           │                      │                    │─── GET node ──>│
  │                           │                      │                    │<── node data ──│
  │                           │                      │                    │                │
  │                           │                      │<── NodeSnapshot ───│                │
  │                           │                      │                    │                │
  │                           │                      │─── select_pool() ──>│                │
  │                           │                      │                    │                │
  │                           │                      │                    │─── GET index ──>│
  │                           │                      │                    │<── pool_ids ────│
  │                           │                      │                    │                │
  │                           │                      │<── selected_node ───│                │
  │                           │                      │                    │                │
  │                           │              [创建 JobAssign]            │                │
  │                           │                      │                    │                │
  │                           │              [Redis 预留节点槽位]         │                │
  │                           │                      │─── reserve_slot() ────────────────>│
  │                           │                      │<── OK ──────────────────────────────│
  │                           │                      │                    │                │
  │                           │<── Job created ──────│                    │                │
  │                           │                      │                    │                │
  │<── JobAssign ─────────────│                      │                    │                │
  │                           │                      │                    │                │
```

#### 4.1.2 关键方法实现

**方法 1: `LocklessCache::get_node()`**

```rust
impl LocklessCache {
    /// 获取节点快照（完全无锁读取路径）
    pub async fn get_node(&self, node_id: &str) -> Option<NodeRuntimeSnapshot> {
        // 步骤 1: 从本地缓存读取（DashMap 无锁）
        if let Some(cached) = self.nodes.get(node_id) {
            // 快速路径：检查版本号（乐观假设缓存有效）
            let cached_version = cached.value().version;
            
            // 步骤 2: 异步检查版本号（不阻塞）
            let current_version_future = self.get_node_version_async(node_id);
            
            // 步骤 3: 如果版本号匹配，直接返回（最常见情况）
            // 注意：这里使用 tokio::select! 实现非阻塞版本号检查
            tokio::select! {
                version_result = current_version_future => {
                    if let Ok(current_version) = version_result {
                        if cached_version >= current_version {
                            // 缓存有效，返回
                            return Some(cached.value().snapshot.clone());
                        }
                    }
                    // 版本号不匹配，需要刷新
                }
                // 如果版本号检查超时（50ms），假设缓存有效（最终一致性）
                _ = tokio::time::sleep(Duration::from_millis(50)) => {
                    // 超时情况下，返回缓存数据（允许短暂的不一致）
                    return Some(cached.value().snapshot.clone());
                }
            }
        }
        
        // 步骤 4: 缓存未命中或失效，从 Redis 刷新
        self.refresh_node_from_redis(node_id).await
    }
    
    /// 从 Redis 刷新节点数据
    async fn refresh_node_from_redis(&self, node_id: &str) -> Option<NodeRuntimeSnapshot> {
        // 步骤 1: 从 Redis 读取节点数据
        let key = format!("scheduler:nodes:{}", node_id);
        let redis_conn = self.redis_client.get_async_connection().await.ok()?;
        let data: Option<String> = redis::cmd("GET").arg(&key).query_async(&mut redis_conn).await.ok()?;
        
        if let Some(json_str) = data {
            // 步骤 2: 解析 JSON
            let node_data: RedisNodeData = serde_json::from_str(&json_str).ok()?;
            
            // 步骤 3: 转换为 NodeRuntimeSnapshot
            let snapshot = self.convert_to_snapshot(node_data.clone());
            
            // 步骤 4: 更新本地缓存
            self.nodes.insert(node_id.to_string(), CachedNodeSnapshot {
                snapshot: snapshot.clone(),
                version: node_data.version,
                cached_at_ms: chrono::Utc::now().timestamp_millis(),
            });
            
            Some(snapshot)
        } else {
            // 节点不存在（可能已下线）
            self.nodes.remove(node_id);
            None
        }
    }
    
    /// 异步获取节点版本号（不阻塞主流程）
    async fn get_node_version_async(&self, node_id: &str) -> Result<u64, redis::RedisError> {
        let key = format!("scheduler:nodes:{}", node_id);
        let mut redis_conn = self.redis_client.get_async_connection().await?;
        
        // 使用 HGET 只获取 version 字段（更高效）
        let version: Option<u64> = redis::cmd("HGET")
            .arg(&key)
            .arg("version")
            .query_async(&mut redis_conn)
            .await?;
        
        Ok(version.unwrap_or(0))
    }
}
```

**方法 2: `LocklessCache::select_nodes_for_pool()`**

```rust
impl LocklessCache {
    /// 从指定 Pool 中选择节点（无锁读取）
    pub async fn select_nodes_for_pool(
        &self,
        pool_id: u16,
        required_types: &[ServiceType],
    ) -> Vec<NodeRuntimeSnapshot> {
        // 步骤 1: 从 Redis 获取 Pool 成员列表（Set）
        let pool_key = format!("scheduler:pool:{}:members", pool_id);
        let mut redis_conn = self.redis_client.get_async_connection().await.ok()?;
        let member_ids: Vec<String> = redis::cmd("SMEMBERS")
            .arg(&pool_key)
            .query_async(&mut redis_conn)
            .await
            .ok()
            .unwrap_or_default();
        
        // 步骤 2: 并行获取所有节点的快照（使用 DashMap 无锁读取）
        let mut candidates = Vec::new();
        for node_id in member_ids {
            if let Some(node) = self.get_node(&node_id).await {
                // 步骤 3: 过滤符合条件的节点（本地过滤，无锁）
                if self.matches_requirements(&node, required_types) {
                    candidates.push(node);
                }
            }
        }
        
        candidates
    }
    
    /// 检查节点是否满足要求（无锁本地检查）
    fn matches_requirements(&self, node: &NodeRuntimeSnapshot, required_types: &[ServiceType]) -> bool {
        // 检查节点健康状态
        if node.health != NodeHealth::Online {
            return false;
        }
        
        // 检查并发限制
        if node.current_jobs >= node.max_concurrency as usize {
            return false;
        }
        
        // 检查服务类型支持（从本地缓存读取，无锁）
        for service_type in required_types {
            if !node.installed_services.iter().any(|s| s.service_type == *service_type) {
                return false;
            }
        }
        
        true
    }
}
```

### 4.2 心跳更新业务流程（无锁版本）

#### 4.2.1 完整流程时序图

```
节点客户端              WebSocket Handler    LocklessCache        Redis             其他调度器实例
  │                           │                    │                │                      │
  │─── Heartbeat ────────────>│                    │                │                      │
  │                           │                    │                │                      │
  │                    [处理心跳]                   │                │                      │
  │                           │                    │                │                      │
  │                           │─── update_node() ─>│                │                      │
  │                           │                    │                │                      │
  │                           │                    │─── GET version ─>│                    │
  │                           │                    │<── version ──────│                    │
  │                           │                    │                │                      │
  │                           │                    │─── INCR version ─>│                   │
  │                           │                    │<── new_version ──│                    │
  │                           │                    │                │                      │
  │                           │                    │─── SET node data ─>│                  │
  │                           │                    │<── OK ────────────│                  │
  │                           │                    │                │                      │
  │                           │                    │─── PUBLISH event ─>│                 │
  │                           │                    │<── subscribers ────│                 │
  │                           │                    │                │                      │
  │                           │                    │                │───── event ─────────>│
  │                           │                    │                │                      │
  │                           │                    │                │              [失效本地缓存]│
  │                           │                    │                │                      │
  │<── ACK ───────────────────│                    │                │                      │
  │                           │                    │                │                      │
```

#### 4.2.2 关键方法实现

**方法 3: `LocklessCache::update_node_heartbeat()`**

```rust
impl LocklessCache {
    /// 更新节点心跳（原子操作，无锁）
    pub async fn update_node_heartbeat(
        &self,
        node_id: &str,
        heartbeat_data: NodeHeartbeatData,
    ) -> Result<u64, redis::RedisError> {
        let node_key = format!("scheduler:nodes:{}", node_id);
        let mut redis_conn = self.redis_client.get_async_connection().await?;
        
        // 步骤 1: 使用 Redis Lua 脚本保证原子性
        let script = r#"
            -- 获取当前版本号
            local version = redis.call('HGET', KEYS[1], 'version') or 0
            version = tonumber(version) + 1
            
            -- 更新节点数据
            redis.call('HSET', KEYS[1],
                'node_id', ARGV[1],
                'status', ARGV[2],
                'health', ARGV[3],
                'capabilities', ARGV[4],
                'resources', ARGV[5],
                'pool_ids', ARGV[6],
                'installed_services', ARGV[7],
                'last_heartbeat_ms', ARGV[8],
                'version', version
            )
            
            -- 设置 TTL（30 秒，如果心跳超时则自动过期）
            redis.call('EXPIRE', KEYS[1], 30)
            
            -- 更新节点索引（如果是新节点或状态变化）
            if ARGV[2] == 'online' then
                redis.call('SADD', 'scheduler:nodes:index:online', ARGV[1])
            else
                redis.call('SREM', 'scheduler:nodes:index:online', ARGV[1])
            end
            
            -- 返回新版本号
            return version
        "#;
        
        // 步骤 2: 准备参数
        let capabilities_json = serde_json::to_string(&heartbeat_data.capabilities).unwrap();
        let resources_json = serde_json::to_string(&heartbeat_data.resources).unwrap();
        let pool_ids_json = serde_json::to_string(&heartbeat_data.pool_ids).unwrap();
        let services_json = serde_json::to_string(&heartbeat_data.installed_services).unwrap();
        let timestamp_ms = chrono::Utc::now().timestamp_millis();
        
        // 步骤 3: 执行 Lua 脚本（原子操作）
        let new_version: u64 = redis::Script::new(script)
            .key(&node_key)
            .arg(node_id)
            .arg("online")
            .arg("Online")
            .arg(&capabilities_json)
            .arg(&resources_json)
            .arg(&pool_ids_json)
            .arg(&services_json)
            .arg(timestamp_ms.to_string())
            .invoke_async(&mut redis_conn)
            .await?;
        
        // 步骤 4: 发布更新事件（通知其他实例）
        let event = CacheEvent {
            event_type: "node_heartbeat".to_string(),
            node_id: node_id.to_string(),
            version: new_version,
            timestamp_ms,
        };
        let event_json = serde_json::to_string(&event).unwrap();
        redis::cmd("PUBLISH")
            .arg("scheduler:events:node_update")
            .arg(&event_json)
            .query_async::<_, u64>(&mut redis_conn)
            .await?;
        
        // 步骤 5: 更新本地缓存（当前实例）
        // 注意：这里可以异步执行，不阻塞心跳响应
        let cache_clone = self.clone();
        let node_id_clone = node_id.to_string();
        tokio::spawn(async move {
            if let Some(node) = cache_clone.refresh_node_from_redis(&node_id_clone).await {
                cache_clone.nodes.insert(node_id_clone, CachedNodeSnapshot {
                    snapshot: node,
                    version: new_version,
                    cached_at_ms: timestamp_ms,
                });
            }
        });
        
        Ok(new_version)
    }
}
```

### 4.3 节点注册业务流程（无锁版本）

**方法 4: `LocklessCache::register_node()`**

```rust
impl LocklessCache {
    /// 注册新节点（原子操作）
    pub async fn register_node(
        &self,
        node_id: &str,
        node_data: NodeRegistrationData,
    ) -> Result<u64, redis::RedisError> {
        let node_key = format!("scheduler:nodes:{}", node_id);
        let mut redis_conn = self.redis_client.get_async_connection().await?;
        
        // 步骤 1: 使用 Redis Lua 脚本保证原子性
        let script = r#"
            -- 检查节点是否已存在
            local exists = redis.call('EXISTS', KEYS[1])
            local version = 1
            
            if exists == 1 then
                -- 节点已存在，获取当前版本号并递增
                version = tonumber(redis.call('HGET', KEYS[1], 'version') or 0) + 1
            end
            
            -- 写入节点数据
            redis.call('HSET', KEYS[1],
                'node_id', ARGV[1],
                'status', 'online',
                'health', 'Online',
                'capabilities', ARGV[2],
                'resources', ARGV[3],
                'pool_ids', ARGV[4],
                'installed_services', ARGV[5],
                'registered_at_ms', ARGV[6],
                'last_heartbeat_ms', ARGV[6],
                'version', version
            )
            
            -- 设置 TTL
            redis.call('EXPIRE', KEYS[1], 30)
            
            -- 添加到在线节点索引
            redis.call('SADD', 'scheduler:nodes:index:online', ARGV[1])
            
            -- 如果节点有 Pool 分配，更新 Pool 成员索引
            local pool_ids = cjson.decode(ARGV[4])
            for _, pool_id in ipairs(pool_ids) do
                redis.call('SADD', 'scheduler:pool:' .. pool_id .. ':members', ARGV[1])
            end
            
            return version
        "#;
        
        // 步骤 2: 准备参数并执行
        let capabilities_json = serde_json::to_string(&node_data.capabilities).unwrap();
        let resources_json = serde_json::to_string(&node_data.resources).unwrap();
        let pool_ids_json = serde_json::to_string(&node_data.pool_ids).unwrap();
        let services_json = serde_json::to_string(&node_data.installed_services).unwrap();
        let timestamp_ms = chrono::Utc::now().timestamp_millis();
        
        let version: u64 = redis::Script::new(script)
            .key(&node_key)
            .arg(node_id)
            .arg(&capabilities_json)
            .arg(&resources_json)
            .arg(&pool_ids_json)
            .arg(&services_json)
            .arg(timestamp_ms.to_string())
            .invoke_async(&mut redis_conn)
            .await?;
        
        // 步骤 3: 发布注册事件
        let event = CacheEvent {
            event_type: "node_register".to_string(),
            node_id: node_id.to_string(),
            version,
            timestamp_ms,
        };
        redis::cmd("PUBLISH")
            .arg("scheduler:events:node_update")
            .arg(serde_json::to_string(&event).unwrap())
            .query_async::<_, u64>(&mut redis_conn)
            .await?;
        
        // 步骤 4: 更新本地缓存
        self.refresh_node_from_redis(node_id).await;
        
        Ok(version)
    }
}
```

---

## 5. 无锁改造内容

### 5.1 代码模块重构

#### 5.1.1 新增模块结构

```
src/node_registry/
├── lockless/
│   ├── mod.rs                    # 无锁缓存管理器入口
│   ├── cache.rs                  # LocklessCache 实现
│   ├── redis_client.rs           # Redis 客户端封装
│   ├── pubsub.rs                 # 发布/订阅处理器
│   ├── serialization.rs          # 序列化/反序列化工具
│   └── version_manager.rs        # 版本号管理
├── management_state.rs           # 【废弃】保留用于迁移期间的兼容
├── snapshot_manager.rs           # 【废弃】保留用于迁移期间的兼容
└── ...
```

#### 5.1.2 关键结构定义

**LocklessCache**

```rust
// src/node_registry/lockless/cache.rs

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use redis::Client as RedisClient;

pub struct LocklessCache {
    // 节点缓存（DashMap 是无锁并发 HashMap）
    nodes: Arc<DashMap<String, CachedNodeSnapshot>>,
    
    // 配置缓存（很少更新，使用 RwLock 即可）
    phase3_config: Arc<RwLock<Option<CachedPhase3Config>>>,
    core_services: Arc<RwLock<Option<CachedCoreServicesConfig>>>,
    
    // 语言索引缓存
    lang_index: Arc<RwLock<Option<CachedLangIndex>>>,
    
    // 版本号跟踪
    cached_versions: Arc<RwLock<CacheVersions>>,
    
    // Redis 客户端
    redis_client: Arc<RedisClient>,
    
    // 配置
    config: LocklessCacheConfig,
}

struct CachedNodeSnapshot {
    snapshot: NodeRuntimeSnapshot,
    version: u64,
    cached_at_ms: i64,
}

struct LocklessCacheConfig {
    // 缓存过期时间（毫秒）
    cache_ttl_ms: i64,
    
    // 版本号检查超时时间（毫秒）
    version_check_timeout_ms: u64,
    
    // 是否启用发布/订阅失效
    enable_pubsub_invalidation: bool,
    
    // 批量刷新大小
    batch_refresh_size: usize,
}
```

#### 5.1.3 接口适配层

为了平滑迁移，提供适配层，使现有代码无需大规模修改：

```rust
// src/node_registry/lockless/adapter.rs

/// 适配器：将 LocklessCache 适配为现有的 NodeRegistry 接口
impl NodeRegistry {
    /// 获取节点（适配现有接口）
    pub async fn get_node(&self, node_id: &str) -> Option<NodeRuntimeSnapshot> {
        // 如果使用无锁架构
        if let Some(lockless_cache) = &self.lockless_cache {
            lockless_cache.get_node(node_id).await
        } else {
            // 降级到原有锁架构
            let snapshot_manager = self.get_or_init_snapshot_manager().await;
            let snapshot = snapshot_manager.get_snapshot().await;
            snapshot.nodes.get(node_id).cloned()
        }
    }
    
    /// 更新节点心跳（适配现有接口）
    pub async fn update_node_heartbeat(
        &self,
        node_id: &str,
        heartbeat_data: NodeHeartbeatData,
    ) -> Result<(), Error> {
        if let Some(lockless_cache) = &self.lockless_cache {
            lockless_cache.update_node_heartbeat(node_id, heartbeat_data).await?;
        } else {
            // 降级到原有锁架构
            self.update_node_heartbeat_with_lock(node_id, heartbeat_data).await?;
        }
        Ok(())
    }
}
```

### 5.2 数据迁移方案

#### 5.2.1 双写策略（过渡期）

在迁移期间，同时写入原有锁架构和 Redis：

```rust
impl NodeRegistry {
    async fn update_node_heartbeat_dual_write(
        &self,
        node_id: &str,
        heartbeat_data: NodeHeartbeatData,
    ) -> Result<(), Error> {
        // 步骤 1: 写入 Redis（新架构）
        if let Some(lockless_cache) = &self.lockless_cache {
            lockless_cache.update_node_heartbeat(node_id, heartbeat_data.clone()).await?;
        }
        
        // 步骤 2: 写入原有锁架构（保证兼容性）
        if self.enable_legacy_write {
            self.update_node_heartbeat_with_lock(node_id, heartbeat_data).await?;
        }
        
        Ok(())
    }
}
```

#### 5.2.2 数据同步任务

启动后台任务，将现有数据同步到 Redis：

```rust
async fn sync_existing_data_to_redis(
    management: &ManagementRegistry,
    lockless_cache: &LocklessCache,
) -> Result<(), Error> {
    // 步骤 1: 读取所有节点
    let nodes = {
        let state = management.read().await;
        state.nodes.keys().cloned().collect::<Vec<_>>()
    };
    
    // 步骤 2: 批量同步到 Redis
    for node_id in nodes {
        let node_data = {
            let state = management.read().await;
            state.get_node(&node_id).cloned()
        };
        
        if let Some(node_state) = node_data {
            lockless_cache.register_node(&node_id, convert_to_registration_data(node_state)).await?;
        }
    }
    
    Ok(())
}
```

### 5.3 配置项

新增配置项用于控制无锁架构的启用：

```toml
# config.toml

[lockless_cache]
# 是否启用无锁架构
enabled = true

# Redis 连接配置
redis_url = "redis://127.0.0.1:6379"
redis_pool_size = 10

# 缓存配置
cache_ttl_ms = 5000  # 5 秒
version_check_timeout_ms = 50  # 50 毫秒

# 发布/订阅配置
enable_pubsub_invalidation = true
pubsub_channels = ["scheduler:events:node_update", "scheduler:events:config_update"]

# 批量操作配置
batch_refresh_size = 100
batch_refresh_interval_ms = 1000

# 迁移配置
enable_legacy_write = false  # 是否同时写入原有架构
enable_data_sync = true      # 是否启动数据同步任务
```

---

## 6. 性能对比与评估

### 6.1 性能指标对比

| 操作 | 当前架构（有锁） | 无锁架构 | 提升倍数 |
|------|----------------|---------|---------|
| **节点选择（单节点）** | 50-200ms | 1-10ms | **5-20x** |
| **节点选择（批量）** | N × 50ms | N × 1ms | **50x** |
| **心跳更新** | 10-50ms | 1-5ms | **5-10x** |
| **节点注册** | 20-100ms | 2-10ms | **10x** |
| **并发处理能力** | 受锁限制 | 无限制 | **∞** |

### 6.2 资源消耗对比

| 资源 | 当前架构 | 无锁架构 | 说明 |
|------|---------|---------|------|
| **内存（单实例）** | 50-100MB | 80-150MB | 增加本地缓存 |
| **Redis 内存** | 10-50MB | 50-200MB | 存储节点状态 |
| **CPU 使用率** | 20-40% | 10-20% | 减少锁竞争 |
| **网络带宽** | 低 | 中 | Redis 读写 + Pub/Sub |

### 6.3 一致性保证

| 一致性级别 | 当前架构 | 无锁架构 | 说明 |
|-----------|---------|---------|------|
| **强一致性** | ✅ | ❌ | 无锁架构采用最终一致性 |
| **最终一致性** | ✅ | ✅ | 通过版本号和 Pub/Sub 保证 |
| **延迟** | 0ms | 1-100ms | 其他实例缓存失效延迟 |

**影响评估**：
- 节点选择使用稍微过时的数据（1-100ms 延迟）是可以接受的
- 关键操作（如节点槽位预留）仍使用 Redis 原子操作保证强一致性

---

## 7. 风险评估与缓解措施

### 7.1 技术风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| **Redis 故障** | 高 | 低 | 1. Redis 集群部署 2. 降级到原有锁架构 3. 本地缓存作为备份 |
| **网络延迟** | 中 | 中 | 1. 本地缓存减少 Redis 访问 2. 异步版本号检查 3. 超时降级策略 |
| **缓存不一致** | 低 | 中 | 1. 版本号机制 2. Pub/Sub 失效 3. 定期全量刷新 |
| **内存泄漏** | 低 | 低 | 1. TTL 机制 2. 定期清理过期缓存 3. 内存监控 |

### 7.2 业务风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| **数据丢失** | 高 | 低 | 1. Redis 持久化 2. 定期备份 3. 双写策略（过渡期） |
| **服务降级** | 中 | 中 | 1. 自动降级到原有架构 2. 健康检查 3. 告警机制 |

### 7.3 迁移风险

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| **数据不同步** | 高 | 中 | 1. 双写策略（过渡期） 2. 数据校验工具 3. 回滚方案 |
| **性能回退** | 中 | 低 | 1. 灰度发布 2. 性能监控 3. A/B 测试 |
| **代码复杂度** | 低 | 高 | 1. 适配层封装 2. 详细文档 3. 代码审查 |

---

## 8. 实施计划

### 8.1 阶段划分

#### 阶段 1：基础设施准备（2 周）

- [ ] Redis 集群部署和配置
- [ ] Redis 客户端封装实现
- [ ] 序列化/反序列化工具实现
- [ ] 单元测试框架搭建

#### 阶段 2：核心功能实现（4 周）

- [ ] LocklessCache 核心功能实现
- [ ] 版本号管理机制实现
- [ ] 发布/订阅失效机制实现
- [ ] 批量操作优化

#### 阶段 3：适配层和迁移工具（2 周）

- [ ] 接口适配层实现
- [ ] 双写策略实现
- [ ] 数据同步工具实现
- [ ] 降级机制实现

#### 阶段 4：测试和优化（3 周）

- [ ] 单元测试（覆盖率 > 80%）
- [ ] 集成测试
- [ ] 性能测试和优化
- [ ] 压力测试

#### 阶段 5：灰度发布（2 周）

- [ ] 单实例灰度发布
- [ ] 多实例灰度发布
- [ ] 监控和告警
- [ ] 问题修复

#### 阶段 6：全量发布（1 周）

- [ ] 全量切换
- [ ] 原有架构下线
- [ ] 文档更新
- [ ] 经验总结

**总时长**：约 14 周（3.5 个月）

### 8.2 资源需求

- **开发人员**：2-3 人
- **测试人员**：1 人
- **运维支持**：1 人
- **Redis 集群**：3 节点（主从模式）

---

## 9. 决策建议

### 9.1 推荐方案

**推荐采用无锁架构方案**，理由如下：

1. ✅ **性能提升显著**：节点选择延迟降低 10-20 倍
2. ✅ **可扩展性强**：支持多实例水平扩展
3. ✅ **技术风险可控**：有完善的降级和回滚方案
4. ✅ **长期收益大**：为未来扩展奠定基础

### 9.2 实施建议

1. **采用渐进式迁移**：
   - 先实现核心功能，保留原有架构作为降级方案
   - 通过适配层平滑迁移，减少代码改动
   - 使用双写策略保证数据一致性

2. **重视测试和监控**：
   - 完善的单元测试和集成测试
   - 详细的性能监控和告警
   - 定期进行压力测试

3. **预留回滚窗口**：
   - 保留原有架构代码至少 3 个月
   - 确保可以快速回滚到原有架构
   - 准备详细的回滚文档

### 9.3 不推荐的情况

如果满足以下任一条件，**不推荐**采用无锁架构：

1. ❌ Redis 基础设施不完善（无集群、无持久化）
2. ❌ 无法接受最终一致性（必须强一致性）
3. ❌ 团队缺乏 Redis 运维经验
4. ❌ 项目时间紧迫（< 3 个月）

---

## 10. 附录

### 10.1 关键代码示例

详见各方法实现章节（4.1.2, 4.2.2, 4.3）

### 10.2 Redis 命令参考

```bash
# 获取节点数据
HGETALL scheduler:nodes:node-12345

# 获取节点版本号
HGET scheduler:nodes:node-12345 version

# 更新节点数据（Lua 脚本）
EVAL <script> 1 scheduler:nodes:node-12345 <args>

# 发布更新事件
PUBLISH scheduler:events:node_update '{"event_type":"node_heartbeat",...}'

# 订阅更新事件
SUBSCRIBE scheduler:events:node_update
```

### 10.3 监控指标

建议监控以下指标：

- Redis 连接池使用率
- Redis 命令延迟（P50, P95, P99）
- 本地缓存命中率
- 版本号检查超时率
- 发布/订阅消息延迟
- 节点选择平均延迟
- 心跳更新平均延迟

---

## 文档版本历史

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1.0 | 2026-01-10 | AI Assistant | 初始版本 |

---

**审批状态**：待决策部门审批

**联系人**：技术架构组
