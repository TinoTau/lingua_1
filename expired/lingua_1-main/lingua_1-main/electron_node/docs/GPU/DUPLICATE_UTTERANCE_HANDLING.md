# 重复Utterance处理机制

## 问题场景

**场景**：第一个utterance是完整的，第二个utterance是上一句的后半句

**示例**：
- 第一个utterance: `"我们 我们可以继续"`（完整句子）
- 第二个utterance: `"继续"`（是上一句的后半句，完全重复）

## 当前处理逻辑

### 1. dedupMergePrecise的处理

当第二个utterance完全被第一个utterance的尾部包含时：

```typescript
// 在 aggregator-state-text-processor.ts 中
const lastTail = extractTail(lastText, this.tailCarryConfig) || lastText.slice(-20);
// 例如：lastTail = "继续"（从"我们 我们可以继续"提取尾部）

const dedupResult = dedupMergePrecise(lastTail, text, this.dedupConfig);
// lastTail = "继续", text = "继续"
// 检测到完全重叠，去重后：dedupedText = ""（空字符串）
```

### 2. 当前的处理逻辑

```typescript
if (dedupResult.deduped && !processedText.trim() && text.length <= 10) {
  // 如果去重后文本为空，且原始文本较短（<=10字符），保留原始文本
  processedText = text; // 保留原始文本
  deduped = false;
}
```

**问题**：如果第二个utterance完全被第一个utterance包含，应该被丢弃，而不是保留。

## 改进方案

### 方案1：检测完全包含的情况

如果当前utterance完全被上一个utterance的尾部包含，应该：
1. **标记为完全重复**
2. **返回空文本**（表示这个utterance应该被丢弃）
3. **记录日志**，便于调试

### 方案2：改进dedupMergePrecise

在`dedupMergePrecise`中检测完全包含的情况：
- 如果`currHead`完全等于`prevTail`的某个后缀
- 或者`currHead`完全被`prevTail`包含
- 返回空文本，并标记为完全重复

## 实现建议

### 改进dedupMergePrecise

添加完全包含检测：

```typescript
// 检测：如果currHead完全被prevTail包含
const prevNorm = normalize(prevTail);
const currNorm = normalize(currHead);

// 如果currHead完全等于prevTail的某个后缀
if (prevNorm.endsWith(currNorm) && currNorm.length >= config.minOverlap) {
  // 完全重复，返回空文本
  return {
    text: '',
    deduped: true,
    overlapChars: currNorm.length,
    isCompletelyContained: true  // 新增标志
  };
}
```

### 改进AggregatorStateTextProcessor

处理完全包含的情况：

```typescript
if (dedupResult.deduped && !processedText.trim()) {
  // 检查是否是完全包含（而不是误判）
  if (dedupResult.isCompletelyContained) {
    // 完全重复，丢弃这个utterance
    logger.info({
      originalText: text,
      lastTail: lastTail,
      note: 'Current utterance is completely contained in previous utterance, discarding'
    });
    processedText = ''; // 返回空文本，表示丢弃
  } else if (text.length <= 10) {
    // 可能是误判，保留原始文本
    processedText = text;
    deduped = false;
  }
}
```

## 处理流程

### 场景1：第二个utterance完全被第一个utterance包含

```
第一个utterance: "我们 我们可以继续"
第二个utterance: "继续"

处理：
1. extractTail("我们 我们可以继续") -> "继续"（或最后6个字符）
2. dedupMergePrecise("继续", "继续") -> 检测到完全重叠
3. 返回：{ text: "", deduped: true, isCompletelyContained: true }
4. 第二个utterance被丢弃（返回空文本）
```

### 场景2：第二个utterance部分重叠

```
第一个utterance: "我们 我们可以"
第二个utterance: "可以继续"

处理：
1. extractTail("我们 我们可以") -> "可以"（或最后6个字符）
2. dedupMergePrecise("可以", "可以继续") -> 检测到部分重叠
3. 返回：{ text: "继续", deduped: true }
4. 第二个utterance去重后：{ text: "继续" }
```

## 预期效果

1. **完全重复的utterance被丢弃**：
   - 避免重复处理
   - 避免重复翻译

2. **部分重叠的utterance被正确去重**：
   - 保留新内容
   - 去除重复部分

3. **短句误判被避免**：
   - 如果去重后为空，但原始文本很短（<=10字符），可能是误判
   - 保留原始文本，避免丢失内容
