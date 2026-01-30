# Job状态存储架构分析

**日期**: 2026-01-22  
**问题**: 为什么任务管理里还有锁？  
**状态**: 🔍 架构不一致性问题

---

## 一、问题描述

用户提问：**"为什么任务管理里还有锁呢？"**

根据架构文档，Scheduler采用**Redis直查（SSOT）**架构：
- Redis是唯一真相源（Single Source of Truth）
- 所有状态存储在Redis
- 无本地锁和状态

但实际代码中，**Job状态存储在本地HashMap中，使用RwLock保护**：

```rust
// core/dispatcher/dispatcher.rs
pub struct JobDispatcher {
    pub jobs: Arc<RwLock<HashMap<String, Job>>>,  // ⚠️ 本地锁
    // ...
}
```

**这是否与SSOT架构冲突？**

---

## 二、当前实现分析

### 2.1 Job状态存储位置

| 存储位置 | 数据类型 | 用途 | 是否SSOT |
|---------|---------|------|---------|
| **本地HashMap** | `RwLock<HashMap<JobId, Job>>` | Job完整状态（status, audio_data等） | ❌ **否** |
| **Redis** | `lingua:v1:job:{job_id}:node` | Job绑定的节点（timeout finalize） | ✅ 是（仅绑定信息） |
| **Phase2 Redis** | `lingua:v1:job:{job_id}:fsm` | Job FSM状态（多实例） | ✅ 是（仅FSM） |

### 2.2 锁的使用场景

| 操作 | 锁类型 | 原因 | 是否必要 |
|------|--------|------|---------|
| 创建Job | 写锁 | 插入HashMap | ⚠️ 如果Job在Redis，不需要 |
| 查询Job | 读锁 | 读取HashMap | ⚠️ 如果Job在Redis，不需要 |
| 更新Job状态 | 写锁 | 更新HashMap | ⚠️ 如果Job在Redis，不需要 |
| 扫描Job（超时） | 读锁 | 遍历HashMap | ⚠️ 如果Job在Redis，不需要 |

### 2.3 架构不一致性

**问题1: Job状态不在Redis中**

```rust
// 当前实现
state.dispatcher.jobs.write().await.insert(job_id, job);  // 本地HashMap

// 如果遵循SSOT，应该是：
// redis.hset("lingua:v1:job:{job_id}", ...).await;  // Redis
```

**问题2: 多实例部署时Job状态不同步**

- 实例A创建Job → 存储在实例A的本地HashMap
- 实例B无法看到实例A的Job状态
- 如果实例A重启，Job状态丢失

**问题3: 与架构文档不一致**

架构文档说：
> "本地状态仅用于WebSocket路由和临时缓存，不是SSOT"

但实际上：
- Job状态是**核心业务状态**，不是"临时缓存"
- Job状态用于任务分发、超时检查、结果处理等关键流程

---

## 三、为什么需要本地锁？

### 3.1 当前设计的原因（推测）

1. **性能考虑**
   - 本地HashMap查询：O(1)，无网络延迟
   - Redis查询：需要网络往返，延迟较高

2. **音频数据存储**
   - Job包含`audio_data: Vec<u8>`（可能很大，几MB）
   - 存储在Redis会占用大量内存和带宽
   - 本地存储更高效

3. **临时性**
   - Job生命周期短（通常<1分钟）
   - 完成后会被清理
   - 不需要持久化

### 3.2 但存在的问题

1. **多实例部署问题**
   - 如果启用Phase2多实例，Job状态无法跨实例共享
   - 实例A创建的Job，实例B无法查询

2. **Scheduler重启问题**
   - Scheduler重启后，所有Job状态丢失
   - 正在执行的任务无法恢复

3. **架构不一致**
   - 与"Redis SSOT"原则冲突
   - 节点状态在Redis，但Job状态在本地

---

## 四、解决方案

### 4.1 方案A: 完全迁移到Redis（推荐）

**优点**:
- ✅ 符合SSOT架构原则
- ✅ 支持多实例部署
- ✅ Scheduler重启后Job状态可恢复
- ✅ 无本地锁，代码更简洁

**缺点**:
- ⚠️ 音频数据存储在Redis会占用大量内存
- ⚠️ 每次查询需要网络往返（但可以通过Lua脚本优化）

**实现**:
```rust
// 创建Job
redis.hset(
    format!("lingua:v1:job:{}", job_id),
    [
        ("status", "Assigned"),
        ("session_id", session_id),
        ("src_lang", src_lang),
        ("tgt_lang", tgt_lang),
        // audio_data 可以单独存储或压缩
    ]
).await?;

// 查询Job
let job: Job = redis.hgetall(format!("lingua:v1:job:{}", job_id)).await?;
```

### 4.2 方案B: 混合存储（当前方案的改进）

**设计**:
- **Job元数据**（status, session_id等）→ Redis（SSOT）
- **Job音频数据** → 本地HashMap（临时缓存）
- **Job绑定信息** → Redis（已实现）

**优点**:
- ✅ 元数据在Redis，支持多实例
- ✅ 音频数据本地存储，性能好
- ✅ 部分符合SSOT原则

**缺点**:
- ⚠️ 仍需要本地锁（保护音频数据）
- ⚠️ 架构仍不完全一致

**实现**:
```rust
// Job元数据在Redis
redis.hset(format!("lingua:v1:job:{}", job_id), metadata).await?;

// 音频数据在本地（带锁）
audio_cache.write().await.insert(job_id, audio_data);
```

### 4.3 方案C: 保持现状（不推荐）

**理由**:
- 如果只部署单实例，当前方案可以工作
- 但不符合SSOT架构原则
- 未来扩展性差

---

## 五、推荐方案

### 5.1 短期方案（最小改动）

**保持当前实现，但明确说明**:
- Job状态是**临时缓存**，不是SSOT
- 仅用于单实例部署
- 多实例部署时，Job状态不共享（这是设计限制）

**更新架构文档**:
```markdown
### 6.2 本地状态（临时缓存）

**Job状态（临时）**:
- 存储在本地HashMap（带锁）
- **不是SSOT**，仅用于单实例部署
- Scheduler重启后丢失
- 多实例部署时，Job状态不共享
```

### 5.2 长期方案（架构统一）

**迁移Job状态到Redis**:
1. 将Job元数据存储在Redis
2. 音频数据可以：
   - 选项1: 存储在Redis（简单，但占用内存）
   - 选项2: 存储在本地，但Job元数据在Redis（混合）
   - 选项3: 不存储音频数据，直接从Session获取（推荐）

**推荐选项3**:
- 音频数据在Session中已有
- Job创建时不需要复制音频数据
- Job只需要引用session_id和utterance_index

---

## 六、当前锁的必要性

### 6.1 如果保持现状

**锁是必要的**，因为：
- 多个任务可能同时访问同一个Job
- 需要保证并发安全
- HashMap不是线程安全的

### 6.2 如果迁移到Redis

**锁不再必要**，因为：
- Redis操作是原子的
- 可以通过Lua脚本保证原子性
- 但需要处理网络延迟

---

## 七、结论

### 7.1 当前问题

1. ✅ **锁是必要的**（保护本地HashMap）
2. ⚠️ **但架构不一致**（Job状态不在Redis）
3. ⚠️ **多实例部署受限**（Job状态不共享）

### 7.2 建议

**短期**:
- 保持现状，但更新文档说明这是设计限制
- 明确Job状态是临时缓存，不是SSOT

**长期**:
- 考虑将Job元数据迁移到Redis
- 音频数据可以保持在本地或直接从Session获取
- 实现真正的SSOT架构

---

**文档版本**: v1.0  
**最后更新**: 2026-01-22  
**状态**: 归档文档（历史记录）
