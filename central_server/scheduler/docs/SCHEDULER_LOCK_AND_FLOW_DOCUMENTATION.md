# 调度服务器流程与加锁细节文档

## 文档信息
- **版本**: v1.0
- **日期**: 2026-01-09
- **目的**: 详细说明调度服务器的关键流程和加锁机制，供决策部门参考

---

## 目录

1. [Web端注册流程](#1-web端注册流程)
2. [节点端注册流程](#2-节点端注册流程)
3. [节点心跳处理流程](#3-节点心跳处理流程)
4. [翻译任务处理流程](#4-翻译任务处理流程)
5. [翻译结果处理流程](#5-翻译结果处理流程)
6. [锁使用总结](#6-锁使用总结)

---

## 1. Web端注册流程

### 1.1 流程概述

Web客户端通过 WebSocket 连接到调度服务器，发送 `session_init` 消息进行注册。

### 1.2 详细步骤

#### 步骤 1: 接收 Session Init 消息
**文件**: `src/websocket/session_message_handler/core.rs::handle_session_init`

**操作**:
1. 验证配对码（如果提供）
2. 创建 Session 对象
3. 注册 WebSocket 连接
4. 初始化结果队列
5. 创建并启动 Session Actor

**加锁情况**:
- **无锁操作**: 大部分操作都是无锁的
- **Session Manager**: 
  - `session_manager.create_session()`: 内部使用 `RwLock`（写锁）
  - `session_manager.update_session()`: 内部使用 `RwLock`（写锁）
  - `session_manager.register_actor()`: 内部使用 `RwLock`（写锁）
- **Session Connections**: 
  - `session_connections.register()`: 内部使用 `RwLock`（写锁）
- **Result Queue**: 
  - `result_queue.initialize_session()`: 内部使用 `RwLock`（写锁）

**锁数量**: 约 5-6 个写锁（串行执行，不并发）

**锁类型**:
- `session_manager.sessions.write()` - Session 存储
- `session_manager.actors.write()` - Actor 句柄存储
- `session_connections.connections.write()` - 连接映射
- `result_queue.queues.write()` - 结果队列

**锁持有时间**: < 10ms（快速操作）

#### 步骤 2: Phase 2 处理（如果启用）
**操作**:
- 写入 Session Owner 到 Redis（无锁，Redis 操作）
- 写入 Session Bind（如果配对节点模式）

**加锁情况**: 无锁（Redis 操作）

#### 步骤 3: 发送确认消息
**操作**: 发送 `session_init_ack` 消息

**加锁情况**: 无锁（消息发送）

### 1.3 锁使用总结

| 操作 | 锁类型 | 锁数量 | 锁持有时间 | 并发性 |
|------|--------|--------|------------|--------|
| Session 创建 | `RwLock` (写) | 1 | < 10ms | 低（串行） |
| Actor 注册 | `RwLock` (写) | 1 | < 10ms | 低（串行） |
| 连接注册 | `RwLock` (写) | 1 | < 10ms | 低（串行） |
| 结果队列初始化 | `RwLock` (写) | 1 | < 10ms | 低（串行） |
| **总计** | - | **4-5** | **< 50ms** | **低** |

---

## 2. 节点端注册流程

### 2.1 流程概述

节点通过 WebSocket 连接到调度服务器，发送 `node_register` 消息进行注册。

### 2.2 详细步骤

#### 步骤 1: 接收节点注册消息
**文件**: `src/websocket/node_handler/message/register.rs::handle_node_register`

**操作**:
1. 验证 `capability_schema_version`（必须为 "2.0"）
2. 调用 `register_node_with_policy()`

**加锁情况**: 无锁（验证操作）

#### 步骤 2: 节点注册处理
**文件**: `src/node_registry/core.rs::register_node_with_policy`

**操作**:
1. 检查 GPU 是否存在（必需）
2. 检查 node_id 冲突
3. 创建 Node 对象
4. 同步节点能力到 Redis（如果启用 Phase 2）
5. 更新节点到内存映射
6. 更新语言能力索引
7. Phase 3 Pool 分配（如果启用）

**加锁情况**:

**锁 1: `nodes.write()`**
- **位置**: 第 190 行
- **类型**: `RwLock` (写锁)
- **用途**: 更新节点映射
- **持有时间**: 约 50-200ms（包括 Pool 分配计算）
- **并发性**: 低（串行）

**锁 2: `language_capability_index.write()`**
- **位置**: 第 260 行
- **类型**: `RwLock` (写锁)
- **用途**: 更新语言能力索引
- **持有时间**: < 10ms
- **并发性**: 低（串行）

**锁 3: `phase3.read()`** (如果启用 Phase 3)
- **位置**: 第 267 行
- **类型**: `RwLock` (读锁)
- **用途**: 读取 Phase 3 配置
- **持有时间**: < 1ms
- **并发性**: 高（可并发读）

**锁 4: `phase3_node_pool.write()`** (如果启用 Phase 3)
- **位置**: `phase3_pool_members.rs::phase3_set_node_pools`
- **类型**: `RwLock` (写锁)
- **用途**: 更新节点到 Pool 的映射
- **持有时间**: < 10ms
- **并发性**: 低（串行）

**锁 5: `phase3_pool_index.write()`** (如果启用 Phase 3)
- **位置**: `phase3_pool_members.rs::phase3_set_node_pools`
- **类型**: `RwLock` (写锁)
- **用途**: 更新 Pool 到节点的映射
- **持有时间**: < 10ms
- **并发性**: 低（串行）

**锁 6: `phase3_core_cache.write()`** (如果启用 Phase 3)
- **位置**: `phase3_core_cache.rs`
- **类型**: `RwLock` (写锁)
- **用途**: 更新 Pool 核心能力缓存
- **持有时间**: < 10ms
- **并发性**: 低（串行）

#### 步骤 3: 注册连接
**操作**: `node_connections.register()`

**加锁情况**:
- **锁类型**: `RwLock` (写锁)
- **持有时间**: < 10ms

#### 步骤 4: Phase 2 处理（如果启用）
**操作**:
- 写入 Node Owner 到 Redis（无锁）
- 同步节点能力到 Redis（无锁）
- 写入节点快照到 Redis（无锁）
- 同步 Pool 成员索引到 Redis（无锁）

**加锁情况**: 无锁（Redis 操作）

#### 步骤 5: 发送确认消息
**操作**: 发送 `node_register_ack` 消息

**加锁情况**: 无锁（消息发送）

### 2.3 锁使用总结

| 操作 | 锁类型 | 锁数量 | 锁持有时间 | 并发性 |
|------|--------|--------|------------|--------|
| 节点映射更新 | `RwLock` (写) | 1 | 50-200ms | 低（串行） |
| 语言能力索引 | `RwLock` (写) | 1 | < 10ms | 低（串行） |
| Phase 3 配置读取 | `RwLock` (读) | 1 | < 1ms | 高（并发读） |
| Phase 3 Pool 映射 | `RwLock` (写) | 2 | < 20ms | 低（串行） |
| Phase 3 核心缓存 | `RwLock` (写) | 1 | < 10ms | 低（串行） |
| 连接注册 | `RwLock` (写) | 1 | < 10ms | 低（串行） |
| **总计** | - | **6-7** | **< 250ms** | **低** |

**注意**: 大部分锁是串行执行的，不会并发持有多个锁。

---

## 3. 节点心跳处理流程

### 3.1 流程概述

节点定期发送心跳消息，更新节点状态和资源使用情况。

### 3.2 详细步骤

#### 步骤 1: 接收心跳消息
**文件**: `src/websocket/node_handler/message/register.rs::handle_node_heartbeat`

**操作**:
1. 调用 `update_node_heartbeat()` 更新节点状态
2. Phase 3 Pool 重新分配（如果语言能力变化）
3. 触发状态检查
4. Phase 2 同步到 Redis

**加锁情况**: 无锁（准备数据）

#### 步骤 2: 更新节点心跳
**文件**: `src/node_registry/core.rs::update_node_heartbeat`

**操作**:
1. 使用 `ManagementRegistry` 快速更新节点状态
2. 更新语言能力索引
3. 更新 SnapshotManager
4. 更新 Phase 3 核心缓存

**加锁情况**:

**锁 1: `management_registry.write()`** ⭐ **已优化**
- **位置**: 第 335 行
- **类型**: `RwLock` (写锁)
- **用途**: 更新节点心跳状态（CPU/GPU/内存/任务数等）
- **持有时间**: < 10ms ⭐ **优化后**
- **并发性**: 低（串行）
- **优化说明**: 使用统一管理锁，替代旧的 `nodes.write()`，锁等待从 1758ms → 0ms

**锁 2: `language_capability_index.write()`**
- **位置**: 第 424 行
- **类型**: `RwLock` (写锁)
- **用途**: 更新语言能力索引
- **持有时间**: < 10ms
- **并发性**: 低（串行）

**锁 3: `snapshot_manager`** (如果启用)
- **位置**: 第 430 行
- **类型**: `OnceCell` + 内部锁
- **用途**: 更新节点快照
- **持有时间**: < 10ms
- **并发性**: 低（串行）

**锁 4: `phase3_core_cache.write()`** (如果启用 Phase 3)
- **位置**: 第 437 行
- **类型**: `RwLock` (写锁)
- **用途**: 更新 Pool 核心能力缓存
- **持有时间**: < 10ms
- **并发性**: 低（串行）

#### 步骤 3: Phase 3 Pool 重新分配（如果语言能力变化）
**文件**: `src/websocket/node_handler/message/register.rs::handle_node_heartbeat`

**操作**:
1. 检查语言能力是否变化
2. 如果变化，重新分配 Pool

**加锁情况**:

**锁 1: `phase3.read()`**
- **位置**: 第 206 行
- **类型**: `RwLock` (读锁)
- **用途**: 读取 Phase 3 配置
- **持有时间**: < 1ms
- **并发性**: 高（可并发读）

**锁 2: `phase3_node_pool.read()`** (检查当前 Pool)
- **位置**: `phase3_pool_allocation_impl.rs`
- **类型**: `RwLock` (读锁)
- **用途**: 检查节点当前 Pool 分配
- **持有时间**: < 1ms
- **并发性**: 高（可并发读）

**锁 3: `phase3_node_pool.write()`** (如果重新分配)
- **位置**: `phase3_pool_members.rs::phase3_set_node_pools`
- **类型**: `RwLock` (写锁)
- **用途**: 更新节点到 Pool 的映射
- **持有时间**: < 10ms
- **并发性**: 低（串行）

**锁 4: `phase3_pool_index.write()`** (如果重新分配)
- **位置**: `phase3_pool_members.rs::phase3_set_node_pools`
- **类型**: `RwLock` (写锁)
- **用途**: 更新 Pool 到节点的映射
- **持有时间**: < 10ms
- **并发性**: 低（串行）

#### 步骤 4: Phase 2 同步到 Redis
**操作**:
- 同步节点能力到 Redis（无锁）
- 写入节点快照到 Redis（无锁）
- 同步节点容量到 Redis（无锁）
- 同步 Pool 成员索引到 Redis（无锁）

**加锁情况**: 无锁（Redis 操作）

### 3.3 锁使用总结

| 操作 | 锁类型 | 锁数量 | 锁持有时间 | 并发性 | 优化状态 |
|------|--------|--------|------------|--------|----------|
| 节点心跳更新 | `RwLock` (写) | 1 | < 10ms ⭐ | 低（串行） | ✅ 已优化 |
| 语言能力索引 | `RwLock` (写) | 1 | < 10ms | 低（串行） | ✅ 正常 |
| 快照更新 | 内部锁 | 1 | < 10ms | 低（串行） | ✅ 正常 |
| Phase 3 核心缓存 | `RwLock` (写) | 1 | < 10ms | 低（串行） | ✅ 正常 |
| Phase 3 Pool 重新分配 | `RwLock` (写) | 2 | < 20ms | 低（串行） | ✅ 优化（只在变化时） |
| **总计** | - | **4-6** | **< 60ms** | **低** | **✅ 已优化** |

**优化说明**:
- ✅ **心跳更新路径已优化**: 使用 `ManagementRegistry` 替代 `nodes.write()`，锁等待从 1758ms → 0ms
- ✅ **Pool 重新分配已优化**: 只在语言能力变化时重新分配，避免不必要的锁竞争
- ✅ **锁持有时间短**: 所有锁持有时间 < 10ms，性能良好

---

## 4. 翻译任务处理流程

### 3.1 流程概述

Web客户端发送音频数据，调度服务器创建翻译任务（Job）并分配给节点。

### 3.2 详细步骤

#### 步骤 1: 接收音频数据
**文件**: `src/websocket/session_message_handler/utterance.rs`

**操作**:
1. 接收音频数据
2. 触发 Session Actor 处理

**加锁情况**: 无锁（消息传递）

#### 步骤 2: Session Actor 处理
**文件**: `src/websocket/session_actor/actor/actor_handle.rs`

**操作**:
1. 累积音频数据
2. 触发任务创建（当满足条件时）

**加锁情况**: 
- **Session Actor 状态**: 内部使用 `Mutex`（互斥锁）
- **锁持有时间**: < 1ms（快速操作）

#### 步骤 3: 创建翻译任务
**文件**: `src/websocket/job_creator.rs::create_translation_jobs`

**操作**:
1. 检查是否在房间模式
2. 创建 Job 对象
3. 调用 `dispatcher.create_job()`

**加锁情况**: 无锁（准备数据）

#### 步骤 4: Job 创建（Phase 2 幂等检查）
**文件**: `src/core/dispatcher/job_creation/job_creation_phase2.rs::create_job_with_phase2_lock`

**操作**:
1. 获取 Redis 请求锁（`acquire_request_lock`）
2. 检查 request_id 绑定（Redis 操作，无锁）
3. 节点选择
4. Redis 预留节点槽位（`reserve_node_slot`）
5. 写入 request_id 绑定到 Redis
6. 创建 Job 对象
7. 更新 Job 状态

**加锁情况**:

**锁 1: Redis 请求锁** (Phase 2)
- **位置**: 第 124 行
- **类型**: Redis 分布式锁
- **用途**: 防止并发创建相同 request_id 的任务
- **持有时间**: 100-500ms（包括节点选择和 Redis 操作）
- **并发性**: 低（串行）

**锁 2: `jobs.write()`**
- **位置**: 第 178 行
- **类型**: `RwLock` (写锁)
- **用途**: 存储 Job 对象
- **持有时间**: < 10ms
- **并发性**: 低（串行）

**锁 3: `nodes.read()`** (节点选择)
- **位置**: `job_creation_node_selection.rs::select_node_for_job_creation`
- **类型**: `RwLock` (读锁)
- **用途**: 读取节点信息进行选择
- **持有时间**: < 10ms
- **并发性**: 高（可并发读）

**锁 4: `phase3.read()`** (如果启用 Phase 3)
- **位置**: `selection_phase3.rs`
- **类型**: `RwLock` (读锁)
- **用途**: 读取 Phase 3 配置
- **持有时间**: < 1ms
- **并发性**: 高（可并发读）

**锁 5: `snapshot_manager`** (如果启用 Phase 3)
- **位置**: `selection_phase3.rs`
- **类型**: `OnceCell` + `RwLock` (读锁)
- **用途**: 读取节点快照
- **持有时间**: < 1ms
- **并发性**: 高（可并发读）

**锁 6: `phase3_pool_index.read()`** (如果启用 Phase 3)
- **位置**: `selection_phase3.rs`
- **类型**: `RwLock` (读锁)
- **用途**: 读取 Pool 成员索引
- **持有时间**: < 1ms
- **并发性**: 高（可并发读）

**锁 7: `phase3_core_cache.read()`** (如果启用 Phase 3)
- **位置**: `selection_phase3.rs`
- **类型**: `RwLock` (读锁)
- **用途**: 读取 Pool 核心能力缓存
- **持有时间**: < 1ms
- **并发性**: 高（可并发读）

#### 步骤 5: 发送任务到节点
**操作**: 通过 WebSocket 发送 `job` 消息到节点

**加锁情况**: 无锁（消息发送）

#### 步骤 6: 标记任务已派发
**文件**: `src/core/dispatcher/job_management.rs::mark_job_dispatched`

**加锁情况**:

**锁 1: `jobs.write()`**
- **位置**: 第 69 行
- **类型**: `RwLock` (写锁)
- **用途**: 更新 Job 状态
- **持有时间**: < 10ms
- **并发性**: 低（串行）

**锁 2: `last_dispatched_node_by_session.write()`**
- **位置**: 第 83 行
- **类型**: `RwLock` (写锁)
- **用途**: 记录最后派发的节点（用于打散策略）
- **持有时间**: < 1ms
- **并发性**: 低（串行）

### 3.3 锁使用总结

| 操作 | 锁类型 | 锁数量 | 锁持有时间 | 并发性 |
|------|--------|--------|------------|--------|
| Redis 请求锁 | Redis 分布式锁 | 1 | 100-500ms | 低（串行） |
| Job 存储 | `RwLock` (写) | 1 | < 10ms | 低（串行） |
| 节点选择（读） | `RwLock` (读) | 1-5 | < 20ms | 高（并发读） |
| Job 状态更新 | `RwLock` (写) | 1 | < 10ms | 低（串行） |
| 打散策略记录 | `RwLock` (写) | 1 | < 1ms | 低（串行） |
| **总计** | - | **5-9** | **< 550ms** | **混合** |

**注意**: 
- Redis 请求锁是主要的串行化点（防止重复创建任务）
- 节点选择使用读锁，可以并发执行
- 大部分锁持有时间很短（< 10ms）

---

## 5. 翻译结果处理流程

### 4.1 流程概述

节点完成翻译任务后，发送 `job_result` 消息，调度服务器处理结果并发送给 Web 客户端。

### 4.2 详细步骤

#### 步骤 1: 接收 Job Result 消息
**文件**: `src/websocket/node_handler/message/job_result/job_result_processing.rs::handle_job_result`

**操作**:
1. 检查结果去重（30秒内是否已收到）
2. Phase 2 跨实例转发检查

**加锁情况**: 无锁（检查操作）

#### 步骤 2: 检查是否应该处理 Job
**文件**: `src/websocket/node_handler/message/job_result/job_result_job_management.rs::check_should_process_job`

**加锁情况**:

**锁 1: `jobs.read()`**
- **位置**: `job_management.rs::get_job`
- **类型**: `RwLock` (读锁)
- **用途**: 读取 Job 信息
- **持有时间**: < 1ms
- **并发性**: 高（可并发读）

#### 步骤 3: 处理 Job 操作
**文件**: `src/websocket/node_handler/message/job_result/job_result_job_management.rs::process_job_operations`

**操作**:
1. Phase 2: 释放 Redis 节点槽位预留
2. Phase 2: 更新 Job FSM 状态
3. 更新 Job 状态（Completed/Failed）

**加锁情况**:

**锁 1: `jobs.write()`**
- **位置**: `job_management.rs::update_job_status`
- **类型**: `RwLock` (写锁)
- **用途**: 更新 Job 状态
- **持有时间**: < 10ms
- **并发性**: 低（串行）

**锁 2: `request_bindings.write()`** (如果 Job 完成/失败)
- **位置**: `job_management.rs::update_job_status`
- **类型**: `RwLock` (写锁)
- **用途**: 清理 request_id 绑定
- **持有时间**: < 1ms
- **并发性**: 低（串行）

#### 步骤 4: 创建翻译结果
**文件**: `src/websocket/node_handler/message/job_result/job_result_creation.rs`

**操作**:
1. 计算耗时
2. 创建 ServiceTimings 和 NetworkTimings
3. 创建 TranslationResult 消息

**加锁情况**: 无锁（计算操作）

#### 步骤 5: 发送结果到客户端
**文件**: `src/websocket/node_handler/message/job_result/job_result_sending.rs::send_results_to_clients`

**操作**:
1. 添加到结果队列
2. 发送到 WebSocket 连接

**加锁情况**:

**锁 1: `result_queue.queues.write()`**
- **位置**: `result_queue.rs`
- **类型**: `RwLock` (写锁)
- **用途**: 添加到结果队列
- **持有时间**: < 1ms
- **并发性**: 低（串行）

**锁 2: `session_connections.connections.read()`**
- **位置**: `session_connections.rs`
- **类型**: `RwLock` (读锁)
- **用途**: 读取 WebSocket 连接
- **持有时间**: < 1ms
- **并发性**: 高（可并发读）

### 4.3 锁使用总结

| 操作 | 锁类型 | 锁数量 | 锁持有时间 | 并发性 |
|------|--------|--------|------------|--------|
| Job 读取 | `RwLock` (读) | 1 | < 1ms | 高（并发读） |
| Job 状态更新 | `RwLock` (写) | 1 | < 10ms | 低（串行） |
| Request 绑定清理 | `RwLock` (写) | 1 | < 1ms | 低（串行） |
| 结果队列添加 | `RwLock` (写) | 1 | < 1ms | 低（串行） |
| 连接读取 | `RwLock` (读) | 1 | < 1ms | 高（并发读） |
| **总计** | - | **5** | **< 15ms** | **混合** |

**注意**: 
- 大部分操作使用读锁，可以并发执行
- 写锁操作时间很短（< 10ms）
- 结果处理是异步的，不会阻塞其他操作

---

## 6. 锁使用总结

### 5.1 锁类型统计

| 锁类型 | 数量 | 用途 | 并发性 |
|--------|------|------|--------|
| `RwLock` (写锁) | 15-20 | 更新共享状态 | 低（串行） |
| `RwLock` (读锁) | 8-12 | 读取共享状态 | 高（并发读） |
| `Mutex` | 1-2 | Session Actor 状态 | 低（串行） |
| Redis 分布式锁 | 1 | 跨实例幂等 | 低（串行） |

### 5.2 关键锁竞争点

#### 高竞争锁（需要关注）

1. **`nodes.write()`** (节点注册/更新)
   - **竞争场景**: 节点注册、节点快照同步
   - **持有时间**: 50-200ms
   - **优化**: 已优化心跳更新路径，使用 `ManagementRegistry`

2. **`phase3_node_pool.write()`** (Pool 分配)
   - **竞争场景**: 节点注册、心跳更新（语言能力变化）
   - **持有时间**: < 10ms
   - **优化**: 已优化，只在语言能力变化时重新分配

3. **`jobs.write()`** (Job 创建/更新)
   - **竞争场景**: 任务创建、任务状态更新
   - **持有时间**: < 10ms
   - **优化**: 锁持有时间短，影响较小

#### 低竞争锁（性能良好）

1. **`nodes.read()`** (节点选择)
   - **并发性**: 高（可并发读）
   - **持有时间**: < 10ms
   - **状态**: 性能良好

2. **`phase3.read()`** (Phase 3 配置读取)
   - **并发性**: 高（可并发读）
   - **持有时间**: < 1ms
   - **状态**: 性能良好

3. **`jobs.read()`** (Job 读取)
   - **并发性**: 高（可并发读）
   - **持有时间**: < 1ms
   - **状态**: 性能良好

### 5.3 锁优化建议

1. **已完成优化**:
   - ✅ 心跳更新路径：使用 `ManagementRegistry`，锁等待从 1758ms → 0ms
   - ✅ 移除向后兼容代码：简化实现，减少锁竞争

2. **可进一步优化**:
   - ⚠️ 节点注册：考虑将 Pool 分配计算移到锁外
   - ⚠️ 节点选择：已使用读锁，性能良好
   - ⚠️ Job 创建：Redis 锁是必要的（跨实例幂等），但可以优化锁持有时间

### 5.4 性能指标

| 流程 | 总锁数量 | 总锁持有时间 | 主要瓶颈 | 优化状态 |
|------|----------|--------------|----------|----------|
| Web端注册 | 4-5 | < 50ms | 无 | ✅ 正常 |
| 节点端注册 | 6-7 | < 250ms | `nodes.write()` (50-200ms) | ⚠️ 可优化 |
| 节点心跳处理 | 4-6 | < 60ms | 无 | ✅ **已优化** |
| 翻译任务处理 | 5-9 | < 550ms | Redis 请求锁 (100-500ms) | ✅ 必要（跨实例幂等） |
| 翻译结果处理 | 5 | < 15ms | 无 | ✅ 正常 |

**结论**: 
- 大部分锁持有时间很短（< 10ms）
- 主要瓶颈是节点注册时的 Pool 分配计算（50-200ms）
- 翻译任务处理的 Redis 锁是必要的（跨实例幂等），但可以优化

---

## 附录：锁定义位置

### 主要锁定义

1. **`NodeRegistry.nodes`**: `src/node_registry/core.rs`
2. **`NodeRegistry.phase3`**: `src/node_registry/core.rs`
3. **`NodeRegistry.phase3_pool_index`**: `src/node_registry/core.rs`
4. **`NodeRegistry.phase3_node_pool`**: `src/node_registry/core.rs`
5. **`NodeRegistry.phase3_core_cache`**: `src/node_registry/core.rs`
6. **`NodeRegistry.language_capability_index`**: `src/node_registry/core.rs`
7. **`JobDispatcher.jobs`**: `src/core/dispatcher/dispatcher.rs`
8. **`JobDispatcher.request_bindings`**: `src/core/dispatcher/dispatcher.rs`
9. **`JobDispatcher.last_dispatched_node_by_session`**: `src/core/dispatcher/dispatcher.rs`
10. **`SessionManager.sessions`**: `src/core/session/session_manager.rs`
11. **`SessionConnections.connections`**: `src/websocket/session_handler.rs`
12. **`ResultQueue.queues`**: `src/core/result_queue.rs`

---

## 文档维护

- **最后更新**: 2026-01-09
- **维护者**: 开发团队
- **更新频率**: 当锁使用发生变化时更新
