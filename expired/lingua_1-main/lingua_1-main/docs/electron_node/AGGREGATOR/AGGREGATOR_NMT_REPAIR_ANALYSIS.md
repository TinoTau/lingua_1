# NMT Repair 功能分析与实现方案

**最后更新**：2025-01-XX  
**状态**：📋 待实现

---

## 概述

NMT Repair 是一个可选功能，用于修复 ASR 识别错误（特别是同音字错误），通过生成候选文本并打分择优来提升翻译质量。

---

## 问题场景

### 典型问题

1. **同音字错误**（中文场景常见）
   - ASR 输出：`"这个方案可以"` → 实际可能是 `"这个方案可行"`
   - 导致翻译不准确

2. **低置信度词错误**
   - ASR 输出：`"我觉得还行"` → 实际可能是 `"我觉得还行"`
   - 但某个词置信度低，可能是错误识别

3. **重复/噪声**
   - ASR 输出：`"这边能不能用这边能不能用"`（重复）
   - 虽然 Aggregator 的 Dedup 可以处理，但可能仍有残留

---

## 设计原则

### 核心原则：保守修复，禁止编造

1. **禁止新增实体/数字/专名**
   - 未在原文或 glossary 中出现的实体不得引入
   - 避免"编造"内容

2. **单 span 替换**
   - 一次只修复一个词/短语
   - 避免大规模改写

3. **可回退**
   - 如果修复后质量下降，回退到原文
   - 通过打分机制确保修复质量

---

## 实现方案

### 方案 A：基于 NMT 候选生成（推荐）

**思路**：利用 NMT 模型的 beam search 或采样机制生成多个候选翻译，然后选择最佳候选。

**优点**：
- 利用 NMT 模型的语言理解能力
- 不需要额外的同音词库
- 可以处理多种语言

**缺点**：
- 需要 NMT 服务支持候选生成
- 可能增加延迟
- 需要修改 NMT 服务接口

**实现步骤**：

1. **扩展 NMT 服务接口**
   ```python
   # nmt_service.py
   async def translate_with_candidates(
       req: TranslateRequest,
       num_candidates: int = 5
   ) -> TranslateResponse:
       # 使用 beam search 或采样生成多个候选
       candidates = model.generate_candidates(
           text=req.text,
           context=req.context_text,
           num_candidates=num_candidates
       )
       return TranslateResponse(
           text=candidates[0],  # 最佳候选
           candidates=candidates  # 所有候选
       )
   ```

2. **在 Aggregator 中调用**
   ```typescript
   // aggregator-middleware.ts
   if (shouldRepair(aggregatedText, qualityScore)) {
     const nmtResult = await this.taskRouter.routeNMTTaskWithCandidates(
       nmtTask,
       5  // 生成 5 个候选
     );
     
     // 打分择优
     const bestCandidate = scoreCandidates(
       [aggregatedText, ...nmtResult.candidates],
       glossary
     );
     
     translatedText = bestCandidate;
   }
   ```

---

### 方案 B：基于同音候选生成（中文场景）

**思路**：针对中文同音字错误，生成同音/近音替换候选，然后通过 NMT 翻译打分。

**优点**：
- 针对性强（中文同音字问题）
- 不需要修改 NMT 服务
- 可以精确控制候选生成

**缺点**：
- 需要同音词库（如 `pypinyin`、`jieba`）
- 主要适用于中文
- 需要额外的候选生成逻辑

**实现步骤**：

1. **同音候选生成器**
   ```typescript
   // homophone-candidate-generator.ts
   export class HomophoneCandidateGenerator {
     generateCandidates(text: string, lowConfidenceSpans: Span[]): string[] {
       const candidates: string[] = [text];  // 包含原文
       
       for (const span of lowConfidenceSpans) {
         const homophones = this.getHomophones(span.text);
         for (const homophone of homophones) {
           const candidate = this.replaceSpan(text, span, homophone);
           candidates.push(candidate);
         }
       }
       
       return candidates.slice(0, 10);  // 最多 10 个候选
     }
   }
   ```

2. **在 Aggregator 中调用**
   ```typescript
   // aggregator-middleware.ts
   if (shouldRepair(aggregatedText, qualityScore)) {
     // 生成同音候选
     const candidates = this.homophoneGenerator.generateCandidates(
       aggregatedText,
       lowConfidenceSpans
     );
     
     // 对每个候选进行 NMT 翻译并打分
     const scoredCandidates = await Promise.all(
       candidates.map(async (candidate) => {
         const nmtResult = await this.taskRouter.routeNMTTask({
           text: candidate,
           src_lang: job.src_lang,
           tgt_lang: job.tgt_lang,
           context_text: contextText,
         });
         
         const score = this.scoreCandidate(
           candidate,
           nmtResult.text,
           glossary
         );
         
         return { candidate, translation: nmtResult.text, score };
       })
     );
     
     // 选择最佳候选
     const best = scoredCandidates.reduce((a, b) => 
       a.score > b.score ? a : b
     );
     
     translatedText = best.translation;
   }
   ```

---

### 方案 C：混合方案（推荐用于生产）

**思路**：结合方案 A 和方案 B，根据场景选择最合适的方案。

**策略**：
- **中文场景**：优先使用同音候选生成（方案 B）
- **其他语言**：使用 NMT 候选生成（方案 A）
- **低置信度场景**：两种方案都使用，综合打分

---

## 打分机制

### 打分维度

1. **规则分**（权重：40%）
   - Glossary/专名保护：命中 glossary 的候选加分
   - 数字保护：数字不匹配的候选减分
   - 重复惩罚：与上一条高度重复的候选减分
   - 长度惩罚：过短或过长的候选减分

2. **NMT 分**（权重：40%）
   - 翻译自然度：翻译是否流畅
   - 翻译一致性：与上下文是否一致
   - 翻译置信度：NMT 模型的置信度

3. **语言模型分**（权重：20%）
   - 文本自然度：原文是否自然
   - 语法正确性：语法是否正确

### 打分函数

```typescript
function scoreCandidate(
  candidate: string,
  translation: string,
  glossary: string[],
  previousText?: string
): number {
  let score = 0;
  
  // 规则分（40%）
  const ruleScore = 
    (glossaryMatchScore(candidate, glossary) * 0.3) +
    (numberProtectionScore(candidate) * 0.2) +
    (repetitionPenalty(candidate, previousText) * 0.2) +
    (lengthScore(candidate) * 0.3);
  
  // NMT 分（40%）
  const nmtScore = 
    (translationNaturalness(translation) * 0.4) +
    (translationConsistency(translation, previousText) * 0.3) +
    (translationConfidence(translation) * 0.3);
  
  // 语言模型分（20%）
  const lmScore = 
    (textNaturalness(candidate) * 0.6) +
    (grammarScore(candidate) * 0.4);
  
  score = (ruleScore * 0.4) + (nmtScore * 0.4) + (lmScore * 0.2);
  
  return score;
}
```

---

## 触发条件

### 建议触发条件

1. **质量分数低**
   - `qualityScore < repair_threshold`（如 0.7）

2. **命中高风险词表**
   - 文本中包含常见的同音歧义词
   - 如：`"可以"` vs `"可行"`、`"方案"` vs `"方法"`

3. **明显重复或噪声**
   - Dedup 裁剪量高（`dedupCharsRemoved > threshold`）
   - 短尾噪声频繁

4. **低置信度词**
   - 包含低置信度词（如果有 word-level confidence）

### 触发逻辑

```typescript
function shouldRepair(
  text: string,
  qualityScore: number | undefined,
  dedupCharsRemoved: number,
  lowConfidenceSpans: Span[]
): boolean {
  // 质量分数低
  if (qualityScore !== undefined && qualityScore < 0.7) {
    return true;
  }
  
  // 明显重复
  if (dedupCharsRemoved > 10) {
    return true;
  }
  
  // 低置信度词
  if (lowConfidenceSpans.length > 0) {
    return true;
  }
  
  // 命中高风险词表
  if (containsHighRiskWords(text)) {
    return true;
  }
  
  return false;
}
```

---

## 技术挑战

### 挑战 1：延迟增加

**问题**：生成多个候选并打分会增加延迟

**解决方案**：
- 限制候选数量（最多 5-10 个）
- 并行处理候选（Promise.all）
- 使用缓存（相同文本不重复处理）
- 异步处理（先返回原文，后台修复）

### 挑战 2：NMT 服务支持

**问题**：需要 NMT 服务支持候选生成

**解决方案**：
- 方案 A：修改 NMT 服务，添加候选生成接口
- 方案 B：不需要修改 NMT 服务，在节点端生成候选

### 挑战 3：同音词库

**问题**：中文同音词库需要维护

**解决方案**：
- 使用现有库（如 `pypinyin`、`jieba`）
- 维护常见同音词表
- 根据实际使用情况动态更新

### 挑战 4：打分准确性

**问题**：打分机制可能不准确，导致修复失败

**解决方案**：
- 保守阈值：只有明显更好的候选才使用
- 可回退：修复后质量下降时回退到原文
- A/B 测试：通过实际使用数据优化打分权重

---

## 实现优先级

### 推荐实现顺序

1. **方案 B：同音候选生成**（中文场景，2-3 周）
   - 不需要修改 NMT 服务
   - 针对性强
   - 可以快速验证效果

2. **方案 A：NMT 候选生成**（通用场景，1-2 周）
   - 需要修改 NMT 服务
   - 适用于所有语言
   - 效果可能更好

3. **方案 C：混合方案**（生产环境，1 周）
   - 结合两种方案
   - 根据场景选择
   - 效果最佳

---

## 工作量估算

### 方案 B：同音候选生成

| 任务 | 工作量 | 优先级 |
|------|--------|--------|
| 同音候选生成器 | 1-2 周 | 🔴 高 |
| 打分机制 | 0.5-1 周 | 🔴 高 |
| Glossary 保护 | 0.5 周 | 🟡 中 |
| 测试与优化 | 0.5-1 周 | 🟡 中 |

**总计**：2-3 周

### 方案 A：NMT 候选生成

| 任务 | 工作量 | 优先级 |
|------|--------|--------|
| NMT 服务候选生成接口 | 1 周 | 🔴 高 |
| 节点端调用逻辑 | 0.5 周 | 🔴 高 |
| 打分机制 | 0.5-1 周 | 🔴 高 |
| 测试与优化 | 0.5-1 周 | 🟡 中 |

**总计**：2-3 周

---

## 是否需要实现？

### 判断标准

1. **如果 P0 效果良好**：
   - Dedup + Tail Carry + 重新翻译已能解决大部分问题
   - 同音字错误率 < 5%
   - → **可能不需要实现**

2. **如果仍有明显问题**：
   - 同音字错误率 > 10%
   - 用户反馈翻译不准确
   - → **建议实现**

### 建议

**先观察 P0 效果**：
- 使用当前实现（Aggregator + 重新翻译）一段时间
- 收集用户反馈和错误案例
- 如果同音字错误仍然是主要问题，再考虑实现 NMT Repair

**如果决定实现**：
- 优先实现方案 B（同音候选生成）
- 针对中文场景，效果明显
- 工作量相对较小

---

## 相关文档

- `AGGREGATOR_TEXT_INCOMPLETENESS_LANGUAGE_GATE_DESIGN.md` - 完整设计文档
- `AGGREGATOR_OPTIMIZATION_AND_REMAINING_WORK.md` - 优化与剩余工作
- `ASR_REFACTOR_PLAN_WITH_CONFIDENCE_VALIDATION_AND_TASKS.md` - ASR 重构计划

