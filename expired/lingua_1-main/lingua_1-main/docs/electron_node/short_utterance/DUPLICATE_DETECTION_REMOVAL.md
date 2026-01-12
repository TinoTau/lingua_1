# 重复检测功能移除

**日期**: 2025-12-30  
**原因**: 重复检测是用来过滤最后一句话的重复的，现在可以完全移除了

---

## 一、移除的内容

### 1. **移除 `lastCommittedText` 属性**

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts:74`

**移除前**:
```typescript
// 新增：存储上一次提交的文本（用于检测重复）
private lastCommittedText: string = '';
```

**移除后**: 已完全移除

### 2. **移除第一处重复检测逻辑**

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts:403-429`

**移除前**:
```typescript
// 在更新 lastCommittedText 之前，先检测重复
// 如果与上次提交的文本完全相同，不更新 lastCommittedText，直接返回空结果
if (commitText && commitText.trim().length > 0 && this.lastCommittedText && this.lastCommittedText.trim().length > 0) {
  const normalizeText = (t: string): string => {
    return t.replace(/\s+/g, ' ').trim();
  };
  
  const normalizedCommitText = normalizeText(commitText);
  const normalizedLast = normalizeText(this.lastCommittedText);
  
  if (normalizedCommitText === normalizedLast && normalizedCommitText.length > 0) {
    logger.info(/* ... */, 'AggregatorState: Detected duplicate with last committed text (before updating), returning empty result.');
    return { text: '', shouldCommit: false, action: 'MERGE', metrics: {} };
  }
}

this.lastCommittedText = commitText;
```

**移除后**: 已完全移除，直接提交文本

### 3. **移除第二处重复检测逻辑**

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts:468-499`

**移除前**: 与第一处类似的重复检测逻辑（针对 `isFinal` 情况）

**移除后**: 已完全移除

### 4. **移除日志中的 `lastCommittedText` 引用**

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts:220`

**移除前**:
```typescript
lastCommittedText: this.lastCommittedText.substring(0, 50),
```

**移除后**: 已移除

### 5. **移除注释中的重复检测说明**

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts:136-139`

**移除前**:
```typescript
// 注意：重复检测应该在聚合决策之后进行，而不是在开始时就检查
// 因为我们需要先进行聚合决策，然后再检查是否与上次提交的文本重复
// 如果文本与上次提交的完全相同，应该在聚合决策之后返回空结果
// 这里先跳过重复检测，在聚合决策之后再进行
```

**移除后**: 已移除

### 6. **移除 `flush()` 方法中的 `lastCommittedText` 更新**

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts:586, 593`

**移除前**:
```typescript
this.lastCommittedText = textToFlush;
```

**移除后**: 已移除

### 7. **移除 `reset()` 方法中的 `lastCommittedText` 清理**

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts:694`

**移除前**:
```typescript
this.lastCommittedText = '';
```

**移除后**: 已移除

### 8. **移除注释中的 `lastCommittedText` 相关说明**

**位置**: `electron_node/electron-node/main/src/aggregator/aggregator-state.ts:205, 434, 498, 552-554`

**移除前**: 多处注释提到 `lastCommittedText` 和重复检测

**移除后**: 已移除

---

## 二、影响分析

### 1. **功能影响**

- ✅ **不再过滤重复文本**：所有文本都会被正常提交，即使与上次提交的文本相同
- ✅ **简化逻辑**：移除了复杂的重复检测逻辑，代码更简洁
- ✅ **提高性能**：减少了文本标准化和比较的开销

### 2. **潜在问题**

- ⚠️ **可能产生重复结果**：如果ASR重复识别相同的文本，可能会产生重复的NMT翻译和TTS语音
- ⚠️ **需要其他机制处理重复**：如果确实需要过滤重复，需要在其他层面（如调度服务器或节点端）处理

### 3. **建议**

如果确实需要过滤重复，可以考虑：

1. **在调度服务器端处理**：在创建Job之前检查是否与最近的Job结果重复
2. **在节点端处理**：在发送结果给调度服务器之前检查是否与最近发送的结果重复
3. **在UI端处理**：在显示结果之前检查是否与最近显示的结果重复

---

## 三、验证

### 1. **编译检查**

✅ 已通过编译检查，无语法错误

### 2. **代码搜索**

✅ 已确认所有 `lastCommittedText` 引用已移除
✅ 已确认所有重复检测相关日志已移除
✅ 已确认所有重复检测相关注释已移除

---

## 四、总结

- ✅ **完全移除了重复检测功能**
- ✅ **移除了 `lastCommittedText` 属性**
- ✅ **移除了两处重复检测逻辑**
- ✅ **移除了所有相关日志和注释**
- ✅ **代码已通过编译检查**

现在聚合逻辑不再会过滤重复文本，所有文本都会被正常提交和处理。

