# Aggregator 文档索引

**最后更新**: 2026-01-24  
**目的**: 整理和索引所有与 AggregatorMiddleware、UtteranceAggregator 相关的文档

---

## 📚 文档结构

### 1. AggregatorMiddleware

- **[AggregatorMiddleware 功能说明](./aggregator_middleware.md)**
  - 核心功能概述
  - 处理流程
  - 配置参数
  - 启用状态对比
  - 常见问题

### 2. UtteranceAggregator

- **[UtteranceAggregator 配置对比](./utterance_aggregator.md)**
  - 备份代码 vs 当前代码配置对比
  - 启用状态分析
  - 修复方案


### 3. 问题分析归档

- **[问题分析索引](./issue_analysis.md)**
  - 问题分析文档索引和总结

- **[未合并问题修复](./issue_merge_fix.md)**
  - AggregatorMiddleware 未合并问题的修复记录

- **[未合并问题详细分析](./issue_merge_analysis.md)**
  - 详细的问题分析和根本原因

- **[生效但未合并问题分析](./issue_not_merging.md)**
  - 问题现象和诊断

- **[连续性判断对比](./continuity_comparison.md)**
  - AudioAggregator 和 AggregatorMiddleware 的连续性判断方式对比

---

## 🔍 快速导航

### 按问题查找

| 问题 | 相关文档 |
|------|---------|
| AggregatorMiddleware 是什么？ | [AggregatorMiddleware 功能说明](./aggregator_middleware.md) |
| 为什么 hasAggregatorManager 是 false？ | [UtteranceAggregator 配置对比](./utterance_aggregator.md) |
| 如何启用文本聚合？ | [UtteranceAggregator 配置对比](./utterance_aggregator.md#修复方案) |
| 为什么所有 job 都被判定为 NEW_STREAM？ | [问题分析索引](./issue_analysis.md), [未合并问题修复](./issue_merge_fix.md) |
| AudioAggregator 和 AggregatorMiddleware 的区别？ | [连续性判断对比](./continuity_comparison.md) |

### 按角色查找

| 角色 | 相关文档 |
|------|---------|
| 节点端开发者 | 所有文档 |
| 系统架构师 | [AggregatorMiddleware 功能说明](./aggregator_middleware.md), [连续性判断对比](./continuity_comparison.md) |
| 问题诊断人员 | [问题分析索引](./issue_analysis.md), [未合并问题修复](./issue_merge_fix.md) |

---

## 📝 文档迁移说明

本目录下的文档是从 `central_server/scheduler/docs` 中整理和合并而来，主要来源包括：

- ✅ `AggregatorMiddleware功能说明_2026_01_24.md` → 已合并到 `aggregator_middleware.md`
- ✅ `AggregatorMiddleware未合并问题修复_2026_01_24.md` → 已归档到 `issue_merge_fix.md`
- ✅ `AggregatorMiddleware未合并问题详细分析_2026_01_24.md` → 已归档到 `issue_merge_analysis.md`
- ✅ `AggregatorMiddleware生效但未合并问题分析_2026_01_24.md` → 已归档到 `issue_not_merging.md`
- ✅ `UtteranceAggregator配置对比分析_2026_01_24.md` → 已合并到 `utterance_aggregator.md`
- ✅ `AudioAggregator和AggregatorMiddleware连续性判断对比_2026_01_24.md` → 已归档到 `continuity_comparison.md`

所有文档已根据实际代码实现进行了更新和整理。

---

## 🔗 相关文档

- [任务管理](../job/README.md)
- [音频处理](../audio/README.md)
- [Finalize 处理机制](../finalize/README.md)

---

## 📅 更新历史

- **2026-01-24**: 创建文档索引，整理和合并所有 Aggregator 相关文档
- **2026-01-24**: 归档问题分析文档，更新文档结构
