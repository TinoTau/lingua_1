# 停止说话后重复返回问题修复

**日期**：2025-01-XX  
**问题**：停止说话后，节点端会将最后一句话返回好几次

---

## 问题分析

### 问题现象

用户停止说话后，节点端会连续多次返回相同的最后一句话，导致重复显示。

### 根本原因

1. **上下文缓存未清理**：
   - 停止说话时，`lastTranslatedText`（上下文缓存）没有被清理
   - 导致后续相同文本仍然使用旧的上下文，可能触发重复处理

2. **缺少与上一次提交文本的重复检测**：
   - 只检测了文本内部的重复（`detectInternalRepetition`）
   - 没有检测与上一次提交文本的重复
   - ASR 服务在停止说话后可能继续返回相同的结果

3. **`lastCommittedText` 未正确维护**：
   - 虽然之前实现了 `lastCommittedText` 的存储，但没有正确使用
   - 在 commit 和 flush 时没有更新 `lastCommittedText`

---

## 修复方案

### 1. 添加 `lastCommittedText` 存储

在 `AggregatorState` 中添加：

```typescript
// 新增：存储上一次提交的文本（用于检测重复）
private lastCommittedText: string = '';
```

---

### 2. 检测与上一次提交文本的重复

在 `processUtterance` 中，在处理文本之前检测：

```typescript
// 检测与上一次提交文本的重复（防止停止说话后重复返回）
if (this.lastCommittedText && text === this.lastCommittedText.trim()) {
  logger.debug({ sessionId: this.sessionId, text: text.substring(0, 50) }, 'Detected duplicate with last committed text, returning empty result.');
  return { text: '', shouldCommit: false, action: 'MERGE', metrics: {} };
}
```

**逻辑**：
- 如果当前文本与上一次提交的文本完全相同，直接返回空结果
- 避免重复处理相同的文本

---

### 3. 更新 `lastCommittedText`

在 commit 和 flush 时更新 `lastCommittedText`：

**在 `processUtterance` 中**：
```typescript
if (shouldCommitNow && this.pendingText) {
  commitText = removeTail(this.pendingText, this.tailCarryConfig);
  // ... 其他逻辑 ...
  // 更新上一次提交的文本
  this.lastCommittedText = commitText;
}
```

**在 `flush` 中**：
```typescript
if (this.pendingText) {
  textToFlush = this.pendingText;
  // ... 其他逻辑 ...
  // 更新上一次提交的文本
  this.lastCommittedText = textToFlush;
} else if (this.tailBuffer) {
  textToFlush = this.tailBuffer;
  // ... 其他逻辑 ...
  // 更新上一次提交的文本
  this.lastCommittedText = textToFlush;
}
```

---

### 4. 清理上下文缓存

在 `removeSession` 时清理上下文缓存：

```typescript
removeSession(sessionId: string): void {
  const state = this.states.get(sessionId);
  if (state) {
    // 先 flush
    const flushed = state.flush();
    if (flushed) {
      logger.debug({ sessionId, flushedLength: flushed.length }, 'Flushed before removing session');
    }
    
    // 清理上下文缓存（停止说话时清理）
    (state as any).clearLastTranslatedText();
    
    this.states.delete(sessionId);
    this.lastAccessTime.delete(sessionId);
    logger.debug({ sessionId }, 'Removed AggregatorState and cleared context cache');
  }
}
```

**逻辑**：
- 在移除 session 时，调用 `clearLastTranslatedText()` 清理上下文缓存
- 确保停止说话后，上下文缓存被清理

---

### 5. 在 `reset` 时清理

在 `reset` 方法中也清理 `lastCommittedText`：

```typescript
reset(): void {
  // ... 其他清理逻辑 ...
  // 清理翻译文本和上下文缓存
  this.lastTranslatedText = null;
  this.lastTranslatedTextTimestamp = 0;
  this.lastCommittedText = '';
}
```

---

## 修复效果

### 修复前

1. 停止说话后，ASR 服务继续返回相同的结果
2. 节点端重复处理相同的文本
3. 上下文缓存未清理，可能导致后续处理使用旧的上下文
4. 最后一句话被返回多次

### 修复后

1. ✅ 检测与上一次提交文本的重复，直接返回空结果
2. ✅ 停止说话时清理上下文缓存
3. ✅ 正确维护 `lastCommittedText`，避免重复处理
4. ✅ 最后一句话只返回一次

---

## 相关代码修改

### 文件：`aggregator-state.ts`

1. **添加 `lastCommittedText` 字段**
2. **在 `processUtterance` 中检测重复**
3. **在 commit 和 flush 时更新 `lastCommittedText`**
4. **在 `reset` 时清理 `lastCommittedText`**

### 文件：`aggregator-manager.ts`

1. **在 `removeSession` 时清理上下文缓存**

---

## 测试建议

### 测试场景

1. **正常说话**：
   - 说几句话，确认正常处理
   - 确认没有重复返回

2. **停止说话**：
   - 说一句话后停止说话
   - 确认最后一句话只返回一次
   - 确认没有重复返回

3. **快速连续说话**：
   - 快速连续说几句话
   - 确认没有重复返回

4. **相同文本**：
   - 说相同的文本多次
   - 确认每次都能正确处理（不是完全相同的文本，应该能处理）

---

## 注意事项

1. **重复检测的粒度**：
   - 当前只检测完全相同的文本
   - 如果 ASR 返回略有不同的文本（如标点符号不同），可能仍然会处理
   - 如果需要更严格的检测，可以考虑使用相似度匹配

2. **上下文缓存清理时机**：
   - 当前在 `removeSession` 时清理
   - 如果会话没有显式移除，上下文缓存会在 1 分钟后自动过期

3. **与 `lastSentText` 的关系**：
   - `NodeAgent` 中有 `lastSentText` 来防止重复发送
   - `AggregatorState` 中的 `lastCommittedText` 用于防止重复处理
   - 两者配合，确保不会重复处理和重复发送

---

## 相关文档

- `AGGREGATOR_CRITICAL_FIXES_IMPLEMENTATION.md` - 关键修复实现
- `AGGREGATOR_CRITICAL_ISSUES_ANALYSIS.md` - 关键问题分析

