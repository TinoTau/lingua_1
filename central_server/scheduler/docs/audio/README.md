# 音频处理文档索引

**最后更新**: 2026-01-24  
**目的**: 整理和索引所有与音频处理、AudioAggregator、Buffer 相关的文档

---

## 📚 文档结构

### 1. 调度服务器端分析

- **[音频处理流程和 Buffer 清除逻辑](./audio_processing_and_buffer.md)**
  - 音频处理流程对比（正式代码 vs 备份代码）
  - Buffer 清除逻辑分析
  - 音频质量检查逻辑
  - 问题根源和解决方案

- **[音频处理流程分析](./audio_processing_flow.md)**
  - 音频处理流程详细分析
  - Buffer 清除逻辑对比

### 2. 节点端（已迁移）

**注意**: 节点端流式 ASR 相关文档已迁移到：
- `electron_node/services/faster_whisper_vad/docs/streaming_asr/`

**主要文档**:
- [流式 ASR 架构和流程](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/architecture_and_flow.md)
- [AudioAggregator 流程分析](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/audio_aggregator_flow_analysis.md)
- [实施总结](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/implementation_summary.md)

### 3. 问题分析归档

- **[问题分析索引](./issue_analysis.md)**
  - 问题分析文档索引和总结

- **[处理流程分析](./processing_flow_analysis.md)**
  - AudioAggregator 处理流程和业务需求分析

- **[跨节点问题分析](./cross_node_issue.md)**
  - Session Affinity 和跨节点问题

- **[修复对比分析](./fix_comparison.md)**
  - 修复前后对比和备份代码对比

- **[合并逻辑修复](./merge_logic_fix.md)**
  - 合并逻辑修复记录

- **[合并逻辑分析](./merge_logic_analysis.md)**
  - 合并逻辑详细分析

- **[Finalize 逻辑分析](./finalize_logic_analysis.md)**
  - Finalize 处理逻辑分析

---

## 🔍 快速导航

### 按问题查找

| 问题 | 相关文档 |
|------|---------|
| 音频处理流程是什么？ | [音频处理流程和 Buffer 清除逻辑](./audio_processing_and_buffer.md) |
| Buffer 为什么被清除？ | [音频处理流程和 Buffer 清除逻辑](./audio_processing_and_buffer.md#buffer-清除逻辑) |
| 音频质量检查在哪里？ | [音频处理流程和 Buffer 清除逻辑](./audio_processing_and_buffer.md#音频质量检查) |
| 节点端 AudioAggregator 如何处理？ | [节点端文档](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/audio_aggregator_flow_analysis.md) |
| AudioAggregator 为什么无法合并？ | [合并逻辑分析](./merge_logic_analysis.md), [合并逻辑修复](./merge_logic_fix.md) |
| 跨节点会有问题吗？ | [跨节点问题分析](./cross_node_issue.md) |
| ASR_EMPTY 是否有必要？ | [Finalize 逻辑分析](./finalize_logic_analysis.md) |

### 按角色查找

| 角色 | 相关文档 |
|------|---------|
| 调度服务器开发者 | [音频处理流程和 Buffer 清除逻辑](./audio_processing_and_buffer.md) |
| 节点端开发者 | [节点端文档](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/), [问题分析归档](./issue_analysis.md) |
| 问题诊断人员 | [问题分析索引](./issue_analysis.md), [修复对比分析](./fix_comparison.md) |

---

## 📝 文档迁移说明

本目录下的文档是从 `central_server/scheduler/docs` 中整理和合并而来，主要来源包括：

- ✅ `音频处理流程和Buffer清除逻辑分析_2026_01_24.md` → 已归档到 `audio_processing_flow.md`
- ✅ `Buffer清除逻辑修复_2026_01_24.md` → 已归档到 `buffer_clear_fix.md`
- ✅ `音频质量检查逻辑分析_2026_01_24.md` → 已归档到 `audio_quality_check.md`
- ✅ `AudioAggregator处理流程分析_2026_01_24.md` → 已归档到 `processing_flow_analysis.md`
- ✅ `AudioAggregator跨节点问题分析_2026_01_24.md` → 已归档到 `cross_node_issue.md`
- ✅ `AudioAggregator修复对比分析_2026_01_24.md` → 已归档到 `fix_comparison.md`
- ✅ `AudioAggregator合并逻辑修复_2026_01_24.md` → 已归档到 `merge_logic_fix.md`
- ✅ `AudioAggregator合并逻辑分析_2026_01_24.md` → 已归档到 `merge_logic_analysis.md`
- ✅ `AudioAggregator和Finalize逻辑分析_2026_01_24.md` → 已归档到 `finalize_logic_analysis.md`

**注意**: 节点端 AudioAggregator 的详细分析文档已迁移到节点端文档目录。

---

## 🔗 相关文档

- [任务管理](../job/README.md)
- [Finalize 处理机制](../finalize/README.md)
- [节点端流式 ASR 文档](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/README.md)

---

## 📅 更新历史

- **2026-01-24**: 创建文档索引，整理和合并所有音频处理相关文档
- **2026-01-24**: 归档 AudioAggregator 问题分析文档，删除旧版本文档
