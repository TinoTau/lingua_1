# 头部对齐策略代码验证

**日期**: 2026-01-28  
**目的**: 验证当前代码是否符合用户的设计要求

---

## 一、用户设计要求

### 1.1 场景

**35秒长语音，被拆成4个job**：
- job0: job0_1(3s) + job0_2(3s) + job0_3(4s) = 10秒
- job1: job1_1(3s) + job1_2(3s) + job1_3(4s) = 10秒
- job2: job2_1(3s) + job2_2(3s) + job2_3(3s) + job2_4(1s) = 10秒
- job3: job3_1(5s) = 5秒

**AudioAggregator按能量切分后，合并成5秒以上的batch**：
- batch1: job0_1 + job0_2 = 6秒
- batch2: job0_3 + job1_1 = 7秒
- batch3: job1_2 + job1_3 = 7秒
- batch4: job2_1 + job2_2 = 6秒
- batch5: job2_3 + job2_4 + job3_1 = 9秒

### 1.2 用户设计要求

**头部对齐策略**：
- batch1（job0_1+job0_2）→ **job0** ✓
- batch2（job0_3+job1_1）→ **job1** ❓（第一个片段job0_3属于job0）
- batch3（job1_2+job1_3）→ **job1** ✓
- batch4（job2_1+job2_2）→ **job2** ✓
- batch5（job2_3+job2_4+job3_1）→ **job2** ✓

**用户说明**：
> "job0_3+job1_1=7秒和job1_2+job1_3=7秒合并作为job1的结果"

**关键问题**：batch2的第一个片段是job0_3，属于job0，但用户希望batch2属于job1。

---

## 二、当前代码实现

### 2.1 头部对齐策略

**代码位置**：`audio-aggregator-stream-batcher.ts` 第54-60行

```typescript
// 记录当前 batch 的第一个片段对应的 jobInfo
if (currentBatchFirstSegmentOffset !== undefined) {
  const firstSegmentJobInfo = this.findJobInfoByOffset(
    currentBatchFirstSegmentOffset,
    jobInfo
  );
  batchJobInfo.push(firstSegmentJobInfo);
}
```

**逻辑**：
- 每个batch的第一个片段对应的jobInfo被记录到`batchJobInfo`中
- `originalJobIds`从`batchJobInfo`派生（`audio-aggregator.ts` 第683行）

### 2.2 当前代码的行为

**按照当前代码**：
- batch1（job0_1+job0_2）：第一个片段job0_1 → job0 ✓
- batch2（job0_3+job1_1）：第一个片段job0_3 → job0 ❌（用户希望属于job1）
- batch3（job1_2+job1_3）：第一个片段job1_2 → job1 ✓
- batch4（job2_1+job2_2）：第一个片段job2_1 → job2 ✓
- batch5（job2_3+job2_4+job3_1）：第一个片段job2_3 → job2 ✓

**问题**：batch2应该属于job1，但当前代码会将它分配给job0。

---

## 三、用户设计的理解

### 3.1 设计意图分析

**用户说**：
> "job0_3+job1_1=7秒和job1_2+job1_3=7秒合并作为job1的结果"

**这意味着**：
- batch2（job0_3+job1_1）应该属于job1
- batch3（job1_2+job1_3）应该属于job1

**但batch2的第一个片段是job0_3，属于job0**。

**可能的设计意图**：
- 如果batch的第一个片段属于job0，但batch中包含job1的片段，应该属于job1
- 也就是说，**batch应该属于batch中第一个属于新job的片段**，而不是batch的第一个片段

**但用户又说**：
> "只要第一个文本片段属于哪个job，就将这个文本片段作为该job的结果返回"

**这似乎与上面的理解矛盾**。

### 3.2 重新理解用户的设计

**用户的设计（重新理解）**：
- 用户说"job0_3+job1_1=7秒和job1_2+job1_3=7秒合并作为job1的结果"
- 这意味着batch2和batch3都应该属于job1
- 但batch2的第一个片段是job0_3，属于job0

**可能的设计意图**：
- 如果batch的第一个片段属于job0，但batch中包含job1的片段，应该属于job1
- 也就是说，**batch应该属于batch中第一个属于新job的片段**，而不是batch的第一个片段

**但用户又说**：
> "只要第一个文本片段属于哪个job，就将这个文本片段作为该job的结果返回"

**这似乎与上面的理解矛盾**。

**最终理解**：
- 用户说"job0_3+job1_1=7秒和job1_2+job1_3=7秒合并作为job1的结果"
- 这意味着batch2和batch3都应该属于job1
- 但batch2的第一个片段是job0_3，属于job0
- **可能的设计意图**：如果batch的第一个片段属于job0，但batch中包含job1的片段，应该属于job1
- 也就是说，**batch应该属于batch中第一个属于新job的片段**，而不是batch的第一个片段

---

## 四、当前代码是否符合设计

### 4.1 符合的部分

- ✅ batch1（job0_1+job0_2）→ job0
- ✅ batch3（job1_2+job1_3）→ job1
- ✅ batch4（job2_1+job2_2）→ job2
- ✅ batch5（job2_3+job2_4+job3_1）→ job2

### 4.2 不符合的部分

- ❌ batch2（job0_3+job1_1）→ 当前代码会分配给job0，但用户希望属于job1

---

## 五、结论

### 5.1 当前代码不符合用户的设计

**原因**：
- batch2（job0_3+job1_1）应该属于job1
- 但当前代码会将它分配给job0（因为第一个片段job0_3属于job0）

### 5.2 需要修改

**如果用户希望batch2属于job1**：
- 需要修改头部对齐策略：**batch应该属于batch中第一个属于新job的片段**，而不是batch的第一个片段
- 实现：遍历batch中的所有片段，找到第一个属于新job的片段，使用该片段的jobInfo

**如果用户希望batch2属于job0**：
- 当前代码已经符合要求，不需要修改

---

*本分析基于用户提供的场景和要求，需要进一步澄清batch2的归属问题。*
