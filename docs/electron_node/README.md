# Electron Node 文档索引

## 核心文档

### 1. ASR模块流程文档
**文件**: `ASR_MODULE_FLOW_DOCUMENTATION.md`

完整的ASR模块流程和代码逻辑文档，包括：
- 模块架构概览
- 完整流程调用链（从入口到各个组件）
- 关键逻辑分支总结
- 代码逻辑检查（重复/矛盾/边界情况）
- 关键设计决策
- 参数配置

**用途**: 决策部门审议、开发人员参考

---

### 2. 长语音流式ASR技术规范
**文件**: `LONG_UTTERANCE_STREAMING_AND_SR_TRIGGER_SPEC.md`

技术规范文档，定义：
- 长语音流式ASR + 单次SR触发机制
- UtteranceState数据结构规范
- 批次累积与容器对齐策略
- 生命周期管理（20秒超时）

**用途**: 技术实现规范、架构设计参考

---

### 3. 设计符合性评审
**文件**: `ASR_MODULE_DESIGN_COMPLIANCE_REVIEW.md`

设计评审文档，包含：
- 设计符合性要点
- 优化方向与任务清单（TASK-1到TASK-4）
- 简化原则

**用途**: 代码优化指导、设计审查

---

### 4. 实现总结
**文件**: `IMPLEMENTATION_SUMMARY.md`

实现总结文档，包含：
- 核心功能实现（长语音流式ASR、音频聚合、ASR结果分发、生命周期管理）
- 代码优化完成情况
- 日志增强
- 遗留代码清理

**用途**: 快速了解实现状态、变更历史

---

## 文档结构

```
docs/electron_node/
├── README.md                                    # 本文档（索引，~100行）
├── ASR_MODULE_FLOW_DOCUMENTATION.md            # 核心：ASR模块流程（264行）
├── LONG_UTTERANCE_STREAMING_AND_SR_TRIGGER_SPEC.md  # 核心：技术规范（215行）
├── ASR_MODULE_DESIGN_COMPLIANCE_REVIEW.md      # 核心：设计评审（227行）
└── IMPLEMENTATION_SUMMARY.md                    # 核心：实现总结（191行）
```

**总计**: 约1000行核心文档，所有文档均在500行以内 ✅

---

## 快速导航

### 新开发者
1. 先阅读 `ASR_MODULE_FLOW_DOCUMENTATION.md` 了解整体架构
2. 再阅读 `LONG_UTTERANCE_STREAMING_AND_SR_TRIGGER_SPEC.md` 了解技术规范
3. 查看 `IMPLEMENTATION_SUMMARY.md` 了解实现状态

### 架构评审
1. 阅读 `ASR_MODULE_FLOW_DOCUMENTATION.md` 查看完整流程
2. 阅读 `ASR_MODULE_DESIGN_COMPLIANCE_REVIEW.md` 了解设计符合性

### 代码优化
1. 参考 `ASR_MODULE_DESIGN_COMPLIANCE_REVIEW.md` 的优化任务清单
2. 查看 `IMPLEMENTATION_SUMMARY.md` 的优化完成情况

---

## 文档维护原则

1. **核心文档控制在500行以内**
2. **删除过期的测试报告和分析文档**
3. **合并相关的实现总结**
4. **保持文档与代码同步**

---

**最后更新**: 2026年1月18日
