# Scheduler 文档索引

**版本**: v3.0（MinimalScheduler + Lua Pool）  
**更新日期**: 2026-01-24

欢迎来到 Lingua Scheduler（调度服务器）文档中心。

---

## 📚 文档结构

### 🏗️ 架构文档

- **[架构文档](./architecture/README.md)** ⭐
  - [Scheduler 架构](./architecture/ARCHITECTURE.md) - 总体架构
  - [Pool 架构](./architecture/POOL_ARCHITECTURE.md) - Pool 系统详细设计
  - [Redis 数据模型](./architecture/REDIS_DATA_MODEL.md) - Key 设计和 Lua 脚本
  - [多实例部署](./architecture/MULTI_INSTANCE_DEPLOYMENT.md) - Phase2 部署指南
  - [优化历史](./architecture/OPTIMIZATION_HISTORY.md) - 架构演进历史

### 🔧 节点注册和管理

- **[节点注册和管理](./node_registry/README.md)** ⭐
  - [节点注册协议](./node_registry/node_registration.md) - 注册流程和消息格式
  - [节点管理和任务管理流程](./node_registry/node_and_job_management.md) - 完整流程分析
  - [Session Affinity 和节点路由](./node_registry/session_affinity.md) - Session Affinity 机制

### 📋 任务管理

- **[任务管理](./job/README.md)**
  - [任务处理流程](./job/job_processing_flow.md) - 调度服务器端和节点端任务处理
  - [节点端任务处理流程](./job/node_job_processing.md) - AudioAggregator、ASR 和 UtteranceAggregator

### 🎵 音频处理

- **[音频处理](./audio/README.md)**
  - [音频处理流程和 Buffer 清除逻辑](./audio/audio_processing_and_buffer.md) - 流程对比和 Buffer 清除逻辑

### 🔄 Finalize 处理

- **[Finalize 处理机制](./finalize/README.md)** ⭐
  - [调度服务器端 Finalize 类型](./finalize/scheduler_finalize_types.md) - Finalize 类型和触发条件
  - [调度服务器端 Finalize 处理](./finalize/scheduler_finalize_processing.md) - Finalize 处理逻辑
  - [节点端 Finalize 处理](./finalize/node_finalize_processing.md) - 节点端处理流程
  - [Timeout Finalize](./finalize/timeout_finalize.md) - Timeout Finalize 详细说明
  - [MaxDuration Finalize](./finalize/maxduration_finalize.md) - MaxDuration Finalize 详细说明

### 📊 Aggregator

- **[Aggregator](./aggregator/README.md)**
  - [AggregatorMiddleware 功能说明](./aggregator/aggregator_middleware.md) - 核心功能和处理流程
  - [UtteranceAggregator 配置对比](./aggregator/utterance_aggregator.md) - 配置对比和启用状态

### 🧪 集成测试

- **[集成测试](./integration_test/README.md)**
  - [集成测试 Job 处理过程分析](./integration_test/integration_test_analysis.md) - 测试结果和问题分析
  - [前半句丢失问题分析](./integration_test/missing_first_half_analysis.md) - 问题诊断和解决方案

### 📦 备份代码对比（归档）

- **[备份代码对比](./backup_comparison/README.md)**
  - 备份代码与正式代码的对比分析文档（历史记录）

---

## 🎯 推荐阅读路径

### 新手入门（按顺序）

1. **[Scheduler 架构](./architecture/ARCHITECTURE.md)**
   → 了解整体架构和核心模块

2. **[Pool 架构](./architecture/POOL_ARCHITECTURE.md)**
   → 理解 Pool 系统（有向语言对、笛卡尔积）

3. **[节点注册协议](./node_registry/node_registration.md)**
   → 学习节点注册和心跳机制

4. **[Redis 数据模型](./architecture/REDIS_DATA_MODEL.md)**
   → 掌握 Redis Key 设计和 Lua 脚本

### 深入理解

1. 阅读 Lua 脚本源码：
   - `scripts/lua/register_node_v2.lua`
   - `scripts/lua/heartbeat_with_pool_assign.lua`
   - `scripts/lua/select_node.lua`

2. 阅读核心 Rust 代码：
   - `src/services/minimal_scheduler.rs`
   - `src/pool/pool_service.rs`
   - `src/pool/types.rs`

---

## 🗂️ 代码模块对照

| 文档 | 对应代码模块 |
|------|-------------|
| [架构文档](./architecture/ARCHITECTURE.md) | `src/` (所有模块) |
| [Pool 架构](./architecture/POOL_ARCHITECTURE.md) | `src/pool/`, `scripts/lua/` |
| [节点注册](./node_registry/node_registration.md) | `src/websocket/node_handler/`, `src/pool/` |
| [Redis 数据模型](./architecture/REDIS_DATA_MODEL.md) | `scripts/lua/`, `src/redis_runtime/` |
| [多实例部署](./architecture/MULTI_INSTANCE_DEPLOYMENT.md) | `src/redis_runtime/` |
| [Finalize 处理](./finalize/README.md) | `src/websocket/session_actor/actor/` |
| [任务管理](./job/README.md) | `src/core/dispatcher/`, `src/websocket/job_creator.rs` |

---

## ⚙️ 核心概念速查

### 有向语言对

```
zh:en（中→英） ≠ en:zh（英→中）
一个节点加入所有（ASR语言 × TTS语言）的Pool
```

### Redis Key格式

```
节点: lingua:v1:node:{node_id}
Pool: lingua:v1:pool:{src}:{tgt}:{pool_id}:nodes
映射: lingua:v1:node:{node_id}:pools
绑定: lingua:v1:job:{job_id}:node
Session: scheduler:session:{session_id}
```

### Lua脚本

```
register_node_v2.lua           - 节点注册
heartbeat_with_pool_assign.lua - 心跳和Pool分配
select_node.lua                - 节点选择（支持Session Affinity）
node_offline.lua               - 节点清理
```

**注意**: `complete_task.lua` 已删除（空实现，无需调用）

### Finalize 类型

```
IsFinal        - 手动 finalize（客户端发送 is_final=true）
Timeout        - 超时 finalize（3秒无新音频）
MaxDuration    - 最大时长 finalize（超过最大时长自动切分）
MaxLength      - 最大长度 finalize（超过最大长度，异常）
```

### 配置

```toml
[scheduler.phase2]
enabled = true  # 必需

[scheduler.phase2.redis]
url = "redis://localhost:6379"
```

---

## ❓ 常见问题

### Q1: Phase3是什么？为什么删除了？
**A**: Phase3是旧的配置驱动Pool系统，已被废弃。  
当前使用 **MinimalScheduler + PoolService (Lua脚本系统)**。

### Q2: dispatch_task.lua去哪了？
**A**: 已删除。实际使用 `select_node.lua` 进行节点选择。

### Q3: complete_task.lua去哪了？
**A**: 已删除。complete_task.lua 是空实现，任务完成只需更新Redis中的Job状态，无需调用Lua。

### Q4: Job状态存储在哪里？
**A**: Job状态存储在Redis中（`lingua:v1:job:{job_id}`），是SSOT。audio_data不存储在Job中，从AudioBufferManager获取。

### Q5: Pool如何分配？
**A**: 节点心跳时，Lua脚本自动生成笛卡尔积并分配到Pool。  
参考: [Pool 架构](./architecture/POOL_ARCHITECTURE.md)

### Q6: 为什么是有向语言对？
**A**: 
- `zh:en` = 中文识别 → 英文输出
- `en:zh` = 英文识别 → 中文输出
- 两者是不同的任务场景，需要分开

### Q7: 如何查看Pool状态？
**A**: 
```bash
redis-cli KEYS "lingua:v1:pool:*:nodes"
redis-cli SMEMBERS lingua:v1:nodes:all
```

### Q8: Session Affinity 是什么？
**A**: Session Affinity 机制确保相关 job 路由到同一个节点，用于 AudioAggregator 合并音频。  
参考: [Session Affinity 和节点路由](./node_registry/session_affinity.md)

### Q9: 不同 Finalize 类型的处理路径？
**A**: 
- **MaxDuration**: 按能量切片，处理前5秒（及以上），剩余部分缓存
- **手动/Timeout**: 立即处理，合并 pending 音频
参考: [Finalize 处理机制](./finalize/README.md)

### Q10: 如何运行调度器单元测试？
**A**: 在 `central_server/scheduler` 目录下执行 `cargo test --lib`。当前约 36 例通过（含 job_creator、pool_service、audio_duration、job_idempotency、node_data 等）。依赖 Redis 的集成测试在 `tests.disabled` 或需单独环境。Finalize / Turn 亲和相关逻辑由 lib 内单元测试覆盖；详细验证见 [调度器 finalize 聚合修复与备份对齐](../../troubleshooting/调度器_finalize聚合修复_与备份对齐_2026_01.md#4-测试验证2026-01)。

---

## 🔄 最近更新

### 2026-01-24（文档整理完成）
- ✅ **完成文档模块化整理**
  - 创建 `finalize/` 模块（6个文档）
  - 创建 `node_registry/` 模块（3个文档）
  - 创建 `job/` 模块（3个文档）
  - 创建 `audio/` 模块（2个文档）
  - 创建 `aggregator/` 模块（2个文档）
  - 创建 `integration_test/` 模块（3个文档）
  - 创建 `architecture/` 模块（5个文档）
  - 创建 `backup_comparison/` 模块（归档）
- ✅ 删除过期文档（Pause Finalize 相关和已合并文档）
- ✅ 更新主 README.md

### 2026-01-22（代码清理完成）
- ✅ **删除所有未使用的代码**（除会议室相关外）
- ✅ 编译通过（无错误）
- ✅ 所有测试通过（42个测试）

### 2026-01-22（优化实施完成）
- ✅ **所有3个优化点已完成实施**
- ✅ 删除所有 `#[allow(dead_code)]` 标记和未使用的代码
- ✅ 所有测试通过（36个测试）

---

## 🔗 相关文档

- [Central Server文档](../../docs/README.md)
- [项目文档总索引](../../../docs/README.md)
- [节点端流式 ASR 文档](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/README.md)

---

**维护团队**: Scheduler开发组  
**反馈渠道**: 项目Issue  
**文档版本**: v3.0（MinimalScheduler + Lua Pool）
