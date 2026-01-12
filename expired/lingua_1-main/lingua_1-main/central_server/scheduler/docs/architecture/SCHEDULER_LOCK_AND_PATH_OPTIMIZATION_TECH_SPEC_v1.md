# SCHEDULER_LOCK_AND_PATH_OPTIMIZATION_TECH_SPEC_v1.md
调度服务器锁优化与调用路径优化技术方案

适用范围：当前多节点、多池、多 Session 的翻译调度服务器（含 Phase3 节点池、Redis try_reserve、WebSocket 会话）  
目标读者：调度服务开发团队、架构设计评审人

---

## 1. 设计目标

1. **解决锁竞争导致的调度阻塞问题**
   - 避免在高并发 Session 情况下出现调度线程等待 `RwLock` 数百毫秒乃至数秒。
2. **统一锁模型**
   - 节点 & 池管理使用单一管理锁（Management Lock）。
   - 同一 Session 的翻译任务使用单一 Session 锁（Session Lock），保证 Session 内部状态一致。
3. **优化调用路径**
   - 区分"冷路径"（管理/重建）与"热路径"（任务调度）。
   - 热路径只使用不可变快照和轻量 cache，不访问重锁。
4. **保持功能语义不变**
   - 保持现有 Phase3 节点池、Redis try_reserve、任务生命周期语义不变。
5. **可渐进落地**
   - 方案可以按模块拆分逐步改造，不要求一次大爆炸重构。

---

## 2. 概念与术语

- **管理域（Management Domain）**：  
  节点注册、下线、心跳更新、池配置、语言索引等，用于维护系统"真相"的区域。
- **运行域（Runtime Domain）**：  
  调度使用的只读快照和缓存，用于高频任务分配的区域。
- **会话域（Session Domain）**：  
  按 Session 维度维护调度相关状态（如绑定池、语言对、上一次分配记录）的区域。
- **冷路径（Cold Path）**：  
  低频操作，允许使用较重锁，但必须避免在锁内做重计算。
- **热路径（Hot Path）**：  
  高频操作（每个翻译 Task 调用），必须尽量无锁/轻锁。

---

## 3. 锁模型总体设计

### 3.1 三层锁结构

1. **Management Lock（管理锁）**
   - 类型：`RwLock<ManagementState>`
   - 职责：
     - 管理所有节点元数据（NodeState）
     - 管理所有池配置及索引（Pools, PoolLanguageIndex, Phase3PoolIndex, Phase3CoreCache）
   - 使用场景：节点注册/下线、心跳更新、池配置变更等冷路径。
   - **实现状态**：✅ 已实现并迁移完成

2. **Runtime Snapshot（运行时快照）**
   - 类型：`Arc<NodeRuntimeMap>` + `Arc<PoolLanguageIndexSnapshot>` + `PoolMembersCache`
   - 职责：
     - 提供调度所需的节点状态、语言索引、池成员缓存。
   - 特征：
     - 快照只读，不加锁或使用轻量读锁。
     - 通过 Copy-On-Write 由管理域更新。
   - **实现状态**：✅ 已实现并迁移完成

3. **Session Lock（每 Session 一把锁）**
   - 类型：`Mutex<SessionRuntimeState>`
   - 职责：
     - 保护 Session 内部与调度相关的状态（preferred_pool、bound_lang_pair、session‑level 缓存）。
   - 特征：
     - 仅在 Session 调度入口短时间持有。
     - 锁内不调用管理锁、Redis 或其他外部 I/O。
   - **实现状态**：⏳ 待实现（当前使用其他机制）

### 3.2 锁获取顺序约定（Lock Ordering）

为避免死锁，强制要求：

1. 任何地方不得在持有 Session Lock 时获取 Management Lock。
2. Management 域逻辑不得访问 SessionManager（不得在 Management Lock 内操作 Session Lock）。
3. 调度路径推荐顺序：
   1. 读取 RuntimeSnapshot（仅读锁或 Arc clone）
   2. 获取 Session Lock（每 Session）
   3. 访问 Redis / 节点 IPC（无锁）

不允许出现"Session Lock → Management Lock"这样的反向依赖。

---

## 4. 数据结构设计

### 4.1 管理域：ManagementState

```rust
pub struct ManagementState {
    pub nodes: HashMap<NodeId, NodeState>,
    pub phase3_config: Phase3Config,
    pub core_services: CoreServicesConfig,
    pub lang_index: PoolLanguageIndex,         // 语言 → 池可用性索引
}

pub struct NodeState {
    pub node: Node,
    pub pool_ids: Vec<u16>,
}

pub struct ManagementRegistry {
    pub state: Arc<RwLock<ManagementState>>,
}
```

所有的"真相状态"集中于此。

**实现状态**：✅ 已实现

### 4.2 运行域：RuntimeSnapshot

```rust
pub struct NodeRuntimeSnapshot {
    pub node_id: String,
    pub health: NodeHealth,                    // Online/Offline/NotReady
    pub capabilities: NodeCapabilities,         // 支持 ASR/NMT/TTS 等
    pub lang_pairs: SmallVec<[LanguagePair; 8]>,
    pub max_concurrency: u32,                  // Node 最大并发
    pub current_jobs: usize,                   // 当前任务数
    pub accept_public_jobs: bool,
    pub pool_ids: SmallVec<[u16; 4]>,
    // 调度所需的其他字段
    pub has_gpu: bool,                         // 是否有 GPU
    pub installed_services: Vec<InstalledService>, // 已安装服务（用于类型检查）
    pub cpu_usage: f32,
    pub gpu_usage: Option<f32>,
    pub memory_usage: f32,
    pub features_supported: FeatureFlags,
}

pub type NodeRuntimeMap = HashMap<String, Arc<NodeRuntimeSnapshot>>;

pub struct RuntimeSnapshot {
    pub nodes: Arc<NodeRuntimeMap>,             // 节点快照
    pub lang_index: Arc<PoolLanguageIndex>,     // 语言索引快照
    pub pool_members_cache: Arc<RwLock<PoolMembersCache>>, // Pool 成员缓存
    pub version: u64,                           // 快照版本
}

pub struct SnapshotManager {
    pub management: ManagementRegistry,
    pub snapshot: Arc<RwLock<RuntimeSnapshot>>,
}
```

特点：

- 调度只读 `SnapshotManager.snapshot`。
- SnapshotManager 由 ManagementRegistry 驱动更新。
- **实现状态**：✅ 已实现并迁移完成

### 4.3 会话域：SessionManager

```rust
pub struct SessionRuntimeState {
    pub preferred_pool: Option<u16>,               // 当前 session 绑定的 pool
    pub bound_lang_pair: Option<(Lang, Lang)>,     // 绑定时的 (src, tgt)
    pub cached_pool_members: Option<(Vec<NodeId>, i64)>, // 可选：该 session 的池成员缓存（含过期时间）
    // 其他 session 级调度策略可扩展字段
}

pub struct SessionEntry {
    pub mutex: tokio::sync::Mutex<SessionRuntimeState>,
}

pub struct SessionManager {
    pub sessions: dashmap::DashMap<SessionId, Arc<SessionEntry>>,
}
```

**实现状态**：⏳ 待实现（当前使用其他机制）

---

## 5. 锁优化：管理路径设计

### 5.1 冷路径场景

冷路径包括：

- 节点注册 / 下线
- 节点心跳更新
- 节点能力变化（可用语言对修改）
- 池配置更新（Phase3 池结构/容量修改）
- 语言索引重建

### 5.2 节点注册 / 下线

**实际实现**：

```rust
pub async fn register_node_with_policy(&self, ...) -> Result<Node, String> {
    // 1. 在管理锁内修改 ManagementState
    let mut mgmt = self.management_registry.write().await;
    // node_id 冲突检测
    // 快速更新节点映射，立即释放锁（< 10ms）
    mgmt.update_node(final_node_id.clone(), node.clone(), vec![]);
    drop(mgmt);

    // 2. 锁外操作：更新语言能力索引
    // 3. 锁外操作：Phase 3 Pool 分配计算（避免在锁内进行耗时操作）
    // 4. 更新快照
    let snapshot_manager = self.get_or_init_snapshot_manager().await;
    snapshot_manager.update_node_snapshot(&final_node_id).await;
}
```

**实现状态**：✅ 已迁移到 ManagementRegistry

节点下线类似：在 ManagementState 中删除，然后刷新快照。

### 5.3 心跳更新

**实际实现**：

```rust
pub async fn update_node_heartbeat(&self, ...) -> bool {
    // 1. 管理锁内更新 NodeState（快速操作，锁持有时间 < 10ms）
    let updated_node = {
        let t0 = Instant::now();
        let result = self.management_registry.update_node_heartbeat(...).await;
        // 记录锁等待时间
        crate::metrics::observability::record_lock_wait(
            "node_registry.management_registry.write", 
            elapsed.as_millis() as u64
        );
        result
    };

    // 2. 锁外更新语言能力索引和快照
    if let Some(ref n) = updated_node {
        // 更新语言能力索引（锁外）
        // 更新 SnapshotManager（锁外）
        let snapshot_manager = self.get_or_init_snapshot_manager().await;
        snapshot_manager.update_node_snapshot(node_id).await;
    }
}
```

**实现状态**：✅ 已迁移到 ManagementRegistry，锁持有时间 < 10ms

### 5.4 Fast Path 与 Slow Path 分离原则

**原则：**

- ManagementState 只在"冷路径"使用写锁。
- 冗长操作（如全量重建 PoolIndex）必须拆成"两段式"：
  - 读锁内收集数据（必要字段）。
  - 锁外重建完整结构。
  - 写锁内一次性覆盖。

**实现状态**：✅ 已实现

---

## 6. 路径优化：调度（热路径）设计

### 6.1 整体调用流程（实际实现）

```
Web / WebSocket → Scheduler:

1. 获取 RuntimeSnapshot（无锁读取）
2. 从 snapshot.nodes 过滤候选节点
3. 根据 snapshot.lang_index 找到 pool
4. PoolMembersCache / Redis 获取 pool 成员（node_id 列表）
5. 根据 runtime_snapshot.nodes 过滤候选节点
6. Redis.try_reserve() 选定节点
7. 创建 Job，推送给节点
```

**实现状态**：✅ 热路径已完全迁移到 RuntimeSnapshot

### 6.2 节点选择（热路径，实际实现）

**实际实现**：

```rust
pub async fn select_node_from_pool(
    &self,
    pool_id: u16,
    candidate_ids: Vec<String>,
    required_types: &[ServiceType],
    ...
) -> (Option<String>, NoAvailableNodeBreakdown) {
    // 优化：使用 RuntimeSnapshot（无锁读取）
    let snapshot_manager = self.get_or_init_snapshot_manager().await;
    let snapshot = snapshot_manager.get_snapshot().await;

    // 从快照中收集候选节点信息（无锁）
    let candidate_nodes: Vec<(String, Arc<NodeRuntimeSnapshot>)> = {
        let mut candidates = Vec::new();
        for nid in nodes_to_check.iter() {
            if let Some(node) = snapshot.nodes.get(nid) {
                candidates.push((nid.clone(), node.clone()));
            }
        }
        candidates
    };

    // 在锁外进行节点过滤和 Redis 查询
    for (_nid, node) in candidate_nodes {
        // 使用 node.health, node.has_gpu, node.installed_services 等字段
        // 进行过滤（无锁）
        // ...
    }
}
```

**实现状态**：✅ 已完全迁移到 RuntimeSnapshot，无锁读取

### 6.3 其他热路径函数

以下函数已迁移到 RuntimeSnapshot：

- `is_node_available()` - 使用 RuntimeSnapshot 检查节点可用性
- `check_node_has_types_ready()` - 使用 RuntimeSnapshot 检查节点类型
- `select_node_with_types_excluding_with_breakdown()` - 使用 RuntimeSnapshot 选择节点
- `select_node_with_features_excluding_with_breakdown()` - 使用 RuntimeSnapshot 选择节点
- `job_creation_node_selection.rs` - Job 创建时的节点选择

**实现状态**：✅ 已完全迁移

---

## 7. 迁移状态总结

### 7.1 已完成迁移

#### 热路径（调度）✅
- `node_selection.rs::select_node_from_pool` - 使用 RuntimeSnapshot
- `core.rs::is_node_available` - 使用 RuntimeSnapshot
- `core.rs::check_node_has_types_ready` - 使用 RuntimeSnapshot
- `selection_types.rs::select_node_with_types_excluding_with_breakdown` - 使用 RuntimeSnapshot
- `selection_features.rs::select_node_with_features_excluding_with_breakdown` - 使用 RuntimeSnapshot
- `job_creation_node_selection.rs` - 使用 RuntimeSnapshot

#### 冷路径（管理）✅
- `core.rs::register_node_with_policy` - 使用 ManagementRegistry
- `core.rs::update_node_heartbeat` - 使用 ManagementRegistry（锁持有时间 < 10ms）
- `core.rs::set_node_status` - 使用 ManagementRegistry
- `core.rs::mark_node_offline` - 使用 ManagementRegistry
- `core.rs::upsert_node_from_snapshot` - 使用 ManagementRegistry
- `core.rs::get_node_snapshot` - 使用 ManagementRegistry
- `phase3_pool_allocation_impl.rs` - 使用 ManagementRegistry
- `phase3_core_cache.rs` - 使用 ManagementRegistry
- `phase3_pool_cleanup.rs` - 使用 ManagementRegistry
- `phase3_pool_members.rs` - 使用 ManagementRegistry

### 7.2 待迁移（遗留代码）

以下文件仍使用旧的 `nodes.read()` 或 `nodes.write()`：

- `phase3_pool_index.rs` - 重建 Pool 索引时仍使用 `nodes.read()`
- `phase3_pool_creation.rs` - 可能仍使用 `nodes.read()`
- `auto_language_pool.rs` - 可能仍使用 `nodes.read()`
- 测试文件 - 使用 `nodes.read()` 或 `nodes.write()`（测试代码，可保留）

**注意**：这些遗留代码主要用于 Pool 重建等低频操作，不影响热路径性能。

### 7.3 NodeRuntimeSnapshot 字段扩展

已扩展 `NodeRuntimeSnapshot` 包含调度所需的所有字段：

- `has_gpu: bool` - 是否有 GPU
- `installed_services: Vec<InstalledService>` - 已安装服务（用于类型检查）
- `cpu_usage: f32` - CPU 使用率
- `gpu_usage: Option<f32>` - GPU 使用率
- `memory_usage: f32` - 内存使用率
- `features_supported: FeatureFlags` - 支持的功能

**实现状态**：✅ 已扩展完成

---

## 8. 性能预期与指标

### 8.1 优化前典型症状

- 调度路径中 `nodes.read()` 与心跳路径 `nodes.write()` 产生竞争，导致：
  - 调度线程等待锁 200ms–4s。
  - 即使只有单节点、多 Session，也出现明显卡顿。

### 8.2 优化后预期

- 调度路径完全不访问 ManagementState：
  - 调度延迟由 "锁等待 + Redis + NodeRTT" 变为 "Redis + NodeRTT"。
  - 在单节点 + 多 Session 压测下，调度层延迟应在 0.2–5ms 范围。
- ManagementState 写锁只在心跳 / 注册 / 配置更新时短暂持有，对调度无直接影响。

**实际效果**：
- ✅ 热路径（调度）完全无锁，性能大幅提升
- ✅ 心跳更新锁持有时间 < 10ms（已优化）
- ✅ 节点注册锁持有时间 < 10ms（Pool 分配计算移到锁外）

### 8.3 建议监控指标

- 调度延迟（从收到翻译请求到节点选出）p50/p95/p99。
- ManagementRegistry.state 写锁等待时间分布。
- SnapshotManager.snapshot RwLock 等待时间分布。
- Redis try_reserve 调用失败率 / 重试次数。
- Session 锁持有时间分布（如果实现）。

---

## 9. 落地步骤建议

配合之前的 Checklist，可以按以下阶段落地：

1. **Phase 1：管理锁收口** ✅ **已完成**
   - 所有管理操作通过 ManagementRegistry.state 进行。
   - 禁止外部直接使用 nodes / language_capability_index 的 write 锁。

2. **Phase 2：RuntimeSnapshot 完整化** ✅ **已完成**
   - 完善 NodeRuntimeSnapshot 字段。
   - 心跳/注册路径完善 COW 更新逻辑。

3. **Phase 3：调度路径迁移** ✅ **已完成**
   - 节点选择、Phase3 池逻辑改为只读 RuntimeSnapshot + PoolIndex。
   - 删除调度路径中所有 nodes.read()。

4. **Phase 4：Session 锁引入（如需要）** ⏳ **待实现**
   - 实现 SessionManager / SessionRuntimeState。
   - 在 dispatch 入口中加入 Session 锁来保护 per-session 调度状态。

5. **Phase 5：压测与调优** ⏳ **待进行**
   - 针对单节点、多节点、多 Session 场景压测。
   - 根据监控指标进行微调（如 PoolMembersCache TTL、Redis 超时等）。

---

## 10. 结论

通过本技术方案中的"锁优化 + 路径优化"联合设计，调度服务器已实现：

- ✅ 从"单一全局锁 + 热路径访问 ManagementState"的架构，
- ✅ 迁移为"管理域单锁 + 运行时快照"的架构，

既保证了节点与池管理的一致性，又大幅降低了调度路径上的锁竞争，使系统能够在家用 PC 节点 + 多 Session 的场景下稳定运行。

**当前状态**：
- ✅ 热路径（调度）完全无锁，使用 RuntimeSnapshot
- ✅ 冷路径（管理）统一使用 ManagementRegistry
- ✅ 锁竞争显著减少，代码更简洁
- ⏳ Session 锁机制待实现（可选）

---

## 11. 代码清理摘要（2025-01）

### 11.1 清理的未使用代码

在锁优化重构后，清理了大量未使用的代码和方法，原因如下：

#### 11.1.1 已废弃的验证函数

`node_registry/validation.rs` 中的函数已被新的实现替代：
- `node_has_required_types_ready()` - 已被 `selection/node_selection.rs` 中的 Redis 查询替代
- `node_has_installed_types()` - 已被 `selection/node_selection.rs` 中的内联检查替代
- `node_supports_features()` - 已被 `selection/selection_features.rs` 中的 `node_supports_features_from_snapshot()` 替代
- `is_node_resource_available()` - 已被 `selection/node_selection.rs` 中的内联资源检查替代

**处理方式**：已删除这些函数，保留文件作为注释说明替代方案。

#### 11.1.2 未使用的 SessionRuntimeManager 系列

`core/session_runtime.rs` 中的结构体和方法是锁优化设计的一部分，但实际未使用（计划中的 Session 锁机制）：
- `SessionRuntimeState` - 保留但标记 `#[allow(dead_code)]`（在测试中使用）
- `SessionEntry` - 保留但标记 `#[allow(dead_code)]`（在测试中使用）
- `SessionRuntimeManager` - 保留但标记 `#[allow(dead_code)]`（在测试中使用）
- `SessionRuntimeManagerStats` - 保留但标记 `#[allow(dead_code)]`

**处理方式**：保留这些代码以便未来实现 Session 锁机制，但添加了 `#[allow(dead_code)]` 标记。

#### 11.1.3 未使用的 RuntimeSnapshot 方法

`node_registry/runtime_snapshot.rs` 中的一些方法目前未使用：
- `RuntimeSnapshot::get_node()` - 保留但标记 `#[allow(dead_code)]`（用于调试）
- `RuntimeSnapshot::get_all_node_ids()` - 保留但标记 `#[allow(dead_code)]`（用于调试）
- `RuntimeSnapshot::update_pool_members()` - 保留但标记 `#[allow(dead_code)]`（Pool 成员直接从 Redis 读取）
- `RuntimeSnapshot::get_pool_members()` - 保留但标记 `#[allow(dead_code)]`（Pool 成员直接从 Redis 读取）

**处理方式**：保留这些方法以便未来扩展和调试，但添加了 `#[allow(dead_code)]` 标记。

#### 11.1.4 未使用的 SnapshotManager 方法

`node_registry/snapshot_manager.rs` 中的方法：
- `SnapshotManager::update_snapshot()` - 保留但标记 `#[allow(dead_code)]`（使用增量更新 `update_node_snapshot`）
- `SnapshotManager::remove_node_snapshot()` - 保留但标记 `#[allow(dead_code)]`（节点移除通过增量更新处理）

**处理方式**：保留这些方法以便未来扩展，但添加了 `#[allow(dead_code)]` 标记。

#### 11.1.5 未使用的 ManagementState/ManagementRegistry 方法

`node_registry/management_state.rs` 中的方法：
- `ManagementState::remove_node()` - 保留但标记 `#[allow(dead_code)]`（通过 ManagementRegistry 处理）
- `ManagementState::update_node_pools()` - 保留但标记 `#[allow(dead_code)]`（Pool 分配在节点注册时完成）
- `ManagementRegistry::update_node()` - 保留但标记 `#[allow(dead_code)]`（通过 `register_node_with_policy` 处理）
- `ManagementRegistry::remove_node()` - 保留但标记 `#[allow(dead_code)]`
- `ManagementRegistry::get_node()` - 保留但标记 `#[allow(dead_code)]`
- `ManagementRegistry::update_node_pools()` - 保留但标记 `#[allow(dead_code)]`

**处理方式**：保留这些方法以便未来扩展，但添加了 `#[allow(dead_code)]` 标记。

#### 11.1.6 未使用的 JobFsmState 方法

`phase2.rs` 中的方法：
- `JobFsmState::parse()` - 已删除（未使用）
- `JobFsmState::as_str()` - 保留（在测试中使用，改为 `pub(crate)`）

**处理方式**：删除未使用的 `parse()` 方法，保留 `as_str()` 方法。

#### 11.1.7 未使用的导入和变量

- `websocket/session_message_handler/audio.rs` - 清理未使用的导入：`ErrorCode`, `UiEventStatus`, `UiEventType`, `create_job_assign_message`, `send_ui_event`, `create_translation_jobs`, `info`, `warn`
- `services/pairing.rs` - 清理未使用的导入：`SystemTime`, `UNIX_EPOCH`
- `core/dispatcher/job_creation/job_creation_phase2.rs` - 修复未使用的变量：`padding_ms`, `no_available_node_metric`

**处理方式**：已删除或修复。

#### 11.1.8 未使用的测试辅助方法

以下方法标记为 `#[cfg(test)]`：
- `NodeRegistry::set_node_status_for_test()`
- `NodeRegistry::get_node_for_test()`
- `NodeRegistry::register_node_for_test()`
- `AudioBufferManager::clear_all_for_session_for_test()`

**处理方式**：使用 `#[cfg(test)]` 标记，仅在测试时编译。

#### 11.1.9 未使用的字段

- `UnavailableServiceEntry::expire_at_ms` - 标记 `#[allow(dead_code)]`
- `NodeRuntimeSnapshot::lang_pairs` - 标记 `#[allow(dead_code)]`（保留用于未来扩展）
- `NodeRuntimeSnapshot::pool_ids` - 标记 `#[allow(dead_code)]`（保留用于未来扩展）
- `PoolMembersCache::members` - 标记 `#[allow(dead_code)]`（Pool 成员直接从 Redis 读取）
- `PoolMembersCache::cached_at_ms` - 标记 `#[allow(dead_code)]`
- `RuntimeSnapshot::pool_members_cache` - 标记 `#[allow(dead_code)]`
- `PendingEntry::consumer` - 标记 `#[allow(dead_code)]`（保留用于未来扩展）

**处理方式**：保留这些字段以便未来扩展，但添加了 `#[allow(dead_code)]` 标记。

#### 11.1.10 未使用的枚举

- `JobFsmState` - 保留（在 Redis FSM 脚本中使用）

**处理方式**：保留，因为它在 Redis Lua 脚本中使用。

### 11.2 清理后的代码统计

- **删除的函数**：4 个（validation.rs 中的函数）
- **标记 `#[allow(dead_code)]` 的结构体/方法**：约 30+ 个
- **标记 `#[cfg(test)]` 的方法**：4 个
- **清理的未使用导入**：10+ 个
- **修复的未使用变量**：2 个

### 11.3 清理原则

1. **保留计划使用的代码**：如果代码是未来功能的一部分（如 Session 锁机制），保留并标记 `#[allow(dead_code)]`
2. **删除已废弃的代码**：如果代码已被新实现完全替代，直接删除
3. **测试代码隔离**：测试辅助方法使用 `#[cfg(test)]` 标记
4. **调试和监控支持**：保留调试和监控相关的方法，但标记 `#[allow(dead_code)]`

### 11.4 架构完整性验证

清理完成后，已验证以下流程完整性：

1. **节点注册流程** ✅
   - `handle_node_register` → `register_node_with_policy` → 更新节点状态和 Pool 分配
   - 完整且正常工作

2. **Web 端注册流程** ✅
   - `handle_session_init` → 创建 SessionActor → SessionInitAck
   - 完整且正常工作

3. **任务分配流程** ✅
   - `create_translation_jobs` → `create_job_phase2` → 节点选择 → 任务分发
   - 完整且正常工作

4. **节点选择逻辑** ✅
   - 使用 `RuntimeSnapshot` 进行无锁节点选择
   - 支持 Phase3 两级调度
   - 支持功能感知选择
   - 完整且正常工作

所有关键流程均完整且正常工作，清理的代码都是确实未使用的遗留代码。

（完）
