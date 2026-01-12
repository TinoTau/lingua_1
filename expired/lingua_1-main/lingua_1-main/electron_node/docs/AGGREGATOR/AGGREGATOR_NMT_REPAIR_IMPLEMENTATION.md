# NMT Repair 功能实现文档

**日期**：2025-01-XX  
**状态**：✅ 已实现  
**方案**：方案 A（基于 NMT 候选生成）

---

## 概述

NMT Repair 功能已实现，用于修复 ASR 识别错误（特别是同音字错误），通过生成多个候选翻译并打分择优来提升翻译质量。

---

## 实现方案

### 方案 A：基于 NMT 候选生成（已实现）

**思路**：利用 NMT 模型的 beam search 机制生成多个候选翻译，然后选择最佳候选。

**优点**：
- ✅ 利用 NMT 模型的语言理解能力
- ✅ 不需要额外的同音词库
- ✅ 可以处理多种语言
- ✅ 不需要手动维护词库

---

## 实现细节

### 1. NMT 服务扩展

**文件**：`electron_node/services/nmt_m2m100/nmt_service.py`

**修改**：
- 扩展 `TranslateRequest`，添加 `num_candidates` 参数
- 扩展 `TranslateResponse`，添加 `candidates` 字段
- 修改 `model.generate()` 调用，支持 `num_return_sequences` 参数
- 解码多个候选翻译并返回

**关键代码**：
```python
# 如果请求候选生成，增加 num_beams 并返回多个候选
num_candidates = req.num_candidates or 1
num_beams = max(4, num_candidates)  # 至少使用 4 个 beam

gen = model.generate(
    **encoded,
    forced_bos_token_id=forced_bos,
    num_beams=num_beams,
    num_return_sequences=min(num_candidates, num_beams),  # 返回的候选数量
    # ... 其他参数
)
```

---

### 2. TaskRouter 扩展

**文件**：`electron_node/electron-node/main/src/task-router/types.ts`  
**文件**：`electron_node/electron-node/main/src/task-router/task-router.ts`

**修改**：
- 扩展 `NMTTask` 接口，添加 `num_candidates` 字段
- 扩展 `NMTResult` 接口，添加 `candidates` 字段
- 在 `routeNMTTask` 中传递 `num_candidates` 参数
- 返回候选列表

---

### 3. 候选打分机制

**文件**：`electron_node/electron-node/main/src/aggregator/candidate-scorer.ts`

**功能**：
- `scoreCandidates()`: 对候选翻译进行打分
- `selectBestCandidate()`: 选择最佳候选（考虑最小分数提升阈值）

**打分维度**：
1. **规则分**（40%）
   - 数字保护：数字不匹配的候选减分
   - 长度惩罚：过短或过长的候选减分
   - 重复惩罚：与上一条高度重复的候选减分
   - 文本相似度：与原文的相似度

2. **NMT 分**（40%）
   - 翻译自然度：翻译是否流畅
   - 翻译一致性：与上下文是否一致
   - 翻译置信度：基于长度的启发式

3. **语言模型分**（20%）
   - 文本自然度：原文是否自然
   - 语法正确性：语法是否正确

---

### 4. AggregatorMiddleware 集成

**文件**：`electron_node/electron-node/main/src/agent/aggregator-middleware.ts`

**修改**：
- 扩展 `AggregatorMiddlewareConfig`，添加 NMT Repair 配置选项
- 在重新翻译逻辑中集成 NMT Repair
- 实现 `shouldRepair()` 方法判断是否触发修复

**触发条件**：
1. **质量分数低**：`qualityScore < nmtRepairThreshold`（默认 0.7）
2. **明显重复**：`dedupCharsRemoved > 10`

**工作流程**：
1. 检查是否应该触发 NMT Repair
2. 如果应该，调用 NMT 服务获取多个候选翻译
3. 对候选进行打分
4. 选择最佳候选（考虑最小分数提升阈值）
5. 如果最佳候选明显更好，使用它；否则使用原始翻译

---

### 5. NodeAgent 配置

**文件**：`electron_node/electron-node/main/src/agent/node-agent.ts`

**配置**：
```typescript
const aggregatorConfig: AggregatorMiddlewareConfig = {
  enabled: true,
  mode: 'offline',
  translationCacheSize: 100,
  translationCacheTtlMs: 5 * 60 * 1000,
  nmtRepairEnabled: true,  // 启用 NMT Repair
  nmtRepairNumCandidates: 5,  // 生成 5 个候选
  nmtRepairThreshold: 0.7,  // 质量分数 < 0.7 时触发
};
```

---

## 配置选项

### AggregatorMiddlewareConfig

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `nmtRepairEnabled` | `boolean` | `false` | 是否启用 NMT Repair |
| `nmtRepairNumCandidates` | `number` | `5` | 生成候选数量 |
| `nmtRepairThreshold` | `number` | `0.7` | 触发阈值（质量分数） |

---

## 使用示例

### 启用 NMT Repair

在 `NodeAgent` 构造函数中配置：

```typescript
const aggregatorConfig: AggregatorMiddlewareConfig = {
  enabled: true,
  mode: 'offline',
  nmtRepairEnabled: true,  // 启用
  nmtRepairNumCandidates: 5,  // 生成 5 个候选
  nmtRepairThreshold: 0.7,  // 质量分数 < 0.7 时触发
};
```

### 禁用 NMT Repair

```typescript
const aggregatorConfig: AggregatorMiddlewareConfig = {
  enabled: true,
  mode: 'offline',
  nmtRepairEnabled: false,  // 禁用
};
```

---

## 性能影响

### 延迟增加

- **正常情况**：1 次 NMT 调用
- **NMT Repair 触发**：1 次 NMT 调用（但生成多个候选）
- **延迟增加**：约 10-20%（取决于候选数量）

### 优化措施

1. **限制候选数量**：默认 5 个候选
2. **触发条件**：只在质量分数低或明显重复时触发
3. **最小分数提升阈值**：只有明显更好的候选才使用

---

## 测试建议

### 测试场景

1. **正常情况**：
   - 质量分数 > 0.7
   - 确认不触发 NMT Repair
   - 确认使用原始翻译

2. **质量分数低**：
   - 质量分数 < 0.7
   - 确认触发 NMT Repair
   - 确认生成多个候选
   - 确认选择最佳候选

3. **明显重复**：
   - Dedup 裁剪量 > 10
   - 确认触发 NMT Repair
   - 确认选择最佳候选

4. **候选打分**：
   - 确认候选打分正确
   - 确认选择最佳候选
   - 确认最小分数提升阈值生效

---

## 日志

### NMT Repair 触发日志

```
{
  "level": 30,
  "jobId": "job-xxx",
  "sessionId": "s-xxx",
  "originalTranslation": "...",
  "bestTranslation": "...",
  "bestScore": 0.85,
  "numCandidates": 5,
  "msg": "NMT Repair: Selected best candidate"
}
```

### NMT Repair 未触发日志

```
{
  "level": 20,
  "jobId": "job-xxx",
  "sessionId": "s-xxx",
  "reason": "No significant improvement",
  "msg": "NMT Repair: Using original translation (no significant improvement)"
}
```

---

## 相关文档

- `AGGREGATOR_NMT_REPAIR_ANALYSIS.md` - NMT Repair 分析文档
- `AGGREGATOR_OPTIMIZATION_AND_REMAINING_WORK.md` - 优化与剩余工作

---

## 同音字自动学习功能（新增）

### 功能概述

**日期**：2025-01-XX  
**状态**：✅ 已实现

系统会自动从 NMT Repair 的结果中学习同音字错误模式，无需手动维护同音字库。

### 实现细节

**文件**：
- `electron_node/electron-node/main/src/aggregator/homophone-detector.ts` - 同音字检测器
- `electron_node/electron-node/main/src/aggregator/homophone-learner.ts` - 同音字自动学习器

**工作流程**：
1. 检测到可能的同音字错误时，生成修复候选（包括原文和修复后的原文）
2. 对每个候选进行 NMT 翻译并打分
3. 如果修复后的候选明显更好（分数提升 > 0.1），自动学习并保存
4. 学习到的模式会持久化到 `data/learned-homophone-patterns.json`

**学习条件**：
- 分数提升 > 0.1
- 至少出现 2 次
- 置信度 ≥ 0.7

**数据存储**：
```json
{
  "patterns": {
    "童英字->同音字": {
      "error": "童英字",
      "correct": "同音字",
      "confidence": 0.85,
      "count": 3,
      "lastUpdated": 1234567890
    }
  },
  "version": 1
}
```

### 优势

- ✅ **无需手动维护**：系统自动学习常见错误
- ✅ **渐进式改进**：使用越多，学习越多
- ✅ **保守策略**：只有高置信度且多次出现的模式才会被使用
- ✅ **可手动覆盖**：手动添加的模式优先级更高

---

## 后续优化

1. **打分机制优化**：
   - 根据实际使用数据优化打分权重
   - 添加更多打分维度

2. **触发条件优化**：
   - 根据实际使用数据调整触发阈值
   - 添加更多触发条件

3. **性能优化**：
   - 并行处理候选（如果 NMT 服务支持）
   - 使用缓存减少重复计算

4. **同音字学习优化**：
   - 改进差异检测算法（当前简化实现）
   - 支持多词替换
   - 添加学习模式验证机制

