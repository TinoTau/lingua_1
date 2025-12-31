# 调度服务器文档

本目录包含调度服务器（Scheduler）相关的设计文档和实现说明。

## 核心文档

- [架构文档](./ARCHITECTURE.md) - 完整的架构说明和模块介绍
- [任务分发算法优化方案](./DISPATCHER_OPTIMIZATION_PLAN.md) - 负载均衡和功能感知节点选择
- [Dashboard 说明](./DASHBOARD.md) - Dashboard 功能说明
- [GPU 要求说明](./GPU_REQUIREMENT_EXPLANATION.md) - GPU 要求说明

## Phase 2（多实例 + Redis）

- **实现总览（代码内文档）**：`../../scheduler/docs/phase2_implementation.md`
- **Streams/DLQ 运维**：`../../scheduler/docs/phase2_streams_ops.md`
- **Cluster 一键验收脚本**：`../../scheduler/scripts/phase2_cluster_acceptance.ps1`
- **双实例手工 smoke test**：`../../scheduler/scripts/phase2_smoketest.ps1`
- **项目侧进度记录**：`../project/Scheduler_Phase2_开发进度记录_2025-12-19.md`
- **容量规划与扩展**：`../project/SCHEDULER_CAPACITY_AND_SCALING.md`

## 相关文档

- `../README.md` - central_server 总览与启动入口
- `../testing/TEST_GUIDE.md` - 测试运行指南
- `../testing/TEST_STATUS.md` - 测试状态概览

