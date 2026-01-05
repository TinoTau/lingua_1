# Electron 节点客户端文档索引

## 从这里开始

- **Electron Node 主文档**：`electron_node/README.md`
- **路径结构与目录口径**：`PATH_STRUCTURE.md`

## 核心功能文档

### GPU 管理
- **GPU 仲裁器**：`GPU/GPU_ARBITER.md` - GPU 资源管理、优先级控制、使用率监控
- **GPU 使用率控制**：`GPU/GPU_USAGE_THRESHOLD_CONTROL_PROPOSAL_v1.1.md` - 详细技术方案
- **顺序执行**：`GPU/SEQUENTIAL_EXECUTION_IMPLEMENTATION.md` - 任务顺序保证机制

### 语义修复
- **语义修复功能**：`ASR_plus/SEMANTIC_REPAIR.md` - 语义修复架构、处理流程、配置

### 音频处理
- **音频处理索引**：`AUDIO_PROCESSING_INDEX.md` - 音频处理相关文档索引
- **音频聚合机制**：`short_utterance/AUDIO_AGGREGATION_COMPLETE_MECHANISM.md` ⭐ **重要** - 完整的音频聚合、ASR、NMT、调度服务器finalize和Web端机制文档

### 服务管理
- **服务热插拔**：`SERVICE_HOT_PLUG_VERIFICATION.md` - 服务热插拔与任务链验证
- **TTS 服务**：`TTS_SERVICES.md` - Piper TTS 和 YourTTS 服务说明

## 架构文档

- **路径结构**：`PATH_STRUCTURE.md` - 路径结构与目录解析
- **迁移文档**：`MIGRATION.md` - 从 expired/ 迁移到 electron_node/ 的详细说明

## Electron Node 应用文档

- **主文档**：`electron_node/README.md`
- **架构建议**：`electron_node/ARCHITECTURE_RECOMMENDATION.md`
- **启动与日志**：`electron_node/NODE_CLIENT_STARTUP_AND_LOGGING.md`
- **服务管理器重构**：`electron_node/SERVICE_MANAGER_REFACTORING.md`
- **GPU 统计跟踪**：`electron_node/GPU_STATISTICS_TRACKING.md`

## 代码重构

根据实际代码，主要模块已进行重构：

- **GPU 仲裁器**：拆分为使用率监控、队列管理、指标统计等模块
- **后处理协调器**：拆分为语义修复处理、合并处理、文本过滤等模块
- **流水线编排器**：拆分为音频处理、ASR结果处理、结果构建等模块
- **文本验证工具**：统一了无意义单词检查和空文本检查逻辑
