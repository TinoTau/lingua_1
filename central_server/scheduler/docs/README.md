# Scheduler 调度服务器技术文档

**版本**: v4.1  
**更新日期**: 2026年1月18日  
**维护者**: Lingua团队

---

## 📚 文档结构

当前文档目录：

```
docs/
├── README.md                                        # 本文档（总览）
├── architecture/                                    # 架构设计文档
│   ├── SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md  # v4.1架构（最新）
│   ├── LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md       # 无锁调度规范
│   ├── NODE_JOB_FLOW_MERGED_TECH_SPEC_v1.0.md      # 节点Job流程规范
│   └── NODE_RUNTIME_SNAPSHOT_ARCHITECTURE_v1.md    # 节点快照架构
└── design/                                          # 功能设计文档
    ├── POOL_ARCHITECTURE.md                         # Pool架构
    ├── NODE_REGISTRATION.md                         # 节点注册
    ├── CAPABILITY_BY_TYPE_DESIGN.md                 # 能力设计
    ├── JOB_FSM_STATE_MAPPING.md                     # Job状态机
    ├── LANGUAGE_SET_POOL_IMPLEMENTATION.md          # 语言集Pool实现
    ├── NODE_CAPACITY_CONTROL_MECHANISM.md           # 节点容量控制
    └── MULTI_INSTANCE_DEPLOYMENT.md                 # 多实例部署

总计：12个核心文档
```

---

## 🏗️ 系统架构概览

### 核心设计理念（v4.1）

Scheduler v4.1 采用 **多实例 + Redis同步 + 随机分配** 架构：

```
┌─────────────────────────────────────────────────────────┐
│               Scheduler v4.1 Architecture                 │
├─────────────────────────────────────────────────────────┤
│  1. NodeRegistry（节点注册与管理）                      │
│     ├─ 节点注册/心跳处理                                │
│     ├─ 能力维护（ASR/NMT/SR/TTS）                      │
│     └─ Pool成员关系更新                                 │
│                                                           │
│  2. PoolIndex（节点池索引）                             │
│     ├─ 维护 pool_members[(src,tgt)] -> set(node_id)   │
│     ├─ Pool重叠支持（节点可属于多个Pool）              │
│     └─ 快速查询候选节点                                 │
│                                                           │
│  3. NodeReservation（并发控制）                         │
│     ├─ try_reserve(node_id)：原子预留                  │
│     ├─ release(node_id)：释放预留                      │
│     └─ Redis实现跨实例一致性                            │
│                                                           │
│  4. Dispatcher（任务分发）                              │
│     ├─ 随机选择候选节点                                 │
│     ├─ 依次尝试预留                                     │
│     └─ 成功后派发任务                                   │
│                                                           │
│  5. Session Affinity（可选）                            │
│     ├─ 超时finalize时记录session->node映射            │
│     └─ 支持用户指定节点（预留接口）                     │
└─────────────────────────────────────────────────────────┘
```

### 关键特性

- ✅ **无锁调度**：基于Redis原子操作实现并发控制
- ✅ **随机分配**：默认不做session粘性，避免用户信息固定
- ✅ **Pool重叠**：节点可属于多个Pool，提高资源利用率
- ✅ **多实例支持**：通过Redis同步状态，支持水平扩展
- ✅ **预留机制**：防止节点超卖，确保任务分配正确性
- ✅ **语义修复优先**：以semantic_langs为准，确保翻译质量

---

## 🎯 核心功能

### 1. 节点注册与Pool生成

**功能**: 节点启动时注册到Scheduler，自动加入对应的语言对Pool

**关键流程**:

```
节点注册 → 提取能力（semantic_langs） → 生成语言对 → 加入Pool
```

**Pool生成规则**:
- **面对面模式（F2F）**: 生成 `A->B` 和 `B->A` 两个Pool
- **单向模式**: 仅生成 `src->tgt` Pool
- **语义修复必选**: 只有semantic_langs中的语言才能作为源语言

**相关文档**:
- `design/NODE_REGISTRATION.md` - 节点注册流程详解
- `design/POOL_ARCHITECTURE.md` - Pool架构设计
- `design/LANGUAGE_SET_POOL_IMPLEMENTATION.md` - 语言集Pool实现

**示例场景**:

```rust
// 节点注册信息
Node {
  semantic_langs: ["zh", "en", "ja"],
  nmt_langs: ["zh", "en", "ja", "ko"],
  tts_langs: ["zh", "en"]
}

// 生成的Pool（面对面模式）
Pool_zh_en: [node_id]
Pool_en_zh: [node_id]
Pool_zh_ja: [node_id]
Pool_ja_zh: [node_id]
Pool_en_ja: [node_id]
Pool_ja_en: [node_id]

// ko不在semantic_langs中，不生成以ko为源的Pool
```

---

### 2. 任务分配（随机+预留）

**功能**: 根据任务的语言对随机选择节点，通过预留机制确保不超卖

**分配流程**:

```
1. 根据(src_lang, tgt_lang)查询Pool，获取候选节点集合
2. 从候选集中随机采样N个节点（N=3-5）
3. 依次尝试 try_reserve(node_id)
4. 预留成功 → 派发任务
5. 预留失败 → 尝试下一个节点
6. 所有节点都失败 → 返回"无可用节点"错误
```

**预留机制**:

```lua
-- Redis Lua脚本实现原子预留
local current = redis.call('GET', 'node:' .. node_id .. ':running_jobs')
local max_jobs = redis.call('GET', 'node:' .. node_id .. ':max_concurrent_jobs')

if current < max_jobs then
  redis.call('INCR', 'node:' .. node_id .. ':running_jobs')
  return 1  -- 预留成功
else
  return 0  -- 节点已满
end
```

**相关文档**:
- `architecture/SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md` - 完整设计方案
- `architecture/LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md` - Lua脚本规范
- `design/NODE_CAPACITY_CONTROL_MECHANISM.md` - 容量控制机制

---

### 3. Session Affinity（会话粘性）

**功能**: 特定场景下将session绑定到固定节点，提高连续性

**使用场景**:
- **超时finalize**: 音频被切分后，后续的小片段继续发送到同一节点
- **用户指定节点**: 用户明确要求使用特定节点（预留接口）

**实现机制**:

```rust
// 超时finalize时记录session->node映射
if job.is_timeout_triggered {
  session_affinity_manager.set_affinity(session_id, node_id);
}

// 下次分配时优先尝试绑定节点
if let Some(affinity_node) = session_affinity_manager.get_affinity(session_id) {
  if try_reserve(affinity_node).await.is_ok() {
    return Some(affinity_node);  // 使用绑定节点
  }
}

// 绑定节点不可用，回退到随机分配
random_select_and_reserve().await
```

**清除时机**:
- 手动/pause finalize: 清除绑定，允许随机分配
- 超时（10秒）: 自动清除过期绑定

**相关文档**:
- `architecture/NODE_JOB_FLOW_MERGED_TECH_SPEC_v1.0.md` - Session Affinity流程

---

### 4. 节点快照（Runtime Snapshot）

**功能**: 快速获取节点状态，避免频繁访问Redis

**快照内容**:

```rust
struct NodeRuntimeSnapshot {
  pool_members: HashMap<(String, String), Vec<NodeId>>,  // Pool成员
  node_capabilities: HashMap<NodeId, NodeCapability>,     // 节点能力
  node_capacity: HashMap<NodeId, (u32, u32)>,            // (running_jobs, max_jobs)
  last_update: Instant,                                   // 最后更新时间
}
```

**更新策略**:
- **增量更新**: 节点注册/心跳时更新对应节点
- **定期刷新**: 每5秒全量刷新一次
- **失效检测**: 心跳超时的节点标记为不可用

**相关文档**:
- `architecture/NODE_RUNTIME_SNAPSHOT_ARCHITECTURE_v1.md` - 快照架构详解

---

### 5. 多实例部署

**功能**: 多个Scheduler实例共享Redis状态，实现高可用和水平扩展

**一致性保证**:
- **节点预留**: 通过Redis Lua脚本原子操作
- **Pool更新**: 通过Redis Pub/Sub同步
- **心跳检测**: 各实例独立检测，Redis统一记录

**部署架构**:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Scheduler 1 │    │ Scheduler 2 │    │ Scheduler 3 │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┴──────────────────┘
                          │
                    ┌─────▼─────┐
                    │   Redis   │
                    │  Cluster  │
                    └───────────┘
```

**相关文档**:
- `design/MULTI_INSTANCE_DEPLOYMENT.md` - 多实例部署指南

---

## 🔧 设计文档详解

### architecture/ - 架构设计文档

#### 1. SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md（必读）

**内容**:
- v4.1架构完整设计方案
- 面对面模式（F2F）任务分配机制
- 随机分配 + 预留机制详解
- 模块划分与接口设计

**行数**: 约600行

**适用场景**:
- 架构评审
- 新功能开发
- 系统设计参考

#### 2. LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md

**内容**:
- 无锁调度器技术规范
- Redis Key设计规范
- Lua脚本实现规范
- 并发控制机制

**行数**: 约400行

**适用场景**:
- Redis集成开发
- 并发控制实现
- Lua脚本编写

#### 3. NODE_JOB_FLOW_MERGED_TECH_SPEC_v1.0.md

**内容**:
- 节点和Job管理流程规范
- Session Affinity实现
- 状态机设计
- 错误处理流程

**行数**: 约350行

#### 4. NODE_RUNTIME_SNAPSHOT_ARCHITECTURE_v1.md

**内容**:
- 节点快照架构设计
- 缓存更新策略
- 性能优化方案

**行数**: 约250行

---

### design/ - 功能设计文档

#### 1. POOL_ARCHITECTURE.md

**内容**:
- Pool架构设计理念
- 语言对Pool生成规则
- Pool重叠机制

**行数**: 约200行

#### 2. NODE_REGISTRATION.md

**内容**:
- 节点注册流程
- 能力提取与验证
- Pool成员关系更新

**行数**: 约180行

#### 3. CAPABILITY_BY_TYPE_DESIGN.md

**内容**:
- capability_by_type数据结构
- 按类型分类节点能力
- 快速查询优化

**行数**: 约150行

#### 4. JOB_FSM_STATE_MAPPING.md

**内容**:
- Job状态机设计
- 状态转换规则
- 错误状态处理

**行数**: 约160行

#### 5. LANGUAGE_SET_POOL_IMPLEMENTATION.md

**内容**:
- 语言集Pool实现总结
- semantic_langs优先策略
- Pool生成算法

**行数**: 约170行

#### 6. NODE_CAPACITY_CONTROL_MECHANISM.md

**内容**:
- 节点容量控制机制
- max_concurrent_jobs管理
- 动态容量调整

**行数**: 约140行

#### 7. MULTI_INSTANCE_DEPLOYMENT.md

**内容**:
- 多实例部署架构
- Redis配置建议
- 负载均衡策略

**行数**: 约190行

---

## 🚀 快速导航

### 新开发者

1. **了解整体架构**
   - 阅读本文档（README.md）
   - 查看 `SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md`

2. **深入核心模块**
   - 节点注册：`NODE_REGISTRATION.md`
   - Pool架构：`POOL_ARCHITECTURE.md`
   - 任务分配：`LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md`

3. **理解关键概念**
   - Pool重叠：`POOL_ARCHITECTURE.md`
   - 预留机制：`NODE_CAPACITY_CONTROL_MECHANISM.md`
   - Session Affinity：`NODE_JOB_FLOW_MERGED_TECH_SPEC_v1.0.md`

### 架构评审

1. 阅读 `SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md` 了解v4.1架构
2. 查看 `LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md` 了解无锁实现
3. 参考 `MULTI_INSTANCE_DEPLOYMENT.md` 了解部署方案

### 问题排查

1. **任务分配失败**
   - 检查Pool成员关系是否正确
   - 检查节点容量是否已满
   - 查看日志：`Dispatcher: No available node for job`

2. **节点未加入Pool**
   - 检查节点注册信息（semantic_langs）
   - 检查Pool生成逻辑
   - 查看日志：`NodeRegistry: Registered node with capabilities`

3. **Session粘性失效**
   - 检查Session Affinity映射是否存在
   - 检查绑定节点是否可用
   - 查看日志：`SessionAffinityManager: Set affinity for session`

---

## 📐 设计原则

### 1. 正确性优先

- **不超卖节点**: 通过预留机制确保节点不超载
- **原子操作**: 使用Redis Lua脚本保证并发安全
- **状态一致性**: 多实例通过Redis同步状态

### 2. 简单可维护

- **Pool是索引**: Pool只负责查询，不负责并发控制
- **并发控制在Node级别**: 全局唯一的节点预留计数
- **随机分配**: 避免复杂的负载均衡算法

### 3. 可扩展性

- **Pool重叠**: 节点可属于多个Pool
- **多实例支持**: 通过Redis实现水平扩展
- **预留接口**: 支持用户指定节点（未来功能）

### 4. 性能优化

- **节点快照**: 减少Redis访问频率
- **增量更新**: 只更新变化的节点
- **批量操作**: 心跳检测批量处理

---

## 📊 性能指标

### 任务分配

- **平均延迟**: <5ms（本地快照查询）
- **预留操作**: <2ms（Redis Lua脚本）
- **吞吐量**: >10000 jobs/s（单实例）

### 节点管理

- **注册延迟**: <10ms
- **心跳处理**: <3ms
- **Pool更新**: <5ms

### Redis负载

- **QPS**: 约5000（单实例，含心跳）
- **内存占用**: 约100MB（1000个节点）

---

## 🔄 版本历史

### v4.1 (2026-01-18)

**重大更新**:
- ✅ 采用随机分配策略，默认不做session粘性
- ✅ 引入预留机制（NodeReservation），防止节点超卖
- ✅ Pool重叠支持，节点可属于多个Pool
- ✅ 预留用户指定节点接口（暂未实现UI）
- ✅ 清理所有测试报告和临时文档（删除149+ → 保留12个核心文档）

**核心变更**:
- **无锁调度**: 基于Redis Lua脚本实现原子预留
- **面对面模式（F2F）**: 专为双语互译场景优化
- **语义修复优先**: 以semantic_langs为准生成Pool

### v3.0 (2025-12-20)

**初始版本**:
- 实现基于Pool的任务分配
- 实现节点注册与心跳检测
- 实现Session Affinity机制
- 支持多实例部署

---

## 📞 联系与支持

如有问题或建议，请参考相关文档或联系团队。

**文档维护原则**:
1. 核心文档控制在500行以内
2. 删除过期的测试报告和分析文档
3. 合并相关的实现总结
4. 保持文档与代码同步

---

**最后更新**: 2026年1月18日  
**维护者**: Lingua团队
