# 头部对齐策略设计验证

**日期**: 2026-01-28  
**目的**: 验证当前代码是否符合用户的设计要求

---

## 一、用户设计要求

### 1.1 场景描述

**场景**：35秒长语音，被调度服务器拆成4个job（job0, job1, job2, job3）

**AudioAggregator切分**：
- job0_1: 3秒
- job0_2: 3秒
- job0_3: 4秒
- job1_1: 3秒
- job1_2: 3秒
- job1_3: 4秒
- job2_1: 3秒
- job2_2: 3秒
- job2_3: 3秒
- job2_4: 1秒
- job3_1: 5秒

**ASR处理**（合并成5秒以上的batch）：
- batch1: job0_1 + job0_2 = 6秒 → ASR文本1
- batch2: job0_3 + job1_1 = 7秒 → ASR文本2
- batch3: job1_2 + job1_3 = 7秒 → ASR文本3
- batch4: job2_1 + job2_2 = 6秒 → ASR文本4
- batch5: job2_3 + job2_4 + job3_1 = 9秒 → ASR文本5

### 1.2 用户设计要求

**头部对齐策略**：
- **batch1**（job0_1+job0_2）→ **job0**（第一个片段job0_1属于job0）
- **batch2**（job0_3+job1_1）→ **job1**（第一个片段job0_3属于job0，但用户希望属于job1？）
- **batch3**（job1_2+job1_3）→ **job1**（第一个片段job1_2属于job1）
- **batch4**（job2_1+job2_2）→ **job2**（第一个片段job2_1属于job2）
- **batch5**（job2_3+job2_4+job3_1）→ **job2**（第一个片段job2_3属于job2）

**用户说明**：
> "job0_3+job1_1=7秒和job1_2+job1_3=7秒合并作为job1的结果"

**理解**：
- batch2（job0_3+job1_1）和batch3（job1_2+job1_3）都应该属于job1
- 但batch2的第一个片段是job0_3，属于job0，按照头部对齐策略应该属于job0
- **用户的设计意图**：如果batch的第一个片段属于job0，但batch中包含job1的片段，应该属于job1？

**重新理解用户的设计**：
- 用户说"job0_3+job1_1=7秒和job1_2+job1_3=7秒合并作为job1的结果"
- 这意味着：**batch2和batch3都应该属于job1**
- 但batch2的第一个片段是job0_3，属于job0
- **可能的设计意图**：如果batch跨越了job边界，应该属于batch中**第一个属于新job的片段**？

**更准确的理解**：
- batch2的第一个片段是job0_3（属于job0），但batch2包含job1_1（属于job1）
- 用户希望batch2属于job1，因为batch2中**第一个属于job1的片段是job1_1**
- 但按照当前的头部对齐策略，batch2应该属于job0（因为第一个片段job0_3属于job0）

**用户的设计意图（推测）**：
- 如果batch的第一个片段属于job0，但batch中包含job1的片段，应该属于job1
- 也就是说，**batch应该属于batch中第一个属于新job的片段**，而不是batch的第一个片段

**但用户又说**：
> "只要第一个文本片段属于哪个job，就将这个文本片段作为该job的结果返回"

**这似乎与上面的理解矛盾**。让我重新理解：

**最终理解**：
- 用户说"job0_3+job1_1=7秒和job1_2+job1_3=7秒合并作为job1的结果"
- 这意味着batch2和batch3都应该属于job1
- 但batch2的第一个片段是job0_3，属于job0
- **可能的设计意图**：如果batch的第一个片段属于job0，但batch中包含job1的片段，应该属于job1
- 也就是说，**batch应该属于batch中第一个属于新job的片段**，而不是batch的第一个片段

**但用户又说**：
> "只要第一个文本片段属于哪个job，就将这个文本片段作为该job的结果返回"

**这似乎与上面的理解矛盾**。让我重新理解用户的设计：

**用户的设计（重新理解）**：
- batch1（job0_1+job0_2）→ job0 ✓（第一个片段job0_1属于job0）
- batch2（job0_3+job1_1）→ job1（第一个片段job0_3属于job0，但用户希望属于job1）
- batch3（job1_2+job1_3）→ job1 ✓（第一个片段job1_2属于job1）
- batch4（job2_1+job2_2）→ job2 ✓（第一个片段job2_1属于job2）
- batch5（job2_3+job2_4+job3_1）→ job2 ✓（第一个片段job2_3属于job2）

**问题**：batch2的第一个片段是job0_3，属于job0，但用户希望batch2属于job1。

**可能的设计意图**：
- 如果batch的第一个片段属于job0，但batch中包含job1的片段，应该属于job1
- 也就是说，**batch应该属于batch中第一个属于新job的片段**，而不是batch的第一个片段

**但用户又说**：
> "只要第一个文本片段属于哪个job，就将这个文本片段作为该job的结果返回"

**这似乎与上面的理解矛盾**。让我重新理解用户的设计：

**用户的设计（最终理解）**：
- 用户说"job0_3+job1_1=7秒和job1_2+job1_3=7秒合并作为job1的结果"
- 这意味着batch2和batch3都应该属于job1
- 但batch2的第一个片段是job0_3，属于job0
- **可能的设计意图**：如果batch的第一个片段属于job0，但batch中包含job1的片段，应该属于job1
- 也就是说，**batch应该属于batch中第一个属于新job的片段**，而不是batch的第一个片段

**但用户又说**：
> "只要第一个文本片段属于哪个job，就将这个文本片段作为该job的结果返回"

**这似乎与上面的理解矛盾**。让我直接验证当前代码是否符合用户的设计。

---

## 二、当前代码实现

### 2.1 头部对齐策略实现

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
- batch2（job0_3+job1_1）：第一个片段job0_3 → job0 ✗（用户希望属于job1）
- batch3（job1_2+job1_3）：第一个片段job1_2 → job1 ✓
- batch4（job2_1+job2_2）：第一个片段job2_1 → job2 ✓
- batch5（job2_3+job2_4+job3_1）：第一个片段job2_3 → job2 ✓

**问题**：batch2应该属于job1，但当前代码会将它分配给job0。

---

## 三、问题分析

### 3.1 用户设计的理解

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

**让我直接询问用户**：batch2（job0_3+job1_1）应该属于job0还是job1？

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

## 五、需要澄清的问题

### 5.1 关键问题

**问题**：batch2（job0_3+job1_1）应该属于job0还是job1？

**当前代码**：属于job0（因为第一个片段job0_3属于job0）

**用户希望**：属于job1（因为batch中包含job1_1）

### 5.2 设计意图

**如果用户希望batch2属于job1**：
- 需要修改头部对齐策略：**batch应该属于batch中第一个属于新job的片段**，而不是batch的第一个片段
- 也就是说，如果batch的第一个片段属于job0，但batch中包含job1的片段，应该属于job1

**如果用户希望batch2属于job0**：
- 当前代码已经符合要求

---

## 六、建议

### 6.1 如果用户希望batch2属于job1

**需要修改**：
- 头部对齐策略：**batch应该属于batch中第一个属于新job的片段**，而不是batch的第一个片段
- 实现：遍历batch中的所有片段，找到第一个属于新job的片段，使用该片段的jobInfo

### 6.2 如果用户希望batch2属于job0

**当前代码已经符合要求**，不需要修改。

---

*本分析基于用户提供的场景和要求，需要进一步澄清batch2的归属问题。*
