# 节点管理和任务管理流程决策文档

## 文档信息

- **版本**: v2.0
- **日期**: 2026-01-11
- **状态**: ✅ 极简无锁调度服务已实现
- **目标受众**: 决策部门
- **参考规范**: `LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md`

---

## 一、架构概述

### 1.1 设计原则

本系统采用**极简无锁调度服务**（Minimal Lockless Scheduler）架构，核心原则：

1. **无锁设计**: 不依赖任何业务层面的 `Mutex`/`RwLock`
2. **状态集中**: 不维护本地全局状态，所有共享状态统一存入 Redis
3. **原子操作**: 所有并发控制统一通过 Redis 原子操作（Lua 脚本）完成
4. **简化流程**: 节点管理和任务管理流程精简，避免复杂的状态同步

### 1.2 核心组件

- **MinimalSchedulerService**: 极简无锁调度服务（Rust API）
- **Lua 脚本**: 4个核心 Lua 脚本，实现原子操作
  - `register_node.lua`: 节点注册
  - `heartbeat.lua`: 节点心跳
  - `dispatch_task.lua`: 任务调度
  - `complete_task.lua`: 任务完成

---

## 二、节点管理流程

### 2.1 节点注册流程

#### 2.1.1 流程图

```
节点连接 WebSocket
    ↓
收到 NodeMessage::Register
    ↓
websocket/node_handler/message/mod.rs::handle_message()
    ↓
websocket/node_handler/message/register.rs::handle_node_register() 【已废弃】
    ↓
【新实现】MinimalSchedulerService::register_node()
    ↓
执行 Lua 脚本: register_node.lua
    ↓
Redis 原子操作:
  - 写入节点信息 (scheduler:node:info:{node_id})
  - 初始化运行状态 (scheduler:node:runtime:{node_id})
  - 更新 Pool 成员 (scheduler:pool:{pool_id}:members)
  - 更新语言索引 (scheduler:lang:{src}:{tgt})
```

#### 2.1.2 方法调用链

| 序号 | 方法/脚本 | 位置 | 功能 | 状态 |
|------|----------|------|------|------|
| 1 | `websocket/node_handler/message/mod.rs::handle_message()` | `src/websocket/node_handler/message/mod.rs:42` | 处理 WebSocket 消息 | ✅ 正常 |
| 2 | `register::handle_node_register()` | `src/websocket/node_handler/message/register.rs:10` | 处理节点注册消息 | ⚠️ **已废弃**，待迁移 |
| 3 | `MinimalSchedulerService::register_node()` | `src/services/minimal_scheduler.rs:125` | 节点注册 API | ✅ **新实现** |
| 4 | `MinimalSchedulerService::eval_script()` | `src/services/minimal_scheduler.rs:100` | 执行 Lua 脚本 | ✅ 正常 |
| 5 | `register_node.lua` | `scripts/lua/register_node.lua` | 节点注册原子操作 | ✅ 正常 |

#### 2.1.3 详细说明

**入口点** (`src/websocket/node_handler/message/mod.rs:42`):
```rust
NodeMessage::Register { ... } => {
    register::handle_node_register(...).await?;
}
```

**旧实现** (`src/websocket/node_handler/message/register.rs:10`):
- ⚠️ **已废弃** - 使用 `register_node_with_policy`（涉及锁和本地状态）
- 临时返回 `Ok(())`，等待迁移到新实现

**新实现** (`src/services/minimal_scheduler.rs:125`):
```rust
pub async fn register_node(&self, req: RegisterNodeRequest) -> Result<()> {
    // 调用 Lua 脚本执行原子操作
    self.eval_script::<String>(
        &self.scripts.register_node,
        &[],
        &[&req.node_id, &req.cap_json, &req.max_jobs.to_string(), pools_json],
    ).await?;
    Ok(())
}
```

**Lua 脚本执行的操作** (`scripts/lua/register_node.lua`):
1. 写入节点信息到 `scheduler:node:info:{node_id}`
   - `online`: "true"
   - `cap_json`: 节点能力 JSON
   - `max_jobs`: 最大任务数
   - `last_heartbeat_ts`: 最后心跳时间戳
2. 初始化运行状态到 `scheduler:node:runtime:{node_id}`
   - `current_jobs`: "0"
3. 更新 Pool 成员（如果提供了 `pools_json`）
   - `SADD scheduler:pool:{pool_id}:members {node_id}`
4. 返回 `"OK"`

#### 2.1.4 迁移状态

- ✅ **新实现已完成**: `MinimalSchedulerService::register_node`
- ⚠️ **旧实现已废弃**: `handle_node_register` 已注释，返回 `Ok(())`
- 🔄 **待迁移**: WebSocket 消息处理器需要调用新实现

---

### 2.2 节点心跳流程

#### 2.2.1 流程图

```
节点定期发送心跳
    ↓
收到 NodeMessage::Heartbeat
    ↓
websocket/node_handler/message/mod.rs::handle_message()
    ↓
websocket/node_handler/message/register.rs::handle_node_heartbeat() 【已废弃】
    ↓
【新实现】MinimalSchedulerService::heartbeat()
    ↓
执行 Lua 脚本: heartbeat.lua
    ↓
Redis 原子操作:
  - 更新节点状态 (scheduler:node:info:{node_id})
  - 更新心跳时间戳
  - 更新负载信息（可选）
```

#### 2.2.2 方法调用链

| 序号 | 方法/脚本 | 位置 | 功能 | 状态 |
|------|----------|------|------|------|
| 1 | `websocket/node_handler/message/mod.rs::handle_message()` | `src/websocket/node_handler/message/mod.rs:73` | 处理 WebSocket 消息 | ✅ 正常 |
| 2 | `register::handle_node_heartbeat()` | `src/websocket/node_handler/message/register.rs:55` | 处理节点心跳消息 | ⚠️ **已废弃**，待迁移 |
| 3 | `MinimalSchedulerService::heartbeat()` | `src/services/minimal_scheduler.rs:155` | 节点心跳 API | ✅ **新实现** |
| 4 | `MinimalSchedulerService::eval_script()` | `src/services/minimal_scheduler.rs:100` | 执行 Lua 脚本 | ✅ 正常 |
| 5 | `heartbeat.lua` | `scripts/lua/heartbeat.lua` | 节点心跳原子操作 | ✅ 正常 |

#### 2.2.3 详细说明

**入口点** (`src/websocket/node_handler/message/mod.rs:73`):
```rust
NodeMessage::Heartbeat { ... } => {
    register::handle_node_heartbeat(...).await;
}
```

**旧实现** (`src/websocket/node_handler/message/register.rs:55`):
- ⚠️ **已废弃** - 使用 `update_node_heartbeat`（涉及锁和本地状态）
- 临时返回，等待迁移到新实现

**新实现** (`src/services/minimal_scheduler.rs:155`):
```rust
pub async fn heartbeat(&self, req: HeartbeatRequest) -> Result<()> {
    // 调用 Lua 脚本执行原子操作
    self.eval_script::<String>(
        &self.scripts.heartbeat,
        &[],
        &[&req.node_id, online_str, load_json],
    ).await?;
    Ok(())
}
```

**Lua 脚本执行的操作** (`scripts/lua/heartbeat.lua`):
1. 更新节点状态到 `scheduler:node:info:{node_id}`
   - `online`: "true" / "false"
   - `last_heartbeat_ts`: 当前时间戳
   - `load_json`: 负载信息 JSON（可选）
2. 返回 `"OK"`

#### 2.2.4 迁移状态

- ✅ **新实现已完成**: `MinimalSchedulerService::heartbeat`
- ⚠️ **旧实现已废弃**: `handle_node_heartbeat` 已注释
- 🔄 **待迁移**: WebSocket 消息处理器需要调用新实现

---

## 三、任务管理流程

### 3.1 任务调度流程

#### 3.1.1 流程图

```
SessionActor 收到音频块
    ↓
检查是否需要 finalize (pause/timeout/is_final)
    ↓
SessionActor::try_finalize()
    ↓
SessionActor::do_finalize()
    ↓
websocket/job_creator.rs::create_translation_jobs()
    ↓
JobDispatcher::create_job() 【已废弃】
    ↓
【新实现】MinimalSchedulerService::dispatch_task()
    ↓
执行 Lua 脚本: dispatch_task.lua
    ↓
Redis 原子操作:
  - 读取会话绑定 (scheduler:session:{session_id})
  - 根据语言对选择 Pool (scheduler:lang:{src}:{tgt})
  - 从 Pool 选择可用节点 (scheduler:pool:{pool_id}:members)
  - 占用节点并发槽 (scheduler:node:runtime:{node_id})
  - 创建任务记录 (scheduler:job:{job_id})
```

#### 3.1.2 方法调用链

| 序号 | 方法/脚本 | 位置 | 功能 | 状态 |
|------|----------|------|------|------|
| 1 | `SessionActor::handle_audio_chunk()` | `src/websocket/session_actor/actor/actor_event_handling.rs:25` | 处理音频块 | ✅ 正常 |
| 2 | `SessionActor::try_finalize()` | `src/websocket/session_actor/actor/actor_finalize.rs:11` | 尝试 finalize | ✅ 正常 |
| 3 | `SessionActor::do_finalize()` | `src/websocket/session_actor/actor/actor_finalize.rs:85` | 执行 finalize | ✅ 正常 |
| 4 | `create_translation_jobs()` | `src/websocket/job_creator.rs:10` | 创建翻译任务 | ✅ 正常 |
| 5 | `JobDispatcher::create_job()` | `src/core/dispatcher/job_creation.rs:17` | 创建任务 | ⚠️ **已废弃**，待迁移 |
| 6 | `MinimalSchedulerService::dispatch_task()` | `src/services/minimal_scheduler.rs:180` | 任务调度 API | ✅ **新实现** |
| 7 | `MinimalSchedulerService::eval_script()` | `src/services/minimal_scheduler.rs:100` | 执行 Lua 脚本 | ✅ 正常 |
| 8 | `dispatch_task.lua` | `scripts/lua/dispatch_task.lua` | 任务调度原子操作 | ✅ 正常 |

#### 3.1.3 详细说明

**入口点** (`src/websocket/session_actor/actor/actor_event_handling.rs:25`):
```rust
pub(crate) async fn handle_audio_chunk(...) -> Result<(), anyhow::Error> {
    // 检查是否需要 finalize
    if should_finalize && self.internal_state.finalize_inflight.is_none() {
        let finalized = self.try_finalize(utterance_index, finalize_reason).await?;
    }
}
```

**Finalize 处理** (`src/websocket/session_actor/actor/actor_finalize.rs:85`):
```rust
async fn do_finalize(...) -> Result<bool, anyhow::Error> {
    // 创建翻译任务
    let jobs = create_translation_jobs(...).await?;
    // ... 发送任务分配消息 ...
}
```

**任务创建** (`src/websocket/job_creator.rs:10`):
```rust
pub(crate) async fn create_translation_jobs(...) -> Result<Vec<Job>, anyhow::Error> {
    // 调用 dispatcher.create_job（旧实现，待迁移）
    let job = state.dispatcher.create_job(...).await;
    // ... 幂等性检查 ...
}
```

**旧实现** (`src/core/dispatcher/job_creation.rs:17`):
- ⚠️ **已废弃** - 使用 `create_job_with_policy`（涉及锁和本地状态）
- 临时返回 `todo!()`，等待迁移到新实现

**新实现** (`src/services/minimal_scheduler.rs:180`):
```rust
pub async fn dispatch_task(&self, req: DispatchRequest) -> Result<DispatchResponse> {
    // 调用 Lua 脚本执行原子操作
    let result: redis::Value = self.eval_script(
        &self.scripts.dispatch_task,
        &[],
        &[&req.session_id, &req.src_lang, &req.tgt_lang, &req.payload_json],
    ).await?;
    
    // 解析结果: (node_id, job_id)
    Ok(DispatchResponse { node_id, job_id })
}
```

**Lua 脚本执行的操作** (`scripts/lua/dispatch_task.lua`):
1. 读取会话绑定的 `preferred_pool`（如果存在）
2. 如果没有 `preferred_pool`，根据语言对选择 Pool
   - 读取 `scheduler:lang:{src}:{tgt}` 的 `pools_json`
   - 选择第一个 Pool ID
   - 写回会话绑定（可选）
3. 从 Pool 获取节点集合
   - `SMEMBERS scheduler:pool:{pool_id}:members`
4. 在节点集合中选择可用节点
   - 检查节点在线状态 (`online == "true"`)
   - 检查节点并发槽可用 (`current_jobs < max_jobs`)
5. 占用节点并发槽
   - `HINCRBY scheduler:node:runtime:{node_id} current_jobs 1`
6. 创建任务记录
   - `INCR scheduler:job:id_seq`（获取序列号）
   - `HSET scheduler:job:{job_id}`（写入任务信息）
7. 返回 `{node_id, job_id}`

#### 3.1.4 迁移状态

- ✅ **新实现已完成**: `MinimalSchedulerService::dispatch_task`
- ⚠️ **旧实现已废弃**: `JobDispatcher::create_job` 已注释，返回 `todo!()`
- 🔄 **待迁移**: `create_translation_jobs` 需要调用新实现

---

### 3.2 任务完成流程

#### 3.2.1 流程图

```
节点完成任务
    ↓
节点发送 NodeMessage::JobResult
    ↓
websocket/node_handler/message/mod.rs::handle_message()
    ↓
websocket/node_handler/message/job_result/job_result_processing.rs::process_job_result()
    ↓
处理 JobResult（去重、验证、添加到结果队列）
    ↓
【新实现】MinimalSchedulerService::complete_task()
    ↓
执行 Lua 脚本: complete_task.lua
    ↓
Redis 原子操作:
  - 校验任务归属 (scheduler:job:{job_id})
  - 更新任务状态 (scheduler:job:{job_id})
  - 释放节点并发槽 (scheduler:node:runtime:{node_id})
```

#### 3.2.2 方法调用链

| 序号 | 方法/脚本 | 位置 | 功能 | 状态 |
|------|----------|------|------|------|
| 1 | `websocket/node_handler/message/mod.rs::handle_message()` | `src/websocket/node_handler/message/mod.rs:89` | 处理 WebSocket 消息 | ✅ 正常 |
| 2 | `job_result::process_job_result()` | `src/websocket/node_handler/message/job_result/job_result_processing.rs` | 处理任务结果 | ✅ 正常 |
| 3 | `MinimalSchedulerService::complete_task()` | `src/services/minimal_scheduler.rs:256` | 任务完成 API | ✅ **新实现** |
| 4 | `MinimalSchedulerService::eval_script()` | `src/services/minimal_scheduler.rs:100` | 执行 Lua 脚本 | ✅ 正常 |
| 5 | `complete_task.lua` | `scripts/lua/complete_task.lua` | 任务完成原子操作 | ✅ 正常 |

#### 3.2.3 详细说明

**入口点** (`src/websocket/node_handler/message/mod.rs:89`):
```rust
NodeMessage::JobResult { ... } => {
    job_result::process_job_result(...).await?;
}
```

**任务结果处理** (`src/websocket/node_handler/message/job_result/job_result_processing.rs`):
- 去重检查
- 验证任务状态
- 添加到结果队列
- 调用 `MinimalSchedulerService::complete_task()` （待迁移）

**新实现** (`src/services/minimal_scheduler.rs:256`):
```rust
pub async fn complete_task(&self, req: CompleteTaskRequest) -> Result<()> {
    // 调用 Lua 脚本执行原子操作
    let result: redis::Value = self.eval_script(
        &self.scripts.complete_task,
        &[],
        &[&req.job_id, &req.node_id, &req.status],
    ).await?;
    
    // 解析结果: "OK" 或错误
    Ok(())
}
```

**Lua 脚本执行的操作** (`scripts/lua/complete_task.lua`):
1. 校验任务归属
   - 读取 `scheduler:job:{job_id}` 的 `node_id`
   - 验证 `job_node_id == node_id`（防止错误回调）
   - 如果不匹配，返回 `{err, "NODE_MISMATCH"}`
2. 更新任务状态
   - `HSET scheduler:job:{job_id} status {status}`（"finished" 或 "failed"）
3. 释放节点并发槽
   - 读取 `current_jobs`
   - 如果 `current_jobs > 0`，则 `HINCRBY scheduler:node:runtime:{node_id} current_jobs -1`
4. 返回 `"OK"`

#### 3.2.4 迁移状态

- ✅ **新实现已完成**: `MinimalSchedulerService::complete_task`
- 🔄 **待迁移**: `process_job_result` 需要调用新实现

---

## 四、方法调用总览

### 4.1 节点管理方法

| 方法 | 位置 | 状态 | 说明 |
|------|------|------|------|
| `handle_node_register()` | `src/websocket/node_handler/message/register.rs:10` | ⚠️ **已废弃** | 旧实现，使用锁和本地状态 |
| `MinimalSchedulerService::register_node()` | `src/services/minimal_scheduler.rs:125` | ✅ **新实现** | 无锁实现，所有状态在 Redis |
| `handle_node_heartbeat()` | `src/websocket/node_handler/message/register.rs:55` | ⚠️ **已废弃** | 旧实现，使用锁和本地状态 |
| `MinimalSchedulerService::heartbeat()` | `src/services/minimal_scheduler.rs:155` | ✅ **新实现** | 无锁实现，所有状态在 Redis |

### 4.2 任务管理方法

| 方法 | 位置 | 状态 | 说明 |
|------|------|------|------|
| `JobDispatcher::create_job()` | `src/core/dispatcher/job_creation.rs:17` | ⚠️ **已废弃** | 旧实现，使用锁和本地状态 |
| `MinimalSchedulerService::dispatch_task()` | `src/services/minimal_scheduler.rs:180` | ✅ **新实现** | 无锁实现，所有状态在 Redis |
| `MinimalSchedulerService::complete_task()` | `src/services/minimal_scheduler.rs:256` | ✅ **新实现** | 无锁实现，所有状态在 Redis |

### 4.3 Lua 脚本

| 脚本 | 位置 | 功能 | 状态 |
|------|------|------|------|
| `register_node.lua` | `scripts/lua/register_node.lua` | 节点注册原子操作 | ✅ 正常 |
| `heartbeat.lua` | `scripts/lua/heartbeat.lua` | 节点心跳原子操作 | ✅ 正常 |
| `dispatch_task.lua` | `scripts/lua/dispatch_task.lua` | 任务调度原子操作 | ✅ 正常 |
| `complete_task.lua` | `scripts/lua/complete_task.lua` | 任务完成原子操作 | ✅ 正常 |

---

## 五、状态说明

### 5.1 已废弃的方法

以下方法已废弃，不应再使用：

1. **`handle_node_register()`** (`src/websocket/node_handler/message/register.rs:10`)
   - 使用 `register_node_with_policy`（涉及锁和本地状态）
   - 已注释，临时返回 `Ok(())`

2. **`handle_node_heartbeat()`** (`src/websocket/node_handler/message/register.rs:55`)
   - 使用 `update_node_heartbeat`（涉及锁和本地状态）
   - 已注释，临时返回

3. **`JobDispatcher::create_job()`** (`src/core/dispatcher/job_creation.rs:17`)
   - 使用 `create_job_with_policy`（涉及锁和本地状态）
   - 已注释，临时返回 `todo!()`

4. **`register_node_with_policy()`** (`src/node_registry/core.rs:132`)
   - 旧实现，使用锁和本地状态
   - 已注释，临时返回 `todo!()`

5. **`update_node_heartbeat()`** (`src/node_registry/core.rs:292`)
   - 旧实现，使用锁和本地状态
   - 已注释，临时返回 `todo!()`

### 5.2 新实现的方法

以下方法已实现，应优先使用：

1. **`MinimalSchedulerService::register_node()`** (`src/services/minimal_scheduler.rs:125`)
   - 完全无锁，所有状态在 Redis
   - 使用 Lua 脚本执行原子操作

2. **`MinimalSchedulerService::heartbeat()`** (`src/services/minimal_scheduler.rs:155`)
   - 完全无锁，所有状态在 Redis
   - 使用 Lua 脚本执行原子操作

3. **`MinimalSchedulerService::dispatch_task()`** (`src/services/minimal_scheduler.rs:180`)
   - 完全无锁，所有状态在 Redis
   - 使用 Lua 脚本执行原子操作

4. **`MinimalSchedulerService::complete_task()`** (`src/services/minimal_scheduler.rs:256`)
   - 完全无锁，所有状态在 Redis
   - 使用 Lua 脚本执行原子操作

### 5.3 待迁移的调用点

以下位置需要迁移到新实现：

1. **节点注册** (`src/websocket/node_handler/message/register.rs:10`)
   - 需要调用 `MinimalSchedulerService::register_node()`

2. **节点心跳** (`src/websocket/node_handler/message/register.rs:55`)
   - 需要调用 `MinimalSchedulerService::heartbeat()`

3. **任务调度** (`src/websocket/job_creator.rs:65, 134, 199`)
   - 需要调用 `MinimalSchedulerService::dispatch_task()`

4. **任务完成** (`src/websocket/node_handler/message/job_result/job_result_processing.rs`)
   - 需要调用 `MinimalSchedulerService::complete_task()`

---

## 六、性能特征

### 6.1 无锁优势

1. **无锁竞争**: 不依赖 Rust 层面的 `Mutex`/`RwLock`，避免锁竞争
2. **原子操作**: 所有并发控制通过 Redis Lua 脚本原子执行
3. **状态集中**: 所有共享状态在 Redis，便于分布式扩展
4. **简化流程**: 减少状态同步复杂度

### 6.2 性能指标

- **节点注册**: 单次 Redis 调用（Lua 脚本）
- **节点心跳**: 单次 Redis 调用（Lua 脚本）
- **任务调度**: 单次 Redis 调用（Lua 脚本），包含 Pool 选择、节点选择、并发槽占用
- **任务完成**: 单次 Redis 调用（Lua 脚本），包含状态更新、并发槽释放

### 6.3 并发处理

- **节点注册**: 支持并发注册，Lua 脚本保证原子性
- **节点心跳**: 支持并发心跳，Lua 脚本保证原子性
- **任务调度**: 支持并发调度，Lua 脚本保证节点并发槽正确占用
- **任务完成**: 支持并发完成，Lua 脚本保证节点并发槽正确释放

---

## 七、Redis 数据结构

### 7.1 节点信息

**Key**: `scheduler:node:info:{node_id}`  
**Type**: Hash  
**Fields**:
- `online`: "true" / "false"
- `cap_json`: 节点能力 JSON
- `max_jobs`: 最大任务数
- `last_heartbeat_ts`: 最后心跳时间戳
- `load_json`: 负载信息 JSON（可选）

**TTL**: 3600 秒

### 7.2 节点运行状态

**Key**: `scheduler:node:runtime:{node_id}`  
**Type**: Hash  
**Fields**:
- `current_jobs`: 当前任务数（字符串，可递增/递减）

**TTL**: 3600 秒

### 7.3 Pool 成员

**Key**: `scheduler:pool:{pool_id}:members`  
**Type**: Set  
**Members**: 节点 ID 列表

**TTL**: 3600 秒

### 7.4 语言索引

**Key**: `scheduler:lang:{src}:{tgt}`  
**Type**: Hash  
**Fields**:
- `pools_json`: Pool ID 列表 JSON

**TTL**: 3600 秒

### 7.5 任务记录

**Key**: `scheduler:job:{job_id}`  
**Type**: Hash  
**Fields**:
- `node_id`: 分配的节点 ID
- `session_id`: 会话 ID
- `src_lang`: 源语言
- `tgt_lang`: 目标语言
- `payload_json`: 任务负载 JSON
- `status`: 任务状态（"created" / "finished" / "failed"）
- `created_ts`: 创建时间戳

**TTL**: 3600 秒

### 7.6 会话绑定

**Key**: `scheduler:session:{session_id}`  
**Type**: Hash  
**Fields**:
- `preferred_pool`: 首选 Pool ID（可选，用于 Sticky Pool）
- `last_lang_pair`: 最后使用的语言对（可选）

**TTL**: 3600 秒

### 7.7 任务序列号

**Key**: `scheduler:job:id_seq`  
**Type**: String  
**Value**: 任务序列号（数字，可递增）

---

## 八、错误处理

### 8.1 节点注册错误

- **节点 ID 冲突**: 如果节点已存在，Lua 脚本会覆盖旧数据（幂等操作）
- **Pool 不存在**: 如果 `pools_json` 为空，不会更新 Pool 成员（正常行为）

### 8.2 节点心跳错误

- **节点不存在**: 如果节点未注册，Lua 脚本会创建节点信息（自动注册）
- **心跳超时**: 由 Redis TTL 机制自动清理离线节点

### 8.3 任务调度错误

- **NO_POOL_FOR_LANG_PAIR**: 语言对没有对应的 Pool
- **EMPTY_POOL**: Pool 为空（没有可用节点）
- **NO_AVAILABLE_NODE**: Pool 中没有可用节点（所有节点都满了）

### 8.4 任务完成错误

- **NODE_MISMATCH**: 任务不属于该节点（防止错误回调）

---

## 九、迁移计划

### 9.1 已完成的工作

- ✅ **新实现已完成**: `MinimalSchedulerService` 及其 4 个核心方法
- ✅ **Lua 脚本已完成**: 4 个核心 Lua 脚本已实现并测试
- ✅ **旧实现已废弃**: 旧方法已注释，标记为废弃
- ✅ **单元测试已完成**: 7/7 测试通过

### 9.2 待完成的工作

1. **节点注册迁移** (`src/websocket/node_handler/message/register.rs:10`)
   - 在 `handle_node_register` 中调用 `MinimalSchedulerService::register_node()`
   - 删除旧实现代码

2. **节点心跳迁移** (`src/websocket/node_handler/message/register.rs:55`)
   - 在 `handle_node_heartbeat` 中调用 `MinimalSchedulerService::heartbeat()`
   - 删除旧实现代码

3. **任务调度迁移** (`src/websocket/job_creator.rs`)
   - 在 `create_translation_jobs` 中调用 `MinimalSchedulerService::dispatch_task()`
   - 替换 `JobDispatcher::create_job()` 调用

4. **任务完成迁移** (`src/websocket/node_handler/message/job_result/job_result_processing.rs`)
   - 在处理 `JobResult` 时调用 `MinimalSchedulerService::complete_task()`

5. **清理工作**
   - 删除已废弃的方法
   - 清理未使用的导入和依赖

---

## 十、决策建议

### 10.1 架构优势

1. **简化设计**: 无锁架构简化了并发控制逻辑
2. **性能提升**: 避免了 Rust 层面的锁竞争
3. **易于扩展**: Redis 作为状态中心，便于分布式扩展
4. **原子性保证**: Lua 脚本保证操作的原子性

### 10.2 风险控制

1. **Redis 依赖**: 系统依赖 Redis，需要保证 Redis 高可用
2. **迁移风险**: 从旧实现迁移到新实现需要充分测试
3. **兼容性**: 需要确保新实现与现有业务逻辑兼容

### 10.3 建议

1. **立即迁移**: 新实现已完成并测试通过，建议立即迁移
2. **分步迁移**: 先迁移节点管理，再迁移任务管理
3. **充分测试**: 迁移后进行充分测试，确保功能正常

---

## 十一、附录

### 11.1 相关文档

- **规范文档**: `docs/architecture/LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md`
- **测试指南**: `docs/testing/MINIMAL_SCHEDULER_TEST_GUIDE.md`
- **测试总结**: `docs/implementation/UNIT_TEST_SUMMARY.md`
- **集成指南**: `docs/implementation/MINIMAL_SCHEDULER_INTEGRATION.md`
- **实施状态**: `docs/implementation/MINIMAL_SCHEDULER_IMPLEMENTATION_STATUS.md`

### 11.2 代码位置

- **新实现**: `src/services/minimal_scheduler.rs`
- **Lua 脚本**: `scripts/lua/*.lua`
- **WebSocket 处理器**: `src/websocket/node_handler/message/`
- **任务创建**: `src/websocket/job_creator.rs`
- **Session Actor**: `src/websocket/session_actor/`

### 11.3 测试文件

- **单元测试**: `tests/minimal_scheduler_test.rs`
- **测试结果**: 7/7 测试通过 ✅

---

**文档版本**: v2.0  
**最后更新**: 2026-01-11  
**状态**: ✅ 新实现已完成，待迁移集成
