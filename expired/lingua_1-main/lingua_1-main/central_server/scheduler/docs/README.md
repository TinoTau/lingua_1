# Scheduler 文档索引

## 文档结构

本文档目录已按功能分类整理：

```
docs/
├── architecture/      # 架构设计文档
├── design/           # 功能设计文档
├── implementation/   # 实现与优化文档
├── issues/           # 问题诊断与修复文档
├── testing/          # 测试相关文档
├── operations/       # 运维与部署文档
└── archived/         # 已归档的文档（已整合或过期）
```

---

## 核心架构文档

### ⭐ 必读文档

1. **[architecture/SCHEDULER_ARCHITECTURE_V3_COMPLETE.md](./architecture/SCHEDULER_ARCHITECTURE_V3_COMPLETE.md)**
   - 调度服务器 v3.0 架构完整文档
   - 基于实际代码实现，包含三域模型、任务分配流程、锁使用情况
   - **已整合以下文档内容**:
     - `SCHEDULER_FLOW_AND_LOCK_DESIGN_v3.0.md` ✅
     - `SCHEDULER_FLOW_AND_LOCK_DESIGN_v3.1_DEV_GUIDE.md` ✅
     - `SCHEDULER_JOB_ALLOCATION_FLOW_ANALYSIS.md` ✅

2. **[architecture/NODE_AND_TASK_MANAGEMENT_FLOW_DECISION.md](./architecture/NODE_AND_TASK_MANAGEMENT_FLOW_DECISION.md)** ⭐ **决策文档（最新）**
   - 节点管理和任务管理流程决策文档（极简无锁调度服务版本）
   - 详细描述每一步调用的方法和流程
   - **状态**: ✅ 新实现已完成并集成
   - **测试**: 单元测试通过
   - **用途**: 供决策部门审议
   - **配套文档**:
     - [DECISION_SUMMARY.md](./architecture/DECISION_SUMMARY.md) - 决策摘要
     - [FLOW_DIAGRAMS.md](./architecture/FLOW_DIAGRAMS.md) - 流程图（Mermaid 格式）

3. **[architecture/SCHEDULER_ARCHITECTURE_V3_REFACTOR_DECISION.md](./architecture/SCHEDULER_ARCHITECTURE_V3_REFACTOR_DECISION.md)**
   - 架构重构决策文档（用于决策流程）

3. **[architecture/LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md](./architecture/LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md)** ⭐ **核心规范**
   - 极简无锁调度服务器技术规范（当前使用的规范）
   - 详细的 Redis Key 设计和 Lua 脚本规范
   - **状态**: ✅ 已实现并投入使用

4. **[architecture/SCHEDULER_ARCHITECTURE_V3_COMPLETE.md](./architecture/SCHEDULER_ARCHITECTURE_V3_COMPLETE.md)**
   - 调度服务器 v3.0 架构完整文档（旧架构参考）
   - 包含三域模型、任务分配流程、锁使用情况

---

## 功能设计文档 (design/)

### 核心设计

- **[POOL_ARCHITECTURE.md](./design/POOL_ARCHITECTURE.md)** - Pool 架构设计（语言集合设计）
- **[NODE_REGISTRATION.md](./design/NODE_REGISTRATION.md)** - 节点注册与 Pool 生成流程
- **[NODE_CAPACITY_CONTROL_MECHANISM.md](./design/NODE_CAPACITY_CONTROL_MECHANISM.md)** - 节点容量控制机制
- **[CAPABILITY_BY_TYPE_DESIGN.md](./design/CAPABILITY_BY_TYPE_DESIGN.md)** - capability_by_type 设计说明
- **[LANGUAGE_SET_POOL_IMPLEMENTATION.md](./design/LANGUAGE_SET_POOL_IMPLEMENTATION.md)** - 语言集合 Pool 实现总结
- **[JOB_FSM_STATE_MAPPING.md](./design/JOB_FSM_STATE_MAPPING.md)** - 任务状态机状态映射
- **[MULTI_INSTANCE_DEPLOYMENT.md](./design/MULTI_INSTANCE_DEPLOYMENT.md)** - 多实例部署指南

### 流程分析

- **[NODE_POOL_ALLOCATION_FLOW_ANALYSIS.md](./design/NODE_POOL_ALLOCATION_FLOW_ANALYSIS.md)** - 节点 Pool 分配流程分析
- **[POOL_ALLOCATION_LOOP_ANALYSIS.md](./design/POOL_ALLOCATION_LOOP_ANALYSIS.md)** - Pool 分配循环分析
- **[NODE_REGISTRATION_AND_LOCK_ANALYSIS.md](./design/NODE_REGISTRATION_AND_LOCK_ANALYSIS.md)** - 节点注册和锁分析
- **[NODE_CLIENT_ALIGNMENT_CHECK.md](./design/NODE_CLIENT_ALIGNMENT_CHECK.md)** - 节点客户端对齐检查

### 中文设计文档

- **[任务分配机制_补充增强项与阶段Checklist_v1.1.md](./design/任务分配机制_补充增强项与阶段Checklist_v1.1.md)**
- **[任务分配机制建议_可行性评估.md](./design/任务分配机制建议_可行性评估.md)**
- **[任务分配稳定且高效_整体机制_建议_v1.0.md](./design/任务分配稳定且高效_整体机制_建议_v1.0.md)**

---

## 实现与优化文档 (implementation/)

### 实现状态

- **[IMPLEMENTATION_STATUS.md](./implementation/IMPLEMENTATION_STATUS.md)** ⭐
  - 核心功能实现状态
  - 测试状态总结
  - Pool Redis 迁移状态
  - 功能完整性评估

- **[CODE_QUALITY.md](./implementation/CODE_QUALITY.md)**
  - 代码质量与清理报告
  - 已完成的清理工作
  - 客户端兼容性检查

- **[LOCKLESS_IMPLEMENTATION_FINAL.md](./implementation/LOCKLESS_IMPLEMENTATION_FINAL.md)**
  - 无锁架构实现完成报告（最新版本）
  - 核心功能完成状态
  - 代码简化总结

### 优化实现

- **[SCHEDULER_OPTIMIZATION_SUMMARY.md](./implementation/SCHEDULER_OPTIMIZATION_SUMMARY.md)** - 调度器优化总结
- **[LOCK_OPTIMIZATION_IMPLEMENTATION_SUMMARY.md](./implementation/LOCK_OPTIMIZATION_IMPLEMENTATION_SUMMARY.md)** - 锁优化实现总结
- **[JOB_SESSION_LEVEL_LOCK_OPTIMIZATION.md](./implementation/JOB_SESSION_LEVEL_LOCK_OPTIMIZATION.md)** - 任务 Session 级锁优化
- **[HEARTBEAT_OPTIMIZATION_FINAL_SUMMARY.md](./implementation/HEARTBEAT_OPTIMIZATION_FINAL_SUMMARY.md)** - 心跳优化最终总结

### Phase 实现

- **[PHASE2_AND_PHASE3_EXPLANATION.md](./implementation/PHASE2_AND_PHASE3_EXPLANATION.md)** - Phase2 和 Phase3 说明
- **[PHASE3_EXPLANATION.md](./implementation/PHASE3_EXPLANATION.md)** - Phase3 说明
- **[PHASE3_POOL_SESSION_BINDING_OPTIMIZATION.md](./implementation/PHASE3_POOL_SESSION_BINDING_OPTIMIZATION.md)** - Phase3 Pool Session 绑定优化
- **[phase2_implementation.md](./implementation/phase2_implementation.md)** - Phase2 实现
- **[phase2_streams_ops.md](./implementation/phase2_streams_ops.md)** - Phase2 Streams 操作

### 流程文档

- **[NODE_AND_JOB_MANAGEMENT_FLOW.md](./implementation/NODE_AND_JOB_MANAGEMENT_FLOW.md)** ⭐
  - 节点管理和任务管理流程详细文档
  - 节点注册、心跳、任务创建、任务完成流程
  - 重复调用分析和修复

### 锁优化分析

- **[LOCK_USAGE_ANALYSIS.md](./implementation/LOCK_USAGE_ANALYSIS.md)** - 锁使用分析
- **[MANAGEMENT_REGISTRY_LOCK_CONTENTION_DECISION.md](./implementation/MANAGEMENT_REGISTRY_LOCK_CONTENTION_DECISION.md)** - 管理注册表锁竞争决策
- **[MANAGEMENT_REGISTRY_LOCK_OPTIMIZATION_ANALYSIS.md](./implementation/MANAGEMENT_REGISTRY_LOCK_OPTIMIZATION_ANALYSIS.md)** - 管理注册表锁优化分析
- **[NODE_REGISTRY_LOCK_OPTIMIZATION.md](./implementation/NODE_REGISTRY_LOCK_OPTIMIZATION.md)** - 节点注册表锁优化
- **[GROUP_MANAGER_LOCK_REFACTOR_v1.md](./implementation/GROUP_MANAGER_LOCK_REFACTOR_v1.md)** - 组管理器锁重构

### 重构与清理

- **[LOCKLESS_REFACTOR_ACTION_PLAN_v1.md](./implementation/LOCKLESS_REFACTOR_ACTION_PLAN_v1.md)** - 无锁架构重构行动计划
- **[LOCKLESS_REFACTOR_SUMMARY.md](./implementation/LOCKLESS_REFACTOR_SUMMARY.md)** - 无锁架构重构总结
- **[SCHEDULER_PATH_REFACTOR_PLAN.md](./implementation/SCHEDULER_PATH_REFACTOR_PLAN.md)** - 调度器路径重构计划
- **[SCHEDULER_PATH_REFACTOR_PROGRESS.md](./implementation/SCHEDULER_PATH_REFACTOR_PROGRESS.md)** - 调度器路径重构进度
- **[BACKWARD_COMPATIBILITY_REMOVAL.md](./implementation/BACKWARD_COMPATIBILITY_REMOVAL.md)** - 向后兼容性移除
- **[COMPATIBILITY_REMOVAL_SUMMARY.md](./implementation/COMPATIBILITY_REMOVAL_SUMMARY.md)** - 兼容性移除总结
- **[STALE_CODE_FIX_SUMMARY.md](./implementation/STALE_CODE_FIX_SUMMARY.md)** - 过时代码修复总结
- **[UNUSED_IMPORTS_CLEANUP.md](./implementation/UNUSED_IMPORTS_CLEANUP.md)** - 未使用导入清理
- **[WARNINGS_CLEANUP_SUMMARY.md](./implementation/WARNINGS_CLEANUP_SUMMARY.md)** - 警告清理总结

---

## 问题诊断文档 (issues/)

- **[DUPLICATE_JOB_CREATION_ISSUE_REPORT.md](./issues/DUPLICATE_JOB_CREATION_ISSUE_REPORT.md)** - 重复任务创建问题报告
- **[GPU_PERFORMANCE_ANALYSIS.md](./issues/GPU_PERFORMANCE_ANALYSIS.md)** - GPU 性能分析
- **[UTTERANCE_INDEX_BUG_FIX.md](./issues/UTTERANCE_INDEX_BUG_FIX.md)** - 话语索引 Bug 修复
- **[PERFORMANCE_DEBUGGING.md](./issues/PERFORMANCE_DEBUGGING.md)** - 性能调试
- **[POOL_INDEX_BUG_ROOT_CAUSE_ANALYSIS.md](./issues/POOL_INDEX_BUG_ROOT_CAUSE_ANALYSIS.md)** - Pool 索引 Bug 根因分析
- **[POOL_INDEX_DEBUG_FIX.md](./issues/POOL_INDEX_DEBUG_FIX.md)** - Pool 索引调试修复
- **[TTS_AUDIO_MISSING_DIAGNOSIS.md](./issues/TTS_AUDIO_MISSING_DIAGNOSIS.md)** - TTS 音频缺失诊断
- **[SEMANTIC_SERVICE_NOT_CALLED_AND_LOCK_ANALYSIS.md](./issues/SEMANTIC_SERVICE_NOT_CALLED_AND_LOCK_ANALYSIS.md)** - 语义服务未调用和锁分析
- **[PERFORMANCE_ISSUE_GROUP_MANAGER_LOCK_CONTENTION.md](./issues/PERFORMANCE_ISSUE_GROUP_MANAGER_LOCK_CONTENTION.md)** - 性能问题：组管理器锁竞争
- **[RUNTIME_INITIALIZATION_FIX.md](./issues/RUNTIME_INITIALIZATION_FIX.md)** - 运行时初始化修复
- **[TEST_TIMEOUT_FIX.md](./issues/TEST_TIMEOUT_FIX.md)** - 测试超时修复

---

## 测试文档 (testing/)

### 测试总结

- **[TEST_SUMMARY_FINAL.md](./testing/TEST_SUMMARY_FINAL.md)** ⭐
  - 测试结果汇总（最新版本）
  - 单元测试结果
  - 测试覆盖范围
  - 已知问题

### 专项测试

- **[PHASE3_TEST_RESULTS.md](./testing/PHASE3_TEST_RESULTS.md)** - Phase3 测试结果
- **[HEARTBEAT_OPTIMIZATION_TEST_FINAL_REPORT.md](./testing/HEARTBEAT_OPTIMIZATION_TEST_FINAL_REPORT.md)** - 心跳优化测试最终报告
- **[HEARTBEAT_OPTIMIZATION_FINAL_TEST.md](./testing/HEARTBEAT_OPTIMIZATION_FINAL_TEST.md)** - 心跳优化最终测试
- **[HEARTBEAT_OPTIMIZATION_TEST_ANALYSIS.md](./testing/HEARTBEAT_OPTIMIZATION_TEST_ANALYSIS.md)** - 心跳优化测试分析
- **[HEARTBEAT_OPTIMIZATION_TEST_RESULTS.md](./testing/HEARTBEAT_OPTIMIZATION_TEST_RESULTS.md)** - 心跳优化测试结果
- **[NODE_REGISTRATION_POOL_ALLOCATION_TEST_RESULTS.md](./testing/NODE_REGISTRATION_POOL_ALLOCATION_TEST_RESULTS.md)** - 节点注册 Pool 分配测试结果
- **[TASK_ALLOCATION_LOCK_TEST_SUMMARY.md](./testing/TASK_ALLOCATION_LOCK_TEST_SUMMARY.md)** - 任务分配锁测试总结
- **[FLOW_TEST_RESULTS.md](./testing/FLOW_TEST_RESULTS.md)** - 流程测试结果

### 验证与排查

- **[PARAMETER_PASSING_VERIFICATION.md](./testing/PARAMETER_PASSING_VERIFICATION.md)** - 参数传递验证清单
- **[WEB_JOB_DISPATCH_VERIFICATION.md](./testing/WEB_JOB_DISPATCH_VERIFICATION.md)** - Web 任务分发验证
- **[TEST_TROUBLESHOOTING.md](./testing/TEST_TROUBLESHOOTING.md)** - 测试故障排查

---

## 运维文档 (operations/)

- **[OBSERVABILITY_METRICS_IMPLEMENTATION.md](./operations/OBSERVABILITY_METRICS_IMPLEMENTATION.md)** ⭐
  - 可观测性指标实现
  - 监控指标说明

- **[release_runbook.md](./operations/release_runbook.md)**
  - 发布运行手册
  - 部署流程

- **[REDIS_VERSION_WARNING.md](./operations/REDIS_VERSION_WARNING.md)**
  - Redis 版本警告
  - 兼容性说明

---

## 已归档文档 (archived/)

以下文档已整合到其他文档中，或已过期，已移动到 `archived/` 目录：

- `SCHEDULER_FLOW_AND_LOCK_DESIGN_v3.0.md` ✅ 已整合到 `SCHEDULER_ARCHITECTURE_V3_COMPLETE.md`
- `SCHEDULER_FLOW_AND_LOCK_DESIGN_v3.1_DEV_GUIDE.md` ✅ 已整合到 `SCHEDULER_ARCHITECTURE_V3_COMPLETE.md`
- `SCHEDULER_JOB_ALLOCATION_FLOW_ANALYSIS.md` ✅ 已整合到 `SCHEDULER_ARCHITECTURE_V3_COMPLETE.md`
- `LOCKLESS_IMPLEMENTATION_COMPLETE.md` ✅ 已被 `LOCKLESS_IMPLEMENTATION_FINAL.md` 替代
- `LOCKLESS_IMPLEMENTATION_STATUS.md` ✅ 已被 `LOCKLESS_IMPLEMENTATION_FINAL.md` 替代
- `LOCKLESS_IMPLEMENTATION_STATUS_FINAL.md` ✅ 已被 `LOCKLESS_IMPLEMENTATION_FINAL.md` 替代
- `LOCKLESS_IMPLEMENTATION_PROGRESS.md` ✅ 已被 `LOCKLESS_IMPLEMENTATION_FINAL.md` 替代
- `LOCKLESS_IMPLEMENTATION_SUMMARY.md` ✅ 已被 `LOCKLESS_IMPLEMENTATION_FINAL.md` 替代
- `NODE_AND_JOB_MANAGEMENT_FLOW_DECISION.md` ✅ 已迁移到无锁架构，已归档
- `CURRENT_FLOW_ANALYSIS_DECISION.md` ✅ 已整合到 `NODE_AND_TASK_MANAGEMENT_FLOW_DECISION.md`
- `LOCKLESS_ARCHITECTURE_DESIGN.md` ✅ 提案文档，已有 `LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md` 作为规范
- `LOCKLESS_ARCHITECTURE_EXECUTIVE_SUMMARY.md` ✅ 提案摘要，已有 `LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md` 作为规范
- `LOCKLESS_ANALYSIS.md` ✅ 历史分析文档，已有 `LOCKLESS_MINIMAL_SCHEDULER_SPEC_v1.md` 作为规范
- `UNIT_TEST_FINAL_RESULTS.md` ✅ 已整合到 `TEST_SUMMARY_FINAL.md`
- `UNIT_TEST_EXECUTION_RESULTS.md` ✅ 已整合到 `TEST_SUMMARY_FINAL.md`
- `UNIT_TESTS_SUMMARY.md` ✅ 已整合到 `TEST_SUMMARY_FINAL.md`
- `TEST_RESULTS.md` ✅ 已整合到 `TEST_SUMMARY_FINAL.md`
- `SERVER_TEST_RESULTS.md` ✅ 已整合到 `TEST_SUMMARY_FINAL.md`

---

## 快速导航

### 新手上路
1. 阅读 [SCHEDULER_ARCHITECTURE_V3_COMPLETE.md](./architecture/SCHEDULER_ARCHITECTURE_V3_COMPLETE.md) 了解整体架构
2. 阅读 [IMPLEMENTATION_STATUS.md](./implementation/IMPLEMENTATION_STATUS.md) 了解实现状态
3. 阅读 [NODE_AND_JOB_MANAGEMENT_FLOW.md](./implementation/NODE_AND_JOB_MANAGEMENT_FLOW.md) 了解核心流程

### 开发人员
- **架构设计**: `architecture/` 目录
- **功能设计**: `design/` 目录
- **实现状态**: `implementation/IMPLEMENTATION_STATUS.md`
- **测试结果**: `testing/TEST_SUMMARY_FINAL.md`

### 运维人员
- **部署指南**: `operations/release_runbook.md`
- **监控指标**: `operations/OBSERVABILITY_METRICS_IMPLEMENTATION.md`
- **问题诊断**: `issues/` 目录

---

## 文档更新历史

- **2026-01-11**: 文档分类整理
  - 创建分类目录结构（architecture/design/implementation/issues/testing/operations/archived）
  - 合并重复文档，移除过期内容
  - 更新 README.md 反映新的文档结构

- **2025-01-28**: 创建 v3.0 架构完整文档
  - 创建 `SCHEDULER_ARCHITECTURE_V3_COMPLETE.md`，整合所有 v3.0 相关文档
  - 整合内容：
    - `SCHEDULER_FLOW_AND_LOCK_DESIGN_v3.0.md` ✅
    - `SCHEDULER_FLOW_AND_LOCK_DESIGN_v3.1_DEV_GUIDE.md` ✅
    - `SCHEDULER_JOB_ALLOCATION_FLOW_ANALYSIS.md` ✅

---

**最后更新**: 2026-01-11
