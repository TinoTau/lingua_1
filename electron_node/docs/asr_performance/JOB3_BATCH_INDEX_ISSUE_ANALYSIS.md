# Job3文本不完整和语序混乱问题分析

**日期**: 2026-01-28  
**问题**: Job3文本不完整，且语序混乱

---

## 一、问题现象

**用户返回结果**：
```
[3] 接下来这一局 评论看看在超过10秒钟之后系统会不会因为超时或者经验判定而强行法 我会尽量连续地说的长一些中间只把刘自然呼吸的节奏不做刻意的
```

**预期文本**：
```
接下来这一句我会尽量连续地说得长一些，中间只保留自然的呼吸节奏，不做刻意的停顿，看看在超过十秒钟之后，系统会不会因为超时或者静音判定而强行把这句话截断...
```

**问题**：
1. 文本不完整（缺少后半部分）
2. 语序混乱（"接下来这一局 评论看看在超过10秒钟之后..." 应该在 "我会尽量连续地说的长一些..." 之前）

---

## 二、日志分析结果

### 2.1 TextMerge阶段的batch信息

从日志中看到：
```json
{
  "batchTexts": [
    {"batchIndex": 0, "text": "我会先读一两句比较短的...用来圈认识"},
    {"batchIndex": 0, "text": "系统会不会在句子之间随意的把云切断或者在没有"},
    {"batchIndex": 1, "text": "必要的时候提前结束本次识别"}
  ]
}
```

**关键问题**：
- **有两个batch的batchIndex都是0！**
- 这会导致排序时顺序错误

### 2.2 合并后的文本

```
我会先读一两句比较短的...用来圈认识 系统会不会在句子之间随意的把云切断或者在没有 必要的时候提前结束本次识别
```

**问题**：
- 这个文本是job1的内容，不是job3的内容
- 说明job3的batch被错误地合并到了job1中

---

## 三、根本原因分析

### 3.1 batchIndex设置错误

**当前代码**（`asr-step.ts` 第440行）：
```typescript
const asrData: OriginalJobASRData = {
  originalJobId,
  asrText: asrResult.text || '',
  asrSegments: asrResult.segments || [],
  languageProbabilities: asrResult.language_probabilities,
  batchIndex: i,  // ❌ 问题：使用循环索引i，而不是相对于originalJobId的索引
  missing: false,
};
```

**问题**：
- `batchIndex`使用循环索引`i`（相对于当前job的batch索引）
- 当多个job的batch被分配给同一个`originalJobId`时，batchIndex会重复
- 例如：
  - job1的batch0 -> originalJobId=job1, batchIndex=0
  - job3的batch0 -> originalJobId=job1, batchIndex=0  （错误！应该是1或2）

### 3.2 排序逻辑

**当前代码**（`original-job-result-dispatcher.ts` 第404-408行）：
```typescript
const sortedSegments = [...registration.accumulatedSegments].sort((a, b) => {
  const aIndex = a.batchIndex ?? 0;
  const bIndex = b.batchIndex ?? 0;
  return aIndex - bIndex;
});
```

**问题**：
- 当多个batch的batchIndex相同时，排序结果不确定
- 导致文本顺序错误

---

## 四、修复方案

### 方案1: 使用相对于originalJobId的batchIndex（推荐）

**思路**：
- batchIndex应该是相对于originalJobId的索引，而不是相对于当前job的循环索引
- 需要跟踪每个originalJobId已经接收了多少个batch

**实现**：
```typescript
// 在addASRSegment中，使用已接收的batch数量作为batchIndex
const currentBatchIndex = registration.receivedCount;  // 使用已接收的batch数量

const asrData: OriginalJobASRData = {
  originalJobId,
  asrText: asrResult.text || '',
  asrSegments: asrResult.segments || [],
  languageProbabilities: asrResult.language_probabilities,
  batchIndex: currentBatchIndex,  // ✅ 使用相对于originalJobId的索引
  missing: false,
};
```

**优点**：
- 简单直接
- 不需要修改asr-step.ts
- batchIndex自动递增，不会重复

### 方案2: 在asr-step.ts中计算正确的batchIndex

**思路**：
- 在asr-step.ts中，对于每个originalJobId，跟踪已经分配的batch数量
- 使用这个计数作为batchIndex

**实现**：
```typescript
// 在循环前，为每个originalJobId创建计数器
const batchIndexMap = new Map<string, number>();

for (let i = 0; i < audioSegments.length; i++) {
  // ...
  if (originalJobIds.length > 0 && i < originalJobIds.length) {
    const originalJobId = originalJobIds[i];
    
    // 获取或初始化batchIndex
    const currentBatchIndex = batchIndexMap.get(originalJobId) || 0;
    batchIndexMap.set(originalJobId, currentBatchIndex + 1);
    
    const asrData: OriginalJobASRData = {
      originalJobId,
      asrText: asrResult.text || '',
      asrSegments: asrResult.segments || [],
      languageProbabilities: asrResult.language_probabilities,
      batchIndex: currentBatchIndex,  // ✅ 使用相对于originalJobId的索引
      missing: false,
    };
  }
}
```

**优点**：
- 在asr-step.ts中就能确保batchIndex正确
- 不依赖dispatcher的内部状态

---

## 五、推荐修复方案

**推荐使用方案1**，因为：
1. 更简单：不需要在asr-step.ts中维护额外的状态
2. 更可靠：batchIndex由dispatcher统一管理，不会出错
3. 更符合设计：batchIndex应该是相对于originalJobId的，而不是相对于当前job的

**修复位置**：
- `original-job-result-dispatcher.ts` 的 `addASRSegment` 方法
- 在累积batch之前，使用`receivedCount`作为batchIndex

---

## 六、验证步骤

1. **修复后测试**：
   - 使用相同的测试文本重新测试
   - 查看日志，确认每个batch的batchIndex是否正确递增
   - 确认文本合并顺序是否正确

2. **日志检查**：
   - 查看TextMerge日志中的batchTexts
   - 确认batchIndex是否连续递增（0, 1, 2, ...）
   - 确认文本顺序是否正确

---

*本分析基于日志数据，需要进一步验证修复效果。*
