# 文档库

本目录包含项目的长期维护文档。

## 核心文档

### 架构与设计

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 系统架构详细说明
- [MODULAR_FEATURES.md](./MODULAR_FEATURES.md) - 模块化功能设计（包含快速参考）

### 协议规范

- [PROTOCOLS.md](./PROTOCOLS.md) - WebSocket 消息协议规范（包含实现状态）

### 扩展设计

- [PUBLIC_API.md](./PUBLIC_API.md) - 对外开放 API 设计与实现（完整文档）

### 使用指南

- [GETTING_STARTED.md](./GETTING_STARTED.md) - 快速开始指南

### 项目状态与开发计划

- [PROJECT_STATUS.md](./PROJECT_STATUS.md) - 项目状态（已完成功能和待完成任务）
- [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) - 开发计划（详细的开发阶段和任务列表）
- [DISPATCHER_OPTIMIZATION_PLAN.md](./DISPATCHER_OPTIMIZATION_PLAN.md) - 任务分发算法优化方案
- [AUTO_LANGUAGE_DETECTION_AND_TWO_WAY_MODE.md](./AUTO_LANGUAGE_DETECTION_AND_TWO_WAY_MODE.md) - 自动语种识别与双向模式设计（包含可行性分析，框架已完成 ✅）

### 协议规范

- [PROTOCOLS.md](./PROTOCOLS.md) - WebSocket 消息协议规范（包含实现状态）

### 测试

- **调度服务器测试**：
  - 测试目录：`scheduler/tests/`
  - 阶段一.1 测试：`scheduler/tests/stage1.1/`（47个测试，全部通过）
  - 阶段一.2 测试：`scheduler/tests/stage1.2/`（7个测试，全部通过）
  - 测试报告：
    - [阶段一.1 测试报告](./../scheduler/tests/stage1.1/TEST_REPORT.md)
    - [阶段一.2 测试报告](./../scheduler/tests/stage1.2/TEST_REPORT.md)
- **节点推理服务测试**：
  - 测试目录：`node-inference/tests/`
  - 阶段一.3 测试：`node-inference/tests/`（20+个测试，10个本地模型测试全部通过）
  - 测试报告：
    - [阶段一.3 测试报告](./../node-inference/tests/stage1.3/TEST_REPORT.md)
    - [本地模型测试说明](./../node-inference/tests/LOCAL_MODEL_TESTING.md)

### 参考文档

- [v0.1版本项目架构与技术报告.md](./v0.1版本项目架构与技术报告.md) - 原项目技术架构参考
- [iOS 技术文档分析](./MOBILE_APP_IOS_DOCS_ANALYSIS.md) - iOS 技术文档对移动端开发的参考价值分析

### iOS 技术文档（原生 iOS 开发参考）

`docs/IOS/` 目录包含 11 个详细的 iOS 原生开发文档，虽然当前项目使用 React Native，但这些文档提供了非常有价值的架构设计和实现思路：

- [IOS_AUDIO_VAD_PIPELINE.md](./IOS/IOS_AUDIO_VAD_PIPELINE.md) - iOS 音频采集与轻量 VAD 设计 ⭐⭐⭐⭐⭐
- [IOS_CLIENT_DESIGN_AND_INTERFACES.md](./IOS/IOS_CLIENT_DESIGN_AND_INTERFACES.md) - iOS 客户端架构与核心接口 ⭐⭐⭐⭐⭐
- [IOS_WEBSOCKET_REALTIME_DESIGN.md](./IOS/IOS_WEBSOCKET_REALTIME_DESIGN.md) - WebSocket 与实时通信设计 ⭐⭐⭐⭐
- [IOS_IMPLEMENTATION_STEPS.md](./IOS/IOS_IMPLEMENTATION_STEPS.md) - 完整实施指南（7个阶段） ⭐⭐⭐⭐⭐
- [IOS_END_TO_END_SEQUENCE.md](./IOS/IOS_END_TO_END_SEQUENCE.md) - 端到端序列图 ⭐⭐⭐⭐
- [IOS_MULTI_SESSION_DESIGN.md](./IOS/IOS_MULTI_SESSION_DESIGN.md) - 多会话管理设计 ⭐⭐⭐
- [IOS_UI_SKETCHES.md](./IOS/IOS_UI_SKETCHES.md) - UI 草图 ⭐⭐⭐
- [IOS_DEBUG_MONITORING.md](./IOS/IOS_DEBUG_MONITORING.md) - 调试与监控系统设计 ⭐⭐⭐
- [IOS_MULTI_SESSION_VIEWMODEL.md](./IOS/IOS_MULTI_SESSION_VIEWMODEL.md) - 多会话 ViewModel 代码草稿 ⭐⭐⭐
- [IOS_DEBUG_OVERLAY_IMPLEMENTATION.md](./IOS/IOS_DEBUG_OVERLAY_IMPLEMENTATION.md) - DebugOverlay 实现 ⭐⭐
- [IOS_PERFORMANCE_TEST_PLAN.md](./IOS/IOS_PERFORMANCE_TEST_PLAN.md) - 性能测试计划 ⭐⭐

**注意**: 这些文档主要针对原生 iOS (Swift) 开发，但架构设计和实现思路对 React Native 开发同样有很高的参考价值。详见 [iOS 技术文档分析](./MOBILE_APP_IOS_DOCS_ANALYSIS.md)。

## 文档维护原则

1. **长期文档**: 本目录仅存放需要长期维护的文档
2. **临时文档**: 脚本使用说明、迁移指南等临时文档请放在 `scripts/` 目录
3. **及时更新**: 文档应与代码保持同步，及时更新
4. **清晰分类**: 按功能模块组织文档结构

## 文档结构说明

```
docs/
├── README.md                    # 本文件
├── ARCHITECTURE.md              # 系统架构文档
├── GETTING_STARTED.md           # 快速开始指南
├── MODULAR_FEATURES.md          # 模块化功能设计（包含快速参考）
├── PROTOCOLS.md                 # WebSocket 消息协议规范（包含实现状态）
├── PUBLIC_API.md                # 对外开放 API 设计与实现
├── PROJECT_STATUS.md            # 项目状态（已完成功能和待完成任务）
├── DEVELOPMENT_PLAN.md          # 开发计划（详细的开发阶段和任务列表）
├── DISPATCHER_OPTIMIZATION_PLAN.md  # 任务分发算法优化方案
└── v0.1版本项目架构与技术报告.md  # 参考文档
```

## 添加新文档

添加新文档时，请：

1. 确定文档类型（长期/临时）
2. 长期文档放在 `docs/` 目录
3. 临时文档放在 `scripts/` 或相应目录
4. 更新本 README.md 的文档列表
5. 在 README.md 中添加链接

