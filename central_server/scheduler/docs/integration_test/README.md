# 集成测试文档索引

**最后更新**: 2026-01-24  
**目的**: 整理和索引所有集成测试相关的文档

---

## 📚 文档结构

### 1. 测试分析报告

- **[集成测试 Job 处理过程分析](./integration_test_analysis.md)**
  - 测试结果
  - Job 处理过程详细分析
  - 问题根源分析
  - 解决方案

### 2. 问题分析

- **[前半句丢失问题分析](./missing_first_half_analysis.md)**
  - 问题描述
  - 可能原因分析
  - 检查点和验证方法

### 3. 日志和诊断归档

- **[日志分析结果](./log_analysis.md)**
  - 调度服务器端分析
  - 节点端分析
  - Job 丢失原因

- **[问题诊断报告](./problem_diagnosis.md)**
  - 心跳处理 Bug（已修复）
  - 节点注册问题
  - 任务分配问题

---

## 🔍 快速导航

### 按问题查找

| 问题 | 相关文档 |
|------|---------|
| 为什么前半句丢失？ | [前半句丢失问题分析](./missing_first_half_analysis.md) |
| utteranceIndex 为什么不连续？ | [集成测试 Job 处理过程分析](./integration_test_analysis.md) |
| 每个 job 都显示 "Buffer not found"？ | [集成测试 Job 处理过程分析](./integration_test_analysis.md#buffer-删除原因) |
| Job 为什么会丢失？ | [日志分析结果](./log_analysis.md) |
| 心跳处理失败？ | [问题诊断报告](./problem_diagnosis.md) |

### 按角色查找

| 角色 | 相关文档 |
|------|---------|
| 测试人员 | 所有文档 |
| 开发者 | [集成测试 Job 处理过程分析](./integration_test_analysis.md), [日志分析结果](./log_analysis.md) |
| 系统架构师 | [前半句丢失问题分析](./missing_first_half_analysis.md) |
| 问题诊断人员 | [问题诊断报告](./problem_diagnosis.md) |

---

## 📝 文档迁移说明

本目录下的文档是从 `central_server/scheduler/docs` 中整理和合并而来，主要来源包括：

- ✅ `集成测试Job处理过程完整分析_2026_01_24_v2_最终版.md` → 已合并到 `integration_test_analysis.md`
- ✅ `集成测试前半句丢失问题分析_2026_01_24.md` → 已归档到 `missing_first_half_analysis.md`
- ✅ `集成测试日志分析结果_2026_01_24.md` → 已归档到 `log_analysis.md`
- ✅ `集成测试问题诊断_2026_01_22.md` → 已归档到 `problem_diagnosis.md`
- ✅ 其他旧版本文档已删除

所有文档已根据实际代码实现和测试结果进行了更新和整理。

---

## 🔗 相关文档

- [任务管理](../job/README.md)
- [音频处理](../audio/README.md)
- [Finalize 处理机制](../finalize/README.md)
- [Aggregator](../aggregator/README.md)

---

## 📅 更新历史

- **2026-01-24**: 创建文档索引，整理和合并所有集成测试相关文档
- **2026-01-24**: 归档日志分析和问题诊断文档，删除旧版本文档
