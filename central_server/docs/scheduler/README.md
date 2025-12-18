# 调度服务器文档

本目录包含调度服务器（Scheduler）相关的设计文档和实现说明。

## 文档列表

- [任务分发算法优化方案](./DISPATCHER_OPTIMIZATION_PLAN.md) - 负载均衡和功能感知节点选择的详细优化方案

### Phase 2（多实例 + Redis）

- **实现总览（代码内文档）**：`../../scheduler/docs/phase2_implementation.md`
- **Streams/DLQ 运维**：`../../scheduler/docs/phase2_streams_ops.md`
- **Cluster 一键验收脚本**：`../../scheduler/scripts/phase2_cluster_acceptance.ps1`
- **双实例手工 smoke test**：`../../scheduler/scripts/phase2_smoketest.ps1`
- **项目侧进度记录**：`../project/Scheduler_Phase2_开发进度记录_2025-12-19.md`
- **容量规划与 Redis 设计**：`../project/Scheduler_扩展与容量规划说明_含Redis设计.md`

## 相关文档

- `../README.md` - central_server 总览与启动入口

## 测试报告

- [阶段 1.1 测试报告](../testing/scheduler/tests/stage1.1/TEST_REPORT.md) - 核心功能测试（47个测试，全部通过）
- [阶段 1.2 测试报告](../testing/scheduler/tests/stage1.2/TEST_REPORT.md) - 消息格式对齐测试（7个测试，全部通过）
- [阶段 2.1.2 测试报告](../testing/scheduler/tests/stage2.1.2/TEST_REPORT.md) - ASR 字幕功能测试（12个测试，全部通过）
- [阶段 3.2 测试报告](../testing/scheduler/tests/stage3.2/TEST_REPORT.md) - 节点选择测试（6个测试，全部通过）

