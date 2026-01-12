# 内部重复检测修复

## 问题分析

用户指出：**如果原文（ASR文本）已经重复，再要求NMT去识别重复，这个方向根本不对。应该在语义修复之前就进行排重。**

### 问题场景

例如：
- ASR文本：`"再提高了一点速度 再提高了一点速度"`
- 如果让NMT翻译这个重复的文本，NMT会翻译成：`"again a bit greater speed again a bit greater speed"`
- 然后需要`extract_translation`去提取，但这是错误的方向

### 正确的方向

应该在**语义修复之前**就检测并移除文本内部的重复（叠字叠词），这样：
1. 进入语义修复的文本已经是去重后的：`"再提高了一点速度"`
2. 进入NMT的文本也是去重后的：`"再提高了一点速度"`
3. 不需要NMT去识别重复，也不需要`extract_translation`去提取

## 修复方案

### 1. 在PostProcessCoordinator中添加内部重复检测

**位置**：在`AggregationStage`之后、`SemanticRepairStage`之前

**逻辑**：
```typescript
// 修复：在语义修复之前检测并移除文本内部重复（叠字叠词）
let textAfterDedup = aggregationResult.aggregatedText;
if (textAfterDedup && textAfterDedup.trim().length > 0) {
  const originalText = textAfterDedup;
  textAfterDedup = detectInternalRepetition(textAfterDedup);
  if (textAfterDedup !== originalText) {
    logger.warn(...); // 记录去重日志
    aggregationResult.aggregatedText = textAfterDedup; // 更新文本
  }
}
```

### 2. 改进detectInternalRepetition函数

**改进点**：
1. **支持检测末尾重复**（叠字叠词）
   - 例如：`"再提高了一点速度 再提高了一点速度"`
   - 检测末尾是否有重复的词或短语
   - 如果发现重复，只保留前面的部分

2. **改进检测逻辑**：
   - 方法1：检测完全重复（50%重复）
   - 方法2：检测末尾重复（新增）- 从末尾开始，检测是否有重复的短语
   - 方法3：检测部分重复（60%-90%重复）

3. **标准化处理**：
   - 标准化空格（`replace(/\s+/g, ' ')`）
   - 支持检测带空格的重复文本

## 处理流程

### 修复前
```
ASR -> AggregationStage -> SemanticRepairStage -> TranslationStage
                          ↑
                    重复文本进入语义修复和NMT
```

### 修复后
```
ASR -> AggregationStage -> [内部重复检测] -> SemanticRepairStage -> TranslationStage
                          ↑
                    重复文本在这里被去除
```

## 预期效果

1. **Job 13和14的重复问题**：
   - ASR文本：`"再提高了一点速度 再提高了一点速度"`
   - 去重后：`"再提高了一点速度"`
   - 进入语义修复和NMT的文本已经是去重后的

2. **减少NMT负担**：
   - NMT不需要翻译重复的文本
   - 不需要`extract_translation`去提取重复部分

3. **提高翻译质量**：
   - 去重后的文本更清晰，翻译质量更好
   - 避免重复翻译导致的混淆

## 修改文件

1. `postprocess-coordinator.ts` - 在语义修复之前添加内部重复检测
2. `dedup.ts` - 改进`detectInternalRepetition`函数，支持检测末尾重复

## 测试建议

1. 测试重复文本的去重效果：
   - `"再提高了一点速度 再提高了一点速度"` -> `"再提高了一点速度"`
   - `"要大量的语音别丢弃要大量的语音别丢弃"` -> `"要大量的语音别丢弃"`

2. 验证去重后的文本是否正确进入语义修复和NMT

3. 检查日志，确认去重操作被正确记录
