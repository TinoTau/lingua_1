# 合并导致后续语音丢失的问题分析

## 问题描述

用户报告：后续输入的语音都丢失了，怀疑是因为合并太多，造成系统处理超时。

## 问题分析

### 1. 合并逻辑的关键条件

从 `aggregation-stage.ts` 第 126 行看，只有满足以下**所有条件**时，才会返回聚合后的文本：

```typescript
if (aggregatorResult.isFirstInMergedGroup === true && 
    aggregatorResult.shouldCommit && 
    aggregatorResult.text) {
  // 返回聚合后的文本
  aggregatedText = aggregatorResult.text;
} else {
  // 返回空文本
  aggregatedText = '';
}
```

**关键点**：
- `isFirstInMergedGroup === true`：必须是合并组中的第一个
- `shouldCommit === true`：必须触发提交
- `text` 不为空：必须有文本

### 2. 提交条件（shouldCommit）

位置：`aggregator-decision.ts` 第 165-178 行

```typescript
export function shouldCommit(
  pendingText: string,
  lastCommitTsMs: number,
  nowMs: number,
  mode: Mode,
  tuning: AggregatorTuning
): boolean {
  const elapsed = nowMs - lastCommitTsMs;
  if (elapsed >= tuning.commitIntervalMs) return true;  // 时间间隔 >= 1200ms (offline)
  
  const isCjk = looksLikeCjk(pendingText);
  if (isCjk) return countCjkChars(pendingText) >= tuning.commitLenCjk;  // >= 30 字 (offline)
  return countWords(pendingText) >= tuning.commitLenEnWords;  // >= 12 词 (offline)
}
```

**提交条件**（满足任一即可）：
1. **时间间隔**：距离上次提交 >= 1200ms (offline) 或 900ms (room)
2. **文本长度**：
   - CJK：>= 30 字 (offline) 或 25 字 (room)
   - 英文：>= 12 词 (offline) 或 10 词 (room)
3. **isFinal**：当前 utterance 是 final 结果（强制提交）
4. **isManualCut**：用户手动切分（强制提交）

### 3. 问题场景分析

#### 场景 1：多个 utterance 被合并，但都不满足提交条件

**示例**：
```
Utterance 1: "让我们来试一下" (10 字, t=0ms)
  → action: NEW_STREAM, shouldCommit: false (10 字 < 30 字, 时间 < 1200ms)
  → 返回原始文本（因为 NEW_STREAM）

Utterance 2: "这个版本" (4 字, t=500ms)
  → action: MERGE, isFirstInMergedGroup: true, shouldCommit: false (14 字 < 30 字, 时间 < 1200ms)
  → pendingText = "让我们来试一下 这个版本" (14 字)
  → 返回空文本（因为 shouldCommit: false）

Utterance 3: "的系统测试" (5 字, t=1000ms)
  → action: MERGE, isFirstInMergedGroup: false, shouldCommit: false (19 字 < 30 字, 时间 < 1200ms)
  → pendingText = "让我们来试一下 这个版本 的系统测试" (19 字)
  → 返回空文本（因为 isFirstInMergedGroup: false）

Utterance 4: "看看效果" (4 字, t=1500ms)
  → action: MERGE, isFirstInMergedGroup: false, shouldCommit: false (23 字 < 30 字, 时间 < 1200ms)
  → pendingText = "让我们来试一下 这个版本 的系统测试 看看效果" (23 字)
  → 返回空文本（因为 isFirstInMergedGroup: false）

... 用户继续说话，但所有 utterance 都返回空文本，用户看不到任何结果
```

**问题**：
- 如果用户快速连续说话，多个 utterance 被合并
- 但文本长度一直 < 30 字，时间间隔 < 1200ms
- 所有 utterance 都返回空文本（因为 `shouldCommit: false` 或 `isFirstInMergedGroup: false`）
- 用户看不到任何结果，直到某个 utterance 触发提交

#### 场景 2：isFirstInMergedGroup 判断错误

**问题**（已修复）：
- 之前的代码要求 `lastCommittedText === ''`，导致 Job1 完成后，后续的 MERGE 无法被识别为"第一个"
- 修复后：移除了 `lastCommittedText === ''` 条件

**但仍有问题**：
- 如果 Job1 是 NEW_STREAM 且已提交，Job2 是 MERGE
- Job2 的 `isFirstInMergedGroup` 应该是 `true`（因为 `pendingText === ''`）
- 但如果 Job2 的 `shouldCommit: false`，仍然返回空文本

#### 场景 3：合并太多导致超时

**可能的问题**：
- 如果多个 utterance 被合并，`pendingText` 会一直累积
- 如果文本很长（例如合并了 10 个 utterance），翻译时间可能很长
- 但这不是"丢失"的原因，而是延迟

### 4. 根本原因

**核心问题**：`aggregation-stage.ts` 的逻辑要求**同时满足** `isFirstInMergedGroup === true` 和 `shouldCommit === true` 才返回文本。

**问题场景**：
1. 如果 `isFirstInMergedGroup === true` 但 `shouldCommit === false`：
   - 文本被合并到 `pendingText`，但不返回
   - 用户看不到任何结果
   - 后续的 utterance 继续合并，但 `isFirstInMergedGroup === false`，也返回空文本

2. 如果 `isFirstInMergedGroup === false`：
   - 直接返回空文本
   - 即使 `shouldCommit === true`，也不会返回文本（因为不是第一个）

**结果**：如果合并组中的第一个 utterance 不满足提交条件，整个合并组都不会返回结果，直到某个 utterance 触发提交。

## 解决方案

### 方案 1：放宽返回条件（推荐）

**问题**：当前逻辑要求 `isFirstInMergedGroup === true && shouldCommit === true` 才返回文本。

**修复**：即使 `shouldCommit === false`，如果是合并组中的第一个，也应该返回当前的 `pendingText`（如果它不为空）。

```typescript
// aggregation-stage.ts
if (aggregatorResult.action === 'MERGE') {
  if (aggregatorResult.isFirstInMergedGroup === true) {
    // 如果是合并组中的第一个，即使未触发提交，也返回当前的 pendingText
    if (aggregatorResult.text) {
      aggregatedText = aggregatorResult.text;
      isFirstInMergedGroup = true;
    } else {
      // 如果 text 为空，说明 pendingText 为空，返回原始文本
      aggregatedText = asrTextTrimmed;
      isFirstInMergedGroup = true;
    }
  } else {
    // 不是第一个，返回空文本
    aggregatedText = '';
    isFirstInMergedGroup = false;
  }
}
```

**但这样会有问题**：如果返回了未提交的文本，后续的 utterance 继续合并时，可能会重复发送。

### 方案 2：强制提交机制

**问题**：如果 `pendingText` 累积到一定长度（例如 50 字），强制提交。

**修复**：在 `shouldCommit` 函数中添加强制提交条件：

```typescript
export function shouldCommit(
  pendingText: string,
  lastCommitTsMs: number,
  nowMs: number,
  mode: Mode,
  tuning: AggregatorTuning
): boolean {
  const elapsed = nowMs - lastCommitTsMs;
  
  // 强制提交：如果 pendingText 太长（例如 >= 50 字），强制提交
  const isCjk = looksLikeCjk(pendingText);
  const textLength = isCjk ? countCjkChars(pendingText) : countWords(pendingText);
  const maxLength = isCjk ? 50 : 20;  // 最大长度阈值
  if (textLength >= maxLength) return true;  // 强制提交，避免无限累积
  
  if (elapsed >= tuning.commitIntervalMs) return true;
  
  if (isCjk) return countCjkChars(pendingText) >= tuning.commitLenCjk;
  return countWords(pendingText) >= tuning.commitLenEnWords;
}
```

### 方案 3：降低提交阈值

**问题**：当前的提交阈值可能太高（30 字/1200ms），导致用户快速说话时，多个 utterance 被合并但不提交。

**修复**：降低提交阈值，让合并后的文本更快提交：

```typescript
// aggregator-decision.ts
commitIntervalMs: isRoom ? 600 : 800,  // 降低：从 900/1200 降到 600/800
commitLenCjk: isRoom ? 20 : 25,         // 降低：从 25/30 降到 20/25
commitLenEnWords: isRoom ? 8 : 10,      // 降低：从 10/12 降到 8/10
```

**但这样可能会**：
- 增加翻译次数（更频繁的提交）
- 降低翻译质量（文本更短，上下文更少）

### 方案 4：isFinal 强制提交（已实现）

**当前逻辑**：`isFinal || isManualCut` 会强制触发提交（第 287 行）。

**问题**：如果用户快速连续说话，每个 utterance 都是 `isFinal: true`，但可能不满足其他提交条件。

**检查**：需要确认 `isFinal` 是否总是 `true`（P0 只处理 final 结果）。

## 推荐方案

**方案 2 + 方案 3 的组合**：
1. 添加强制提交机制（方案 2）：如果 `pendingText` 累积到 50 字，强制提交
2. 适度降低提交阈值（方案 3）：将 `commitIntervalMs` 从 1200ms 降到 800ms，`commitLenCjk` 从 30 字降到 25 字

这样可以：
- 避免 `pendingText` 无限累积
- 让合并后的文本更快提交
- 减少用户等待时间
- 保持翻译质量（25 字仍然足够长）

## 相关代码位置

1. **提交判断**：`electron_node/electron-node/main/src/aggregator/aggregator-decision.ts` 第 165-178 行
2. **聚合阶段**：`electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts` 第 124-160 行
3. **状态管理**：`electron_node/electron-node/main/src/aggregator/aggregator-state.ts` 第 280-366 行

