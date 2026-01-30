# AudioAggregator 和 AggregatorMiddleware 连续性判断对比

**日期**: 2026-01-24  
**问题**: AudioAggregator 和 AggregatorMiddleware 分别使用什么进行连续性判断？

---

## 一、关键发现

### 1.1 AudioAggregator 使用 `utteranceIndexDiff`

**AudioAggregator** 使用 `utteranceIndexDiff` 来判断是否合并音频：

**代码位置**（`audio-aggregator-finalize-handler.ts:165`）：
```typescript
const utteranceIndexDiff = job.utterance_index - pendingUtteranceIndex;

if (utteranceIndexDiff > 2) {
  // 跳跃太大，不合并
  return { shouldMerge: false };
}

if (utteranceIndexDiff === 0) {
  // 相同 utterance_index，不合并
  return { shouldMerge: false };
}

// utteranceIndexDiff === 1 或 2，允许合并
```

**使用场景**：
- ✅ 合并 `pendingTimeoutAudio`（超时 finalize 的音频）
- ✅ 合并 `pendingMaxDurationAudio`（MaxDuration finalize 的音频）

**判断逻辑**：
- `utteranceIndexDiff === 1` 或 `2`：允许合并（连续）
- `utteranceIndexDiff > 2`：不合并（跳跃太大）
- `utteranceIndexDiff === 0`：不合并（重复 job）

### 1.2 AggregatorMiddleware 使用 `gapMs`

**AggregatorMiddleware** 使用 `gapMs`（时间间隔）来判断是否合并文本：

**代码位置**（`aggregator-decision.ts:117`）：
```typescript
const gapMs = Math.max(0, curr.startMs - prev.endMs);

if (gapMs >= tuning.hardGapMs) {
  // 时间间隔太长，不合并
  return 'NEW_STREAM';
}

if (gapMs <= tuning.strongMergeMs) {
  // 时间间隔很短，强制合并
  return 'MERGE';
}

// 根据文本完整性、语言稳定性等判断
```

**使用场景**：
- ✅ 合并 ASR 文本（基于时间间隔、文本完整性、语言稳定性）

**判断逻辑**：
- `gapMs <= strongMergeMs`（700-1000ms）：强制合并
- `gapMs >= hardGapMs`（1500-2000ms）：强制不合并
- `gapMs` 在中间范围：根据文本完整性、语言稳定性等判断

---

## 二、为什么使用不同的判断方式？

### 2.1 AudioAggregator 使用 `utteranceIndexDiff` 的原因

**原因**：
1. ✅ **音频合并发生在 ASR 之前**，此时还没有时间戳信息
2. ✅ `utterance_index` 是调度器分配的，是**顺序递增**的
3. ✅ `utteranceIndexDiff === 1` 表示连续的 utterance，应该合并
4. ✅ `utteranceIndexDiff > 2` 表示中间有其他独立 utterance，不应该合并

**优势**：
- ✅ 不依赖时间戳，更可靠
- ✅ 基于调度器的 utterance_index，逻辑简单

### 2.2 AggregatorMiddleware 使用 `gapMs` 的原因

**原因**：
1. ✅ **文本合并发生在 ASR 之后**，此时有完整的时间戳信息
2. ✅ `gapMs` 表示两个 utterance 之间的**实际时间间隔**
3. ✅ 时间间隔短（< 1000ms）表示连续说话，应该合并
4. ✅ 时间间隔长（> 2000ms）表示停顿，不应该合并

**优势**：
- ✅ 基于实际时间间隔，更准确
- ✅ 可以处理网络延迟、处理时间等影响

---

## 三、两者的关系

### 3.1 处理顺序

```
客户端发送音频
    ↓
AudioAggregator（使用 utteranceIndexDiff 合并音频）
    ↓
ASR 识别（返回文本和时间戳）
    ↓
AggregatorMiddleware（使用 gapMs 合并文本）
    ↓
NMT 翻译
```

### 3.2 互补关系

**AudioAggregator**：
- ✅ 在 ASR 之前合并音频，确保 ASR 收到完整音频
- ✅ 使用 `utteranceIndexDiff` 判断连续性（基于调度器的 utterance_index）

**AggregatorMiddleware**：
- ✅ 在 ASR 之后合并文本，确保文本完整
- ✅ 使用 `gapMs` 判断连续性（基于实际时间间隔）

**两者互补**：
- ✅ AudioAggregator 确保音频完整（ASR 输入）
- ✅ AggregatorMiddleware 确保文本完整（NMT 输入）

---

## 四、总结

### 4.1 AudioAggregator

**使用**：`utteranceIndexDiff`（utterance_index 差值）

**判断逻辑**：
- `utteranceIndexDiff === 1` 或 `2`：允许合并
- `utteranceIndexDiff > 2`：不合并
- `utteranceIndexDiff === 0`：不合并

**原因**：
- 音频合并发生在 ASR 之前，没有时间戳信息
- 基于调度器的 utterance_index，逻辑简单可靠

### 4.2 AggregatorMiddleware

**使用**：`gapMs`（时间间隔，毫秒）

**判断逻辑**：
- `gapMs <= strongMergeMs`（700-1000ms）：强制合并
- `gapMs >= hardGapMs`（1500-2000ms）：强制不合并
- 中间范围：根据文本完整性、语言稳定性等判断

**原因**：
- 文本合并发生在 ASR 之后，有完整的时间戳信息
- 基于实际时间间隔，更准确

### 4.3 两者关系

**互补关系**：
- ✅ AudioAggregator 确保音频完整（ASR 输入）
- ✅ AggregatorMiddleware 确保文本完整（NMT 输入）

**处理顺序**：
1. AudioAggregator（使用 `utteranceIndexDiff` 合并音频）
2. ASR 识别（返回文本和时间戳）
3. AggregatorMiddleware（使用 `gapMs` 合并文本）

---

## 五、结论

**AudioAggregator** 使用 `utteranceIndexDiff` 进行连续性判断（用于合并音频）

**AggregatorMiddleware** 使用 `gapMs` 进行连续性判断（用于合并文本）

两者使用不同的判断方式，因为：
1. ✅ 处理阶段不同（ASR 之前 vs ASR 之后）
2. ✅ 可用信息不同（utterance_index vs 时间戳）
3. ✅ 判断目标不同（音频连续性 vs 文本连续性）

---

**文档版本**: v1.0  
**最后更新**: 2026-01-24  
**状态**: 归档文档（历史记录）
