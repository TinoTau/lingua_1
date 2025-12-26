# Scheduler 文档索引

本文档目录包含调度服务器（Scheduler）的所有相关文档。

## 文档列表

### 综合总结
- **[TTS Opus 改造与 ASR 优化总结](../electron_node/TTS_OPUS_AND_ASR_OPTIMIZATION_SUMMARY.md)** - 包含 utterance_index 机制改造的完整总结

### 核心功能
- [Phase 2 实现](./phase2_implementation.md) - Phase 2 实现文档
- [Pool 机制](./POOL_MECHANISM.md) - 两级调度与节点分组机制 ⭐
- [任务分配机制](./任务分配机制_补充增强项与阶段Checklist_v1.1.md) - 任务分配机制说明

### 问题诊断和修复
- [Utterance 核销机制改进](./UTTERANCE_ACKNOWLEDGMENT_IMPROVEMENT.md) - 补位机制实现
- [翻译延迟分析](./TRANSLATION_DELAY_ANALYSIS.md) - 翻译结果返回延迟问题分析
- [节点延迟根因分析](./NODE_DELAY_ROOT_CAUSE_ANALYSIS.md) - 节点端延迟问题分析
- [节点选择失败诊断](./NODE_SELECTION_FAILURE_DIAGNOSIS.md) - 节点选择失败问题诊断
- [问题检查报告](./ISSUE_CHECK_REPORT.md) - 问题检查报告
- [三个问题分析](./THREE_ISSUES_ANALYSIS.md) - 三个问题的综合分析
- [错误分析](./ERROR_ANALYSIS_job-BAEC928D.md) - 特定任务的错误分析

### 性能优化
- [GPU 性能分析](./GPU_PERFORMANCE_ANALYSIS.md) - GPU 性能分析
- [性能调试](./PERFORMANCE_DEBUGGING.md) - 性能调试指南

### 部署和运维
- [多实例部署](./MULTI_INSTANCE_DEPLOYMENT.md) - 多实例部署指南
- [发布运行手册](./release_runbook.md) - 发布运行手册

### 其他
- [Utterance Index Bug 修复](./UTTERANCE_INDEX_BUG_FIX.md) - Utterance Index 相关 Bug 修复
- [重复任务创建问题报告](./DUPLICATE_JOB_CREATION_ISSUE_REPORT.md) - 重复任务创建问题

## 相关文档

- [中央服务器文档索引](../README.md)
- [系统架构文档](../../SYSTEM_ARCHITECTURE.md)

