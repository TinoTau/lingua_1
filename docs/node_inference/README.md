# 节点推理服务文档

本目录包含节点推理服务（Node Inference Service）相关的设计文档和实现说明。

## 文档列表

- [自动语种识别与双向模式设计](./AUTO_LANGUAGE_DETECTION_AND_TWO_WAY_MODE.md) - 自动语种识别功能的设计文档（包含可行性分析，框架已完成 ✅）
- [两级 VAD 设计](./TWO_LEVEL_VAD_DESIGN.md) - 两级 VAD 设计说明

## 相关文档

- [系统架构文档](../ARCHITECTURE.md) - 节点推理服务架构说明
- [协议规范文档](../PROTOCOLS.md) - WebSocket 消息协议规范
- [项目状态](../project_management/PROJECT_STATUS.md) - 节点推理服务实现状态

## 测试报告

- [阶段 1.3 测试报告](../../node-inference/tests/stage1.3/TEST_REPORT.md) - 核心功能测试（20+个测试，10个本地模型测试全部通过）
- [阶段 1.4 测试报告](../../node-inference/tests/stage1.4/TEST_REPORT.md) - 自动语种识别测试（7个测试，全部通过）
- [阶段 2.1.2 测试报告](../../node-inference/tests/stage2.1.2/TEST_REPORT.md) - ASR 字幕功能测试（5个测试，2个通过，3个需要模型文件）
- [本地模型测试说明](../../node-inference/tests/LOCAL_MODEL_TESTING.md) - 本地模型测试指南

