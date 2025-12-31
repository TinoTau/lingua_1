# S1/S2 问题分析与优化方案

## 问题描述

### 用户反馈
1. **识别不准确**：存在同音字替换问题（如"短句"识别为"短剧"）
2. **速度慢**：返回速度特别慢

### 测试案例
- ASR识别："那这次主要目的呢是测试这个短剧"（应为"短句"）
- ASR识别："作詞編曲編"（识别错误）
- ASR识别："現在有反回了"（应为"返回了"）

---

## 问题分析

### 1. S2 Rescoring当前无法改善识别

**根本原因**：
- `CandidateProvider` 当前只返回 `primary` 候选，没有生成真正的候选（N-best或二次解码）
- Rescoring只能对同一个文本打分，无法替换为更好的候选
- 因此rescoring实际上没有意义，只是增加了延迟

**代码位置**：
```typescript
// candidate-provider.ts
async provide(ctx: CandidateProviderContext): Promise<CandidateProviderResult> {
  const candidates: Candidate[] = [];
  // 只添加primary作为候选
  candidates.push({
    text: ctx.primaryText,
    source: 'primary',
  });
  // TODO: N-best和二次解码未实现
  return { candidates, source: 'none' };
}
```

### 2. 性能问题

**可能原因**：
1. Rescoring逻辑虽然被触发，但只处理primary候选，仍然有计算开销
2. 每次commit都会检查是否需要rescoring，即使没有真正的候选
3. 日志记录可能增加开销

### 3. S1 Prompt未实现

**当前状态**：
- `PromptBuilder` 已实现，但未在ASR调用时使用
- 需要在 `TaskRouter.routeASRTask` 中构建prompt并传递给ASR服务
- 这是改善识别准确率的关键功能

---

## 优化方案

### 方案1：暂时禁用S2 Rescoring（已实施）

**原因**：
- 当前没有真正的候选，rescoring无法改善结果
- 避免不必要的性能开销

**实施**：
- 在 `AggregatorMiddleware` 中，检测到需要rescoring时，直接跳过
- 记录日志说明原因
- 保留代码结构，待实现N-best或二次解码后启用

### 方案2：实现S1 Prompt（优先）

**重要性**：
- S1 Prompt是改善识别准确率的关键
- 通过上下文偏置，可以帮助ASR识别正确的词汇
- 不需要额外的ASR调用，性能开销小

**实施步骤**：
1. 在 `TaskRouter.routeASRTask` 中，从 `AggregatorManager` 获取上下文
2. 使用 `PromptBuilder` 构建prompt
3. 通过 `context_text` 参数传递给ASR服务

### 方案3：优化触发条件

**优化点**：
- 在没有qualityScore且文本较长时，跳过rescoring检查
- 减少不必要的计算

**已实施**：
- 在 `NeedRescoreDetector.shouldSkip` 中添加了优化逻辑

---

## 下一步行动

### 立即执行（P0）
1. ✅ **暂时禁用S2 Rescoring** - 已完成
2. ⏳ **实现S1 Prompt** - 需要实现
   - 在TaskRouter中获取AggregatorState上下文
   - 构建prompt并传递给ASR服务

### 后续优化（P1）
1. **实现N-best支持**
   - 验证fast-whisper是否支持alternatives
   - 如果支持，实现N-best候选生成
   - 重新启用S2 Rescoring

2. **实现二次解码**
   - 实现音频ring buffer
   - 实现二次解码worker
   - 仅在必要时触发（短句+低质量+高风险）

3. **性能优化**
   - 减少日志记录频率
   - 优化rescoring计算逻辑
   - 添加性能监控

---

## 预期效果

### S1 Prompt实施后
- **识别准确率提升**：通过上下文偏置，减少同音字替换错误
- **性能影响小**：只是增加prompt参数，不增加ASR调用
- **适用场景**：所有utterance都会受益

### S2 Rescoring（待实现N-best后）
- **进一步改善准确率**：通过候选比较，选择最佳结果
- **性能开销可控**：仅在短句/低质量时触发
- **适用场景**：短句、低质量、高风险特征

---

## 测试建议

### S1 Prompt测试
1. 发送包含专名的短句
2. 检查是否减少了同音字错误
3. 监控性能影响

### 性能测试
1. 测量禁用rescoring后的延迟改善
2. 监控CPU/GPU使用率
3. 检查日志输出频率

---

## 总结

**当前问题**：
- S2 Rescoring无法改善结果（没有真正的候选）
- S1 Prompt未实现（关键功能缺失）
- 性能开销（不必要的rescoring检查）

**解决方案**：
- ✅ 暂时禁用S2 Rescoring
- ⏳ 优先实现S1 Prompt
- ⏳ 后续实现N-best后重新启用S2

**预期改善**：
- S1 Prompt实施后，识别准确率应该明显提升
- 禁用不必要的rescoring后，性能应该改善

