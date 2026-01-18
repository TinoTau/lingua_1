# getLastCommittedText 修复方案实现完成报告

## 实现状态

✅ **已完成** (2025-01-17)

## 修改的文件

### 1. `electron_node/electron-node/main/src/aggregator/aggregator-state-context.ts`

**主要修改**：
- 将`recentCommittedText`从`string[]`改为`CommittedText[]`
- 新增`CommittedText`类型定义：`{ utteranceIndex: number; text: string }`
- 修改`updateRecentCommittedText(text: string, utteranceIndex: number)`，增加`utteranceIndex`参数
- 修改`updateLastCommittedText(utteranceIndex: number, originalText: string, repairedText: string)`，增加`utteranceIndex`参数
- 新增`getLastCommittedText(currentUtteranceIndex: number)`方法，只按`utteranceIndex`选择
- 修改`getRecentCommittedText()`，返回文本数组（用于关键词提取等功能）
- 新增`getAllCommittedTexts()`方法，用于调试和测试

**关键改进**：
- 完全删除所有基于文本内容的heuristic逻辑（包含关系、长度差等）
- 只按`utteranceIndex`顺序选择最近一条已提交的完整文本
- 确保`recentCommittedText`按`utteranceIndex`排序

### 2. `electron_node/electron-node/main/src/aggregator/aggregator-manager.ts`

**主要修改**：
- 修改`getLastCommittedText(sessionId: string, currentUtteranceIndex: number)`，只接收`currentUtteranceIndex`参数
- 修改`updateLastCommittedTextAfterRepair(sessionId: string, utteranceIndex: number, originalText: string, repairedText: string)`，增加`utteranceIndex`参数

**关键改进**：
- 删除所有基于文本内容的匹配逻辑
- 直接调用`state.getLastCommittedText(currentUtteranceIndex)`

### 3. `electron_node/electron-node/main/src/aggregator/aggregator-state.ts`

**主要修改**：
- 修改`updateLastCommittedTextAfterRepair(utteranceIndex: number, originalText: string, repairedText: string)`，增加`utteranceIndex`参数
- 移除聚合阶段的`updateRecentCommittedText`调用（只在语义修复后更新）

**关键改进**：
- 确保`recentCommittedText`中只包含最终提交的文本（语义修复后的文本）

### 4. `electron_node/electron-node/main/src/aggregator/aggregator-state-commit-executor.ts`

**主要修改**：
- 移除`updateRecentCommittedText`调用（只在语义修复后更新）

**关键改进**：
- 确保`recentCommittedText`中只包含最终提交的文本

### 5. `electron_node/electron-node/main/src/pipeline/steps/semantic-repair-step.ts`

**主要修改**：
- 更新`updateLastCommittedTextAfterRepair`调用，传递`job.utterance_index`

**关键改进**：
- 确保在语义修复后正确更新`recentCommittedText`，并记录正确的`utteranceIndex`

### 6. `electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts`

**主要修改**：
- 更新`getLastCommittedText`调用，传递`job.utterance_index`而不是`aggregatedText`

**关键改进**：
- 使用`utteranceIndex`而不是文本内容来获取上下文

## 单元测试

✅ **已添加** (`electron_node/electron-node/tests/aggregator-state-context.test.ts`)

**测试覆盖的场景**：

1. **场景1：Job4为完整长句，Job7为其短片段**
   - 测试：Job 7应该返回Job 4的文本，而不是跳过它
   - 验证：修复后不会因为包含关系和长度差而跳过Job 4

2. **场景2：只有一条历史文本**
   - 测试：应该永远使用那条文本作为context
   - 验证：无论当前utteranceIndex是多少，只要有历史文本就返回它

3. **场景3：当前job为第一句**
   - 测试：应该返回null（无上下文）
   - 验证：第一个utterance没有上下文

4. **其他边界情况**：
   - utteranceIndex不连续的情况
   - 更新相同utteranceIndex的文本
   - 按utteranceIndex排序
   - 限制最多MAX_RECENT_COMMITS条

## 关键改进

### 1. 完全删除heuristic逻辑

**之前**：
- 检查历史文本是否包含当前文本
- 检查长度差是否大于某个阈值
- 基于文本内容做"跳过"判断

**现在**：
- 只按`utteranceIndex`顺序选择
- 不关心文本内容
- 行为可预测、易理解

### 2. 只按utteranceIndex选择

**之前**：
```typescript
getLastCommittedText(sessionId: string, currentText?: string): string | null {
  // 复杂的文本匹配逻辑
  if (textTrimmed.includes(currentTextTrimmed) && lengthDiff > threshold) {
    continue; // 跳过
  }
  return text;
}
```

**现在**：
```typescript
getLastCommittedText(currentUtteranceIndex: number): string | null {
  // 从后往前找第一条utteranceIndex < currentUtteranceIndex的文本
  for (let i = this.recentCommittedText.length - 1; i >= 0; i--) {
    const item = this.recentCommittedText[i];
    if (item.utteranceIndex < currentUtteranceIndex) {
      return item.text;
    }
  }
  return null;
}
```

### 3. 只在语义修复后更新

**之前**：
- 在聚合阶段和语义修复后都更新`recentCommittedText`

**现在**：
- 只在语义修复后更新，确保`recentCommittedText`中只包含最终提交的文本

### 4. 保持向后兼容

- `getRecentCommittedText()`仍然返回`string[]`，用于关键词提取等功能
- 不影响其他依赖`recentCommittedText`的功能

## 验证

修复后，Job 7应该能够正确获取Job 4的文本作为context，而不会跳过它返回Job 1的文本。

**预期行为**：
- Job 4 (utteranceIndex=4): 完整长句（80字符）
- Job 7 (utteranceIndex=7): 短片段（6字符），是Job 4的一部分
- Job 7的context应该 = Job 4的文本 ✅

**之前的行为**：
- Job 7的context = Job 1的文本 ❌（因为跳过了Job 4）

## 运行测试

```bash
cd electron_node/electron-node
npm test -- aggregator-state-context.test.ts
```

## 相关文档

- [修复方案规范](./FIX_GET_LAST_COMMITTED_TEXT_SPEC.md)
- [评估报告](./FIX_GET_LAST_COMMITTED_TEXT_EVALUATION.md)
- [根本原因分析](./JOB_4_7_ROOT_CAUSE_ANALYSIS.md)
