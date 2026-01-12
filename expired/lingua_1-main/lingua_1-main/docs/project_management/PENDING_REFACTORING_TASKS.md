# 未完成的改造任务清单

**文档日期**: 2025-01-27  
**基于文档**: 
- `docs/project_management/NEXT_DEVELOPMENT_STEPS.md`
- `docs/electron_node/asr/implementation/GATE_A_B_TEST_FIX_SUMMARY.md`
- `docs/electron_node/asr/ASR_P1_ENTRY_GATE_CHECKLIST.md`

---

## 一、Gate 状态检查

### Gate-A: Context Reset 真正生效

**文档状态**: ✅ 已完成（根据 `NEXT_DEVELOPMENT_STEPS.md`）  
**代码状态**: ✅ 已实现

**实现位置**:
- `electron_node/electron-node/main/src/pipeline-orchestrator/session-context-manager.ts` - SessionContextManager 已实现
- `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts` - 已集成到流水线
- `electron_node/electron-node/main/src/task-router/task-router.ts` - 已实现连续低质量检测和标记

**功能验证**:
- ✅ 单元测试全部通过（9个测试）
- ✅ 连续 2 次低质量 utterance 会触发 context reset
- ✅ resetContext 方法已实现并集成

**结论**: ✅ **已完成**，无需额外改造

---

### Gate-B: Rerun 指标可观测

**文档状态**: ✅ 已完成（根据 `NEXT_DEVELOPMENT_STEPS.md`）  
**代码状态**: ✅ 已实现

**实现位置**:
- `electron_node/electron-node/main/src/task-router/task-router.ts` - getRerunMetrics() 已实现
- `electron_node/electron-node/main/src/inference/inference-service.ts` - 已暴露 getRerunMetrics()
- `electron_node/electron-node/main/src/agent/node-agent.ts` - 已通过心跳上报 rerun_metrics

**功能验证**:
- ✅ 单元测试全部通过（4个测试）
- ✅ rerun_metrics 已通过 node_heartbeat 上报到调度服务器
- ✅ 指标包含：totalReruns, successfulReruns, failedReruns, timeoutReruns, qualityImprovements

**待完善项**:
- ⚠️ **指标持久化**: 当前指标仅在内存中，重启后丢失
- ⚠️ **指标聚合**: 调度服务器端可能需要聚合多个节点的指标
- ⚠️ **Dashboard 展示**: 需要将指标展示在监控面板中

**结论**: ✅ **核心功能已完成**，但需要完善持久化和展示

---

### Gate-C: P0.5 行为稳定性回归

**文档状态**: ✅ 已完成  
**测试结果**: ✅ 通过

**结论**: ✅ **已完成**

---

### Gate-D: P1 触发样本可收集

**文档状态**: ✅ 已完成

**结论**: ✅ **已完成**

---

## 二、P0 补充功能（OBS 系列）

### OBS-1: 埋点指标

**状态**: ⚠️ **部分完成**

**已完成**:
- ✅ 节点端已实现 rerun 指标统计
- ✅ 节点端已实现 qualityScore 和 reasonCodes 计算

**待完成**:
- ❌ **ASR 端到端延迟统计**（p50/p95/p99）
  - 需要在节点端记录 ASR 任务开始和结束时间
  - 需要计算并上报延迟分位数
  - **预计工期**: 0.5 天

- ❌ **语言置信度分布统计**
  - 需要统计 language_probability 的分布（例如：<0.5, 0.5-0.7, 0.7-0.9, >0.9）
  - 需要定期上报或聚合
  - **预计工期**: 0.5 天

- ❌ **坏段检测率统计**
  - 需要统计 bad_segment_rate = bad_segments / total_segments
  - 需要区分线下模式和会议室模式
  - **预计工期**: 0.5 天

- ❌ **重跑触发率统计**
  - 需要统计 rerun_trigger_rate = rerun_count / total_jobs
  - 需要区分线下模式和会议室模式
  - **预计工期**: 0.5 天

**实现位置**:
- 节点端: `electron_node/electron-node/main/src/task-router/task-router.ts`
- 调度服务器: `central_server/scheduler/src/websocket/session_actor/actor.rs`

**总预计工期**: 2 天

---

### OBS-2: reason_codes 和 quality_score 透传

**状态**: ✅ **已完成**

**验证**:
- ✅ 节点端已填充字段
- ✅ 调度服务器已透传字段
- ✅ 数据流：Node → Scheduler → Web Client

**结论**: ✅ **已完成**

---

### OBS-3: 限频/超时机制配置

**状态**: ✅ **已完成**

**验证**:
- ✅ 配置结构已添加
- ✅ 支持 max_rerun_count、rerun_timeout_ms、conference_mode_strict
- ✅ 配置已生效

**结论**: ✅ **已完成**

---

## 三、P0.5 核心功能（RERUN 系列）

### RERUN-1: 坏段判定器

**状态**: ✅ **已完成**

**结论**: ✅ **已完成**

---

### RERUN-2: Top-2 语言重跑

**状态**: ✅ **已完成**

**验证**:
- ✅ 已实现 Top-2 语言重跑逻辑
- ✅ 支持强制语言重跑
- ✅ 支持超时保护
- ✅ 支持质量评分择优

**结论**: ✅ **已完成**

---

### RERUN-3: 质量评分选择器优化（可选）

**状态**: ⚠️ **部分完成**

**当前实现**:
- ✅ 质量评分已实现（减法模式：从 1.0 开始减去）
- ✅ 质量评分择优逻辑已实现

**待优化**（可选）:
- ❌ **加权公式优化**
  - 当前使用简单的减法模式
  - 建议优化为加权公式：
    ```typescript
    qualityScore = 
      baseScore * 0.3 +           // 基础分（文本长度）
      langProbScore * 0.3 +       // 语言置信度分
      garbagePenalty * 0.2 +      // 乱码惩罚
      segmentPenalty * 0.1 +      // segments 异常惩罚
      overlapPenalty * 0.1        // 重叠惩罚
    ```
  - **预计工期**: 0.5 天（如果需要优化）

**建议**: 
- 如果当前实现已经能够正常工作，可以暂时不优化
- 如果发现质量评分不够准确，可以考虑优化

**结论**: ⚠️ **核心功能已完成，优化可选**

---

## 四、集成测试和端到端验证

**状态**: ❌ **待完成**

**需要验证的内容**:

1. **OBS-2 数据透传完整性**
   - ❌ 验证从 Node → Scheduler → Web Client 的数据流
   - ❌ 确认所有字段正确传递
   - **预计工期**: 0.5 天

2. **OBS-1 指标记录准确性**
   - ❌ 验证指标是否正确记录
   - ❌ 检查指标计算逻辑
   - **预计工期**: 0.5 天

3. **OBS-3 配置生效**
   - ❌ 验证配置是否正确加载
   - ❌ 测试 max_rerun_count 和 rerun_timeout_ms 是否生效
   - **预计工期**: 0.5 天

4. **RERUN-2 重跑逻辑**
   - ❌ 验证 Top-2 语言重跑是否正常工作
   - ❌ 测试质量评分选择器是否选择最佳结果
   - **预计工期**: 0.5 天

**总预计工期**: 2 天

---

## 五、性能优化和监控

**状态**: ❌ **待完成**

**需要关注的点**:

1. **延迟影响**
   - ❌ 监控重跑带来的延迟增量
   - ❌ 确保 p95 延迟增量在可接受范围内（< 200ms）
   - **预计工期**: 0.5 天

2. **资源消耗**
   - ❌ 监控重跑对 CPU/内存的影响
   - ❌ 确保不会导致资源耗尽
   - **预计工期**: 0.5 天

3. **触发率**
   - ❌ 监控重跑触发率
   - ❌ 确保会议室模式 < 5%，线下模式 < 10%
   - **预计工期**: 0.5 天

**总预计工期**: 1.5 天

---

## 六、文档和总结

**状态**: ⚠️ **部分完成**

**已完成**:
- ✅ Web 客户端重构文档已创建
- ✅ Bug 修复文档已创建

**待完成**:
- ❌ **API 文档更新**
  - 更新接口文档
  - 添加配置说明
  - **预计工期**: 0.5 天

- ❌ **测试报告整理**
  - 整理测试结果
  - 记录已知问题和限制
  - **预计工期**: 0.5 天

- ❌ **部署指南**
  - 配置说明
  - 监控指标说明
  - **预计工期**: 0.5 天

**总预计工期**: 1.5 天

---

## 七、P1 阶段功能（未来规划）

根据 `ASR_NEXT_PHASE_DEVELOPMENT_PLAN.md`，P1 阶段功能包括：

### P1 核心功能（待开始）

1. **WORD-1/2: Word-level 置信度** ❌ 待实现
   - 坏段触发时启用 `word_timestamps=True`
   - 低置信词比例与低置信词列表计算
   - **预计工期**: 1 天

2. **HMP-1/2/3: 同音候选生成与重排** ❌ 待实现
   - Glossary 接口（会议室/线下可配置词表）
   - 同音/近音候选生成器
   - 候选重排：规则/术语综合打分
   - **预计工期**: 4 天

**注意**: P1 功能需要在 P0.5 完全稳定后再开始。

---

## 八、总结

### 已完成 ✅

1. ✅ Gate-A: Context Reset 真正生效
2. ✅ Gate-B: Rerun 指标可观测（核心功能）
3. ✅ Gate-C: P0.5 行为稳定性回归
4. ✅ Gate-D: P1 触发样本可收集
5. ✅ OBS-2: reason_codes 和 quality_score 透传
6. ✅ OBS-3: 限频/超时机制配置
7. ✅ RERUN-1: 坏段判定器
8. ✅ RERUN-2: Top-2 语言重跑

### 待完成 ❌

#### 高优先级（建议优先完成）

1. **OBS-1: 埋点指标**（2 天）
   - ASR 端到端延迟统计
   - 语言置信度分布统计
   - 坏段检测率统计
   - 重跑触发率统计

2. **集成测试和端到端验证**（2 天）
   - OBS-2 数据透传完整性验证
   - OBS-1 指标记录准确性验证
   - OBS-3 配置生效验证
   - RERUN-2 重跑逻辑验证

#### 中优先级

3. **性能优化和监控**（1.5 天）
   - 延迟影响监控
   - 资源消耗监控
   - 触发率监控

4. **Gate-B 完善**（可选，1 天）
   - 指标持久化
   - 指标聚合
   - Dashboard 展示

#### 低优先级（可选）

5. **RERUN-3 质量评分优化**（0.5 天）
   - 加权公式优化（如果当前实现不够准确）

6. **文档和总结**（1.5 天）
   - API 文档更新
   - 测试报告整理
   - 部署指南

### 总预计工期

- **必须完成**: 5.5 天（OBS-1 + 集成测试 + 性能监控）
- **建议完成**: 6.5 天（+ Gate-B 完善）
- **完整完成**: 8.5 天（+ RERUN-3 优化 + 文档）

---

## 九、建议的开发顺序

1. **第一步**: 完成 OBS-1 埋点指标（2 天）
   - 为后续优化提供数据支撑
   - 便于监控系统性能

2. **第二步**: 集成测试和端到端验证（2 天）
   - 确保所有功能在实际环境中正常工作
   - 发现并修复潜在问题

3. **第三步**: 性能优化和监控（1.5 天）
   - 确保系统性能不受影响
   - 建立监控机制

4. **第四步**: Gate-B 完善（可选，1 天）
   - 指标持久化
   - Dashboard 展示

5. **第五步**: 文档和总结（1.5 天）
   - 完善文档
   - 准备进入下一阶段

---

## 十、进入 P1 的条件

根据 `ASR_P1_ENTRY_GATE_CHECKLIST.md`：

- ✅ **Gate-A**: Context Reset 真正生效 - **已完成**
- ✅ **Gate-B**: Rerun 指标可观测 - **核心功能已完成**（建议完善持久化）
- ✅ **Gate-C**: P0.5 行为稳定性回归 - **已完成**
- ✅ **Gate-D**: P1 触发样本可收集 - **已完成**

**结论**: 所有 Gate 条件已满足，**可以进入 P1 阶段开发**。

但建议先完成 OBS-1 埋点指标和集成测试，为 P1 阶段提供更好的观测和验证能力。

---

**文档维护**: 本文档应在每次完成改造任务后更新。  
**最后更新**: 2025-01-27

