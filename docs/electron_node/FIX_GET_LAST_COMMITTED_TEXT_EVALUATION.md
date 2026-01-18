# getLastCommittedText 修复方案评估

## 方案概述

该方案的核心思想是：
1. **完全删除所有基于文本内容的heuristic**（包含关系、长度差等）
2. **只按`utteranceIndex`顺序选择最近一条已提交的完整文本**
3. **不关心文本内容，只关心"顺序靠前且最近"**

## 能否解决问题？

### ✅ **能解决根本问题**

**当前问题**：
- Job 7的文本（6字符）"判聚和后半聚"是Job 4文本（80字符）的子串
- `getLastCommittedText`的逻辑在行284-289中，如果历史文本包含当前文本且长度差异很大（超过50%），会跳过历史文本
- 因此跳过了Job 4的文本，继续往前查找，返回了Job 1的文本

**修复后的行为**：
- Job 7调用`getLastCommittedText(sessionId, utteranceIndex=7)`
- 查找所有`utteranceIndex < 7`的已提交文本
- 找到`utteranceIndex=4`的Job 4文本，直接返回
- **不再检查包含关系和长度差，因此不会跳过Job 4**

### ✅ **更简单、可预测**

**当前实现的问题**：
- 复杂的heuristic逻辑（包含关系、长度差、相似度等）
- 行为不可预测，容易出现意外跳过
- 难以调试和维护

**修复后的优势**：
- 行为清晰：只按顺序选择最近一条
- 可预测：不会有意外的跳过逻辑
- 易维护：代码简单，逻辑清晰

### ✅ **实现可行**

**需要的修改**：

1. **修改数据结构**：
   ```typescript
   // 当前：string[]
   private recentCommittedText: string[] = [];
   
   // 修改为：CommittedText[]
   type CommittedText = {
     utteranceIndex: number;
     text: string;
   }
   private recentCommittedText: CommittedText[] = [];
   ```

2. **修改`updateLastCommittedTextAfterRepair`签名**：
   ```typescript
   // 当前：只接收originalText和repairedText
   updateLastCommittedTextAfterRepair(
     sessionId: string,
     originalText: string,
     repairedText: string
   ): void
   
   // 修改为：增加utteranceIndex参数
   updateLastCommittedTextAfterRepair(
     sessionId: string,
     utteranceIndex: number,
     originalText: string,
     repairedText: string
   ): void
   ```

3. **修改`getLastCommittedText`实现**：
   ```typescript
   // 当前：基于文本内容匹配，有复杂的heuristic
   getLastCommittedText(sessionId: string, currentText?: string): string | null
   
   // 修改为：只按utteranceIndex选择
   getLastCommittedText(
     sessionId: string,
     currentUtteranceIndex: number
   ): string | null
   ```

**可用性检查**：
- ✅ `job.utterance_index`在调用`updateLastCommittedTextAfterRepair`时是可用的（从`semantic-repair-step.ts:120`可以看到）
- ✅ `job.utterance_index`在调用`getLastCommittedText`时是可用的（从`translation-stage.ts:115`可以看到）

## 潜在问题和注意事项

### 1. 需要确保utteranceIndex的正确性

**问题**：
- 如果`utteranceIndex`不正确（例如容器job使用原始job的utteranceIndex），可能导致上下文选择错误

**解决方案**：
- 确保在写入`recentCommittedText`时使用正确的`utteranceIndex`
- 对于容器job，应该使用原始job的`utteranceIndex`（从日志看，已经这样做了）

### 2. 需要处理utteranceIndex相同的情况

**问题**：
- 如果多个job有相同的`utteranceIndex`（理论上不应该发生，但需要防御性编程）

**解决方案**：
- 如果找到多个相同`utteranceIndex`的文本，返回最后一个（最新的）
- 或者在写入时检查并更新相同`utteranceIndex`的文本

### 3. 需要确保文本提交的时机

**问题**：
- 如果Job 4的文本在Job 7翻译时还没有被提交到`recentCommittedText`，仍然会返回Job 1的文本

**解决方案**：
- 确保在语义修复完成后立即更新`recentCommittedText`
- 从日志看，Job 4的文本在语义修复后被更新了（行714），所以这个问题应该不存在

### 4. 需要处理边界情况

**问题**：
- 如果当前job是第一个job（`utteranceIndex=0`或`1`），应该返回`null`

**解决方案**：
- 在`getLastCommittedText`中检查，如果没有找到`utteranceIndex < currentUtteranceIndex`的文本，返回`null`

## 实现建议

### 步骤1：修改数据结构

在`aggregator-state-context.ts`中：
```typescript
type CommittedText = {
  utteranceIndex: number;
  text: string;
}

export class AggregatorStateContextManager {
  private recentCommittedText: CommittedText[] = [];
  // ... 其他代码
}
```

### 步骤2：修改`updateRecentCommittedText`

```typescript
updateRecentCommittedText(text: string, utteranceIndex: number): void {
  if (!text || !text.trim()) return;
  
  this.recentCommittedText.push({
    utteranceIndex,
    text: text.trim(),
  });
  
  // 保持最多MAX_RECENT_COMMITS条
  if (this.recentCommittedText.length > this.MAX_RECENT_COMMITS) {
    this.recentCommittedText.shift();
  }
  
  // 可选：按utteranceIndex排序，确保顺序正确
  this.recentCommittedText.sort((a, b) => a.utteranceIndex - b.utteranceIndex);
}
```

### 步骤3：修改`updateLastCommittedText`

```typescript
updateLastCommittedText(
  utteranceIndex: number,
  originalText: string,
  repairedText: string
): void {
  if (!repairedText || !repairedText.trim()) return;
  
  // 查找是否有相同utteranceIndex的文本
  const index = this.recentCommittedText.findIndex(
    item => item.utteranceIndex === utteranceIndex
  );
  
  if (index !== -1) {
    // 如果找到，更新文本
    this.recentCommittedText[index].text = repairedText.trim();
  } else {
    // 如果没找到，添加新条目
    this.recentCommittedText.push({
      utteranceIndex,
      text: repairedText.trim(),
    });
    
    // 保持最多MAX_RECENT_COMMITS条
    if (this.recentCommittedText.length > this.MAX_RECENT_COMMITS) {
      this.recentCommittedText.shift();
    }
    
    // 按utteranceIndex排序
    this.recentCommittedText.sort((a, b) => a.utteranceIndex - b.utteranceIndex);
  }
}
```

### 步骤4：修改`getLastCommittedText`

```typescript
getLastCommittedText(currentUtteranceIndex: number): string | null {
  if (!this.recentCommittedText || this.recentCommittedText.length === 0) {
    return null;
  }
  
  // 从后往前找第一条utteranceIndex < currentUtteranceIndex的文本
  for (let i = this.recentCommittedText.length - 1; i >= 0; i--) {
    const item = this.recentCommittedText[i];
    if (item.utteranceIndex < currentUtteranceIndex) {
      return item.text;
    }
  }
  
  // 没有比当前index小的，说明这是第一句
  return null;
}
```

### 步骤5：更新调用点

在`semantic-repair-step.ts`中：
```typescript
services.aggregatorManager.updateLastCommittedTextAfterRepair(
  job.session_id,
  job.utterance_index,  // 新增参数
  textToRepair,
  ctx.repairedText
);
```

在`translation-stage.ts`中：
```typescript
let contextText = this.aggregatorManager?.getLastCommittedText(
  job.session_id,
  job.utterance_index  // 改为使用utteranceIndex而不是currentText
) || undefined;
```

## 总结

### ✅ **该方案能解决问题**

1. **能解决根本问题**：不再检查包含关系和长度差，Job 7会直接返回Job 4的文本
2. **更简单、可预测**：行为清晰，不会有意外的跳过逻辑
3. **实现可行**：`utteranceIndex`在调用时是可用的，只需要修改数据结构和函数签名

### ⚠️ **需要注意的事项**

1. 确保`utteranceIndex`的正确性（特别是容器job的情况）
2. 处理边界情况（第一个job、相同utteranceIndex等）
3. 确保文本提交的时机正确

### 📝 **建议**

1. **立即实施**：该方案能解决当前问题，且实现简单
2. **添加测试**：特别是Job 4-7的场景，确保修复后Job 7能正确获取Job 4的文本
3. **保留日志**：在关键点添加日志，便于调试和验证
