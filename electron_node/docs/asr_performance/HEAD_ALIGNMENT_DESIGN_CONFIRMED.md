# 头部对齐策略设计确认

**日期**: 2026-01-28  
**状态**: ✅ 当前代码符合用户设计要求

---

## 一、用户设计要求确认

### 1.1 设计原则

**头部对齐策略**：
- **batch属于batch的第一个片段所属的job**
- 如果batch跨越job边界，仍然属于第一个片段所属的job

### 1.2 场景验证

**35秒长语音，被拆成4个job**：
- job0: job0_1(3s) + job0_2(3s) + job0_3(4s) = 10秒
- job1: job1_1(3s) + job1_2(3s) + job1_3(4s) = 10秒
- job2: job2_1(3s) + job2_2(3s) + job2_3(3s) + job2_4(1s) = 10秒
- job3: job3_1(5s) = 5秒

**AudioAggregator按能量切分后，合并成5秒以上的batch**：
- batch1: job0_1 + job0_2 = 6秒 → **job0** ✓（第一个片段job0_1属于job0）
- batch2: job0_3 + job1_1 = 7秒 → **job0** ✓（第一个片段job0_3属于job0）
- batch3: job1_2 + job1_3 = 7秒 → **job1** ✓（第一个片段job1_2属于job1）
- batch4: job2_1 + job2_2 = 6秒 → **job2** ✓（第一个片段job2_1属于job2）
- batch5: job2_3 + job2_4 + job3_1 = 9秒 → **job2** ✓（第一个片段job2_3属于job2）

**结果分配**：
- job0: batch1 + batch2 = ASR文本1 + ASR文本2
- job1: batch3 = ASR文本3
- job2: batch4 + batch5 = ASR文本4 + ASR文本5
- job3: 没有以job3开头的batch，视为合并入job2 ✓

---

## 二、当前代码实现验证

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
- ✅ 每个batch的第一个片段对应的jobInfo被记录到`batchJobInfo`中
- ✅ `originalJobIds`从`batchJobInfo`派生（`audio-aggregator.ts` 第683行）
- ✅ 符合用户设计要求：batch属于batch的第一个片段所属的job

### 2.2 文本合并逻辑

**代码位置**：`original-job-result-dispatcher.ts` 第330-467行

**逻辑**：
- ✅ 按`originalJobId`分组累积ASR结果
- ✅ 按`batchIndex`排序合并文本
- ✅ 确保同一个`originalJobId`的所有batch按顺序合并

**验证**：
- job0会收到batch1和batch2的ASR结果，按batchIndex排序合并
- job1会收到batch3的ASR结果
- job2会收到batch4和batch5的ASR结果，按batchIndex排序合并
- job3没有batch，会被标记为空容器（如果`originalJobInfo`中包含job3）

---

## 三、设计优势

### 3.1 流式处理

**优势**：
- ✅ 每个batch独立处理，不需要等待所有batch完成
- ✅ 同一个job的多个batch按顺序合并，确保文本顺序正确
- ✅ 切片数量不会超过job容器数量，不会产生文本丢失

### 3.2 简单清晰

**优势**：
- ✅ 头部对齐策略简单：batch属于第一个片段所属的job
- ✅ 逻辑清晰，易于理解和维护
- ✅ 不需要复杂的边界判断逻辑

---

## 四、总结

### 4.1 设计确认

- ✅ **头部对齐策略**：batch属于batch的第一个片段所属的job
- ✅ **当前代码实现**：完全符合用户设计要求
- ✅ **场景验证**：所有场景都符合要求

### 4.2 代码状态

- ✅ **audio-aggregator-stream-batcher.ts**：正确实现头部对齐策略
- ✅ **original-job-result-dispatcher.ts**：正确实现文本合并逻辑
- ✅ **asr-step.ts**：正确实现空容器检测逻辑

---

*当前代码完全符合用户的设计要求，无需修改。*
