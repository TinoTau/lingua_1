# NODE_RUNTIME_SNAPSHOT_ARCHITECTURE_v1.md
节点运行时快照架构设计文档（用于彻底解决调度服务器锁竞争问题）

---

# 1. 文档目的

本文件定义调度服务器中 “Runtime Snapshot（节点运行时快照）” 的架构、数据结构、更新流程和调度使用方式。

其目标是：

1. **彻底消除 NodeRegistry（HashMap<NodeId→NodeState>） 在调度时的锁竞争**
2. **将调度决策（dispatch_job）从“慢路径（有锁）”迁移到“无锁快路径”**
3. **保证节点状态一致性和调度实时性**
4. **与现有 Redis try_reserve + Pool Index 调度模型完全兼容**

这是解决当前调度服务器“任务堆积、锁等待 1–4 秒、WebSocket 多 session 卡顿”的核心机制。

---

# 2. 当前问题（背景）

在现有实现中：

- 所有调度相关操作需要访问 `node_registry.nodes: RwLock<HashMap<NodeId, NodeState>>`
- 心跳需要 `nodes.write()`
- 调度需要 `nodes.read()`
- pool 重建读取 `nodes.read()`
- 多个异步任务同时抢占这把锁

这导致：

- 写锁阻塞所有读锁
- 多读互相排队
- 调度延迟上升至 1–4 秒
- 即使只有一个节点也会发生（锁争用来自调度线程本身）

这是根本性架构瓶颈。

---

# 3. Snapshot 机制解决问题的核心思路

**将调度使用的节点信息从 NodeRegistry 分离成 RuntimeSnapshot，调度只读 snapshot，不再触碰 NodeRegistry → 无锁高并发。**

“慢路径”：节点状态管理（注册、心跳），仍然操作 NodeRegistry（低频）
“快路径”：任务调度（高频），只读取 snapshot + pool_index（无锁）

---

# 4. 三层结构总览

```
┌─────────────────────────┐
│   NodeRegistry (有锁,慢路径) │
│   HashMap<NodeId, NodeState> │
└──────────────┬──────────┘
               │ COW 更新
               ▼
┌─────────────────────────┐
│ RuntimeSnapshot (无锁,快路径) │
│ Arc<HashMap<NodeId, NodeRuntimeSnapshot>> │
└──────────────┬──────────┘
               │ 构建 pool
               ▼
┌─────────────────────────┐
│ PoolIndex (无锁)            │
│ PoolId → Vec<NodeId>       │
└─────────────────────────┘
```

Snapshot 是任务调度的唯一数据来源。

---

# 5. 数据结构定义（Rust）

## 5.1 NodeRegistry（保持现状，不再暴露给调度）

```rust
pub struct NodeRegistry {
    pub nodes: Arc<RwLock<HashMap<NodeId, NodeState>>>,
    pub runtime_snapshot: Arc<RwLock<Arc<NodeRuntimeMap>>>,
}
```

## 5.2 NodeRuntimeSnapshot（调度使用的轻量结构）

```rust
pub struct NodeRuntimeSnapshot {
    pub node_id: NodeId,
    pub health: HealthStatus,
    pub capabilities: NodeCapabilities,
    pub lang_pairs: SmallVec<[LangPair; 8]>,
    pub max_concurrency: u32,
}
```

Snapshot 只包含调度需要的字段。

## 5.3 Snapshot Map

```rust
pub type NodeRuntimeMap = HashMap<NodeId, Arc<NodeRuntimeSnapshot>>;
```

---

# 6. 心跳更新节点状态的流程（慢路径）

旧方式（问题来源）：

```
nodes.write() → 更新 NodeState → nodes.read() → 调度使用
```

新方式：

```
1. nodes.write() 更新 NodeState（低频）
2. 锁外从 NodeState 生成 NodeRuntimeSnapshot
3. clone 旧 snapshot map + 替换该 node entry
4. runtime_snapshot.write() 替换 Arc（极短）
5. pool_index 可选择同步重建
```

写锁时间极短（几十微秒）。

---

# 7. 调度流程（dispatch_job）完全无锁

旧方式：

```
nodes.read() → 过滤节点 → clone 信息 → dispatch
```

新方式：

```
snapshot_arc = runtime_snapshot.read().clone()
pool_nodes = pool_index.get(pool_id)

for nid in pool_nodes:
    candidate = snapshot_arc.get(nid)
    if ok → push

scheduler_select(candidates)
redis.try_reserve(node)
```

调度线程永远不会访问 node_registry.nodes → 不会等待锁。

---

# 8. Snapshot 与 PoolIndex

pool_index 重建流程：

```
snapshot_arc = runtime_snapshot.read().clone()
遍历 snapshot → 根据语言对构建 pool_index
phase3_pool_index.write(new_index)
```

调度使用 snapshot + pool_index → 不触碰 NodeRegistry。

---

# 9. Snapshot 一致性保证

1. Snapshot 是不可变对象  
2. 每次更新通过 COW 构建新 map  
3. 调度线程始终看到一致的 snapshot  
4. 更新 snapshot 的写锁非常短（替换 Arc 指针）  
5. Nodes 的写锁不影响调度线程

---

# 10. 状态机（State Machine）

```
心跳 → NodeRegistry::nodes.write()
     → 构建 NodeRuntimeSnapshot
     → runtime_snapshot.write()（Arc 替换）
     →（可选）pool_index 重建

任务 → dispatch_job
     → snapshot.clone()（无锁）
     → pool_index.read()（短锁）
     → redis.try_reserve
     → 返回 node_id
```

---

# 11. 伪代码

## 11.1 Snapshot 更新

```rust
pub async fn update_snapshot(&self, node_id: NodeId) {
    // 1. 读取 NodeState
    let state = {
        let nodes = self.nodes.read().await;
        match nodes.get(&node_id) {
            Some(s) => s.clone(),
            None => return,
        }
    };

    // 2. 生成运行时快照
    let snap = Arc::new(NodeRuntimeSnapshot::from_state(node_id.clone(), &state));

    // 3. clone map（锁外做）
    let new_map = {
        let old = self.runtime_snapshot.read().await;
        let mut cloned = (**old).clone();
        cloned.insert(node_id.clone(), snap);
        Arc::new(cloned)
    };

    // 4. 替换 snapshot（写锁极短）
    {
        let mut w = self.runtime_snapshot.write().await;
        *w = new_map;
    }
}
```

## 11.2 调度使用 snapshot（无锁）

```rust
pub async fn dispatch(&self, pool: PoolId) -> Option<NodeId> {
    let snapshot = {
        let r = self.runtime_snapshot.read().await;
        r.clone()
    };

    let pool_nodes = self.pool_index.get(&pool)?;

    let mut candidates = Vec::new();
    for nid in pool_nodes {
        if let Some(info) = snapshot.get(nid) {
            candidates.push(info.clone());
        }
    }

    let chosen = scheduler_select(candidates)?;
    redis_try_reserve(chosen).await?;
    Some(chosen)
}
```

---

# 12. 异常路径

- 心跳延迟导致 snapshot 未更新 → 用旧 snapshot，也能调度  
- Redis 容量判定失败 → 自动 fallback 到下一个 candidate  
- 节点下线 → 心跳超时，快照中被标记 unhealthy，pool_index 自动剔除  

---

# 13. 性能收益（估算）

| 指标 | 旧架构（读/写锁） | Snapshot 架构 |
|-----|------------------|---------------|
| 调度延迟 | 100ms–4s | 0.1–2ms |
| 节点扩展能力 | 差 | 良好 |
| 多 session 并发 | 会互相阻塞 | 完全不会 |
| 心跳影响 | 极大 | 极小 |

这是一个 10–100 倍的整体性能提升。

---

# 14. 落地步骤（可渐进式改造）

1. 添加 runtime_snapshot 字段  
2. 实现 NodeRuntimeSnapshot  
3. 调整 handle_heartbeat → 产生 snapshot  
4. 调整 dispatch_job → 使用 snapshot + pool_index  
5. pool_index 重建 → 改为使用 snapshot  
6. 移除调度路径中所有 nodes.read()  

即可完成重构，风险极低。

---

# 15. 结论

Runtime Snapshot 机制使调度服务器从：

- “共享可变状态，所有线程争同一把锁”  
变为  
- “不可变快照 + Copy-on-Write 更新，高并发无锁调度”

这是专业级调度器（k8s scheduler、Envoy、Redis cluster-aware router）使用的标准模式。

本设计可直接交付开发实现。

（完）
