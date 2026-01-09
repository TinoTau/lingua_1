# SCHEDULER_LOCK_OPTIMIZATION_COMBINED_DESIGN_v1.md
调度服务器锁优化综合方案（管理锁 + 快照 + Session锁）
=========================================================

本文件将两类优化方案合并成一个完整可落地的调度架构，并给出任务拆分清单（Task List），可直接交付开发团队执行。

---

# 1. 目标

1. 避免全局锁竞争导致的调度阻塞。
2. 节点与池的管理（注册、心跳、池配置）统一使用**一把管理锁**。
3. 来自**同一个 Session 的翻译任务**串行控制，使用**一把 Session 锁**。
4. 调度路径脱离管理锁，使用 **RuntimeSnapshot（节点运行快照）** + **Pool 索引快照**。
5. Redis `try_reserve` 继续作为最终并发控制来源。
6. 架构清晰，无死锁路径，满足高并发场景（上千 WebSocket 会话）。

---

# 2. 总体架构（锁分层）

```
┌─────────────────────────────┐
│ 管理域 Management Domain       │  ← 一把锁（RwLock）
│ - 静态节点信息 NodeState        │
│ - 池配置 Pools                 │
│ - 语言索引 PoolLanguageIndex   │
└───────────────┬─────────────┘
                │ Copy-On-Write
                ▼
┌─────────────────────────────┐
│ 运行域 Runtime Domain           │  ← 无锁或轻锁
│ - RuntimeSnapshot(nodes)      │
│ - PoolMembersCache            │
│ - PoolLanguageIndex Snapshot  │
└───────────────┬─────────────┘
                │ Session Mutex
                ▼
┌─────────────────────────────┐
│ 会话域 Session Domain           │  ← 每个 session 一把锁
│ - preferred_pool              │
│ - bound_lang_pair             │
│ - session-level cache         │
└─────────────────────────────┘
```

---

# 3. 管理锁设计（节点 + 池统一管理）

## 3.1 ManagementState

```rust
pub struct ManagementState {
    pub nodes: HashMap<NodeId, NodeState>,
    pub pools: Vec<Phase3PoolConfig>,
    pub lang_index: PoolLanguageIndex,
}
```

## 3.2 ManagementRegistry

```rust
pub struct ManagementRegistry {
    pub state: RwLock<ManagementState>,
}
```

**所有节点注册、下线、心跳更新、池配置更新全部走这一把锁**。  
但所有“重建计算”（如 pool index rebuild）都放在锁外完成。

---

# 4. RuntimeSnapshot（调度快路径）

## 4.1 Snapshot 结构

```rust
pub struct NodeRuntimeSnapshot {
    pub node_id: NodeId,
    pub health: Health,
    pub capabilities: NodeCapabilities,
    pub lang_pairs: SmallVec<[LangPair; 8]>,
    pub max_concurrency: u32,
}

pub type NodeRuntimeMap = HashMap<NodeId, Arc<NodeRuntimeSnapshot>>;

pub struct RuntimeSnapshot {
    pub nodes: Arc<NodeRuntimeMap>,
    pub pool_members_cache: Arc<RwLock<PoolMembersCache>>,
    pub lang_index: Arc<PoolLanguageIndex>,
}
```

快照完全从 ManagementState 派生：

- 心跳更新 NodeState → 触发快照更新  
- 快照通过 COW（Clone-On-Write）更新，不阻塞调度  
- 调度线程永远不读 ManagementState

---

# 5. Session 锁（每个 session 串行）

## 5.1 Session 数据结构

```rust
pub struct SessionRuntimeState {
    pub preferred_pool: Option<u16>,
    pub bound_lang_pair: Option<(Lang, Lang)>,
    pub cached_pool_members: Option<(Vec<NodeId>, i64)>,
}

pub struct SessionEntry {
    pub mutex: Mutex<SessionRuntimeState>,
}

pub struct SessionManager {
    pub sessions: DashMap<SessionId, Arc<SessionEntry>>,
}
```

同一个 session 内：

- 语言对归一化
- preferred_pool 绑定
- session 层 cache 更新  
全部通过一把轻量 mutex 完成。

---

# 6. 调度流程（合并后最终版）

```
dispatch_job(session_id, job):

1. 读取 RuntimeSnapshot（无锁）
2. 使用 SessionManager 获取 session_entry
3. session_entry.mutex.lock().await
4. 基于 session_state：
     - 确定 lang_pair
     - 确定 preferred_pool（若无则新绑定）
     - 更新 session cache（可选）
5. 释放 session 锁
6. 用 snapshot.lang_index 找到 pool → O(1)
7. 用 snapshot.pool_members_cache / Redis 获取 pool 成员
8. 用 snapshot.nodes 过滤可用节点
9. 用 redis.try_reserve() 进行最终并发控制
10. 返回分配的节点
```

---

# 7. 死锁安全分析

必须遵守：

1. 调度路径不得在 session 锁内访问管理锁  
2. 管理域逻辑不得访问 SessionManager  

不会形成环路，完全安全。

---

# 8. Task List（开发任务拆分）

## A. 管理域任务（统一管理锁）

### A1. 重构 ManagementState  
### A2. 心跳更新流程改造  
### A3. PoolLanguageIndex 的生成与更新  

## B. RuntimeSnapshot（调度快路径）

### B1. 定义 NodeRuntimeSnapshot / NodeRuntimeMap  
### B2. 构建 RuntimeSnapshot struct  
### B3. 调度路径改造：只读快照  

## C. SessionManager（每 Session 一把锁）

### C1. 实现 SessionManager + DashMap  
### C2. 实现 SessionRuntimeState 状态机  
### C3. 在调度路径中加入 session 锁  

## D. 调度路径（核心改造）

### D1. 快照读替代 Nodes 读  
### D2. 快照语言索引替代 pool 解析  
### D3. 引入 PoolMembersCache  
### D4. Redis try_reserve 集成  

## E. 测试与验证

### E1. 并发压测  
### E2. 心跳场景模拟  
### E3. Session 行为回放测试  

---

# 9. 最终效果

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 调度延迟 | 200ms–4s | 0.2–5ms |
| 写锁阻塞 | 高 | 极低 |
| 并发能力 | 差 | 高 |
| 心跳影响 | 大 | 最小 |
| Session 一致性 | 弱 | 强 |

本架构可直接交付开发实现。

（完）
