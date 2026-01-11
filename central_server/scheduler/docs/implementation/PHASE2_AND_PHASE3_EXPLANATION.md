# Phase2 和 Phase3 功能说明

## 概述

Phase2 和 Phase3 是调度系统的两个**独立但可组合**的功能模块，分别解决不同的问题：

| 特性 | Phase2 | Phase3 |
|------|--------|--------|
| **核心功能** | 多实例支持（横向扩展） | 两级调度（性能优化） |
| **主要目标** | 实现多实例部署的一致性 | 优化节点选择性能 |
| **依赖** | 需要 Redis | 可选（如果启用 Phase2，Pool 成员从 Redis 读取） |
| **启用方式** | 配置 `phase2.enabled = true` | 配置 `phase3.enabled = true` |
| **关系** | 可以独立启用 | 可以独立启用，但通常与 Phase2 配合使用 |

---

## Phase2：多实例支持（Multi-instance Deployment）

### 1.1 核心功能

**Phase2** 的主要目标是让调度服务器支持**横向扩展（多实例部署）**，通过 Redis 作为共享状态存储，实现跨实例的一致性。

### 1.2 解决的问题

在多实例环境下，如果没有 Phase2，会出现以下问题：

1. **重复调度**：多个实例可能同时将同一个任务分配给不同的节点
2. **资源泄漏**：节点槽位预留（reservation）可能在不同实例间不一致
3. **消息投递失败**：跨实例的消息（如节点消息、会话消息）无法正确投递
4. **节点状态不一致**：不同实例看到的节点状态可能不同

### 1.3 关键能力

Phase2 提供以下关键能力：

#### 1.3.1 实例存在性（Presence）
- 每个调度实例启动后周期性写入 Redis presence key（带 TTL）
- 用于跨实例判断目标实例是否存活

#### 1.3.2 Owner 绑定（Node/Session -> Instance）
- 节点/会话与调度实例的绑定关系存储在 Redis
- 断开连接时清除，后台续约 TTL

#### 1.3.3 跨实例可靠投递（Redis Streams）
- 使用 Redis Streams 实现跨实例消息投递
- 支持 consumer group + pending + failover reclaim
- 包含 DLQ（Dead Letter Queue）机制

#### 1.3.4 节点快照同步（Node Snapshot）
- 每个实例将本地节点快照写入 Redis
- 各实例后台拉取全量快照，保持全局节点视图一致

#### 1.3.5 节点能力同步（Node Capabilities）
- 节点能力信息（ASR、NMT、TTS、Tone）存储在 Redis
- 所有实例从 Redis 读取，保证一致性

#### 1.3.6 节点并发控制（Reservation）
- 使用 Redis Lua 脚本实现原子预留
- 防止多实例同时分配导致节点超载

#### 1.3.7 任务状态机（Job FSM）
- Job 生命周期状态外置到 Redis
- 通过 Lua 脚本保证关键迁移的原子性和幂等性

#### 1.3.8 Request 幂等
- 同一 `request_id` 在多实例并发下只会生成/绑定一个 job

### 1.4 配置示例

```toml
[scheduler.phase2]
enabled = true
instance_id = "scheduler-1"  # 每个实例必须唯一
owner_ttl_seconds = 45
stream_block_ms = 1000
stream_count = 64
stream_group = "scheduler"
stream_maxlen = 10000

[scheduler.phase2.redis]
mode = "single"  # 或 "cluster"
url = "redis://your-redis-host:6379"
key_prefix = "lingua-prod"  # 用于多环境隔离

[scheduler.phase2.node_snapshot]
enabled = true
presence_ttl_seconds = 45
refresh_interval_ms = 2000
remove_stale_after_seconds = 600
```

### 1.5 代码位置

- **核心实现**：`central_server/scheduler/src/phase2/`
  - `runtime_init.rs`：初始化、key 规划、owner、presence
  - `runtime_routing.rs`：跨实例投递入口
  - `runtime_job_fsm.rs`：Job FSM（Redis + Lua）
  - `runtime_background.rs`：后台任务（presence/owner 续约、inbox worker、snapshot refresher）
  - `runtime_snapshot.rs`：节点快照写入/刷新/清理
  - `runtime_streams.rs`：Streams inbox worker / reclaim / DLQ
  - `redis_handle.rs`：Redis 连接与命令封装

### 1.6 文档参考

- `central_server/scheduler/docs/phase2_implementation.md`：详细实现文档
- `central_server/scheduler/docs/MULTI_INSTANCE_DEPLOYMENT.md`：多实例部署指南

---

## Phase3：两级调度（Two-level Scheduling）

### 2.1 核心功能

**Phase3** 的主要目标是实现**两级调度机制**，优化节点选择性能。

**两级调度**：
1. **第一级：Pool 选择** - 从多个 Pool（节点池）中选择一个
2. **第二级：节点选择** - 在选定的 Pool 内选择具体的节点

### 2.2 解决的问题

在节点数量较大时（> 100），如果直接遍历所有节点进行选择，会导致：
- **性能问题**：选择效率线性下降
- **可扩展性问题**：节点数量增长时，选择时间显著增加
- **可观测性问题**：难以按 Pool 进行指标统计和容量规划

### 2.3 设计目标

根据 `config_types.rs` 的注释：
> 目标：在节点规模增大时，把"全量遍历选节点"收敛为"先选 pool，再在 pool 内选 node"，并提供可观测性与可运维性。

**优势**：
- ✅ **性能优化**：避免全量遍历所有节点
- ✅ **可扩展性**：节点数量增长时，选择效率不会线性下降
- ✅ **可观测性**：提供 Pool 级别的指标和日志
- ✅ **可运维性**：可以按 Pool 进行容量规划和隔离

### 2.4 工作流程

#### 2.4.1 节点注册流程

```
1. 节点注册：节点支持 {zh, en} 语言集合
2. Pool 创建：自动创建 en-zh Pool（如果不存在）
3. 节点分配：节点被分配到 en-zh Pool
4. Redis 同步：Pool 成员索引同步到 Redis（如果启用 Phase2）
```

#### 2.4.2 任务分配流程

```
任务请求（src_lang, tgt_lang）
  ↓
【Phase3 启用？】
  ├─ 是 → 两级调度
  │    ├─ 第一级：选择 Pool（搜索包含 src_lang 和 tgt_lang 的 Pool）
  │    └─ 第二级：在 Pool 内选择节点（随机采样 + 负载排序）
  │
  └─ 否 → 单级选择（直接遍历所有节点）
```

### 2.5 Pool 生成方式

Phase3 支持两种 Pool 生成方式：

#### 2.5.1 自动生成（推荐）
- 根据节点语言能力自动生成 Pool
- 配置：`auto_generate_language_pools = true`
- Pool 命名：语言集合（如 `zh-en`、`en-zh`）

#### 2.5.2 手动配置
- 在配置文件中定义 Pool
- 配置：`auto_generate_language_pools = false`
- 需要手动定义每个 Pool 的 `required_services` 和语言对

### 2.6 配置示例

```toml
[scheduler.phase3]
enabled = true
mode = "two_level"  # 目前仅支持 "two_level"
auto_generate_language_pools = true
enable_session_affinity = false  # 默认 false，随机选择
random_sample_size = 20  # 随机采样节点数量

[scheduler.phase3.auto_pool_config]
min_nodes_per_pool = 1  # 最小节点数
max_pools = 100  # 最大 Pool 数量
pool_naming = "set"  # Pool 命名规则
require_semantic = true  # 是否包含语义修复服务
enable_mixed_pools = false  # 是否启用混合池
```

### 2.7 代码位置

- **核心实现**：`central_server/scheduler/src/node_registry/`
  - `phase3_pool.rs`：Pool 分配、Pool 索引管理
  - `selection/selection_phase3.rs`：两级节点选择逻辑
  - `phase3_core_cache.rs`：Pool 核心能力缓存
  - `auto_language_pool.rs`：自动生成语言 Pool

### 2.8 文档参考

- `central_server/scheduler/docs/PHASE3_EXPLANATION.md`：详细说明文档
- `central_server/scheduler/docs/POOL_ARCHITECTURE.md`：Pool 架构文档

---

## Phase2 和 Phase3 的关系

### 3.1 独立但可组合

Phase2 和 Phase3 是**独立的功能模块**，可以：
- **单独启用 Phase2**：实现多实例支持，但不使用 Pool 机制
- **单独启用 Phase3**：使用 Pool 机制，但 Pool 成员存储在内存（单实例）
- **同时启用**：多实例 + Pool 机制（推荐配置）

### 3.2 推荐配置（多实例环境）

```toml
[scheduler.phase2]
enabled = true  # 启用多实例支持
instance_id = "scheduler-1"
# ... 其他配置

[scheduler.phase3]
enabled = true  # 启用两级调度
mode = "two_level"
auto_generate_language_pools = true
# ... 其他配置
```

**效果**：
- **Phase2**：Pool 成员索引同步到 Redis（多实例一致性）
- **Phase3**：使用 Pool 机制进行两级调度（性能优化）

### 3.3 数据流向

当同时启用 Phase2 和 Phase3 时：

```
节点注册/心跳
  ↓
Phase2：节点能力同步到 Redis
  ↓
Phase3：根据节点能力分配 Pool
  ↓
Phase2：Pool 成员索引同步到 Redis
  ↓
任务分配
  ↓
Phase3：从 Redis 读取 Pool 成员（Phase2 提供）
  ↓
Phase2：原子预留节点槽位（Redis Lua 脚本）
```

### 3.4 关键依赖

- **Phase3 依赖 Phase2**：如果启用 Phase2，Phase3 的 Pool 成员索引会从 Redis 读取（保证多实例一致性）
- **Phase2 不依赖 Phase3**：Phase2 可以独立工作，不依赖 Pool 机制

---

## 常见问题

### Q1: Phase2 必须启用吗？

**A**: 不是必须的。如果只有单实例部署，可以不启用 Phase2。但如果需要横向扩展（多实例），必须启用 Phase2。

### Q2: Phase3 必须启用吗？

**A**: 不是必须的。如果节点数量较少（< 50），可以不启用 Phase3，系统会回退到单级选择。但如果节点数量较多（> 100），建议启用 Phase3 以优化性能。

### Q3: Phase2 和 Phase3 可以单独使用吗？

**A**: 可以。但推荐在多实例环境下同时启用，以获得最佳性能和一致性。

### Q4: 如何验证 Phase2 是否工作？

**A**: 
1. 检查日志：查看是否有 "Phase2 enabled" 相关日志
2. 检查 Redis：查看是否有 `{prefix}:schedulers:presence:*` key
3. 检查配置：确认 `phase2.enabled = true`

### Q5: 如何验证 Phase3 是否工作？

**A**: 
1. 检查日志：查看是否有 "Phase3 two-level scheduling" 相关日志
2. 检查指标：查看 `phase3_pool_selected` 指标
3. 检查配置：确认 `phase3.enabled = true`

---

## 总结

- ✅ **Phase2**：多实例支持，通过 Redis 实现跨实例一致性
- ✅ **Phase3**：两级调度，通过 Pool 机制优化节点选择性能
- ✅ **可以独立启用**，也可以组合使用
- ✅ **推荐配置**：多实例环境下同时启用 Phase2 和 Phase3

---

**最后更新**: 2026-01-XX
