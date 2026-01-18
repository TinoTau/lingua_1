# ASR批次累积修复

## 问题描述

用户报告测试结果更糟糕：
- job0: "開始進行語音識別的穩定性測試" (完整)
- job1: "我會先" (不完整，应该是"我會先讀一兩句比較短的話")
- job3: "接下來進行" (不完整，应该是"接下來這一句我會盡量連續地說得長一些")
- job6: "這句話解斷?" (不完整)

**问题**：每个job都被拆分成了多个片段，而不是完整处理。

---

## 根本原因

### ASR批次立即处理问题

在 `asr-step.ts` 中：
1. 当有 `originalJobIds` 时，为每个 `uniqueOriginalJobId` 注册 dispatcher
2. 当 `isFinalize = true`（手动发送或pause finalize）时，`expectedSegmentCount = 0`
3. `expectedSegmentCount = 0` 表示**立即处理**
4. 但是，代码会为每个batch单独调用ASR，然后立即添加到dispatcher
5. **每个batch添加后都会立即触发处理**，导致每个batch都被单独处理，而不是累积

### 问题流程

```
job0 (isFinalize=true) 
  → 注册dispatcher (expectedSegmentCount=0)
  → batch0 ASR完成 → 添加到dispatcher → 立即处理 → 发送结果 [0]
  → batch1 ASR完成 → 添加到dispatcher → 立即处理 → 发送结果 [1]
  → batch2 ASR完成 → 添加到dispatcher → 立即处理 → 发送结果 [3]
```

**期望流程**：
```
job0 (isFinalize=true)
  → 注册dispatcher (expectedSegmentCount=3) // 等待3个batch
  → batch0 ASR完成 → 添加到dispatcher (1/3)
  → batch1 ASR完成 → 添加到dispatcher (2/3)
  → batch2 ASR完成 → 添加到dispatcher (3/3) → 达到期望数量 → 处理 → 发送结果 [0]
```

---

## 修复方案

### 修复：等待所有batch添加完成

**位置**: `asr-step.ts` 第121-124行

**修改前**:
```typescript
const expectedSegmentCount = isFinalize ? 0 : undefined;
```

**修改后**:
```typescript
// 计算该originalJobId对应的batch数量
const batchCountForThisJob = originalJobIds.filter(id => id === originalJobId).length;
const expectedSegmentCount = isFinalize 
  ? batchCountForThisJob // 等待所有batch添加完成
  : undefined; // 非finalize时累积等待
```

---

## 修复效果

### 修复前

- job0: 3个batch → 3个结果 [0], [1], [3]
- 每个batch都被单独处理，导致文本被拆分

### 修复后

- job0: 3个batch → 1个结果 [0]（完整文本）
- 所有batch累积后统一处理，确保完整文本

---

## 关键修复点

1. ✅ **计算每个originalJobId的batch数量**
   - 使用 `originalJobIds.filter(id => id === originalJobId).length`

2. ✅ **等待所有batch添加完成**
   - `expectedSegmentCount = batchCountForThisJob`（而不是0）

3. ✅ **保持非finalize场景的累积逻辑**
   - `expectedSegmentCount = undefined`（累积等待finalize）

---

## 相关代码

- `asr-step.ts` 第121-140行：注册originalJob时的expectedSegmentCount计算
- `original-job-result-dispatcher.ts` 第231-244行：shouldProcessNow逻辑

---

## 总结

✅ **修复完成**

**核心改进**：
- 独立utterance（手动发送或pause finalize）时，等待所有batch都添加完成后再处理
- 确保每个job的完整文本被统一处理，而不是被拆分成多个片段

**预期效果**：
- ✅ job0包含完整的第一句话
- ✅ job1包含完整的第二句话
- ✅ job6包含完整的第三句话
- ✅ 不再出现文本被拆分的情况
