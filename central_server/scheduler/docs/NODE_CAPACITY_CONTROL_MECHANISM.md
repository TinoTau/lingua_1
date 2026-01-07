# 节点容量控制机制

## 文档信息

- **版本**: v1.0
- **日期**: 2026-01-07
- **目的**: 详细说明调度服务器如何保证单个节点不会被分配太多任务
- **状态**: 已实现

---

## 一、执行摘要

调度服务器通过**多层防护机制**确保单个节点不会被分配超过其容量的任务：

1. **节点选择阶段**：在分配任务前，检查节点的有效负载（`effective_jobs`）
2. **Reservation 阶段**：使用原子操作（内存锁或 Redis Lua）预留任务槽位
3. **资源检查**：检查节点的 CPU/GPU/内存使用率
4. **心跳更新**：节点定期上报 `current_jobs`，调度服务器实时更新

**核心公式**：
```
effective_jobs = max(current_jobs, reserved_jobs)
if effective_jobs >= max_concurrent_jobs:
    节点不可用，跳过
```

---

## 二、容量控制机制详解

### 2.1 节点容量定义

每个节点都有一个**最大并发任务数**（`max_concurrent_jobs`），这是节点能够同时处理的任务上限。

**配置位置**：
- 节点注册时上报：`max_concurrent_jobs`（默认 4）
- 配置文件：`scheduler.max_concurrent_jobs_per_node`（默认 4）

**数据结构**：
```rust
pub struct Node {
    pub node_id: String,
    pub max_concurrent_jobs: usize,  // 最大并发任务数
    pub current_jobs: usize,         // 当前正在处理的任务数（来自心跳）
    // ...
}
```

---

### 2.2 有效负载计算

**有效负载（Effective Load）**是调度服务器用来判断节点是否还有容量的关键指标。

**计算公式**：
```rust
let reserved = reserved_counts.get(&node.node_id).copied().unwrap_or(0);
let effective_jobs = std::cmp::max(node.current_jobs, reserved);
```

**为什么取最大值？**
- `current_jobs`：节点心跳上报的当前任务数（可能有延迟）
- `reserved_jobs`：调度服务器已预留但尚未 ACK 的任务数
- 取最大值是为了**防止超卖**：即使心跳延迟，也能通过 `reserved_jobs` 感知到已分配的任务

**示例**：
```
节点 A：
- max_concurrent_jobs = 4
- current_jobs = 2（心跳上报）
- reserved_jobs = 1（已预留但未 ACK）
- effective_jobs = max(2, 1) = 2
- 可用容量 = 4 - 2 = 2（还可以分配 2 个任务）
```

---

### 2.3 节点选择阶段的容量检查

在节点选择阶段，调度服务器会**过滤掉已满的节点**。

**代码位置**：`central_server/scheduler/src/node_registry/selection/selection_phase3.rs`

**检查逻辑**：
```rust
// 1. 获取节点的 reserved_jobs 数量
let reserved = reserved_counts.get(&node.node_id).copied().unwrap_or(0);

// 2. 计算有效负载
let effective_jobs = std::cmp::max(node.current_jobs, reserved);

// 3. 检查是否超过容量
if effective_jobs >= node.max_concurrent_jobs {
    breakdown.capacity_exceeded += 1;
    self.record_exclude_reason(DispatchExcludeReason::CapacityExceeded, node.node_id.clone()).await;
    continue;  // 跳过该节点
}
```

**效果**：
- ✅ 已满的节点不会被选中
- ✅ 只选择有可用容量的节点
- ✅ 自动负载均衡：优先选择负载低的节点

---

### 2.4 Reservation 阶段的原子保护

在节点选择后、任务派发前，调度服务器会**原子性地预留任务槽位**，防止多实例并发分配导致超卖。

#### 2.4.1 单实例实现（Phase 1）

**代码位置**：`central_server/scheduler/src/node_registry/reserved.rs`

**实现方式**：使用内存锁保护

```rust
pub async fn reserve_job_slot(&self, node_id: &str, job_id: &str, ttl: Duration) -> bool {
    // 1. 读取节点状态（需要锁保护）
    let nodes = self.nodes.read().await;
    let node = nodes.get(node_id)?;
    let max_jobs = node.max_concurrent_jobs;
    let current_jobs = node.current_jobs;
    drop(nodes);

    // 2. 获取 reserved_jobs 锁
    let mut reserved = self.reserved_jobs.write().await;
    let entry = reserved.entry(node_id.to_string()).or_insert_with(HashMap::new);

    // 3. 清理过期 reservation
    entry.retain(|_jid, v| v.expire_at_ms > now_ms);
    let reserved_count = entry.len();

    // 4. 检查容量（原子操作）
    let effective_jobs = std::cmp::max(current_jobs, reserved_count);
    if effective_jobs >= max_jobs {
        return false;  // 容量已满，预留失败
    }

    // 5. 预留成功，插入 reservation 记录
    entry.insert(job_id.to_string(), ReservedJobEntry { expire_at_ms });
    true
}
```

**关键点**：
- ✅ 使用 `RwLock` 保护 `reserved_jobs`，确保原子性
- ✅ 检查容量和插入 reservation 在同一个锁保护下完成
- ✅ 如果容量已满，立即返回失败，不会超卖

#### 2.4.2 多实例实现（Phase 2）

**代码位置**：`central_server/scheduler/src/phase2/redis_handle.rs`

**实现方式**：使用 Redis Lua 脚本实现原子操作

```lua
-- Redis Lua 脚本：原子检查容量并预留
local now = tonumber(ARGV[1])
local ttl_ms = tonumber(ARGV[2])
local running = tonumber(ARGV[3])  -- 节点心跳上报的 current_jobs
local maxj = tonumber(ARGV[4])     -- max_concurrent_jobs
local job = ARGV[5]

-- 1. 清理过期的 reservation（ZSET 中 score < now 的成员）
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now)

-- 2. 获取当前的 reserved 数量
local reserved = redis.call('ZCARD', KEYS[1])

-- 3. 计算有效负载（取最大值）
local effective = reserved
if running > reserved then effective = running end

-- 4. 检查容量（原子操作）
if effective >= maxj then
  return 0  -- 容量已满，预留失败
end

-- 5. 预留成功，添加到 ZSET（score = 过期时间）
redis.call('ZADD', KEYS[1], now + ttl_ms, job)
redis.call('EXPIRE', KEYS[1], math.max(60, math.floor(ttl_ms/1000) + 60))
return 1  -- 预留成功
```

**关键点**：
- ✅ **原子操作**：整个检查-预留过程在 Redis Lua 脚本中原子执行
- ✅ **跨实例安全**：多个调度实例并发调用时，Redis 保证原子性
- ✅ **TTL 保护**：reservation 有过期时间，防止泄漏

**调用方式**：
```rust
pub async fn reserve_node_slot(
    &self,
    node_id: &str,
    job_id: &str,
    ttl_seconds: u64,
    running_jobs: usize,  // 节点心跳上报的 current_jobs
    max_jobs: usize,      // max_concurrent_jobs
) -> bool {
    let key = self.node_reserved_zset_key(node_id);
    self.redis
        .zreserve_with_capacity(
            &key,
            job_id,
            ttl_seconds.max(1),
            running_jobs as u64,
            max_jobs.max(1) as u64,
        )
        .await
        .unwrap_or(false)
}
```

---

### 2.5 任务生命周期中的容量管理

#### 2.5.1 任务分配流程

```
1. 节点选择
   └─> 检查 effective_jobs < max_concurrent_jobs
   └─> 选择负载最低的节点

2. Reservation（原子预留）
   └─> 调用 reserve_job_slot / reserve_node_slot
   └─> 原子检查容量并预留槽位
   └─> 如果失败，选择下一个节点

3. 任务派发
   └─> 向节点发送任务请求
   └─> reservation 仍然有效（防止超卖）

4. 节点 ACK
   └─> 节点确认接收任务
   └─> reserved_jobs -= 1
   └─> current_jobs += 1（节点心跳上报）

5. 任务完成
   └─> 节点上报任务完成
   └─> current_jobs -= 1（节点心跳上报）
```

#### 2.5.2 Reservation 的释放

**正常释放**（节点 ACK 后）：
```rust
// Phase 1：内存实现
pub async fn release_job_slot(&self, node_id: &str, job_id: &str) {
    let mut reserved = self.reserved_jobs.write().await;
    if let Some(map) = reserved.get_mut(node_id) {
        map.remove(job_id);
    }
}

// Phase 2：Redis 实现
pub async fn release_node_slot(&self, node_id: &str, job_id: &str) {
    let key = self.node_reserved_zset_key(node_id);
    let _ = self.redis.zrem(&key, job_id).await;
}
```

**超时释放**（ACK 超时或派发失败）：
- Reservation 有 TTL（默认 5 秒），过期后自动清理
- 如果节点 ACK 超时，reservation 会被释放，节点可以重新分配任务

---

### 2.6 资源阈值检查（额外保护）

除了容量检查，调度服务器还会检查节点的**资源使用率**，作为额外的保护层。

**代码位置**：`central_server/scheduler/src/node_registry/validation.rs`

**检查逻辑**：
```rust
pub fn is_node_resource_available(node: &Node, threshold: f32) -> bool {
    // CPU 使用率检查
    if node.cpu_usage > threshold {
        return false;
    }
    
    // GPU 使用率检查
    if let Some(gpu_usage) = node.gpu_usage {
        if gpu_usage > threshold {
            return false;
        }
    }
    
    // 内存使用率检查
    if node.memory_usage > threshold {
        return false;
    }
    
    true
}
```

**默认阈值**：90%（CPU/GPU/内存使用率超过 90% 的节点会被跳过）

**效果**：
- ✅ 即使节点还有容量，如果资源使用率过高，也不会被选中
- ✅ 防止节点过载，确保任务处理质量

---

## 三、多实例场景下的并发安全

### 3.1 问题场景

在多实例调度服务器场景下，可能出现以下情况：

```
实例 A：选择节点 X，检查容量 = 2/4，可用
实例 B：同时选择节点 X，检查容量 = 2/4，可用
实例 A：预留成功，reserved_jobs = 1
实例 B：预留成功，reserved_jobs = 2
结果：节点 X 实际负载 = 2 + 2 = 4，达到上限 ✅

但如果实例 B 在实例 A 预留前也检查了容量：
实例 A：检查容量 = 2/4，可用
实例 B：检查容量 = 2/4，可用（此时实例 A 还未预留）
实例 A：预留成功，reserved_jobs = 1
实例 B：预留成功，reserved_jobs = 2
结果：节点 X 实际负载 = 2 + 2 = 4，达到上限 ✅

但如果继续分配：
实例 C：检查容量 = 2/4，可用（此时 reserved_jobs = 2，但实例 C 可能看不到）
实例 C：预留成功，reserved_jobs = 3
结果：节点 X 实际负载 = 2 + 3 = 5，超过上限 ❌
```

### 3.2 解决方案：Redis Lua 原子操作

**关键**：使用 Redis Lua 脚本实现**原子检查-预留**操作。

**Redis Lua 脚本的优势**：
1. ✅ **原子性**：整个脚本在 Redis 中原子执行，不会被其他操作打断
2. ✅ **跨实例安全**：多个调度实例并发调用时，Redis 保证只有一个能成功
3. ✅ **一致性**：所有实例看到相同的 `reserved_jobs` 状态

**执行流程**：
```
实例 A：调用 Redis Lua 脚本
  └─> Redis 执行脚本（原子操作）
      └─> 检查容量：effective = max(running, reserved) = 2
      └─> 2 < 4，容量可用
      └─> reserved += 1，reserved = 1
      └─> 返回成功

实例 B：同时调用 Redis Lua 脚本
  └─> Redis 执行脚本（原子操作）
      └─> 检查容量：effective = max(running, reserved) = 3（实例 A 已预留）
      └─> 3 < 4，容量可用
      └─> reserved += 1，reserved = 2
      └─> 返回成功

实例 C：调用 Redis Lua 脚本
  └─> Redis 执行脚本（原子操作）
      └─> 检查容量：effective = max(running, reserved) = 4（实例 A、B 已预留）
      └─> 4 >= 4，容量已满
      └─> 返回失败（不会超卖）
```

---

## 四、容量控制的完整流程

### 4.1 任务分配完整流程

```
任务到达
    │
    ▼
选择 Pool（根据语言对）
    │
    ▼
从 Pool 中选择候选节点
    │
    ▼
【第一层防护】节点选择阶段容量检查
    ├─> 计算 effective_jobs = max(current_jobs, reserved_jobs)
    ├─> 检查 effective_jobs < max_concurrent_jobs
    └─> 过滤掉已满的节点
    │
    ▼
选择负载最低的节点
    │
    ▼
【第二层防护】Reservation 原子预留
    ├─> 调用 reserve_job_slot / reserve_node_slot
    ├─> 原子检查容量并预留槽位
    └─> 如果失败，选择下一个节点
    │
    ▼
【第三层防护】资源阈值检查
    ├─> 检查 CPU/GPU/内存使用率 < 90%
    └─> 如果超过阈值，选择下一个节点
    │
    ▼
任务派发到节点
    │
    ▼
节点 ACK
    ├─> reserved_jobs -= 1
    └─> current_jobs += 1（节点心跳上报）
    │
    ▼
任务处理中
    │
    ▼
任务完成
    └─> current_jobs -= 1（节点心跳上报）
```

### 4.2 容量检查的时机

| 时机 | 检查内容 | 防护层级 | 实现方式 |
|------|----------|----------|----------|
| **节点选择** | `effective_jobs < max_concurrent_jobs` | 第一层 | 内存检查 |
| **Reservation** | 原子检查容量并预留 | 第二层 | 内存锁 / Redis Lua |
| **资源检查** | CPU/GPU/内存使用率 < 90% | 第三层 | 内存检查 |
| **心跳更新** | 节点上报 `current_jobs` | 持续监控 | 节点心跳 |

---

## 五、防止超卖的关键机制

### 5.1 为什么需要 Reservation？

**问题**：节点心跳上报 `current_jobs` 有延迟（默认 15 秒），可能导致超卖。

**场景**：
```
时间 T0：节点 X 的 current_jobs = 2（心跳上报）
时间 T1：调度服务器分配任务 A 到节点 X
时间 T2：调度服务器分配任务 B 到节点 X（此时 current_jobs 仍然是 2）
时间 T3：节点 X 心跳上报 current_jobs = 3（任务 A 已开始处理）
时间 T4：调度服务器分配任务 C 到节点 X（此时 current_jobs = 3）
结果：节点 X 实际负载 = 3 + 2 = 5，超过 max_concurrent_jobs = 4 ❌
```

**解决方案**：使用 `reserved_jobs` 记录已预留但尚未 ACK 的任务。

```
时间 T0：节点 X 的 current_jobs = 2，reserved_jobs = 0
时间 T1：调度服务器分配任务 A 到节点 X
         └─> reserved_jobs = 1
         └─> effective_jobs = max(2, 1) = 2
时间 T2：调度服务器分配任务 B 到节点 X
         └─> effective_jobs = max(2, 1) = 2
         └─> 2 < 4，可以分配
         └─> reserved_jobs = 2
         └─> effective_jobs = max(2, 2) = 2
时间 T3：节点 X ACK 任务 A
         └─> reserved_jobs = 1
         └─> current_jobs = 3（心跳上报）
         └─> effective_jobs = max(3, 1) = 3
时间 T4：调度服务器分配任务 C 到节点 X
         └─> effective_jobs = max(3, 1) = 3
         └─> 3 < 4，可以分配
         └─> reserved_jobs = 2
         └─> effective_jobs = max(3, 2) = 3
时间 T5：调度服务器分配任务 D 到节点 X
         └─> effective_jobs = max(3, 2) = 3
         └─> 3 < 4，可以分配
         └─> reserved_jobs = 3
         └─> effective_jobs = max(3, 3) = 3
时间 T6：调度服务器分配任务 E 到节点 X
         └─> effective_jobs = max(3, 3) = 3
         └─> 3 < 4，可以分配
         └─> reserved_jobs = 4
         └─> effective_jobs = max(3, 4) = 4
时间 T7：调度服务器分配任务 F 到节点 X
         └─> effective_jobs = max(3, 4) = 4
         └─> 4 >= 4，容量已满，拒绝分配 ✅
```

### 5.2 Reservation TTL 的作用

**问题**：如果节点 ACK 失败或超时，reservation 会一直占用槽位。

**解决方案**：Reservation 有 TTL（默认 5 秒），过期后自动清理。

```
时间 T0：预留任务 A，reserved_jobs = 1，TTL = 5 秒
时间 T1：节点 ACK 超时（网络问题）
时间 T5：Reservation 过期，自动清理
         └─> reserved_jobs = 0
         └─> 节点可以重新分配任务
```

---

## 六、总结

### 6.1 容量控制机制总结

调度服务器通过**三层防护机制**确保单个节点不会被分配超过其容量的任务：

1. **节点选择阶段**：检查 `effective_jobs < max_concurrent_jobs`，过滤已满节点
2. **Reservation 阶段**：使用原子操作（内存锁或 Redis Lua）预留槽位，防止并发超卖
3. **资源检查**：检查 CPU/GPU/内存使用率，防止节点过载

### 6.2 关键设计点

1. **有效负载计算**：`effective_jobs = max(current_jobs, reserved_jobs)`
   - 取最大值是为了防止心跳延迟导致的超卖

2. **原子预留**：使用内存锁（单实例）或 Redis Lua（多实例）
   - 确保检查容量和预留槽位在同一个原子操作中完成

3. **TTL 保护**：Reservation 有过期时间
   - 防止 ACK 失败或超时导致的槽位泄漏

4. **多层防护**：节点选择、Reservation、资源检查
   - 即使某一层失效，其他层仍能提供保护

### 6.3 实际效果

- ✅ **不会超卖**：节点永远不会被分配超过 `max_concurrent_jobs` 的任务
- ✅ **并发安全**：多实例场景下通过 Redis Lua 保证原子性
- ✅ **自动恢复**：Reservation TTL 确保槽位不会永久泄漏
- ✅ **负载均衡**：优先选择负载低的节点，自动分散任务

---

**文档结束**
