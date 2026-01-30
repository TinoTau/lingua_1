# 备份代码对比文档归档

**最后更新**: 2026-01-24  
**目的**: 归档所有与备份代码对比相关的文档

---

## 📚 文档说明

本目录下的文档是与备份代码（`expired/lingua_1-main`）的对比分析文档，用于记录代码演进和问题修复过程。

**注意**: 这些文档是历史记录，当前代码实现可能已经与备份代码不同。

---

## 📝 文档列表

### 1. 配置和机制分析

- **[配置覆盖机制分析](./config_override_mechanism.md)**
  - 分析备份代码中ASR配置的覆盖机制
  - BEAM_SIZE 和模型路径的配置层级

### 2. 代码对比分析

- **[对比分析](./comparison_analysis.md)**
  - Job结果去重机制对比
  - 音频质量阈值（RMS）对比
  - 文本去重算法对比
  - 空结果处理对比

- **[完整差异对比](./full_difference_comparison.md)**
  - beam_size配置差异
  - 预加载逻辑差异
  - 依赖版本差异
  - VAD预热差异

### 3. ASR性能分析

- **[ASR性能对比](./asr_performance_comparison.md)**
  - 短句和长句处理时间对比
  - 性能差异原因分析
  - PipelineScheduler状态分析

- **[ASR过载分析](./asr_overload_analysis.md)**
  - PipelineScheduler机制分析
  - SequentialExecutor vs PipelineScheduler
  - 全局ASR并发控制

- **[ASR性能对比分析](./asr_performance_analysis.md)**
  - 用户测试场景对比
  - ASR配置对比
  - 并发控制机制对比

- **[ASR性能分析](./asr_performance_analysis_2.md)**
  - beam_size差异分析
  - 预加载差异分析
  - 测试场景差异分析

### 4. Finalize处理机制

- **[MaxDuration处理机制分析](./backup_maxduration_analysis.md)**
  - 备份代码MaxDuration处理机制
  - 与正式代码的对比

- **[Timeout Finalize分析](./backup_timeout_finalize_analysis.md)**
  - 备份代码Timeout finalize处理
  - 与正式代码的对比

### 5. AggregatorMiddleware

- **[AggregatorMiddleware分析](./backup_aggregator_middleware_analysis.md)**
  - 备份代码AggregatorMiddleware日志分析
  - 与正式代码的对比

### 6. 客户端相关

- **[客户端 is_final 发送逻辑对比](./client_is_final_logic.md)**
  - 客户端发送 is_final=true 的触发条件
  - 静音检测逻辑
  - 解决方案

---

## 🔍 快速导航

### 按问题查找

| 问题 | 相关文档 |
|------|---------|
| 备份代码的配置覆盖机制是什么？ | [配置覆盖机制分析](./config_override_mechanism.md) |
| 备份代码和正式代码有什么差异？ | [对比分析](./comparison_analysis.md), [完整差异对比](./full_difference_comparison.md) |
| 为什么备份代码不会ASR过载？ | [ASR过载分析](./asr_overload_analysis.md), [ASR性能分析](./asr_performance_analysis_2.md) |
| 备份代码的ASR性能如何？ | [ASR性能对比](./asr_performance_comparison.md), [ASR性能对比分析](./asr_performance_analysis.md) |
| 备份代码的MaxDuration处理机制是什么？ | [MaxDuration处理机制分析](./backup_maxduration_analysis.md) |
| 备份代码的Timeout finalize处理是什么？ | [Timeout Finalize分析](./backup_timeout_finalize_analysis.md) |
| 备份代码的AggregatorMiddleware是什么？ | [AggregatorMiddleware分析](./backup_aggregator_middleware_analysis.md) |

### 按主题分类

| 主题 | 相关文档 |
|------|---------|
| 配置和机制 | [配置覆盖机制分析](./config_override_mechanism.md) |
| 代码对比 | [对比分析](./comparison_analysis.md), [完整差异对比](./full_difference_comparison.md) |
| ASR性能 | [ASR性能对比](./asr_performance_comparison.md), [ASR过载分析](./asr_overload_analysis.md), [ASR性能对比分析](./asr_performance_analysis.md), [ASR性能分析](./asr_performance_analysis_2.md) |
| Finalize处理 | [MaxDuration处理机制分析](./backup_maxduration_analysis.md), [Timeout Finalize分析](./backup_timeout_finalize_analysis.md) |
| AggregatorMiddleware | [AggregatorMiddleware分析](./backup_aggregator_middleware_analysis.md) |
| 客户端逻辑 | [客户端 is_final 发送逻辑对比](./client_is_final_logic.md) |

---

## 🔗 相关文档

- [Finalize 处理机制](../finalize/README.md)
- [节点端流式 ASR 文档](../../../electron_node/services/faster_whisper_vad/docs/streaming_asr/README.md)
- [音频处理文档](../audio/README.md)

---

## 📅 更新历史

- **2026-01-24**: 归档备份代码对比文档，整理文档索引
- **2026-01-23**: 创建归档目录，开始整理备份代码对比文档
