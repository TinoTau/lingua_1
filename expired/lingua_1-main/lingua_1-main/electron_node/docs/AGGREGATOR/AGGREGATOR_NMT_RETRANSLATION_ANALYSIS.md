# Aggregator 重新触发 NMT 功能分析报告

**分析日期**：2025-01-XX  
**基于**：P0 测试结果和代码审查

---

## 执行摘要

根据 P0 测试结果和代码分析，**建议实现重新触发 NMT 功能**，但优先级为**中等**。主要原因是：

1. ✅ **MERGE 操作确实发生**：测试结果显示 MERGE 功能正常工作
2. ⚠️ **翻译不匹配问题存在**：当文本被聚合时，翻译与聚合后的文本不匹配
3. 📊 **影响程度待评估**：需要根据实际使用数据判断问题的严重性

---

## 当前状态

### 问题描述

当 Aggregator 聚合文本时：
- ✅ `text_asr` 被更新为聚合后的文本
- ❌ `text_translated` 仍然是原始翻译（基于原始 `text_asr`）
- ❌ 导致翻译与聚合后的文本不匹配

### 代码位置

**问题代码**：`electron_node/electron-node/main/src/agent/node-agent.ts` (第 829-832 行)

```typescript
finalResult = {
  ...result,
  text_asr: middlewareResult.aggregatedText,
  // 注意：如果文本被聚合，可能需要重新翻译
  // P0 简化：暂时使用原始翻译，后续可以优化为重新触发 NMT
};
```

---

## P0 测试结果分析

### 测试结果

**测试向量**：7/7 通过（100%）
- ✅ t01: 短 gap MERGE - 通过
- ✅ t02: 长 gap NEW_STREAM - 通过
- ✅ t03: 手动截断 NEW_STREAM - 通过
- ✅ t04-t07: 其他场景 - 通过

**基础功能测试**：4/5 通过
- ✅ 基本 merge 决策 - 通过
- ✅ hard gap 触发 new_stream - 通过
- ✅ Dedup 功能 - 通过
- ⚠️ 语言切换 - 需要注意（符合实际逻辑）
- ✅ Flush 功能 - 正常

### MERGE 操作频率

根据测试结果：
- **MERGE 操作确实发生**：测试 1 显示短 gap 触发了 MERGE
- **MERGE 率**：需要实际使用数据统计

---

## 影响分析

### 1. 翻译不匹配的场景

**场景 A：简单拼接**
- 原始：`"我们"` → 翻译：`"we"`
- 聚合后：`"我们今天讨论一下"` → 仍显示：`"we"` ❌
- **影响**：严重，翻译完全错误

**场景 B：去重后拼接**
- 原始：`"我们"` → 翻译：`"we"`
- 聚合后：`"我们可以"`（去重后） → 仍显示：`"we"` ❌
- **影响**：严重，翻译不完整

**场景 C：文本变化不大**
- 原始：`"今天讨论"` → 翻译：`"discuss today"`
- 聚合后：`"今天讨论一下"` → 仍显示：`"discuss today"` ⚠️
- **影响**：中等，翻译基本可用但不够准确

### 2. 问题严重性评估

| 场景 | 频率 | 严重性 | 影响 |
|------|------|--------|------|
| 简单拼接 | 高（MERGE 时） | 高 | 翻译完全错误 |
| 去重后拼接 | 中（Dedup 时） | 高 | 翻译不完整 |
| 文本变化不大 | 低 | 中 | 翻译基本可用 |

**结论**：当 MERGE 或 Dedup 发生时，翻译不匹配问题**严重**。

---

## 实现方案

### 方案 1：在中间件中重新触发 NMT（推荐）

**实现位置**：`aggregator-middleware.ts`

**步骤**：
1. 判断文本是否被聚合（`aggregatedText !== asrTextTrimmed`）
2. 如果被聚合，调用 NMT 服务重新翻译
3. 更新 `text_translated`

**代码示例**：
```typescript
// 在 aggregator-middleware.ts 中
async process(job: JobAssignMessage, result: JobResult): Promise<AggregatorMiddlewareResult> {
  // ... 现有聚合逻辑 ...
  
  let aggregatedText = asrTextTrimmed;
  let translatedText = result.text_translated;
  
  if (aggregatorResult.shouldCommit && aggregatorResult.text) {
    aggregatedText = aggregatorResult.text;
    
    // 如果文本被聚合，重新触发 NMT
    if (aggregatedText !== asrTextTrimmed) {
      try {
        const nmtTask: NMTTask = {
          text: aggregatedText,
          src_lang: job.src_lang,
          tgt_lang: job.tgt_lang,
          context_text: undefined,
          job_id: job.job_id,
        };
        
        // 需要访问 taskRouter（通过依赖注入或传递）
        const nmtResult = await this.taskRouter.routeNMTTask(nmtTask);
        translatedText = nmtResult.text;
        
        logger.debug(
          {
            jobId: job.job_id,
            sessionId: job.session_id,
            originalText: asrTextTrimmed,
            aggregatedText,
            originalTranslation: result.text_translated,
            newTranslation: translatedText,
          },
          'Re-triggered NMT for aggregated text'
        );
      } catch (error) {
        logger.error(
          { error, jobId: job.job_id, sessionId: job.session_id },
          'Failed to re-trigger NMT, using original translation'
        );
        // 降级：使用原始翻译
        translatedText = result.text_translated;
      }
    }
  }
  
  return {
    shouldSend: true,
    aggregatedText,
    translatedText,  // 新增：返回重新翻译的文本
    action: aggregatorResult.action,
    metrics: aggregatorResult.metrics,
  };
}
```

**复杂度**：中等  
**预计工作量**：3-5 天  
**风险**：
- 需要访问 `taskRouter`（依赖注入）
- 增加延迟（NMT 调用时间）
- 错误处理（NMT 失败时的降级策略）

### 方案 2：调整架构（不推荐）

将 Aggregator 移到 PipelineOrchestrator 内部（NMT 之前），先聚合再翻译。

**复杂度**：高  
**预计工作量**：1-2 周  
**风险**：架构变更大，影响面广

---

## 决策建议

### 建议：**实现重新触发 NMT 功能**

**理由**：
1. ✅ **MERGE 操作确实发生**：测试证明 MERGE 功能正常工作
2. ⚠️ **翻译不匹配问题严重**：当文本被聚合时，翻译完全错误
3. 📊 **影响用户体验**：翻译质量直接影响用户体验
4. 🔧 **实现复杂度可控**：方案 1 复杂度中等，风险可控

### 优先级：**中等**

**原因**：
- P0 核心功能（文本聚合）已完成
- 翻译不匹配问题虽然存在，但需要实际使用数据评估影响
- 可以优先收集实际使用数据，再决定是否实现

### 实施建议

**阶段 1：数据收集（1-2 周）**
- 监控 MERGE 操作频率
- 监控翻译不匹配率
- 收集用户反馈

**阶段 2：实现（如果数据支持）**
- 实现方案 1（在中间件中重新触发 NMT）
- 添加错误处理和降级策略
- 性能优化（缓存、批量处理等）

---

## 验收标准

如果实现重新触发 NMT 功能，需要满足：

1. ✅ **功能正确性**
   - 当文本被聚合时，自动重新触发 NMT
   - 翻译与聚合后的文本匹配

2. ✅ **性能**
   - 重新翻译延迟 < 500ms（目标）
   - 不影响整体处理流程

3. ✅ **错误处理**
   - NMT 失败时降级到原始翻译
   - 记录错误日志

4. ✅ **可观测性**
   - 记录重新翻译次数
   - 记录重新翻译延迟
   - 记录翻译不匹配率

---

## 总结

根据 P0 测试结果，**建议实现重新触发 NMT 功能**，但优先级为**中等**。

**建议行动**：
1. **短期**：收集实际使用数据，评估翻译不匹配问题的严重性
2. **中期**：如果数据支持，实现方案 1（在中间件中重新触发 NMT）
3. **长期**：根据实际效果优化（缓存、批量处理等）

**预计工作量**：3-5 天（如果决定实现）

---

## 相关文档

- `AGGREGATOR_OPTIMIZATION_AND_REMAINING_WORK.md` - 优化与剩余工作
- `AGGREGATOR_IMPLEMENTATION_STATUS_AND_ARCHITECTURE.md` - 实现状态与架构
- `AGGREGATOR_P0_KICKOFF_CLEARANCE_NOTE.md` - P0 开工说明

