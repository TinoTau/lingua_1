# GROUP_MANAGER_LOCK_REFACTOR_v1.md  
（GroupManager 锁粒度优化与阻塞问题修复方案）

> **状态**: ✅ 已完成实现（2026-01-08）  
> 目标：在不改变对上层业务语义的前提下，**消除 GroupManager 写锁长时间阻塞**，避免任务在调度服务器上堆积；同时为后续并发扩展留出空间。

---

## 1. 问题背景与现状

### 1.1 当前设计（简化抽象）

```rust
pub struct GroupManager {
    cfg: GroupConfig,
    active: Arc<RwLock<HashMap<SessionId, GroupId>>>,
    groups: Arc<RwLock<HashMap<GroupId, UtteranceGroup>>>,
}
```

典型调用路径包括：

- `ensure_target_group(session_id, ...)`  
  - 需要访问或创建 `UtteranceGroup`，会获取 `groups.write()`（或 `read()` + `write()`）
- `on_session_end(session_id, reason)`  
  - 为了清理 session 相关的所有 group，通常会：
    - 获取 `groups.write()`（或 `read()` + `write()`）
    - 对 `HashMap<GroupId, UtteranceGroup>` 做遍历与 retain/remove

### 1.2 阻塞症状

在高并发/多 session 的情况下：

- `on_session_end` 对 `groups` 做 **全量遍历 + 过滤**，持有 `write()` 时间过长。
- 期间所有需要 `groups.write()` 的操作（包括新建 group、更新 group）全部阻塞。
- 最终表现为：  
  - 翻译任务在调度服务器内部堆积，延迟迅速上升到数秒甚至十几秒。  
  - CPU 占用偏高，线程挂在 `RwLock::write()` 等待上。

本方案的核心就是：**缩短写锁时间 + 降低写锁调用频率**。

---

## 2. 改造目标

1. **不改变对外行为语义**：  
   - session 结束时，仍然要清理完相关的 group / active 记录。  
2. **写锁仅用于“小范围、短时间”的 Map 更新**：  
   - 所有涉及遍历 / 查找的逻辑尽量在读锁或锁外完成。  
3. **为后续扩展预留索引结构**：  
   - 能够快速按 `session_id` 找到关联的 `GroupId` 集合，而不是每次全表扫描。

---

## 3. 新数据结构设计

在原有基础上，新增一个 `session_groups` 索引：

```rust
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct GroupManager {
    cfg: GroupConfig,

    /// session 当前活跃的主 group（若有）
    active: Arc<RwLock<HashMap<SessionId, GroupId>>>,

    /// 所有 group 的详细信息
    groups: Arc<RwLock<HashMap<GroupId, UtteranceGroup>>>,

    /// 新增：按照 session 维度索引所有关联的 group
    /// session_id -> { group_id_1, group_id_2, ... }
    session_groups: Arc<RwLock<HashMap<SessionId, HashSet<GroupId>>>>,
}
```

### 3.1 设计说明

- `groups` 仍然是所有 `GroupId -> UtteranceGroup` 的主存储。
- `session_groups` 是一个轻量索引，用来快速定位“某个 session 相关的所有 group_id”，避免在 `on_session_end` 里对整个 `groups` 做全表扫描。
- `active` 保持原语义（如果已有）。

### 3.2 约束

- 任意时刻，`groups` 和 `session_groups` 的变更必须保持一致（只要涉及创建/删除 group，都同时更新两边）。
- 不允许在锁外修改 `HashMap` / `HashSet` 内部结构。

---

## 4. 锁使用规范（新方案）

### 4.1 总体原则

- 读多写少场景：  
  - 使用 `RwLock` 的 `read()` 进行并发读取。  
  - 使用 `write()` 进行短时间的结构性写入（insert/remove）。
- **禁止** 在 `write()` 范围内做：
  - 长时间遍历大量元素（O(N) 的 retain/filter）；
  - 任何异步 I/O 操作；
  - 重计算。

### 4.2 推荐模式：两段式（读锁 + 写锁）

典型模式示例：

```rust
// 1）在读锁中收集需要处理的 key 列表
let ids_to_remove: Vec<GroupId> = {
    let groups = self.groups.read().await;
    groups
        .iter()
        .filter(|(_, g)| g.session_id == session_id)
        .map(|(gid, _)| gid.clone())
        .collect()
};

// 2）在写锁中执行“数据结构更新”，操作次数与 ids_to_remove 长度成正比
{
    let mut groups = self.groups.write().await;
    for gid in &ids_to_remove {
        groups.remove(gid);
    }
}
```

> 注意：  
> - 第一段持有的是 **读锁**，可以与其他读者并发。  
> - 第二段写锁中只做少量 `remove`，不会长时间阻塞。

---

## 5. 关键路径改造

### 5.1 `ensure_target_group`（或同类函数）

原逻辑（伪代码）类似：

```rust
pub async fn ensure_target_group(&self, session_id: &SessionId, ...) -> GroupId {
    let mut groups = self.groups.write().await;
    // 在写锁里查找 / 创建 group
    if let Some(gid) = find_existing_group_locked(&mut groups, session_id, ...) {
        return gid;
    }

    // 创建新的 group
    let gid = GroupId::new();
    groups.insert(gid.clone(), UtteranceGroup::new(session_id.clone(), ...));
    gid
}
```

问题点：

- 对于“仅查找”的场景也会获取 `write()`，浪费。

改造方案：

```rust
pub async fn ensure_target_group(&self, session_id: &SessionId, ...) -> GroupId {
    // 1) 尝试在读锁里查找已有 group
    if let Some(gid) = {
        let groups = self.groups.read().await;
        find_existing_group_in_read(&groups, session_id, ...)
    } {
        return gid;
    }

    // 2) 未找到时，再获取写锁，二次检查（避免竞态）
    let mut groups = self.groups.write().await;

    if let Some(gid) = find_existing_group_in_write(&groups, session_id, ...) {
        return gid;
    }

    // 3) 确认不存在，创建新 group
    let gid = GroupId::new();
    let group = UtteranceGroup::new(session_id.clone(), ...);
    groups.insert(gid.clone(), group);

    // 4) 同步更新 session_groups
    {
        let mut sess_map = self.session_groups.write().await;
        sess_map
            .entry(session_id.clone())
            .or_insert_with(HashSet::new)
            .insert(gid.clone());
    }

    gid
}
```

### 5.2 `on_session_end` 改造（核心）

**原常见问题模式**（伪代码）：

```rust
pub async fn on_session_end(&self, session_id: &str, reason: &str) {
    let mut groups = self.groups.write().await;

    groups.retain(|gid, group| {
        if group.session_id == session_id {
            // 需要清理
            false
        } else {
            true
        }
    });

    // 可能还有其他在锁中执行的操作...
}
```

上述 `retain` 是对整个 `HashMap` 做一次 O(N) 遍历，持锁时间与全局 group 数量成正比。

**新方案**：

```rust
pub async fn on_session_end(&self, session_id: &SessionId, reason: &str) {
    // 1) 从 session_groups 中读出所有关联的 group_id 列表
    let group_ids_to_remove: Vec<GroupId> = {
        let sess_map = self.session_groups.read().await;
        match sess_map.get(session_id) {
            Some(set) => set.iter().cloned().collect(),
            None => Vec::new(),
        }
    };

    if group_ids_to_remove.is_empty() {
        // 无任何 group 需要处理，直接返回
        // 仍可以记录日志或 metrics
        return;
    }

    // 2) 在 groups 中删除这些 group_id
    {
        let mut groups = self.groups.write().await;
        for gid in &group_ids_to_remove {
            groups.remove(gid);
        }
    }

    // 3) 在 session_groups 中删除该 session 的记录
    {
        let mut sess_map = self.session_groups.write().await;
        sess_map.remove(session_id);
    }

    // 4) 可选：在 active 中删除该 session 的 active group
    {
        let mut active = self.active.write().await;
        active.remove(session_id);
    }

    // 5) 其他与 session 结束相关的逻辑放在锁外执行
    self.log_session_end(session_id, reason, group_ids_to_remove.len()).await;
}
```

改造后的特性：

- 不再需要遍历 `groups` 全表，复杂度降为 O(K)，K 为该 session 下 group 数。
- 写锁分别只包裹：
  - 对 `groups` 的若干次 `remove`；
  - 对 `session_groups` 的一次 `remove`；
  - 对 `active` 的一次 `remove`。
- 所有与日志、回调、通知相关的慢操作都移出锁外。

---

## 6. 辅助函数与一致性维护

### 6.1 创建 group 时写入 session_groups

建议封装一个内部工具函数，避免代码散落：

```rust
impl GroupManager {
    async fn insert_group(
        &self,
        session_id: SessionId,
        group_id: GroupId,
        group: UtteranceGroup,
    ) {
        {
            let mut groups = self.groups.write().await;
            groups.insert(group_id.clone(), group);
        }
        {
            let mut sess_map = self.session_groups.write().await;
            sess_map
                .entry(session_id.clone())
                .or_insert_with(HashSet::new)
                .insert(group_id);
        }
    }
}
```

再在 `ensure_target_group` 或其他创建逻辑中统一调用 `insert_group`。

### 6.2 删除 group 时保持索引一致

如果存在“单个 group 的删除逻辑”，同样建议封装：

```rust
impl GroupManager {
    async fn remove_group(&self, session_id: &SessionId, group_id: &GroupId) {
        {
            let mut groups = self.groups.write().await;
            groups.remove(group_id);
        }
        {
            let mut sess_map = self.session_groups.write().await;
            if let Some(set) = sess_map.get_mut(session_id) {
                set.remove(group_id);
                if set.is_empty() {
                    sess_map.remove(session_id);
                }
            }
        }
    }
}
```

保证任意删除都能维护 `groups` 与 `session_groups` 的一致性。

---

## 7. 异常场景与注意事项

### 7.1 并发 session_end 与新 group 创建

场景：

1. `on_session_end(session_x)` 已开始执行，读取了 `session_groups[session_x]`；
2. 另一个任务尝试为同一 `session_x` 创建新 group。

**处理策略**：

- 允许出现“session_end 之后仍然出现 group”吗？  
  - 一般不允许（session 已结束），可以在上层业务对 session 状态进行控制。  
- 技术层面上，可能的做法：
  - 在更高层对 `session_id` 做“结束标记”，新请求一律拒绝；
  - 或在 `ensure_target_group` 里检测 session 状态（已结束则返回错误）。

本方案不对 session 生命周期做决策，只保证在当前 session 生命周期管理策略下，锁使用是安全的。

### 7.2 长时间 session 不调用 session_end

- `session_groups` 会长期积累，可能导致内存增长。  
- 建议在更高层增加：
  - Session TTL（无活动若干时间后自动触发 `on_session_end`）；  
  - 或周期性后台任务扫描过期 session。

---

## 8. 与任务调度层的关系

本方案仅优化 **GroupManager 内部并发与锁竞争**，不涉及：

- 节点池（Pool）与节点选择策略；
- Redis 级别的 reservation（`try_reserve` / `commit`）；
- 任务的多实例调度。

但它有直接收益：

- 当翻译任务结果返回、需要更新 group / 合并输出 / 标记完成时，`GroupManager` 不会因为某个 session_end 的全表操作而长时间写锁阻塞。
- 对上层表现为：  
  - 任务结果写入延迟下降；  
  - 新任务创建时不会被 `groups.write()` 长时间卡死。

---

## 9. 开发任务拆分建议

1. **新增数据结构** ✅
   - 在 `GroupManager` 中增加 `session_groups: Arc<RwLock<HashMap<SessionId, HashSet<GroupId>>>>`。
   - 为 `SessionId` / `GroupId` 实现必要的 `Clone` / `Hash` / `Eq`。

2. **封装插入/删除操作** ✅
   - `insert_group(session_id, group_id, group)`  
   - `remove_group(session_id, group_id)`

3. **改造 ensure_target_group 等创建逻辑** ✅
   - 先读锁查找，未命中再写锁+创建；
   - 创建时统一走 `insert_group`。

4. **改造 on_session_end** ✅
   - 由 "`groups.retain` 全表扫描" 替换为 "`session_groups[session_id]` 定位 + 小范围删除"；
   - 所有慢操作（日志、外部通知）放在锁外。

5. **代码审查** ✅
   - 全文搜索 `groups.write()` 与 `session_groups.write()` 的使用点，确认均符合"短锁"原则；
   - 确认为对外接口行为保持不变。

---

## 10. 验收标准

1. 功能正确：✅
   - session 结束后，不再有该 session 的 group/active 记录；
   - 新 group 的创建与清理不影响业务语义。

2. 性能改善：✅
   - 压测场景下，`on_session_end` 调用不再引起明显的长时间 `RwLock::write()` 等待；
   - 翻译任务结果写入延迟显著下降（p95/p99）。

3. 并发安全：✅
   - 经 race 模拟测试（并发创建 group + 并发 session_end）后，无 panic / 死锁 / 数据结构不一致。

---

## 11. 实现总结

### 11.1 已完成的修改

- ✅ 添加 `session_groups` 索引字段
- ✅ 实现 `insert_group` 和 `remove_group` 辅助函数
- ✅ 改造 `create_new_group` 使用 `insert_group`
- ✅ 改造 `on_session_end` 使用索引避免全表扫描

### 11.2 关键优化

- **性能**: `on_session_end` 从 O(n) 全表扫描优化为 O(k) 索引查找（k 为该 session 的 group 数量）
- **锁竞争**: 写锁持有时间从数秒减少到毫秒级，消除长时间阻塞
- **一致性**: 通过 `insert_group` 和 `remove_group` 保证 `groups` 和 `session_groups` 的一致性

### 11.3 测试覆盖

- ✅ 基础功能测试（创建、更新、删除）
- ✅ 索引一致性测试
- ✅ 并发安全测试
- ✅ 性能测试（锁等待时间）

---

（完）
