# Utterance 聚合文档

## 文档概述

本目录包含 utterance 聚合相关的核心文档，涵盖从 ASR 返回结果到发送给语义修复服务的完整流程。

**最后更新**: 2026年1月26日

---

## 📖 核心文档

### 1. 调用链分析报告（决策文档）

**`UTTERANCE_AGGREGATION_FLOW_ANALYSIS_FOR_DECISION.md`** ⭐ **推荐阅读**

详细分析从 ASR 返回结果到发送给语义修复服务的完整调用链，识别重复调用和潜在开销问题。

**核心内容**:
- 完整调用链（逐方法级别）
- 关键方法调用统计
- 重复调用分析和优化效果
- 性能开销分析
- 决策建议

**关键发现**:
- ✅ `dedupMergePrecise()` 调用从 3-5次 优化为 1-3次（减少 2次）
- ✅ `getLastCommittedText()` 调用从 2-3次 优化为 1次（减少 1-2次）
- ✅ 总体优化效果：减少 3-4 次重复调用

---

### 2. v3 补充动作说明

**`UTTERANCE_AGGREGATION_V3_SUPPLEMENT_ACTIONS.md`**

v3 最简统一架构完成后的最终补充动作，用于锁定已验证的正确行为，防止后续迭代回退。

**核心内容**:
- 最小行为级自动化测试（3条用例）
- 架构不变量（Invariant）声明（2条）

---

## 🏗️ 架构概览

### v3 改造核心原则

1. **唯一 Gate 决策点**: `decideGateAction()` 统一处理 SEND/HOLD/DROP
2. **Trim 单次调用**: `mergeByTrim()` 统一调用 `dedupMergePrecise()`
3. **Drop 职责纯粹**: `DeduplicationHandler` 只做 Drop 判定
4. **TextProcessor 不隐式丢弃**: 保留原文，让 Gate 统一处理
5. **previousText 口径固定**: Trim 用 `lastCommittedText`，Drop 用 `lastSentText`

### 核心流程

```
ASR 结果
  └─> runAggregationStep()
      ├─> getLastCommittedText()  【1次，缓存到 ctx】
      └─> AggregationStage.process()
          ├─> AggregatorState.processUtterance()
          │   └─> TextProcessor.processText()  【组内尾部整形，0-2次 dedupMergePrecise】
          ├─> DeduplicationHandler.isDuplicate()  【Drop 判定，1次 getLastSentText】
          └─> TextForwardMergeManager.processText()
              └─> mergeByTrim()  【Trim，1次 dedupMergePrecise】
                  └─> decideGateAction()  【Gate 决策：SEND/HOLD/DROP】
  └─> runSemanticRepairStep()
      ├─> 使用 ctx.lastCommittedText  【使用缓存的上下文】
      └─> SemanticRepairStage.process()
          └─> TaskRouter.routeSemanticRepairTask()
              └─> POST /repair  【语义修复服务 API】
```

---

## 📊 性能优化效果

### 方法调用优化

| 方法 | 优化前 | 优化后 | 改进 |
|------|--------|--------|------|
| `dedupMergePrecise()` (forward-merge) | 3次 | 1次 | ✅ 减少 2次 |
| `dedupMergePrecise()` (TextProcessor) | 0-2次 | 0-2次 | ✅ 必要调用（组内整形） |
| `getLastCommittedText()` | 2-3次 | 1次 | ✅ 减少 1-2次 |
| `getLastSentText()` | 2次 | 2次 | ⚠️ 职责不同（Drop 判定和日志） |

**总体优化**: 减少 3-4 次重复调用

---

## 🔑 关键组件

### 核心文件

| 文件 | 职责 | 关键方法 |
|------|------|---------|
| `pipeline/job-pipeline.ts` | Pipeline 编排 | `runJobPipeline()` |
| `pipeline/steps/aggregation-step.ts` | 聚合步骤 | `runAggregationStep()` |
| `agent/postprocess/aggregation-stage.ts` | 聚合阶段 | `process()` |
| `aggregator/aggregator-state.ts` | 聚合状态 | `processUtterance()` |
| `aggregator/aggregator-state-text-processor.ts` | 文本处理 | `processText()` |
| `agent/postprocess/text-forward-merge-manager.ts` | 向前合并 | `processText()`, `mergeByTrim()` |
| `agent/aggregator-middleware-deduplication.ts` | 去重处理 | `isDuplicate()`, `getLastSentText()` |
| `pipeline/steps/semantic-repair-step.ts` | 语义修复步骤 | `runSemanticRepairStep()` |

### 关键方法

```typescript
// dedupMergePrecise - 去重合并
function dedupMergePrecise(
  base: string,
  incoming: string,
  config?: DedupConfig
): DedupResult

// getLastCommittedText - 获取已提交文本（用于 Trim）
function getLastCommittedText(
  sessionId: string,
  utteranceIndex: number
): string | null

// getLastSentText - 获取已发送文本（用于 Drop）
function getLastSentText(sessionId: string): string | undefined
```

---

## 🎯 职责分离

### TextProcessor vs forward-merge

| 组件 | 职责 | 调用 dedupMergePrecise 次数 |
|------|------|---------------------------|
| **TextProcessor** | 组内尾部整形（hangover） | 0-2次（必要） |
| **forward-merge** | 跨 committed 的 Trim | 1次（已优化） |

**职责分离清晰**: TextProcessor 做组内整形，forward-merge 做跨 committed 的 Trim

### lastCommittedText vs lastSentText

| 数据 | 用途 | 更新时机 |
|------|------|---------|
| **lastCommittedText** | Trim（边界重叠裁剪） | commit 时更新 |
| **lastSentText** | Drop（完全重复/子串重复/高相似度） | send 成功时更新 |

---

## ✅ 架构不变量（Invariant）

### Invariant 1: Gate 输出语义不变量

**位置**: `TextForwardMergeManager` 类注释和 `decideGateAction()` 方法注释

```
/// Invariant 1: Gate 输出语义不变量
/// processText / decideGateAction 永远返回完整 mergedText。
/// 禁止返回裁剪片段（如 dedupResult.text）。
/// 所有 SEND/HOLD/DROP 决策必须基于完整 mergedText。
```

### Invariant 2: TextProcessor 责任边界不变量

**位置**: `AggregatorStateTextProcessor` 类注释和 `processText()` 方法注释

```
/// Invariant 2: TextProcessor 责任边界不变量
/// AggregatorStateTextProcessor 只负责 MERGE 组内的尾部整形（hangover）。
/// 禁止在此处决定 SEND / HOLD / DROP。
/// 禁止通过空字符串或特殊值隐式触发丢弃。
```

---

## 📈 Gate 决策逻辑

### 决策规则

| 文本长度 | 处理动作 | shouldDiscard | shouldWaitForMerge | shouldSendToSemanticRepair |
|---------|---------|--------------|-------------------|--------------------------|
| **< 6字符** | 丢弃 | `true` | `false` | `false` |
| **6-20字符** | 等待合并 | `false` | `true`（除非手动发送） | `false` |
| **20-40字符** | 等待确认 | `false` | `true`（除非手动发送） | `false` |
| **> 40字符** | 直接发送 | `false` | `false` | `true` |

### 关键机制

- **pendingTexts**: 存储待合并的文本（Map结构）
- **超时机制**: 3秒超时，如果没有后续输入则发送
- **手动发送**: 强制立即处理，不等待合并
- **去重合并**: 使用 `dedupMergePrecise` 去重后合并

---

## 🔍 重复调用分析

### 已优化的重复调用 ✅

1. **getLastCommittedText() 重复调用**:
   - 优化前: 2-3次
   - 优化后: 1次（缓存到 ctx.lastCommittedText）
   - 优化效果: 减少 1-2 次重复调用

2. **dedupMergePrecise() 在 forward-merge 中的重复调用**:
   - 优化前: 3次（pending 超时、pending 未超时、previousText）
   - 优化后: 1次（统一调用 `mergeByTrim()`）
   - 优化效果: 减少 2 次重复调用

### 仍存在的调用（非重复，职责分离）

1. **dedupMergePrecise() 在 TextProcessor 中的调用**:
   - 调用次数: 0-2次
   - 职责: 组内尾部整形（hangover）
   - 状态: ✅ 必要调用，职责分离清晰

2. **getLastSentText() 调用**:
   - 调用次数: 2次
   - 职责: Drop 判定（1次）+ 日志输出（1次）
   - 状态: ⚠️ 可以优化，但优先级低

---

## 🚀 当前状态

### ✅ v3 改造已完成

- 重复调用已显著减少（减少 3-4 次）
- 职责分离清晰，无逻辑冲突
- 代码质量良好，无未使用代码
- 架构不变量已声明，防止回退

### ✅ 无需进一步优化

以下调用虽然存在，但都是必要的，无需优化：

1. **TextProcessor 的 dedupMergePrecise 调用（0-2次）**: 组内尾部整形，必要调用
2. **getLastSentText() 调用（2次）**: 职责不同（Drop 判定和日志输出），无重复

---

## 📝 建议的监控指标

### 性能监控

- `dedupMergePrecise()` 的调用次数（应该显著减少）
- `getLastCommittedText()` 的调用次数（应该减少）
- Gate 决策的延迟（应该保持或改善）

### 数据一致性监控

- commit 和 send 的时间差
- `lastCommittedText` 和 `lastSentText` 的一致性

---

## 📦 归档文档

历史文档和已解决问题的文档已归档到 `archived/` 目录，包括：

- shouldCommit 移除相关文档
- 部分内容过期的流程文档
- 测试分析文档

详细说明请查看：`archived/ARCHIVE_NOTES.md`

---

## 🔗 快速导航

- **了解完整调用链**: 阅读 `UTTERANCE_AGGREGATION_FLOW_ANALYSIS_FOR_DECISION.md`
- **了解补充动作**: 阅读 `UTTERANCE_AGGREGATION_V3_SUPPLEMENT_ACTIONS.md`
- **了解历史问题**: 阅读 `archived/` 目录下的文档

---

**文档结束**
