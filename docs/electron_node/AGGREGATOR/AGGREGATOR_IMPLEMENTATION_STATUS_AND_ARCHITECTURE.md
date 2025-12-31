# Aggregator 实现状态与架构

**状态**：✅ **已完成**  
**最后更新**：2025-01-XX

本文档整合了 Aggregator 的实现状态和架构说明。

---

## 目录

1. [实现状态总览](#实现状态总览)
2. [架构实现](#架构实现)
3. [功能实现详情](#功能实现详情)
4. [Blocker 解决状态](#blocker-解决状态)
5. [测试状态](#测试状态)
6. [配置参数](#配置参数)
7. [指标监控](#指标监控)

---

## 实现状态总览

✅ **P0 核心功能已全部实现**

| 功能模块 | 状态 | 位置 | 说明 |
|---------|------|------|------|
| 核心决策逻辑 | ✅ 完成 | `aggregator-decision.ts` | Text Incompleteness Score + Language Stability Gate |
| Dedup 功能 | ✅ 完成 | `dedup.ts` | 边界重叠裁剪 |
| Tail Carry 功能 | ✅ 完成 | `tail-carry.ts` | 尾巴延迟归属 |
| 会话态管理 | ✅ 完成 | `aggregator-state.ts` | per session 状态管理 |
| 多会话管理器 | ✅ 完成 | `aggregator-manager.ts` | TTL/LRU 回收 |
| 中间件集成 | ✅ 完成 | `aggregator-middleware.ts` | NodeAgent 中间件 |
| gap_ms 计算 | ✅ 完成 | `aggregator-state.ts` | 从 segments 推导时间戳 |

---

## 架构实现

### 中间件架构（已实现）

**位置**：`electron_node/electron-node/main/src/agent/aggregator-middleware.ts`

**集成点**：`NodeAgent.handleJob()` 中，在 `InferenceService.processJob()` 之后、发送 `JobResultMessage` 之前

**架构流程**：
```
JobAssignMessage (Scheduler)
  ↓
NodeAgent.handleJob()
  ↓
InferenceService.processJob()
  ↓
PipelineOrchestrator.processJob()
  ├─ ASR Service → ASRResult
  ├─ NMT Service → NMTResult
  └─ TTS Service → TTSResult
  ↓
JobResult (包含 text_asr, text_translated, tts_audio, segments)
  ↓
AggregatorMiddleware.process()  ← 中间件处理
  ├─ 处理 text_asr（聚合、去重、边界重建）
  └─ 返回处理后的结果
  ↓
JobResultMessage (发送到 Scheduler)
```

**优势**：
- ✅ 解耦：不依赖 PipelineOrchestrator 的具体实现
- ✅ 灵活性：可以轻松启用/禁用
- ✅ 不影响模型替换：模型替换只影响 InferenceService

**配置**：
```typescript
{
  enabled: true,  // 是否启用
  mode: 'offline' | 'room',  // 模式
  ttlMs: 5 * 60 * 1000,  // 会话超时时间
  maxSessions: 1000,  // 最大会话数
}
```

---

## 功能实现详情

### 1. Text Incompleteness Score

✅ **已实现**

**位置**：`aggregator-decision.ts` (textIncompletenessScore 函数)

**评分项**：
- ✅ 极短文本检测
- ✅ 短文本检测
- ✅ 短 gap 检测
- ✅ 无强句末标点检测
- ✅ 连接词/语气词尾检测
- ✅ 低质量检测

### 2. Language Stability Gate

✅ **已实现**

**位置**：`aggregator-decision.ts` (isLangSwitchConfident 函数)

**判断条件**：
- ✅ 前后双高置信度检查（p1 >= 0.80）
- ✅ 语言切换检查（top1 不同）
- ✅ Margin 检查（p1 - p2 >= margin）
- ✅ Gap 联动检查（gap_ms > threshold）

### 3. merge/new_stream 决策

✅ **已实现**

**位置**：`aggregator-decision.ts` (decideStreamAction 函数)

**决策流程**：
- ✅ 硬规则（isManualCut, hardGap）
- ✅ 语言稳定门
- ✅ 强 merge
- ✅ 评分 merge

### 4. Commit 策略

✅ **已实现**

**位置**：`aggregator-decision.ts` (shouldCommit 函数)

**触发条件**：
- ✅ 时间触发（commit_interval_ms）
- ✅ 长度触发（commit_len_cjk / commit_len_en_words）

### 5. Dedup（边界去重）

✅ **已实现**

**位置**：`dedup.ts` (dedupMergePrecise 函数)

**功能**：
- ✅ 最长重叠前后缀检测
- ✅ 重叠裁剪（3-15 字符范围）
- ✅ 支持 CJK 和英文

### 6. Tail Carry（尾巴延迟归属）

✅ **已实现**

**位置**：`tail-carry.ts` (extractTail, removeTail 函数)

**功能**：
- ✅ 计算尾部长度（CJK/英文不同策略）
- ✅ 提取尾部文本
- ✅ 移除尾部文本（用于 commit）

### 7. 会话态管理

✅ **已实现**

**位置**：`aggregator-state.ts` (AggregatorState 类)

**功能**：
- ✅ 维护 pending text
- ✅ 维护上一个 utterance 信息
- ✅ 维护会话时间轴
- ✅ 维护 tail buffer
- ✅ 指标收集

### 8. 多会话管理器

✅ **已实现**

**位置**：`aggregator-manager.ts` (AggregatorManager 类)

**功能**：
- ✅ TTL 自动清理（5 分钟）
- ✅ LRU 回收（超过 1000 个会话时）
- ✅ Flush 和清理接口

---

## Blocker 解决状态

### Blocker 1：gap_ms 的可靠来源

✅ **已解决** - 采用方案 A（从 ASR segments 推导）

**实现**：
- 从 `asrResult.segments` 提取时间戳
- 在 `AggregatorState.calculateUtteranceTime()` 中计算
- 维护会话时间轴，推导 utterance 的绝对时间
- 降级策略：segments 缺失时使用当前时间估算

**代码位置**：
- `aggregator-state.ts` (calculateUtteranceTime 方法)

### Blocker 2：跨 utterance 的 Dedup + Tail Carry

✅ **已解决** - 已实现

**实现**：
- Dedup：`dedup.ts` - 边界重叠裁剪算法
- Tail Carry：`tail-carry.ts` - 尾巴延迟归属机制
- 已集成到 `AggregatorState.processUtterance()` 中

**代码位置**：
- `dedup.ts` (dedupMergePrecise 函数)
- `tail-carry.ts` (extractTail, removeTail 函数)
- `aggregator-state.ts` (processUtterance 方法)

---

## 测试状态

### 单元测试

⚠️ **待完善**

**状态**：
- 已创建测试文件：`tests/aggregator-test.ts`
- 需要配置测试环境（ts-node 配置问题）

### 集成测试

✅ **已准备**

**状态**：
- 已创建测试指南：`tests/AGGREGATOR_LIVE_TEST.md`
- 已创建测试检查清单：`tests/AGGREGATOR_TEST_CHECKLIST.md`
- 已创建测试脚本：`tests/test-aggregator-middleware.ps1`

### 功能验证

✅ **已确认**

**状态**：
- 日志显示：`"Aggregator middleware initialized"`
- MERGE 功能正常触发
- 功能测试已完成

---

## 配置参数

### 默认参数（已优化）

**线下模式（Offline）**：
- `hard_gap_ms`: 2000
- `soft_gap_ms`: 1200（已优化）
- `strong_merge_ms`: 1000（已优化）
- `commit_interval_ms`: 800（已优化）
- `commit_len_cjk`: 25（已优化）
- `commit_len_en_words`: 10（已优化）
- `score_threshold`: 2.5（已优化）
- `tail_carry_tokens`: 2 (CJK 4 字)

**会议室模式（Room）**：
- `hard_gap_ms`: 1500
- `soft_gap_ms`: 1000
- `strong_merge_ms`: 800（已优化）
- `commit_interval_ms`: 600（已优化）
- `commit_len_cjk`: 20（已优化）
- `commit_len_en_words`: 8（已优化）
- `score_threshold`: 2.5（已优化）
- `tail_carry_tokens`: 2 (CJK 4 字)

---

## 指标监控

✅ **已实现**

**指标类型**：
- `commitCount`: 提交次数
- `mergeCount`: 合并次数
- `newStreamCount`: 新流次数
- `dedupCount`: 去重次数
- `dedupCharsRemoved`: 去重裁剪字符数
- `tailCarryUsage`: Tail carry 使用次数
- `commitLatencyMs`: 首次输出延迟
- `missingGapCount`: gap_ms 缺失次数
- `nmtRetranslationTimeMs`: 重新翻译耗时（新增）

**输出方式**：
- 每次处理输出决策结果
- 每 10 个 utterance 输出完整指标汇总

---

## 已知问题与限制

### P0 限制

1. **只处理 final 结果**：partial results 不参与聚合
2. **简化处理**：merge 操作时，如果是 final，仍然提交当前文本（完整聚合文本在下一个 utterance 时提交）
3. ✅ **重新触发 NMT**：已实现（2025-01-XX）

### 待优化项

1. ✅ **重新触发 NMT**：✅ 已实现并测试通过
2. ✅ **性能优化**：✅ 已完成（从 1077.67ms 降至 378ms，缓存命中率 100%）
3. **部分结果处理**：P1 可以考虑处理 partial results
4. **参数调优**：根据实际效果调整参数
5. ✅ **上下文传递**：✅ 已实现（保留上下文 1 分钟）

---

## 代码位置

### 核心模块
- **中间件**：`electron_node/electron-node/main/src/agent/aggregator-middleware.ts`
- **核心决策**：`electron_node/electron-node/main/src/aggregator/aggregator-decision.ts`
- **会话态管理**：`electron_node/electron-node/main/src/aggregator/aggregator-state.ts`
- **多会话管理**：`electron_node/electron-node/main/src/aggregator/aggregator-manager.ts`
- **Dedup**：`electron_node/electron-node/main/src/aggregator/dedup.ts`
- **Tail Carry**：`electron_node/electron-node/main/src/aggregator/tail-carry.ts`

### 集成点
- **NodeAgent**：`electron_node/electron-node/main/src/agent/node-agent.ts`
- **PipelineOrchestrator**：`electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts`

---

## 相关文档

- `AGGREGATOR_TEXT_INCOMPLETENESS_LANGUAGE_GATE_DESIGN.md` - 完整设计文档
- `AGGREGATOR_P0_KICKOFF_CLEARANCE_NOTE.md` - P0 开工说明
- `AGGREGATOR_ISSUES_AND_OPTIMIZATIONS.md` - 问题分析与优化
- `AGGREGATOR_OPTIMIZATION_AND_REMAINING_WORK.md` - 优化与剩余工作
- `AGGREGATOR_NMT_RETRANSLATION_IMPLEMENTATION.md` - 重新触发 NMT 实现文档
- `AGGREGATOR_NMT_RETRANSLATION_TEST_REPORT.md` - 重新触发 NMT 测试报告
- `AGGREGATOR_NMT_RETRANSLATION_FUNCTIONAL_SPEC.md` - 重新触发 NMT 功能说明

