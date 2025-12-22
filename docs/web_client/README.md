# Web 客户端文档

本文档目录包含 Web 客户端的所有文档，已从 `webapp/web-client/docs/` 移动至此。

## 文档索引

### 架构与设计
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Web 客户端架构设计
- [VAD_AND_STATE_MACHINE_REFACTOR.md](./VAD_AND_STATE_MACHINE_REFACTOR.md) - VAD 和状态机重构说明

### Phase 2 & Phase 3 实现
- [PHASE2_IMPLEMENTATION.md](./PHASE2_IMPLEMENTATION.md) - Phase 2 实现总结（Binary Frame、Opus 框架）
- [PHASE3_IMPLEMENTATION.md](./PHASE3_IMPLEMENTATION.md) - Phase 3 实现总结（背压、Opus、Session Init）

### 规模化相关
- [SCALABILITY_REFACTOR_SUMMARY.md](./SCALABILITY_REFACTOR_SUMMARY.md) - 规模化改造总结
- [SCALABILITY_PLAN_EVALUATION.md](./SCALABILITY_PLAN_EVALUATION.md) - 规模化方案可行性评估
- [SCALABILITY_SPEC.md](./SCALABILITY_SPEC.md) - 规模化能力要求与协议规范

### 内存与性能
- [AUDIO_BUFFER_MEMORY_ANALYSIS.md](./AUDIO_BUFFER_MEMORY_ANALYSIS.md) - 音频缓冲区内存分析
- [MEMORY_MONITORING_AND_AUTO_PLAYBACK.md](./MEMORY_MONITORING_AND_AUTO_PLAYBACK.md) - 内存监控与自动播放

### 开发与调试
- [DEBUGGING_GUIDE.md](./DEBUGGING_GUIDE.md) - 调试指南
- [SCHEDULER_COMPATIBILITY_FIX.md](./SCHEDULER_COMPATIBILITY_FIX.md) - 与调度服务器的兼容性修复说明
- [UI 改进和功能更新](../webapp/web-client/docs/UI_IMPROVEMENTS_AND_FEATURES.md) - UI 改进和功能更新（2025-01）

### 测试
- [TEST_RUN_GUIDE.md](./TEST_RUN_GUIDE.md) - 测试运行指南
- [TEST_RESULTS.md](./TEST_RESULTS.md) - 测试结果报告

---

## 文档说明

### Phase 2 & Phase 3
- **PHASE2_IMPLEMENTATION.md**: 包含 Binary Frame 协议、Opus 编码框架、协议协商等
- **PHASE3_IMPLEMENTATION.md**: 包含背压机制、Opus 编码集成、Session Init 协议增强等

### 规模化相关
- **SCALABILITY_REFACTOR_SUMMARY.md**: Phase 1 改造完成情况
- **SCALABILITY_PLAN_EVALUATION.md**: 规模化方案可行性评估
- **SCALABILITY_SPEC.md**: 规模化能力要求与协议规范（合并版）

### 内存管理
- **AUDIO_BUFFER_MEMORY_ANALYSIS.md**: 20秒播放缓冲区的内存影响分析
- **MEMORY_MONITORING_AND_AUTO_PLAYBACK.md**: 内存监控和自动播放机制

---

## 相关链接

- [项目根目录 README](../../README.md)
- [项目状态文档](../project_management/PROJECT_STATUS.md)
- [Phase 3 测试完成报告](../PHASE3_TESTING_COMPLETE_FINAL.md)

