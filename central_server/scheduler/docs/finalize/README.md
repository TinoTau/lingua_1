# Finalize 处理机制文档索引

**最后更新**: 2026-01-24  
**目的**: 整理和索引所有与 finalize 处理机制相关的文档

---

## 📚 文档结构

### 1. 调度服务器端

- **[Finalize 类型和触发条件](./scheduler_finalize_types.md)**
  - Finalize 类型枚举（Manual, Auto, Exception）
  - 各种 finalize 的触发条件和机制
  - 触发优先级和检查顺序

- **[Finalize 处理逻辑](./scheduler_finalize_processing.md)**
  - `try_finalize` 和 `do_finalize` 的完整流程
  - Hangover 延迟机制
  - Session Affinity 和节点路由
  - Job 创建和派发逻辑

### 2. 节点端

- **[节点端 Finalize 处理流程](./node_finalize_processing.md)**
  - 三种 finalize 类型的处理路径
  - AudioAggregator 的处理逻辑
  - 缓存机制（pendingTimeoutAudio, pendingMaxDurationAudio）
  - 处理时机和实际效果对比

### 3. 特定 Finalize 类型详解

- **[Timeout Finalize](./timeout_finalize.md)**
  - 触发条件和机制
  - 调度服务器端处理
  - 节点端处理（对齐 Pause Finalize 行为）
  - TTL 机制

- **[MaxDuration Finalize](./maxduration_finalize.md)**
  - 触发条件（超长语音自动截断）
  - Session Affinity 机制
  - 节点端部分处理和缓存逻辑
  - 与 Timeout Finalize 的区别

### 4. 修复历史归档

- **[MaxDuration Finalize 修复历史](./maxduration_fix_history.md)**
  - MaxDuration 处理路径修复
  - MaxDuration 独立标签修复
  - 修复效果对比

---

## 🔍 快速导航

### 按问题查找

| 问题 | 相关文档 |
|------|---------|
| 有哪些 finalize 类型？ | [Finalize 类型和触发条件](./scheduler_finalize_types.md) |
| Timeout finalize 如何触发？ | [Timeout Finalize](./timeout_finalize.md#触发机制) |
| MaxDuration finalize 如何处理？ | [MaxDuration Finalize](./maxduration_finalize.md) |
| 节点端如何处理不同 finalize？ | [节点端 Finalize 处理流程](./node_finalize_processing.md) |
| Session Affinity 如何工作？ | [Finalize 处理逻辑](./scheduler_finalize_processing.md#session-affinity) |
| MaxDuration 的修复历史？ | [MaxDuration Finalize 修复历史](./maxduration_fix_history.md) |

### 按角色查找

| 角色 | 相关文档 |
|------|---------|
| 调度服务器开发者 | [Finalize 类型](./scheduler_finalize_types.md), [处理逻辑](./scheduler_finalize_processing.md) |
| 节点端开发者 | [节点端处理流程](./node_finalize_processing.md) |
| 系统架构师 | 所有文档 |
| 问题诊断人员 | [MaxDuration Finalize 修复历史](./maxduration_fix_history.md) |

---

## 📝 文档迁移说明

本目录下的文档是从 `central_server/scheduler/docs` 中整理和合并而来，主要来源包括：

- ✅ `finalize类型和触发条件分析_2026_01_24.md` → 已合并到 `scheduler_finalize_types.md`
- ✅ `timeout_finalize生成条件分析_2026_01_24.md` → 已合并到 `timeout_finalize.md`
- ✅ `MaxDuration_Finalize处理机制分析_2026_01_24.md` → 已合并到 `maxduration_finalize.md`
- ✅ `节点端Finalize处理流程总结_2026_01_24.md` → 已合并到 `node_finalize_processing.md`
- ✅ `Timeout_Finalize对齐Pause_Finalize行为_2026_01_24.md` → 已合并到 `timeout_finalize.md`
- ✅ `调度服务器finalize逻辑对比分析_2026_01_24.md` → 已合并到 `scheduler_finalize_processing.md`
- ✅ `MaxDuration独立标签修复总结_2026_01_24.md` → 已归档到 `maxduration_fix_history.md`
- ✅ `MaxDuration处理路径修复总结_2026_01_24.md` → 已归档到 `maxduration_fix_history.md`
- ✅ `MaxDuration处理路径修复_2026_01_24.md` → 已归档到 `maxduration_fix_history.md`

所有文档已根据实际代码实现进行了更新和整理。

---

## 🔗 相关文档

- [流式 ASR 文档](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/README.md)
- [节点端音频处理和 ASR 结果聚合](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/architecture_and_flow.md)

---

## 📅 更新历史

- **2026-01-24**: 创建文档索引，整理和合并所有 finalize 相关文档
- **2026-01-24**: 归档 MaxDuration 修复历史文档
