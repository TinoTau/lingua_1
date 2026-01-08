# Scheduler 文档索引

## 核心设计文档

1. **[SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md](./SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md)** - 核心设计文档（v4.1 面对面模式）
   - 任务分配与节点池管理技术方案
   - 多实例 + Redis 同步机制
   - 随机分配与预留机制

---

## 架构与设计

1. **[POOL_ARCHITECTURE.md](./POOL_ARCHITECTURE.md)** - Pool 架构设计（语言集合设计）
2. **[NODE_REGISTRATION.md](./NODE_REGISTRATION.md)** - 节点注册与 Pool 生成流程
3. **[NODE_CAPACITY_CONTROL_MECHANISM.md](./NODE_CAPACITY_CONTROL_MECHANISM.md)** - 节点容量控制机制
4. **[MULTI_INSTANCE_DEPLOYMENT.md](./MULTI_INSTANCE_DEPLOYMENT.md)** - 多实例部署指南

---

## 实现状态

1. **[IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)** - 实现状态总结
   - 核心功能实现状态
   - 测试状态总结
   - Pool Redis 迁移状态
   - 功能完整性评估

2. **[CODE_QUALITY.md](./CODE_QUALITY.md)** - 代码质量与清理报告
   - 已完成的清理工作
   - 客户端兼容性检查
   - 代码质量改进

---

## 可观测性

1. **[OBSERVABILITY_METRICS_IMPLEMENTATION.md](./OBSERVABILITY_METRICS_IMPLEMENTATION.md)** - 可观测性指标实现

---

## 其他文档

1. **[NODE_CLIENT_ALIGNMENT_CHECK.md](./NODE_CLIENT_ALIGNMENT_CHECK.md)** - 节点客户端对齐检查
2. **[LANGUAGE_SET_POOL_IMPLEMENTATION.md](./LANGUAGE_SET_POOL_IMPLEMENTATION.md)** - 语言集合 Pool 实现总结
3. **[CAPABILITY_BY_TYPE_DESIGN.md](./CAPABILITY_BY_TYPE_DESIGN.md)** - capability_by_type 设计说明

---

## 快速导航

### 设计文档
- **核心设计**：`SCHEDULER_V4_1_F2F_POOL_AND_RESERVATION_DESIGN.md`
- **Pool 架构**：`POOL_ARCHITECTURE.md`
- **节点注册**：`NODE_REGISTRATION.md`

### 实现文档
- **实现状态**：`IMPLEMENTATION_STATUS.md`
- **代码质量**：`CODE_QUALITY.md`
- **容量控制**：`NODE_CAPACITY_CONTROL_MECHANISM.md`
- **多实例部署**：`MULTI_INSTANCE_DEPLOYMENT.md`

---

## 更新历史

- **2026-01-XX**: 整理文档，合并重复内容，移除过期文档
  - 合并实现状态相关文档为 `IMPLEMENTATION_STATUS.md`
  - 合并清理相关文档为 `CODE_QUALITY.md`
  - 删除临时文档（日志分析、测试结果等）
  - 更新核心设计文档，确保与代码一致

---

**最后更新**: 2026-01-XX
