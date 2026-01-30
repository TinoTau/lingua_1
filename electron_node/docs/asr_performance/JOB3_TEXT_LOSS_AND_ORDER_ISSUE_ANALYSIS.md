# Job3文本丢失和语序混乱问题分析

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

### 2.1 Job3的batch被错误分配

**关键发现**：
```
jobId: job-168a54c4-0b31-404f-8e60-e50df06c9ff8 (job3)
originalJobIds: ["job-355e0727-1b60-418f-b4ad-929da7be042b", "job-355e0727-1b60-418f-b4ad-929da7be042b"]
```

**问题**：
- job3的两个batch都被分配给了job-355e0727（job1的originalJobId）
- 这导致job3的文本被合并到了job1中

### 2.2 Job1的TextMerge结果

**从日志看到**：
```json
{
  "batchTexts": [
    {"batchIndex": 0, "text": "我会先读一两句比较短的..."},
    {"batchIndex": 0, "text": "系统会不会在句子之间..."},  // ❌ 重复的batchIndex=0
    {"batchIndex": 1, "text": "必要的时候提前结束本次识别"}
  ],
  "mergedText": "我会先读一两句比较短的...用来圈认识 系统会不会在句子之间随意的把云切断或者在没有 必要的时候提前结束本次识别"
}
```

**问题**：
- 有两个batch的batchIndex都是0
- 这导致排序时顺序不确定，文本被错误合并

### 2.3 "接下来这一句"的文本在哪里？

**从日志看到**：
- "接下来这一句"的文本实际上在job-23d468c8（utteranceIndex=3）中
- 这个job的TextMerge显示：
  ```json
  {
    "batchTexts": [
      {"batchIndex": 0, "text": "接下来这一局"},
      {"batchIndex": 0, "text": "评论看看在超过10秒钟之后..."},  // ❌ 重复的batchIndex=0
      {"batchIndex": 1, "text": "我会尽量连续地说的长一些..."}
    ],
    "mergedText": "接下来这一局 评论看看在超过10秒钟之后系统会不会因为超时或者经验判定而强行法 我会尽量连续地说的长一些中间只把刘自然呼吸的节奏不做刻意的"
  }
  ```

**问题**：
- 这个文本和用户说的job3结果一致
- 但batchIndex也有重复（两个batchIndex=0）
- 导致语序混乱

---

## 三、根本原因分析

### 3.1 batchIndex混乱导致语序混乱

**问题**：
- batchIndex重复导致排序时顺序不确定
- 文本被错误合并

**修复**：
- ✅ 已修复：batchIndex由dispatcher自动分配（相对于originalJobId）

### 3.2 batch被错误分配导致文本丢失

**问题**：
- job3的batch被错误地分配给了job1
- 导致job3的文本被合并到了job1中，job3本身没有文本

**根本原因**：
- 头部对齐策略（head alignment）导致batch被分配到错误的originalJobId
- job3合并了pendingMaxDurationAudio，但batch被分配给了job1的originalJobId

**从日志看到**：
```
jobId: job-168a54c4 (job3)
ownerJobId: job-355e0727 (job1)
originalJobIds: ["job-355e0727", "job-355e0727"]  // ❌ 两个batch都被分配给了job1
```

---

## 四、batchIndex混乱能否解释文本丢失？

### 4.1 batchIndex混乱的影响

**能解释**：
- ✅ 语序混乱：batchIndex重复导致排序不确定
- ✅ 文本被错误合并：排序错误导致文本顺序错误

**不能解释**：
- ❌ 文本丢失：batchIndex混乱不会导致文本丢失，只会导致顺序错误
- ❌ batch被错误分配：这是另一个问题

### 4.2 文本丢失的真正原因

**从日志分析**：
1. **batch被错误分配**：
   - job3的batch被分配给了job1
   - 导致job3没有自己的文本，文本被合并到了job1中

2. **batchIndex混乱**：
   - 导致job1的文本顺序错误
   - 但不会导致文本丢失

**结论**：
- **batchIndex混乱可以解释语序混乱，但不能解释文本丢失**
- **文本丢失的真正原因是batch被错误分配**

---

## 五、修复方案

### 5.1 batchIndex混乱（已修复）

**修复**：
- batchIndex由dispatcher自动分配（相对于originalJobId）
- 确保每个batch都有唯一且递增的索引

### 5.2 batch被错误分配（需要进一步分析）

**问题**：
- 头部对齐策略导致batch被分配到错误的originalJobId
- 需要检查头部对齐策略的实现

**可能的原因**：
- job3合并了pendingMaxDurationAudio，但batch分配时使用了错误的jobId
- 需要检查`createStreamingBatchesWithPending`的实现

---

## 六、总结

### 6.1 batchIndex混乱的影响

- ✅ **能解释语序混乱**：batchIndex重复导致排序不确定
- ❌ **不能解释文本丢失**：batchIndex混乱不会导致文本丢失

### 6.2 文本丢失的真正原因

- **batch被错误分配**：job3的batch被分配给了job1
- 导致job3没有自己的文本，文本被合并到了job1中

### 6.3 下一步行动

1. **检查头部对齐策略**：
   - 为什么job3的batch被分配给了job1？
   - 头部对齐策略的实现是否正确？

2. **检查pendingMaxDurationAudio合并**：
   - job3合并了pendingMaxDurationAudio，但batch分配时使用了什么jobId？
   - 是否正确处理了合并后的batch分配？

---

*本分析基于日志数据，需要进一步检查头部对齐策略的实现。*
