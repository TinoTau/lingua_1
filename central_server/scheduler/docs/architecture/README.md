# 架构文档索引

**最后更新**: 2026-01-24  
**目的**: 整理和索引所有架构相关的核心文档

---

## 📚 核心架构文档

### 1. 总体架构

- **[Scheduler 架构](./ARCHITECTURE.md)** ⭐
  - MinimalScheduler + Lua Pool 系统
  - 核心模块和组件
  - 架构原则和设计理念

### 2. Pool 系统

- **[Pool 架构](./POOL_ARCHITECTURE.md)** ⭐
  - 有向语言对概念
  - 笛卡尔积分配
  - Pool 分片机制
  - Lua 脚本详解

### 3. 数据模型

- **[Redis 数据模型](./REDIS_DATA_MODEL.md)** ⭐
  - lingua:v1:* Key 设计
  - 数据结构定义
  - Lua 脚本操作
  - 调试命令大全

### 4. 部署和运维

- **[多实例部署](./MULTI_INSTANCE_DEPLOYMENT.md)**
  - 实例间通信（Phase2）
  - Ownership 管理
  - 运维指南

### 5. 优化历史

- **[优化历史](./OPTIMIZATION_HISTORY.md)**
  - Phase1: 单机优化
  - Phase2: 多实例部署
  - Phase3: Pool 系统（当前）
  - 容量规划和架构演进

### 6. 架构分析

- **[complete_task 架构分析](./complete_task_analysis.md)**
  - 备份代码 vs 当前代码的架构差异
  - 双写架构 vs 单写架构（Redis SSOT）

- **[Job状态存储架构分析](./job_state_architecture.md)**
  - Job状态存储位置分析
  - 本地锁 vs Redis SSOT
  - 多实例部署问题

---

## 🔍 快速导航

### 按问题查找

| 问题 | 相关文档 |
|------|---------|
| Scheduler 的整体架构是什么？ | [Scheduler 架构](./ARCHITECTURE.md) |
| Pool 系统如何工作？ | [Pool 架构](./POOL_ARCHITECTURE.md) |
| Redis Key 如何设计？ | [Redis 数据模型](./REDIS_DATA_MODEL.md) |
| 如何部署多实例？ | [多实例部署](./MULTI_INSTANCE_DEPLOYMENT.md) |
| 系统如何演进？ | [优化历史](./OPTIMIZATION_HISTORY.md) |
| 为什么任务管理里还有锁？ | [Job状态存储架构分析](./job_state_architecture.md) |
| complete_task 是什么？ | [complete_task 架构分析](./complete_task_analysis.md) |

### 按角色查找

| 角色 | 相关文档 |
|------|---------|
| 系统架构师 | 所有文档 |
| 开发者 | [Scheduler 架构](./ARCHITECTURE.md), [Pool 架构](./POOL_ARCHITECTURE.md) |
| 运维人员 | [多实例部署](./MULTI_INSTANCE_DEPLOYMENT.md), [Redis 数据模型](./REDIS_DATA_MODEL.md) |
| 问题诊断人员 | [Job状态存储架构分析](./job_state_architecture.md), [complete_task 架构分析](./complete_task_analysis.md) |

---

## 🎯 推荐阅读路径

### 新手入门（按顺序）

1. **[Scheduler 架构](./ARCHITECTURE.md)**
   → 了解整体架构和核心模块

2. **[Pool 架构](./POOL_ARCHITECTURE.md)**
   → 理解 Pool 系统（有向语言对、笛卡尔积）

3. **[Redis 数据模型](./REDIS_DATA_MODEL.md)**
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

## 🔗 相关文档

- [节点注册和管理](../node_registry/README.md)
- [Finalize 处理机制](../finalize/README.md)
- [任务管理](../job/README.md)

---

## 📅 更新历史

- **2026-01-24**: 创建架构文档索引，整理和归档架构相关文档
- **2026-01-24**: 归档 complete_task 和 Job状态存储架构分析文档
