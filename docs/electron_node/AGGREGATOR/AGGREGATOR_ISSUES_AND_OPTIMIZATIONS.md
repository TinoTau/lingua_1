# Aggregator 问题分析与优化

**状态**：✅ **已完成**  
**最后更新**：2025-01-XX

本文档整合了 Aggregator 实施过程中的问题分析、测试结果和优化方案。

---

## 目录

1. [问题修复](#问题修复)
2. [测试分析](#测试分析)
3. [性能优化](#性能优化)
4. [翻译质量优化](#翻译质量优化)

---

## 问题修复

### 问题 1：isFinal 硬规则导致无法 MERGE ⚠️ **已修复**

**问题描述**：
在 `aggregator-decision.ts` 的 `decideStreamAction` 函数中，`isFinal` 为 `true` 时总是返回 `NEW_STREAM`，导致所有 utterance 都无法 MERGE。

**影响**：
- 所有 utterance 都被强制返回 `NEW_STREAM`
- Aggregator 无法聚合文本
- 每个片段独立翻译，翻译质量下降

**修复方案**：
- 移除了 `isFinal` 的硬规则
- 只对 `isManualCut` 强制 `NEW_STREAM`
- `isFinal` 结果现在可以 MERGE（如果满足其他条件）

**状态**：✅ **已修复**

**详细说明**：参见 `AGGREGATOR_ISSUE_FIX.md`（已合并到此文档）

---

## 测试分析

### 集成测试问题

**测试时间**：2025-01-XX  
**测试场景**：连续说话测试

#### 问题 1：翻译质量问题 ⚠️ **已优化**

**现象**：
- 长语句的准确率挺高
- 但后面越来越不知所云
- 出现完全不合理的词汇

**根本原因**：
1. MERGE 时使用原始文本翻译，缺少上下文
2. 短片段被独立翻译，翻译质量差
3. 文本被过早 commit，导致碎片化

**优化方案**：
- 调整 MERGE 策略参数（提高 `strongMergeMs`，降低 `softGapMs`，降低 `scoreThreshold`）
- 提高 `commitLenCjk` 和 `commitLenEnWords`，减少碎片化

**状态**：✅ **已优化**

#### 问题 2：翻译速度慢 ⚠️ **已优化**

**现象**：
- 需要等10秒才有结果

**根本原因**：
- `commit_interval_ms` 太长（1400ms）
- `commit_len` 阈值太高（30 CJK 字符）

**优化方案**：
- 降低 `commit_interval_ms`：`1400ms → 800ms`
- 降低 `commit_len_cjk`：`30 → 20`（后续调整为 25 以提升质量）

**状态**：✅ **已优化**

**详细说明**：参见 `AGGREGATOR_TEST_ANALYSIS.md`（已合并到此文档）

---

## 性能优化

### 延迟优化

**问题**：翻译速度慢，需要等10秒才有结果

**分析**：
- 单个 job 处理时间：1.6-4.6 秒（Pipeline orchestration）
- `commit_interval_ms` 太长：Offline 模式 1400ms
- `commit_len` 阈值太高：需要累积很多文本才触发

**优化方案**：

**已应用**：
- `commit_interval_ms`: `1400ms → 800ms`（降低 43%）
- `commit_len_cjk`: `30 → 20`（降低 33%）
- `commit_len_en_words`: `12 → 8`（降低 33%）

**预期效果**：
- 首次输出延迟：从 ≥ 1.4 秒降低到 ≥ 0.8 秒
- 累积延迟：显著降低
- 总体延迟：从 10 秒降低到 5-6 秒

**状态**：✅ **已优化**

**详细说明**：参见 `AGGREGATOR_PERFORMANCE_ANALYSIS.md`（已合并到此文档）

---

## 翻译质量优化

### 质量下降问题

**现象**：
- 长语句准确率高
- 后面越来越不知所云
- 出现完全不合理的词汇

**根本原因**：
1. MERGE 时使用原始文本翻译，缺少上下文
2. 短片段被独立翻译，翻译质量差
3. 文本被过早 commit，导致碎片化

**优化方案**：

**已应用**：
- `strongMergeMs`: `700 → 1000`（提高 43%）
- `softGapMs`: `1500 → 1200`（降低 20%）
- `scoreThreshold`: `3 → 2.5`（降低 17%）
- `commitLenCjk`: `20 → 25`（提高 25%）
- `commitLenEnWords`: `8 → 10`（提高 25%）

**预期效果**：
- 更多片段被 MERGE，减少独立翻译
- 文本累积更多后再 commit，减少碎片化
- 翻译质量提升

**状态**：✅ **已优化**

**详细说明**：参见 `AGGREGATOR_TRANSLATION_QUALITY_ANALYSIS.md`（已合并到此文档）

---

## 总结

### 已修复/优化的问题

| 问题 | 状态 | 说明 |
|------|------|------|
| isFinal 硬规则 | ✅ 已修复 | 移除硬规则，允许 MERGE |
| 翻译速度慢 | ✅ 已优化 | 降低 commit_interval_ms 和 commit_len |
| 翻译质量下降 | ✅ 已优化 | 调整 MERGE 策略和 commit 策略 |
| 短片段独立翻译 | ✅ 已优化 | 提高 strongMergeMs，降低 scoreThreshold |

### 待优化项

| 项目 | 状态 | 优先级 |
|------|------|--------|
| 重新触发 NMT | ⚠️ 待实现 | 中 |
| Partial Results 处理 | ⚠️ 待实现 | 低 |
| 单元测试完善 | ⚠️ 待完善 | 中 |

---

## 相关文档

- `AGGREGATOR_IMPLEMENTATION_STATUS.md` - 实现状态
- `AGGREGATOR_NMT_OPTIMIZATION_STATUS.md` - NMT 优化状态
- `AGGREGATOR_REMAINING_WORK.md` - 剩余工作

