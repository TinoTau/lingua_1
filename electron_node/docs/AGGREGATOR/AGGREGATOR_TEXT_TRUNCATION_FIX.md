# 文本截断问题修复

**日期**：2025-01-XX  
**问题**：识别出的文本不完整，部分文本被截断

---

## 问题分析

### 问题现象

从日志中看到：
1. **第一句**：
   - `"originalText":"模型的纠正应该是好用的"`
   - `"aggregatedText":"模型的纠正"`（只聚合了部分）
   - 用户听到完整的 "test this version"

2. **最后一句**：
   - `"originalText":"效果还是非常差的"`
   - `"aggregatedText":"效果"`（只聚合了部分）
   - 用户听到完整的 "the result is bad"

### 根本原因

1. **`removeTail` 函数问题**：
   - 使用 `lastIndexOf` 查找 tail 字符串
   - 如果 tail 在文本中间也出现，会找到错误的位置
   - 导致移除了太多文本

2. **`isFinal` 时 Tail Carry 问题**：
   - 当 `isFinal=true` 时，仍然使用 Tail Carry 机制
   - 导致部分文本被保留在 tail buffer 中，没有提交

3. **MERGE 操作时 pending 文本未提交**：
   - 当 `action=MERGE` 且 `shouldCommit=false` 时
   - pending 文本没有被提交，导致文本丢失

---

## 修复方案

### 1. 修复 `removeTail` 函数

**问题**：使用 `lastIndexOf` 可能找到 tail 在文本中间的位置

**修复**：
- 直接检查文本是否以 tail 结尾
- 如果以 tail 结尾，从末尾精确移除
- 如果不以 tail 结尾，按字符数/词数移除

```typescript
export function removeTail(
  text: string,
  config: TailCarryConfig = DEFAULT_TAIL_CARRY_CONFIG
): string {
  const tail = extractTail(text, config);
  if (!tail) return text;
  
  // 从文本末尾精确移除 tail（不使用 lastIndexOf，因为 tail 可能在文本中间也出现）
  // 直接检查文本是否以 tail 结尾
  const trimmedText = text.trim();
  if (trimmedText.endsWith(tail)) {
    // 从末尾移除 tail
    return trimmedText.slice(0, trimmedText.length - tail.length).trim();
  }
  
  // 如果文本不以 tail 结尾（可能因为空格等），尝试从末尾按字符数移除
  const isCjk = looksLikeCjk(text);
  if (isCjk) {
    const chars = Array.from(trimmedText);
    if (chars.length > config.tailCarryCjkChars) {
      return chars.slice(0, chars.length - config.tailCarryCjkChars).join('').trim();
    }
  } else {
    const words = trimmedText.split(/\s+/);
    if (words.length > config.tailCarryTokens) {
      return words.slice(0, words.length - config.tailCarryTokens).join(' ').trim();
    }
  }
  
  return text;
}
```

---

### 2. `isFinal` 时不使用 Tail Carry

**问题**：当 `isFinal=true` 时，仍然使用 Tail Carry，导致部分文本未提交

**修复**：
- 当 `isFinal=true` 或 `isManualCut=true` 时，不保留 tail
- 全部输出，确保完整

```typescript
if (shouldCommitNow && this.pendingText) {
  // 如果是 isFinal，不保留 tail，全部输出（确保完整）
  if (isFinal || isManualCut) {
    commitText = this.pendingText;
    // 如果有 tail buffer，也包含进去
    if (this.tailBuffer) {
      commitText = this.tailBuffer + commitText;
      this.tailBuffer = '';
    }
  } else {
    // 非 final，保留 tail
    commitText = removeTail(this.pendingText, this.tailCarryConfig);
    // ...
  }
}
```

---

### 3. 强制提交 pending 文本（当 `isFinal=true` 时）

**问题**：当 `isFinal=true` 但 `shouldCommit=false` 时，pending 文本没有被提交

**修复**：
- 当 `isFinal=true` 且 `pendingText` 不为空时，强制提交
- 确保 final 时所有文本都被提交

```typescript
} else if (isFinal && this.pendingText) {
  // 如果是 final 但没有触发 commit（可能是因为 pending 文本太短），强制提交
  // 确保 final 时所有文本都被提交
  commitText = this.pendingText;
  // 如果有 tail buffer，也包含进去
  if (this.tailBuffer) {
    commitText = this.tailBuffer + commitText;
    this.tailBuffer = '';
  }
  this.pendingText = '';
  this.lastCommitTsMs = nowMs;
  this.metrics.commitCount++;
  this.lastCommittedText = commitText;
  shouldCommitNow = true;
}
```

---

### 4. 修复 AggregatorMiddleware 中的 MERGE 处理

**问题**：当 `action=MERGE` 且 `shouldCommit=false` 时，只使用当前文本，丢失 pending 文本

**修复**：
- 当 `action=MERGE` 且 `shouldCommit=false` 时，强制 flush pending 文本

```typescript
} else if (aggregatorResult.action === 'MERGE') {
  // Merge 操作：文本已累积到 pending
  // 如果是 final，应该已经提交了 pending 文本（在 processUtterance 中）
  // 如果 shouldCommit=false，说明 pending 文本还没有达到提交条件
  // 但因为是 final，我们需要强制提交 pending 文本
  if (!aggregatorResult.shouldCommit) {
    // 强制 flush pending 文本（因为是 final）
    const flushedText = this.manager?.flush(job.session_id) || '';
    if (flushedText) {
      aggregatedText = flushedText;
      // ...
    }
  }
}
```

---

## 修复效果

### 修复前

1. 文本被截断：
   - `"originalText":"模型的纠正应该是好用的"` → `"aggregatedText":"模型的纠正"`
   - `"originalText":"效果还是非常差的"` → `"aggregatedText":"效果"`

2. 用户听到完整句子，但文本不完整

### 修复后

1. ✅ `isFinal=true` 时，不保留 tail，全部输出
2. ✅ `isFinal=true` 时，强制提交 pending 文本
3. ✅ `removeTail` 从末尾精确移除，不会移除中间文本
4. ✅ MERGE 操作时，正确提交 pending 文本

---

## 相关代码修改

### 文件：`tail-carry.ts`
- 修复 `removeTail` 函数，从末尾精确移除 tail

### 文件：`aggregator-state.ts`
- `isFinal=true` 时，不保留 tail，全部输出
- `isFinal=true` 时，强制提交 pending 文本

### 文件：`aggregator-middleware.ts`
- MERGE 操作时，正确处理 pending 文本

---

## 测试建议

1. **正常说话**：
   - 说完整句子
   - 确认文本完整，不被截断

2. **快速连续说话**：
   - 快速连续说几句话
   - 确认所有文本都被正确聚合和提交

3. **停止说话**：
   - 说一句话后停止说话
   - 确认最后一句完整，不被截断

---

## 相关文档

- `AGGREGATOR_OPTIMIZATION_SEGMENTATION_FIX.md` - 分段优化修复
- `AGGREGATOR_CRITICAL_FIXES_IMPLEMENTATION.md` - 关键修复实现

