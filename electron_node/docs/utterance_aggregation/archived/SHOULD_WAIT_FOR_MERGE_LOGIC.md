# shouldWaitForMerge 逻辑详解

## ⚠️ 文档状态：已归档

**归档日期**: 2026-01-24  
**归档原因**: 已被新文档替代（包含更完整的信息）  
**当前有效文档**: `../SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

---

## 文档信息
- **创建日期**: 2026-01-24
- **归档日期**: 2026-01-24
- **目的**: 详细说明 `shouldWaitForMerge` 的完整逻辑和处理流程

---

## 1. 概述

`shouldWaitForMerge` 是 `TextForwardMergeManager` 中的核心逻辑，用于决定是否等待与下一句文本合并。

**位置**: `electron_node/electron-node/main/src/agent/postprocess/text-forward-merge-manager.ts`

**目的**: 
- 处理短文本合并，提高翻译质量
- 避免短文本被单独发送，导致翻译不完整

---

## 2. 核心配置参数

### 2.1 默认配置

```typescript
minLengthToKeep: 6      // 最小保留长度（< 6字符丢弃）
minLengthToSend: 20    // 最小发送长度（6-20字符等待合并）
maxLengthToWait: 40    // 最大等待长度（20-40字符等待确认）
waitTimeoutMs: 3000    // 等待超时时间（3秒）
```

### 2.2 配置来源

从 `nodeConfig.textLength` 加载，如果没有配置则使用默认值。

---

## 3. 完整处理流程

### 3.1 主流程：processText 方法

```
输入: currentText, previousText, sessionId, jobId, utteranceIndex, isManualCut
  ↓
1. 检查是否有待合并的文本（pendingTexts）
  ↓
2. 如果有待合并的文本：
   a. 如果超时或手动发送 → 处理待合并的文本
   b. 如果未超时且非手动发送 → 与当前文本合并
  ↓
3. 如果没有待合并的文本：
   a. 如果有previousText → 去重
   b. 根据文本长度判断处理动作
  ↓
4. 返回处理结果
```

---

## 4. 详细逻辑说明

### 4.1 场景1：有待合并的文本（pendingTexts）

#### 4.1.1 超时或手动发送

**条件**: `isManualCut || nowMs >= pending.waitUntil`

**处理**:
1. 如果有 `currentText`：
   - 与 `pendingText` 去重合并
   - 判断合并后的文本长度：
     - **< 6字符**: 丢弃
     - **6-20字符**: 
       - 如果 `isManualCut=true` → 直接发送
       - 如果 `isManualCut=false` → 继续等待（重新设置 `pendingTexts`）
     - **20-40字符**: 
       - 如果 `isManualCut=true` → 直接发送
       - 如果 `isManualCut=false` → 继续等待（重新设置 `pendingTexts`）
     - **> 40字符**: 直接发送

2. 如果没有 `currentText`：
   - 直接发送 `pendingText`（无论长度）

#### 4.1.2 未超时且非手动发送

**条件**: `pending && nowMs < pending.waitUntil && !isManualCut`

**处理**:
1. 与 `currentText` 去重合并
2. 判断合并后的文本长度：
   - **< 6字符**: 丢弃
   - **6-20字符**: 继续等待（重新设置 `pendingTexts`）
   - **20-40字符**: 继续等待（重新设置 `pendingTexts`）
   - **> 40字符**: 直接发送

---

### 4.2 场景2：没有待合并的文本

#### 4.2.1 去重处理

**如果有 `previousText`**:
1. 使用 `dedupMergePrecise` 去重
2. 如果去重后文本为空或很短（< 6字符）：
   - 标记 `mergedFromUtteranceIndex = utteranceIndex - 1`
   - 用于通知GPU仲裁器取消上一个utterance的任务

#### 4.2.2 长度判断

**< 6字符** (`processedText.length < minLengthToKeep`):
- `shouldDiscard: true`
- `shouldWaitForMerge: false`
- `shouldSendToSemanticRepair: false`
- `processedText: ''`

**6-20字符** (`processedText.length <= minLengthToSend`):
- 如果 `isManualCut=true`:
  - `shouldWaitForMerge: false`
  - `shouldSendToSemanticRepair: true`
  - `processedText: processedText`
- 如果 `isManualCut=false`:
  - `shouldWaitForMerge: true`
  - `shouldSendToSemanticRepair: false`
  - `processedText: ''`
  - **设置 `pendingTexts`**: `{ text: processedText, waitUntil: nowMs + 3000, jobId, utteranceIndex }`

**20-40字符** (`processedText.length <= maxLengthToWait`):
- 如果 `isManualCut=true`:
  - `shouldWaitForMerge: false`
  - `shouldSendToSemanticRepair: true`
  - `processedText: processedText`
- 如果 `isManualCut=false`:
  - `shouldWaitForMerge: true`
  - `shouldSendToSemanticRepair: false`
  - `processedText: ''`
  - **设置 `pendingTexts`**: `{ text: processedText, waitUntil: nowMs + 3000, jobId, utteranceIndex }`
  - **目的**: 等待3秒确认是否有后续输入，避免用户说到最后一句话时被截断

**> 40字符** (`processedText.length > maxLengthToWait`):
- `shouldWaitForMerge: false`
- `shouldSendToSemanticRepair: true`
- `processedText: processedText`
- **目的**: 强制截断，避免用户不断输入导致文本累积过多

---

## 5. pendingTexts 管理

### 5.1 数据结构

```typescript
pendingTexts: Map<string, {
  text: string;              // 待合并的文本
  waitUntil: number;         // 等待截止时间（nowMs + 3000）
  jobId: string;             // 任务ID
  utteranceIndex: number;     // utterance索引
}>
```

### 5.2 设置 pendingTexts

**时机**:
- 6-20字符的文本（非手动发送）
- 20-40字符的文本（非手动发送）

**设置**:
```typescript
this.pendingTexts.set(sessionId, {
  text: processedText,
  waitUntil: nowMs + this.lengthConfig.waitTimeoutMs,  // 默认3000ms
  jobId,
  utteranceIndex,
});
```

### 5.3 清除 pendingTexts

**时机**:
- 与下一句文本合并后
- 超时后处理
- 手动发送时处理
- 调用 `clearPendingText(sessionId)` 或 `clearAllPendingTexts()`

---

## 6. 关键逻辑点

### 6.1 去重合并

**使用**: `dedupMergePrecise(pendingText, currentText, dedupConfig)`

**结果**:
- `deduped: boolean` - 是否去重
- `text: string` - 去重后的文本（只包含 `currentText` 去掉重叠后的剩余部分）
- `overlapChars: number` - 重叠字符数

**合并逻辑**:
```typescript
const mergedText = dedupResult.deduped 
  ? pending.text + dedupResult.text  // 如果有去重，合并 pending.text 和去重后的 currentText
  : pending.text + currentText;      // 如果没有去重，直接合并
```

### 6.2 手动发送（isManualCut）

**作用**: 强制立即处理，不等待合并

**影响**:
- 6-20字符：直接发送，不等待
- 20-40字符：直接发送，不等待
- 如果有 `pendingTexts`：立即处理，不等待超时

### 6.3 超时机制

**超时时间**: 3秒（`waitTimeoutMs: 3000`）

**超时处理**:
- 如果有 `currentText`：与 `currentText` 合并后判断长度
- 如果没有 `currentText`：直接发送 `pendingText`（无论长度）

---

## 7. 返回值说明

### 7.1 ForwardMergeResult 接口

```typescript
interface ForwardMergeResult {
  processedText: string;                    // 处理后的文本（如果等待合并则为空字符串）
  shouldDiscard: boolean;                  // 是否应该丢弃（< 6字符）
  shouldWaitForMerge: boolean;              // 是否应该等待合并（6-20字符或20-40字符）
  shouldSendToSemanticRepair: boolean;      // 是否应该发送给语义修复（> 20字符或手动发送）
  deduped: boolean;                         // 是否去重
  dedupChars: number;                       // 去重字符数
  mergedFromUtteranceIndex?: number;        // 如果合并了前一个utterance，存储前一个utterance的索引
  mergedFromPendingUtteranceIndex?: number; // 如果合并了待合并的文本，存储待合并文本的utterance索引
}
```

### 7.2 返回值含义

**shouldWaitForMerge=true**:
- `processedText: ''`（空字符串）
- 文本已存储在 `pendingTexts` 中
- 等待下一句文本或超时

**shouldWaitForMerge=false**:
- `processedText: processedText`（有文本）
- 直接发送给语义修复

**shouldDiscard=true**:
- `processedText: ''`（空字符串）
- 文本被丢弃，不发送

---

## 8. 处理流程图

```
输入文本
  ↓
是否有 pendingTexts？
  ├─ 是 → 是否超时或手动发送？
  │      ├─ 是 → 与 currentText 合并（如果有）
  │      │         ↓
  │      │      判断合并后长度
  │      │         ├─ < 6字符 → 丢弃
  │      │         ├─ 6-20字符 → 手动发送？直接发送 : 继续等待
  │      │         ├─ 20-40字符 → 手动发送？直接发送 : 继续等待
  │      │         └─ > 40字符 → 直接发送
  │      │
  │      └─ 否 → 与 currentText 合并
  │                ↓
  │             判断合并后长度
  │                ├─ < 6字符 → 丢弃
  │                ├─ 6-20字符 → 继续等待
  │                ├─ 20-40字符 → 继续等待
  │                └─ > 40字符 → 直接发送
  │
  └─ 否 → 是否有 previousText？
           ├─ 是 → 去重
           └─ 否 → 直接判断长度
                     ↓
                  判断文本长度
                     ├─ < 6字符 → 丢弃
                     ├─ 6-20字符 → 手动发送？直接发送 : 等待合并
                     ├─ 20-40字符 → 手动发送？直接发送 : 等待确认
                     └─ > 40字符 → 直接发送
```

---

## 9. 关键设计点

### 9.1 为什么需要 shouldWaitForMerge？

**问题**: 短文本单独翻译质量差

**解决**: 等待与下一句合并，提高翻译质量

### 9.2 为什么使用字符数量判断？

**原因**:
- 短文本（6-20字符）通常是不完整的句子
- 中等文本（20-40字符）可能是完整的句子，但需要确认是否有后续输入
- 长文本（> 40字符）通常是完整的句子，可以直接发送

### 9.3 为什么有3秒超时？

**原因**:
- 给短文本足够时间等待合并
- 避免无限等待
- 如果3秒内没有后续输入，说明用户已经说完，可以发送

### 9.4 为什么手动发送时直接发送？

**原因**:
- 用户主动点击发送，表示当前文本已经完整
- 不需要等待合并

---

## 10. 使用示例

### 10.1 示例1：短文本等待合并

```typescript
// Job 1: "这是第一句话" (7字符)
const result1 = manager.processText(
  sessionId,
  '这是第一句话',
  null,
  'job-1',
  0,
  false
);
// 结果: shouldWaitForMerge=true, processedText=''
// pendingTexts: { text: '这是第一句话', waitUntil: nowMs + 3000 }

// Job 2: "这是第二句话" (7字符)
const result2 = manager.processText(
  sessionId,
  '这是第二句话',
  null,
  'job-2',
  1,
  false
);
// 结果: shouldWaitForMerge=true, processedText=''
// 合并后: "这是第一句话这是第二句话" (14字符)
// pendingTexts: { text: '这是第一句话这是第二句话', waitUntil: nowMs + 3000 }
```

### 10.2 示例2：超时后发送

```typescript
// Job 1: "这是第一句话" (7字符)
const result1 = manager.processText(
  sessionId,
  '这是第一句话',
  null,
  'job-1',
  0,
  false
);
// 结果: shouldWaitForMerge=true, processedText=''
// pendingTexts: { text: '这是第一句话', waitUntil: nowMs + 3000 }

// 等待3秒后，没有后续输入
// Job 2: "" (空文本)
const result2 = manager.processText(
  sessionId,
  '',
  null,
  'job-2',
  1,
  false
);
// 结果: shouldWaitForMerge=false, shouldSendToSemanticRepair=true
// processedText: '这是第一句话'
```

### 10.3 示例3：手动发送

```typescript
// Job 1: "这是第一句话" (7字符)
const result1 = manager.processText(
  sessionId,
  '这是第一句话',
  null,
  'job-1',
  0,
  false
);
// 结果: shouldWaitForMerge=true, processedText=''
// pendingTexts: { text: '这是第一句话', waitUntil: nowMs + 3000 }

// 手动发送
const result2 = manager.processText(
  sessionId,
  '这是第二句话',
  null,
  'job-2',
  1,
  true  // isManualCut=true
);
// 结果: shouldWaitForMerge=false, shouldSendToSemanticRepair=true
// processedText: '这是第一句话这是第二句话' (合并后的文本)
```

---

## 11. 总结

### 11.1 核心逻辑

1. **< 6字符**: 丢弃
2. **6-20字符**: 等待合并（3秒超时），除非手动发送
3. **20-40字符**: 等待确认（3秒超时），除非手动发送
4. **> 40字符**: 直接发送

### 11.2 关键机制

- **pendingTexts**: 存储待合并的文本
- **超时机制**: 3秒超时，如果没有后续输入则发送
- **手动发送**: 强制立即处理，不等待合并
- **去重合并**: 使用 `dedupMergePrecise` 去重后合并

### 11.3 设计目的

- **提高翻译质量**: 合并短文本，避免不完整翻译
- **避免截断**: 20-40字符等待确认，避免句子被截断
- **防止累积**: > 40字符强制发送，避免文本累积过多

---

**文档结束**
