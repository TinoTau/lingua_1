# Faster Whisper VAD 服务文档索引

本文档目录包含 Faster Whisper VAD 服务的所有整理后的文档。

## 文档结构

```
organized/
├── README.md                           # 本文档（索引）
├── crash_analysis/                    # 崩溃分析
│   └── crash_analysis.merged_part*.md
├── opus_decoding/                     # Opus 解码
│   └── opus_decoding.merged_part*.md
├── audio_processing/                  # 音频处理
│   └── audio_processing.merged_part*.md
├── context_and_deduplication/         # 上下文和去重
│   └── context_and_deduplication.merged_part*.md
├── queue_and_results/                 # 队列和结果处理
│   └── queue_and_results.merged_part*.md
├── error_analysis/                    # 错误分析
│   └── error_analysis.merged_part*.md
├── web_client_integration/            # Web 客户端集成
│   └── web_client_integration.merged_part*.md
├── scheduler_integration/             # 调度器集成
│   └── scheduler_integration.merged_part*.md
├── testing/                           # 测试文档
│   └── testing_complete_part*.md
├── implementation/                    # 实现总结
│   └── implementation_complete_part*.md
└── logging/                           # 日志和诊断
    └── logging_complete_part*.md
```

## 快速导航

### 崩溃分析
- [崩溃分析完整文档](./crash_analysis/crash_analysis.merged_part1.md) (Part 1)
- 包含所有崩溃相关的分析、诊断和修复文档

### Opus 解码
- [Opus 解码完整文档](./opus_decoding/opus_decoding.merged_part1.md) (Part 1)
- 包含所有 Opus 解码相关的分析、修复和测试文档

### 音频处理
- [音频处理完整文档](./audio_processing/audio_processing.merged_part1.md) (Part 1)
- 包含所有音频处理相关的分析、修复和配置文档

### 上下文和去重
- [上下文和去重完整文档](./context_and_deduplication/context_and_deduplication.merged_part1.md) (Part 1)
- 包含所有上下文管理和去重相关的文档

### 队列和结果处理
- [队列和结果处理完整文档](./queue_and_results/queue_and_results.merged_part1.md) (Part 1)
- 包含所有队列和结果处理相关的文档

### 错误分析
- [错误分析完整文档](./error_analysis/error_analysis.merged_part1.md) (Part 1)
- 包含所有错误分析相关的文档（404、400 等）

### Web 客户端集成
- [Web 客户端集成完整文档](./web_client_integration/web_client_integration.merged_part1.md) (Part 1)
- 包含所有 Web 客户端集成相关的文档

### 调度器集成
- [调度器集成完整文档](./scheduler_integration/scheduler_integration.merged_part1.md) (Part 1)
- 包含所有调度器集成相关的文档

### 测试文档
- [测试完整文档](./testing/testing_complete_part1.md) (Part 1)
- 包含所有测试报告和结果

### 实现总结
- [实现总结完整文档](./implementation/implementation_complete_part1.md) (Part 1)
- 包含所有实现总结和计划相关文档

### 日志和诊断
- [日志和诊断完整文档](./logging/logging_complete_part1.md) (Part 1)
- 包含所有日志和诊断相关文档

## 文档说明

- 所有文档已按主题分类合并
- 每个合并后的文件不超过 500 行
- 如果内容超过 500 行，会分割为多个部分（part1, part2, ...）
- 原始文档内容已完整保留，仅进行了分类和合并

## 相关文档

- [Faster Whisper VAD 服务 README](../README.md)
- [ASR 模块文档](../../../../docs/electron_node/asr/README.md)

