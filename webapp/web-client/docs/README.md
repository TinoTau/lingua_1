# Web 客户端文档

本文档目录包含 Web 客户端的详细文档。

## 文档索引

### 快速开始
- [README.md](../README.md) - 项目概述和快速开始指南

### 开发文档
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Web 客户端架构设计
- [DEBUGGING_GUIDE.md](./DEBUGGING_GUIDE.md) - 调试指南，包含日志查看、常见问题诊断等
- [SCHEDULER_COMPATIBILITY_FIX.md](./SCHEDULER_COMPATIBILITY_FIX.md) - 与调度服务器的兼容性修复说明
- [SCALABILITY_PLAN_EVALUATION.md](./SCALABILITY_PLAN_EVALUATION.md) - 规模化方案可行性评估
- [Web客户端规模化能力与Web_Scheduler协议规范_合并版_v1.1.md](./Web客户端规模化能力与Web_Scheduler协议规范_合并版_v1.1.md) - 规模化能力要求与协议规范

### 测试文档
- [TEST_RUN_GUIDE.md](./TEST_RUN_GUIDE.md) - 测试运行指南
- [TEST_RESULTS.md](./TEST_RESULTS.md) - 测试结果报告

### 架构设计
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Web 客户端架构设计
- [../../ARCHITECTURE.md](../../ARCHITECTURE.md) - 系统整体架构设计

## 文档说明

### DEBUGGING_GUIDE.md
包含以下内容：
- 日志查看方法
- 常见问题诊断步骤
- 日志字段说明
- 调试技巧

### SCHEDULER_COMPATIBILITY_FIX.md
记录了 Web 客户端与调度服务器之间的兼容性修复：
- `audio_chunk` 消息格式修复
- `session_init_ack` 消息格式修复
- Phase2/Phase3 兼容性说明

### TEST_RUN_GUIDE.md
测试运行指南，包含：
- 测试环境设置
- 测试命令
- 测试用例说明

### TEST_RESULTS.md
测试结果报告，包含：
- 测试执行结果
- 测试覆盖率
- 问题记录

## 相关链接

- [项目根目录 README](../../../README.md)
- [调度服务器文档](../../../central_server/scheduler/docs/)
- [节点端文档](../../../electron_node/services/node-inference/docs/)

