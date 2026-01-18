# Lingua 项目文档

本目录包含 Lingua 实时语音翻译系统的完整文档。

**最后更新**: 2026-01-19

---

## 📚 快速导航

### 新用户必读

1. [系统架构文档](./SYSTEM_ARCHITECTURE.md) - 三层架构、三个客户端详解 ⭐
2. [项目结构文档](./PROJECT_STRUCTURE.md) - 完整目录结构和路径说明
3. [项目状态](./project_management/PROJECT_STATUS.md) - 当前开发进度和功能状态

### 开发者快速开始

1. [产品文档索引](./PRODUCT_DOCUMENTATION_INDEX.md) - 按角色分类的文档索引
2. [开发计划](./project_management/DEVELOPMENT_PLAN.md) - 详细的功能清单和实现状态
3. [日志规范](./logging/README.md) - 日志和可观测性使用指南

---

## 📖 文档分类

### 1. 系统架构与设计

#### 核心架构
- [系统架构文档](./SYSTEM_ARCHITECTURE.md) - 完整的三层架构说明 ⭐
- [项目结构文档](./PROJECT_STRUCTURE.md) - 项目目录结构和路径说明

#### 架构设计
- `architecture/` - 架构设计文档
  - [服务类型能力重构总结](./architecture/SERVICE_TYPE_CAPABILITY_REFACTOR_SUMMARY.md) - ServiceType改造总结
  - [节点端简化架构完成说明](./architecture/节点端简化架构改造完成说明.md) - 节点端架构优化
  - [节点端任务处理完整流程](./architecture/节点端任务处理完整流程文档.md) - 任务处理流程
  - [服务热插拔机制](./architecture/SERVICE_HOTPLUG_MECHANISM.md) - 服务动态加载机制
  - [按需服务选择](./architecture/按需服务选择功能实现方案.md) - 模块化功能选择

---

### 2. 三个客户端文档

#### Web 客户端 (`webapp/web-client/`)
- [Web 客户端总览](./webapp/README.md) - 功能概述和快速开始
- [Web 客户端架构](./webapp/web-client/ARCHITECTURE.md) - 详细架构设计
- [Phase 2 实现](./webapp/web-client/PHASE2_IMPLEMENTATION_SUMMARY.md) - Binary Frame、Opus编码
- [Phase 3 实现](./web_client/PHASE3_IMPLEMENTATION.md) - 背压、Session Init
- [规模化规范](./web_client/SCALABILITY_SPEC.md) - 规模化能力要求
- [VAD 与状态机](./webapp/web-client/VAD_AND_STATE_MACHINE_REFACTOR.md) - VAD 静音过滤和状态机
- [调试指南](./webapp/web-client/DEBUGGING_GUIDE.md) - 日志查看和问题诊断

**WebRTC 会议室模式**:
- [会议室模式概览](./webapp/webRTC/ROOM_MODE_OVERVIEW.md) - 多人会议翻译功能
- [原声传递带宽优化](./webapp/webRTC/RAW_VOICE_BANDWIDTH_OPTIMIZATION.md) - P2P连接和音频混控
- [WebRTC 音频混控实现](./webapp/webRTC/WEBRTC_AUDIO_MIXER_IMPLEMENTATION.md) - 音频混控器详细实现

**产品设计文档**:
- [统一设计方案 v3](./webapp/webClient/Web_端实时语音翻译_统一设计方案_v3.md) - 完整设计方案
- [Utterance Group](./webapp/webClient/UTTERANCE_GROUP.md) - 上下文拼接功能
- [面对面模式](./webapp/webClient/FACE_TO_FACE_MODE.md) - 双向翻译模式

#### 中央服务器 (`central_server/`)
- [中央服务器总览](./central_server/README.md) - 组件概述和启动指南
- [调度服务器架构](./central_server/scheduler/ARCHITECTURE.md) - Scheduler 完整架构 ⭐
- [任务分发优化](./central_server/scheduler/DISPATCHER_OPTIMIZATION_PLAN.md) - 负载均衡和节点选择
- [Dashboard 说明](./central_server/scheduler/DASHBOARD.md) - 监控面板功能
- [语言能力架构](./central_server/scheduler/LANGUAGE_CAPABILITY_IMPLEMENTATION_SUMMARY.md) - 语言对池化机制
- [Pool 机制](./central_server/scheduler/POOL_MECHANISM.md) - 节点池管理机制
- [多实例部署](./central_server/scheduler/MULTI_INSTANCE_DEPLOYMENT.md) - Phase 2 多实例支持
- [任务管理流程](./central_server/scheduler/TASK_MANAGEMENT_FLOW_COMPLETE.md) - 完整的任务管理流程

**API 网关**:
- [API 网关总览](./central_server/api_gateway/README.md) - API 网关概述
- [公共 API 规范](./central_server/api_gateway/PUBLIC_API_SPEC.md) - REST/WebSocket API 规范
- [公共 API 状态](./central_server/api_gateway/PUBLIC_API_STATUS.md) - API 实现状态

**模型库服务**:
- [模型库总览](./central_server/model_hub/README.md) - 模型库服务说明
- [模型管理统一方案](./central_server/modelManager/公司模型库与Electron客户端模型管理统一技术方案.md) - 平台化服务包管理

#### Electron 节点客户端 (`electron_node/`)
- [节点客户端总览](./electron_node/README.md) - 功能概述和启动指南
- [ASR 模块流程](./electron_node/ASR_MODULE_FLOW_DOCUMENTATION.md) - ASR 处理完整流程 ⭐
- [GPU 管理机制](./electron_node/GPU/GPU_ARBITER_DESIGN.md) - GPU 仲裁器设计
- [服务热插拔](./electron_node/AGGREGATOR/SERVICE_HOTPLUG_DESIGN.md) - 动态服务加载
- [模块化功能](./electron_node/modular/MODULAR_FEATURES.md) - 按需功能选择

**iOS 客户端（参考）**:
- [iOS 客户端设计](./webapp/IOS/IOS_CLIENT_DESIGN_AND_INTERFACES.md) - iOS 端设计方案
- [iOS 音频 VAD 管道](./webapp/IOS/IOS_AUDIO_VAD_PIPELINE.md) - 音频处理流程

---

### 3. 项目管理

- `project_management/` - 项目管理文档
  - [项目状态](./project_management/PROJECT_STATUS.md) - 当前开发进度 ⭐
  - [开发计划](./project_management/DEVELOPMENT_PLAN.md) - 详细功能清单
  - [已完成功能](./project_management/PROJECT_STATUS_COMPLETED.md) - 已实现功能列表
  - [待完成功能](./project_management/PROJECT_STATUS_PENDING.md) - 待开发功能列表
  - [测试状态](./project_management/PROJECT_STATUS_TESTING.md) - 测试报告链接
  - [下一步开发](./project_management/NEXT_DEVELOPMENT_STEPS.md) - 下一步开发计划

- `project/phase3/` - Phase 3 功能文档
  - [Phase 3 实现总结](./project/phase3/PHASE3_IMPLEMENTATION_SUMMARY.md) - Phase 3 功能完成状态
  - [Phase 3 测试报告](./project/phase3/PHASE3_TESTING_COMPLETE_FINAL.md) - Phase 3 测试结果

---

### 4. 日志和可观测性

- `logging/` - 日志规范文档
  - [日志规范 v3.1](./logging/LINGUA_Logging_Observability_Spec_Consolidated_v3.1.md) - 完整日志规范
  - [使用指南](./logging/USAGE_GUIDE.md) - 日志使用方法
  - [实现状态](./logging/IMPLEMENTATION_STATUS.md) - 日志功能实现进度
  - [开发就绪度](./logging/DEVELOPMENT_READINESS.md) - 开发环境日志配置

---

### 5. 测试文档

- `testing/` - 测试相关文档
  - [端到端测试指南](./testing/END_TO_END_TESTING_GUIDE.md) - 完整的测试流程
  - [测试状态总览](./project_management/PROJECT_STATUS_TESTING.md) - 所有测试报告链接
  - [Web 客户端测试](./web_client/TEST_RUN_GUIDE.md) - Web 端测试指南
  - [Scheduler 测试策略](./central_server/testing/scheduler/TEST_STRATEGY.md) - 调度服务器测试策略

---

### 6. 故障排查

- `troubleshooting/` - 常见问题和解决方案
  - [Finalize 机制说明](./troubleshooting/FINALIZE_MECHANISM_EXPLANATION.md) - Finalize 触发机制
  - [ASR 音频块丢失修复](./troubleshooting/ASR_AUDIO_CHUNK_LOSS_ROOT_FIX_DESIGN_AND_TASKS.md) - 音频丢失问题解决
  - [翻译管道问题](./troubleshooting/TRANSLATION_PIPELINE_ISSUES.md) - 翻译链路问题排查
  - [进程清理改进](./troubleshooting/PROCESS_CLEANUP_IMPROVEMENTS.md) - 进程管理优化
  - [Pool 配置警告](./troubleshooting/Pool配置警告说明.md) - 配置问题说明

---

### 7. 环境配置和部署

- `setup/` - 环境配置文档
  - [环境配置指南](./setup/ENVIRONMENT_SETUP.md) - 环境变量配置
  - [环境配置完成](./setup/ENVIRONMENT_CONFIGURATION_COMPLETE.md) - 配置验证
  - [CMake 4.2 兼容性](./setup/CMAKE_4.2_COMPATIBILITY_FIX.md) - CMake 版本问题解决

- **快速开始**:
  - [Web 客户端快速开始](./webapp/QUICK_START.md)
  - [中央服务器快速开始](./central_server/QUICK_START.md)

- **运维文档**:
  - [Scheduler 发布运行手册](./central_server/scheduler/release_runbook.md) - 生产环境部署指南

---

### 8. 特殊功能模块

#### 训练模块（方言 ASR/TTS）
- `train/` 和 `trainning/` - 训练相关文档
  - [方言 ASR/TTS 共享训练池方案](./trainning/方言_ASR_TTS_共享训练池_单卡节点_整合方案.md)
  - [用户参与式训练模块](./trainning/方言_ASR_TTS_用户参与式训练模块_产品说明与风险评估_决策版.md)
  - [吴语方言语料设计](./train/WU_DIALECT_CORPUS_DESIGN_GUIDE_SHANGHAINESE.md) - 上海话语料设计

#### 用户系统（待开发）
- `user/` - 用户系统文档
  - [用户系统和计费模块 PRD](./user/User_System_and_Billing_Module_PRD.md)
  - [可行性分析](./user/User_System_and_Billing_Module_Feasibility_Analysis.md)

---

### 9. 参考文档

- `reference/` - 技术参考文档
  - [架构设计参考 v0.1](./reference/v0.1_第一部分_概述架构与技术.md)
  - [部署性能参考 v0.1](./reference/v0.1_第二部分_部署性能与结构.md)
  - [状态对比](./reference/STATUS_COMPARISON.md)

---

## 🚀 使用建议

### 首次了解项目
1. 阅读 [系统架构文档](./SYSTEM_ARCHITECTURE.md) 了解整体架构
2. 查看 [项目状态](./project_management/PROJECT_STATUS.md) 了解当前进度
3. 浏览 [产品文档索引](./PRODUCT_DOCUMENTATION_INDEX.md) 按需查找文档

### 开始开发
1. 选择你要开发的客户端（Web端/公司端/节点端）
2. 阅读对应的 README 和快速开始文档
3. 参考 [开发计划](./project_management/DEVELOPMENT_PLAN.md) 了解功能实现状态
4. 查看 [日志使用指南](./logging/USAGE_GUIDE.md) 配置日志

### 进行测试
1. 参考 [端到端测试指南](./testing/END_TO_END_TESTING_GUIDE.md)
2. 查看 [测试状态](./project_management/PROJECT_STATUS_TESTING.md) 了解测试覆盖率

### 问题排查
1. 查看对应模块的调试指南
2. 检查 [故障排查](./troubleshooting/) 文档
3. 查看日志文件（各模块 `logs/` 目录）

---

## 📝 文档维护说明

### 文档组织原则
- **按模块分类**: 文档按照三个客户端和功能模块分类
- **精简高效**: 删除过期和重复文档，保持文档数量在合理范围
- **易于查找**: 每个模块都有 README 作为索引入口
- **大小限制**: 单个文档不超过 500 行，便于阅读和维护

### 文档更新记录
- **2026-01-19**: 大规模文档整理，删除测试报告和过期分析文档，精简至 ~200 个文档
- **2025-01**: 项目文档统一迁移到 `docs/` 目录

---

## 📊 项目统计

- **文档总数**: ~200 个
- **代码测试**: 369+ 个测试用例
- **主要组件**: 3 个客户端 + 3 个服务层组件
- **支持语言**: 100+ 种语言互译
- **核心功能**: 实时语音翻译、WebRTC 会议室、模块化功能选择

---

## 🔗 相关链接

- **项目主 README**: `../README.md`
- **启动脚本说明**: `../scripts/README_PRODUCTS.md`
- **更新日志**: [CHANGELOG 2025-01](./changelog/CHANGELOG_2025_01.md)
- **迁移文档**: [PROJECT_MIGRATION.md](./PROJECT_MIGRATION.md)

---

**Lingua 项目团队**  
最后更新：2026-01-19
