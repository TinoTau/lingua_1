# Scheduler 扩展与容量规划

**状态**: ✅ **已实现基础功能，扩展方案已规划**

## 概述

本文档说明 Scheduler 的扩展方案和容量规划，包括 Redis 状态外置设计（Phase 2）。

## 当前架构（Phase 0）

### 核心职责

- **控制面（Control Plane）**
  - 节点选择与调度决策
  - 功能感知节点匹配
  - 资源阈值过滤（CPU / GPU / 内存）
- **状态维护**
  - 节点在线状态（心跳）
  - 节点当前任务数
  - 节点能力快照
- **运行期统计**
  - WebSocket 活跃用户数
  - 语言使用统计
  - 模型/服务包算力提供统计

### 当前实现特征

- 单实例运行
- 内存状态管理（HashMap）
- 同步任务分发
- 基础负载均衡（最少连接数）

## 容量边界

### Phase 0（当前）

- **节点数**: < 100
- **并发会话**: < 1000
- **吞吐量**: < 100 req/s

### Phase 1（控制面扩展）

- **节点数**: < 500
- **并发会话**: < 5000
- **吞吐量**: < 500 req/s

### Phase 2（多实例 + Redis）

- **节点数**: < 5000
- **并发会话**: < 50000
- **吞吐量**: < 5000 req/s

## 扩展方案

### Phase 1: 控制面扩展

**目标**: 解耦控制面与数据面，提升单实例性能

**措施**:
- 异步任务分发
- 批量状态更新
- 缓存优化
- 连接池管理

### Phase 2: 多实例 + Redis

**目标**: 支持多实例部署，状态外置到 Redis

**措施**:
- Redis 状态外置
- 分布式锁
- 会话绑定外置
- 统计快照

## Redis 设计（Phase 2）

### Key 设计规范

- 命名空间: `lingua:v1:`
- 结构: `<namespace>:<category>:<identifier>`

### 核心数据结构

1. **节点在线状态**: `lingua:v1:nodes:<node_id>`
2. **节点能力**: `lingua:v1:caps:<node_id>`
3. **会话绑定**: `lingua:v1:session:<session_id>`
4. **任务计数**: `lingua:v1:jobs:<node_id>`
5. **统计快照**: `lingua:v1:stats:snapshot`

### 原子操作

使用 Redis Lua 脚本保证原子性：
- 会话绑定与节点计数
- 任务分发与状态更新
- 节点注册与能力更新

## 实施建议

### 最小可行清单（Phase 2）

1. Presence + Caps 外置（Redis）
2. Session Bind 外置 + 幂等 request_id
3. 绑定与节点并发计数的原子化 Lua
4. MODEL_NOT_AVAILABLE 去抖 key
5. Dashboard 改为读取 snapshot

## 风险与注意事项

1. 不要在早期过度引入分布式复杂度
2. 控制面扩展优先于算法微优化
3. Dashboard 必须与调度主路径解耦
4. 所有调度接口必须幂等（request_id）
5. Redis key 设计要避免热点与大 value

## 相关文档

- [任务分发优化方案](../scheduler/DISPATCHER_OPTIMIZATION_PLAN.md)
- [Phase 2 开发进度记录](./Scheduler_Phase2_开发进度记录_2025-12-19.md)
- [Phase 2 决策补充](./Scheduler_Phase2_决策补充_v1.1_Instance_Job_Redis.md)

---

**最后更新**: 2025-12-18

