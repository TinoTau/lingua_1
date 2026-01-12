# 项目文档

本文档目录包含 Lingua 项目的所有文档。

## 文档结构

### 项目级文档

- **系统架构**: `SYSTEM_ARCHITECTURE.md` - 系统架构文档（三层架构、三个客户端详解）⭐ **重要**
- **项目结构**: `PROJECT_STRUCTURE.md` - 项目目录结构和路径说明
- **项目迁移**: `PROJECT_MIGRATION.md` - 项目迁移和路径调整文档
- **文档索引**: `DOCUMENTATION_INDEX.md` - 文档索引
- **产品文档索引**: `PRODUCT_DOCUMENTATION_INDEX.md` - 产品文档索引

### 环境配置

- `setup/` - 环境配置相关文档
  - `ENVIRONMENT_SETUP.md` - 环境变量配置指南
  - `ENVIRONMENT_CONFIGURATION_COMPLETE.md` - 环境变量配置完成报告
  - `CMAKE_4.2_COMPATIBILITY_FIX.md` - CMake 4.2 兼容性修复
  - `CMAKE_4.2_SOLUTION.md` - CMake 4.2 解决方案

### 变更日志

- `changelog/` - 变更日志
  - `CHANGELOG_2025_01.md` - 2025年1月更新日志

### 项目管理

- `project_management/` - 项目管理相关文档
  - 开发计划
  - 项目状态
  - 已完成/待完成项目
- `project/phase3/` - Phase3 相关文档
  - `PHASE3_IMPLEMENTATION_SUMMARY.md` - Phase3 功能实现总结
  - `PHASE3_TESTING_*.md` - Phase3 测试相关文档

### 日志和可观测性

- `logging/` - 日志和可观测性相关文档
  - 日志规范
  - 可观测性配置
  - 日志使用指南

### 项目管理

- `project_management/` - 项目管理相关文档
  - 开发计划
  - 项目状态
  - 已完成/待完成项目

### 参考文档

- `reference/` - 参考文档
  - 架构设计参考
  - 技术方案参考
  - 状态对比

### 测试文档

- `testing/` - 测试相关文档
  - 端到端测试指南
  - 测试策略

## 各组件文档

所有模块文档已统一移动到 `docs/` 目录下，避免多层嵌套路径。

### Web 客户端

- **位置**: `web_client/` 和 `webapp/`
- **文档索引**: 
  - [web_client/README.md](./web_client/README.md) - Web 客户端文档
  - [webapp/README.md](./webapp/README.md) - Web 应用文档（包含 WebRTC、iOS 等）
- **分析文档**: `web_client/analysis/` - Web 端音频传输、播放等分析文档
  - `web_audio_logic_summary.md` - Web 端音频发送和播放逻辑总结
  - `web_audio_check_summary.md` - Web 端音频传输检查总结
  - `web_audio_analysis_summary.md` - Web 端音频接收和播放区添加情况分析
  - `audio_transmission_analysis.md` - 节点端音频传输过程分析
  - `finalize_timing_analysis.md` - Finalize 时长和音频累积分析
  - `analyze_first_audio_playback.md` - 第一段音频播放问题分析

### 中央服务器

- **位置**: `central_server/`
- **文档索引**: [central_server/README.md](./central_server/README.md)
- **子模块文档**:
  - `central_server/scheduler/` - 调度服务器文档
  - `central_server/api_gateway/` - API 网关文档
  - `central_server/model_hub/` - 模型库服务文档
  - `central_server/modelManager/` - 模型管理文档
  - `central_server/project/` - 项目相关文档
  - `central_server/testing/` - 测试文档

### Electron 节点客户端

- **位置**: `electron_node/`
- **文档索引**: [electron_node/README.md](./electron_node/README.md)
- **新增服务**:
  - [Faster Whisper VAD 服务](../electron_node/services/faster_whisper_vad/README.md) - ASR + VAD 整合服务（GPU加速）
  - [Speaker Embedding 服务](../electron_node/services/speaker_embedding/README.md) - 说话者特征提取服务（GPU加速）
- **音频聚合与处理机制（2025-12-31）**:
  - [**音频聚合完整机制**](./electron_node/short_utterance/AUDIO_AGGREGATION_COMPLETE_MECHANISM.md) ⭐ **重要** - 完整的音频聚合、ASR、NMT、调度服务器finalize和Web端机制文档

## 项目结构

```
lingua_1/
├── webapp/                    # Web 客户端
│   ├── web-client/           # Web 客户端代码
│   └── docs/                 # Web 客户端文档（已同步到 docs/webapp/）
├── central_server/            # 中央服务器
│   └── docs/                 # 中央服务器文档（已同步到 docs/central_server/）
├── electron_node/             # Electron 节点客户端
│   └── docs/                 # 节点客户端文档（已同步到 docs/electron_node/）
├── scripts/                   # 启动脚本
├── shared/                    # 共享代码
├── docs/                      # 项目级文档（本目录，统一管理所有文档）
│   ├── web_client/           # Web 客户端文档
│   ├── webapp/               # Web 应用文档（WebRTC、iOS 等）
│   ├── central_server/       # 中央服务器文档
│   ├── electron_node/        # Electron 节点客户端文档
│   └── ...                    # 其他项目级文档
└── expired/                   # 备份代码（旧版本）
```

> **注意**: 所有文档已统一整合到 `docs/` 目录下，各子项目的 `docs/` 目录内容已同步到根目录 `docs/` 中。

## 快速参考

- **项目迁移**: `PROJECT_MIGRATION.md`
- **文档索引**: [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md)
- **产品文档索引**: [PRODUCT_DOCUMENTATION_INDEX.md](./PRODUCT_DOCUMENTATION_INDEX.md)
- **更新日志**: [changelog/CHANGELOG_2025_01.md](./changelog/CHANGELOG_2025_01.md) - 最新更新（2025年1月）
- **ServiceType 能力重构总结**: [architecture/SERVICE_TYPE_CAPABILITY_REFACTOR_SUMMARY.md](./architecture/SERVICE_TYPE_CAPABILITY_REFACTOR_SUMMARY.md) - 服务类型改造过程及结果总结 ⭐
- **Web 客户端文档**: [web_client/README.md](./web_client/README.md)
- **中央服务器文档**: [central_server/README.md](./central_server/README.md)
- **Electron Node 文档**: [electron_node/README.md](./electron_node/README.md)
