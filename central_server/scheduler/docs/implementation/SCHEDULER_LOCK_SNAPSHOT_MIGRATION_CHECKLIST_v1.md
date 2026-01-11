# SCHEDULER_LOCK_SNAPSHOT_MIGRATION_CHECKLIST_v1.md
调度锁优化与快照迁移 Checklist（给开发部门）

本清单用于指导开发团队，将当前实现迁移为：
- 管理域：统一使用 ManagementRegistry 一把锁管理节点与池；
- 运行域：调度仅依赖 RuntimeSnapshot / PoolIndex，不再访问 nodes / 旧索引；
- Session 域：为需要的地方补齐 per-session 状态锁（若启用）。

本 Checklist 按“模块 → 具体改动项”组织，可逐条勾选。

---

## A. 管理域：统一管理锁收口

### A1. 收拢节点管理入口

- [ ] 搜索所有对 `nodes.write()` 的直接调用（不经过 ManagementRegistry）：
  - 典型位置：
    - 节点注册时新增 NodeState
    - 节点下线时移除 NodeState
    - 节点属性（能力、并发上限）变更
- [ ] 将上述逻辑替换为：
  ```rust
  let mut mgmt = management_registry.state.write().await;
  // 在 mgmt.nodes 上做 insert/remove/update
  drop(mgmt);
  ```
- [ ] 确认外部模块不再直接使用 `nodes.write()` 做管理操作。

### A2. 收拢语言索引管理入口

- [ ] 搜索所有对 `language_capability_index.write()` 的直接调用：
  - 包含节点注册 / 下线 / 能力更新时操作语言索引的代码。
- [ ] 将其合并到 ManagementState 更新逻辑中：
  ```rust
  let mut mgmt = management_registry.state.write().await;
  // 在 mgmt.lang_index 上更新语言索引
  drop(mgmt);
  ```
- [ ] 删除或隐藏 `language_capability_index` 对外暴露的锁接口（仅在 ManagementState 内部使用）。

### A3. Phase3 池相关结构并入 ManagementState

- [ ] 确认以下结构是否独立使用自己的 RwLock：
  - `phase3_node_pool_mapping`
  - `phase3_pool_index`
  - `phase3_core_cache`
- [ ] 若是，将这些结构移入 `ManagementState` 内统一管理：
  ```rust
  pub struct ManagementState {
      pub nodes: HashMap<NodeId, NodeState>,
      pub pools: Vec<Phase3PoolConfig>,
      pub lang_index: PoolLanguageIndex,
      pub phase3_pool_index: Phase3PoolIndex,
      pub phase3_core_cache: Phase3CoreCache,
  }
  ```
- [ ] 所有修改 phase3_* 的地方统一改为：
  ```rust
  let mut mgmt = management_registry.state.write().await;
  // 修改 mgmt.phase3_pool_index / mgmt.phase3_core_cache 等
  drop(mgmt);
  ```

### A4. 管理锁内禁止重计算

- [ ] 检查所有 `management_registry.state.write()` 内部的逻辑：
  - [ ] 禁止在锁内执行任何 O(N) 遍历 / 大规模重构（如全量重建 pool index）。
- [ ] 对需要重建的结构采用“两段式”：
  1. `read()` 获取必要信息构建“重建任务参数”；
  2. 锁外执行重建；
  3. `write()` 用新结构覆盖。

---

## B. 运行域：调度路径只读快照

### B1. 消除调度路径中的 `nodes.read()`

- [ ] 搜索代码中所有对 `nodes.read()` 的调用。
- [ ] 标记哪些是“调度热路径”：
  - Job 创建时的节点筛选 / 节点权重计算；
  - Phase3 池节点候选列表构建。
- [ ] 在上述热路径中，将 `nodes.read()` 替换为对 RuntimeSnapshot 的访问：
  ```rust
  let snapshot_arc = {
      let r = snapshot_manager.read().await;
      r.clone()  // Arc<NodeRuntimeMap>
  };
  // 在 snapshot_arc 上进行节点过滤和选择
  ```
- [ ] 确认调度热路径不再依赖 NodeState / nodes，而只依赖 NodeRuntimeSnapshot。

### B2. RuntimeSnapshot 完整性检查

- [ ] 确认 `NodeRuntimeSnapshot` 中包含所有调度决策需要的字段：
  - 节点健康状态（health）
  - 支持能力（ASR/NMT/TTS）
  - 支持语言对（lang_pairs）
  - 最大并发 / 权重等（max_concurrency / weight）
- [ ] 确认快照的更新逻辑在以下路径上完整触发：
  - 节点首次注册完成后
  - 心跳状态更新后
  - 节点能力变化后
- [ ] 在这些路径上采用 COW 更新快照：
  ```rust
  let new_snap = Arc::new(NodeRuntimeSnapshot::from_state(&node_id, &state));
  let new_map = {
      let old = snapshot_manager.read().await;
      let mut cloned = (**old).clone();
      cloned.insert(node_id.clone(), new_snap);
      Arc::new(cloned)
  };
  {
      let mut w = snapshot_manager.write().await;
      *w = new_map;
  }
  ```

### B3. Phase3 PoolIndex 使用快照而非 nodes

- [ ] 在构建或重建 Phase3 PoolIndex 时：
  - 仅使用 RuntimeSnapshot 或 ManagementState 内的 nodes 数据一次性构建；
  - 不在调度路径内动态读取 nodes。
- [ ] 调度时：
  ```rust
  let snapshot = snapshot_manager.read().await.clone();
  let pool_nodes = phase3_pool_index.read().await.get(pool_id);
  // 仅用 pool_nodes 中的 node_id 去 snapshot 中取 NodeRuntimeSnapshot
  ```

### B4. PoolMembersCache 的使用规范

- [ ] 检查所有从 Redis 读取 pool 成员列表的代码：
  - 优先从 PoolMembersCache 读取；
  - miss 时才访问 Redis，并写入缓存；
- [ ] Cache 自身有独立小锁（如 RwLock 或 Mutex），不依赖 ManagementState 或 nodes 锁。

---

## C. Session 域：补齐 per-session 状态锁（如有需求）

> 若你暂时不需要 per-session 池绑定 / 缓存，可将此部分标记为“延后”。

### C1. 引入 SessionManager

- [ ] 定义：
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
- [ ] 为 SessionManager 增加 `get_or_create(session_id)` 方法。

### C2. 调度路径中使用 session 锁

- [ ] 在 dispatch/job 创建入口处增加：
  ```rust
  let entry = session_manager.get_or_create(&session_id);
  let mut sess = entry.mutex.lock().await;
  // 归一化 lang_pair / preferred_pool / session cache
  drop(sess);
  ```
- [ ] 确认锁内 **不调用** ManagementRegistry / Redis / 外部网络 I/O。

### C3. 整理现有 session 级状态

- [ ] 如果当前已有 `last_dispatched_node_by_session` 等按 session 记录分配历史的 map：
  - 考虑迁移到 SessionRuntimeState 中（统一 session 层状态管理）；
  - 或至少保证这些 map 的访问不与其他锁产生交叉嵌套。

---

## D. 锁顺序与死锁防护

### D1. 制定锁顺序约定

- [ ] 文档中明确约定锁获取顺序，例如：
  1. ManagementRegistry.state
  2. RuntimeSnapshot（读）
  3. SessionEntry.mutex
  4. Redis / 外部服务（无锁）
- [ ] 约定：**禁止在 SessionEntry.mutex 内再获取 ManagementRegistry.state.write()**。

### D2. 审查所有可能嵌套加锁位置

- [ ] 搜索所有 `management_registry.state.write()` 调用，确认内部不再调用：
  - `session_manager`
  - 任何可能阻塞的 async I/O（包括 Redis）
- [ ] 搜索所有 `SessionEntry.mutex.lock().await` 调用，确认内部不调用：
  - `management_registry.state.write/read()`
  - 任何重计算逻辑

---

## E. 验证与回归

### E1. 性能与锁等待指标

- [ ] 增加 metrics：
  - 调度延迟分布（p50/p95/p99）
  - ManagementRegistry 写锁等待时间
  - nodes / snapshot_manager 锁等待时间（若仍存在）
- [ ] 压测场景：
  - 100+ 并发 session，单节点；
  - 100+ 并发 session，多节点多池；
- [ ] 预期：
  - 调度路径不再出现秒级锁等待；
  - ManagementRegistry 写锁等待主要由心跳路径触发，且对调度无直接影响。

### E2. 回归测试

- [ ] 单元测试：
  - 节点注册/下线
  - 池配置变更
  - RuntimeSnapshot 更新
  - Session 状态更新
- [ ] 集成测试：
  - 端到端一次翻译：Web → Scheduler → Node → 回传
  - 多 Session 并发翻译
  - 节点故障 / 心跳超时后调度行为

---

## F. 完成标志（Done Criteria）

当以下条件满足时，可认为本次迁移完成：

- [ ] 调度路径中不再直接访问 `nodes.read()` / `nodes.write()`。
- [ ] 所有节点与池管理操作均通过 `ManagementRegistry.state.write()` 完成。
- [ ] RuntimeSnapshot 是调度决策唯一依赖的节点状态来源。
- [ ] Session 内部状态（如 preferred_pool）由独立的 per-session 锁保护（若启用该功能）。
- [ ] 压测结果显示：在高并发场景下，不再出现锁竞争导致的秒级延迟。

（完）
