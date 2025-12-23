# Electron Node 客户端文档

本文档目录包含 Electron Node 客户端的所有文档，已从 `electron_node/docs/` 移动至此。

## 文档索引

### 快速开始
- [README](./README.md) - Electron Node 客户端概述
- [路径结构](./PATH_STRUCTURE.md) - 路径结构说明

### Electron Node 客户端
- [Electron Node 文档](./electron_node/README.md)
- [架构建议](./electron_node/ARCHITECTURE_RECOMMENDATION.md)
- [能力状态实现](./electron_node/CAPABILITY_STATE_IMPLEMENTATION.md)
- [功能对比](./electron_node/FEATURE_COMPARISON.md)
- [GPU 统计追踪](./electron_node/GPU_STATISTICS_TRACKING.md)
- [模块热插拔实现](./electron_node/MODULE_HOT_PLUG_IMPLEMENTATION.md)
- [启动与日志](./electron_node/NODE_CLIENT_STARTUP_AND_LOGGING.md)
- [插件架构评估](./electron_node/PLUGIN_ARCHITECTURE_NECESSITY_ASSESSMENT.md)
- [服务管理器重构](./electron_node/SERVICE_MANAGER_REFACTORING.md)
- [服务迁移评估](./electron_node/SERVICE_MIGRATION_ASSESSMENT.md)
- [阶段 2.2 实现](./electron_node/STAGE2.2_IMPLEMENTATION.md)
- [第三方插件场景（第一部分）](./electron_node/THIRD_PARTY_PLUGIN_SCENARIOS_PART1.md)
- [第三方插件场景（第二部分）](./electron_node/THIRD_PARTY_PLUGIN_SCENARIOS_PART2.md)

### 模块化功能
- [模块化功能文档](./modular/README.md)
- [完整技术说明书](./modular/LINGUA_完整技术说明书_v2.md)
- [模块化功能说明](./modular/MODULAR_FEATURES.md)

### 服务实现
- [服务热插拔验证](./SERVICE_HOT_PLUG_VERIFICATION.md)
- [YourTTS 集成实现](./YOURTTS_INTEGRATION_IMPLEMENTATION.md)
- [YourTTS 变更日志](./CHANGELOG_YOURTTS.md)
- [中文 TTS 修复总结](./CHINESE_TTS_FIX_SUMMARY.md)
- [平台化实现总结](./PLATFORM_READY_IMPLEMENTATION_SUMMARY.md)

### 节点推理服务优化（新增）
- [VAD 引擎集成实现](./node-inference/VAD_INTEGRATION_IMPLEMENTATION.md)
- [VAD 上下文缓冲区实现](./node-inference/VAD_CONTEXT_BUFFER_IMPLEMENTATION.md)
- [Opus 压缩支持](./node-inference/OPUS_COMPRESSION_SUPPORT.md)
- [ASR 文本过滤配置](../../electron_node/services/node-inference/docs/ASR_TEXT_FILTER_CONFIG.md) - ASR 文本过滤规则配置（包含标点符号过滤）
- [上下文缓冲区状态](../../electron_node/services/node-inference/docs/CONTEXT_BUFFER_STATUS.md) - 上下文缓冲区使用说明
- [ASR 日志查看指南](../../electron_node/services/node-inference/docs/HOW_TO_VIEW_ASR_LOGS.md) - ASR 日志查看方法

### Speaker Embedding 模块（新增）
- [Embedding 模块迁移报告](../../electron_node/services/node-inference/docs/EMBEDDING_MODULE_MIGRATION.md) - 完整的迁移文档和架构说明
- [Embedding 模块对比分析](../../electron_node/services/node-inference/docs/EMBEDDING_MODULE_COMPARISON.md) - 原项目与当前项目对比
- [模块实现方式说明](../../electron_node/services/node-inference/docs/MODULE_IMPLEMENTATION_METHODS.md) - 包含 Speaker Embedding 服务说明
- [模块列表](../../electron_node/services/node-inference/docs/MODULE_LIST.md) - 所有模块列表和说明

### 新增 Python 服务（2025-12-23）

#### Faster Whisper VAD 服务
- [服务 README](../../electron_node/services/faster_whisper_vad/README.md) - 服务使用说明和 API 文档
- [GPU 性能分析](../../electron_node/services/faster_whisper_vad/GPU_ANALYSIS.md) - GPU 可行性和性能分析
- [GPU 配置指南](../../electron_node/services/faster_whisper_vad/GPU_SETUP.md) - GPU 配置步骤

#### Speaker Embedding 服务
- [服务 README](../../electron_node/services/speaker_embedding/README.md) - 服务使用说明和 API 文档
- [GPU 性能分析](../../electron_node/services/speaker_embedding/GPU_ANALYSIS.md) - GPU 可行性和性能分析
- [GPU 配置指南](../../electron_node/services/speaker_embedding/GPU_SETUP.md) - GPU 配置步骤

#### GPU 配置相关
- [GPU 配置完成报告](../../electron_node/services/GPU_CONFIGURATION_COMPLETE.md) - GPU 配置状态和验证结果
- [PyTorch 版本分析](../../electron_node/services/PYTORCH_VERSION_ANALYSIS.md) - 各服务 PyTorch 版本分析和架构说明

---

## 相关链接

- [项目根目录 README](../../README.md)
- [项目状态文档](../project_management/PROJECT_STATUS.md)
- [系统架构文档](../SYSTEM_ARCHITECTURE.md)

