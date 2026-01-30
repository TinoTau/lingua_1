# 任务管理文档索引

**最后更新**: 2026-01-24  
**目的**: 整理和索引所有与任务管理、任务处理流程相关的文档

---

## 📚 文档结构

### 1. 调度服务器端

- **[任务处理流程](./job_processing_flow.md)**
  - 任务创建流程
  - 节点选择流程
  - 任务状态管理
  - 与备份代码的对比

### 2. 节点端

- **[节点端任务处理流程](./node_job_processing.md)**
  - AudioAggregator 处理
  - ASR 处理
  - UtteranceAggregator 处理
  - 三种 finalize 类型的处理路径

- **[Job处理流程详细分析](./job_processing_flow_detailed.md)**
  - 问题描述
  - 日志分析结果
  - 各 Job 处理详情
  - 可能原因和解决方案

---

## 🔍 快速导航

### 按问题查找

| 问题 | 相关文档 |
|------|---------|
| 任务如何创建和分发？ | [任务处理流程](./job_processing_flow.md) |
| 节点端如何处理任务？ | [节点端任务处理流程](./node_job_processing.md) |
| 不同 finalize 类型的处理路径？ | [节点端任务处理流程](./node_job_processing.md#三种-finalize-类型的处理路径) |

### 按角色查找

| 角色 | 相关文档 |
|------|---------|
| 调度服务器开发者 | [任务处理流程](./job_processing_flow.md) |
| 节点端开发者 | [节点端任务处理流程](./node_job_processing.md) |
| 系统架构师 | 所有文档 |

---

## 📝 文档迁移说明

本目录下的文档是从 `central_server/scheduler/docs` 中整理和合并而来，主要来源包括：

- `Job处理流程详细分析_2026_01_24.md`
- `节点端任务处理流程完整分析_2026_01_24.md`
- `节点端Job处理流程分析.md`

所有文档已根据实际代码实现进行了更新和整理。

---

## 🔗 相关文档

- [节点注册和管理](../node_registry/README.md)
- [Finalize 处理机制](../finalize/README.md)
- [音频处理](../audio/README.md)

---

## 📅 更新历史

- **2026-01-24**: 创建文档索引，整理和合并所有任务管理相关文档
