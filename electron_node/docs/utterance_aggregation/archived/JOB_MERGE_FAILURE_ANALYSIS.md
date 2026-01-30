# Job合并失败原因分析

## ⚠️ 文档状态：已归档

**归档日期**: 2026-01-24  
**归档原因**: 问题已解决（shouldCommit 已移除，矛盾已解决）  
**当前有效文档**: `../SHOULD_WAIT_FOR_MERGE_COMPLETE.md`

---

## 问题描述

用户发现以下job对应该合并但没有合并：
- **Job 1 和 Job 2** 应该合并但没有合并
- **Job 3 和 Job 4** 应该合并但没有合并（注：实际上Job 4已经与Job 3合并了）
- **Job 5 和 Job 6** 应该合并但没有合并

## 聚合决策逻辑回顾

### 决策流程

`decideStreamAction` 函数的决策流程：

1. **如果没有前一个utterance** → `NEW_STREAM`
2. **如果是手动切分（manualCut）** → `NEW_STREAM`
3. **如果间隔 >= hardGapMs（1500ms）** → `NEW_STREAM`
4. **如果检测到语言切换** → `NEW_STREAM`
5. **如果间隔 <= strongMergeMs（800ms）** → `MERGE`（强合并）
6. **如果文本不完整分数 >= 2.5 且间隔 <= softGapMs（1000ms）** → `MERGE`（软合并）
7. **否则** → `NEW_STREAM`

### 关键参数（room/two_way模式）

- `strongMergeMs`: 800ms（强合并阈值）
- `softGapMs`: 1000ms（软合并最大间隔）
- `hardGapMs`: 1500ms（硬间隔，超过则强制NEW_STREAM）
- `scoreThreshold`: 2.5（文本不完整分数阈值）

### 文本不完整分数计算

`textIncompletenessScore` 函数计算分数：

- `veryShort` (< 4字符): +3
- `short` (< 9字符): +2
- `gap < strongMergeMs + 200` (1000ms): +2
- 没有强标点（。！？.!?；;）: +1
- 以连接词结尾: +1
- 质量低 (< 0.5): +1
- 前一个没有强标点且gap <= softGapMs: +1

**总分需要 >= 2.5 才能触发MERGE（在softGapMs内）**

---

## 各Job对的分析

### Job 1 和 Job 2

#### Job 1 信息
- **ASR文本**: "我会先多一两句比较短的话用来确认系统会不会在句子之间随意的把语音切断或者没有"
- **文本长度**: 38字符
- **动作**: `NEW_STREAM`
- **shouldWaitForMerge**: `true`（38字符在6-40字符范围内）

#### Job 2 信息
- **ASR文本**: "必要的时候提前结束本质识别"
- **文本长度**: 13字符
- **动作**: `NEW_STREAM`
- **shouldWaitForMerge**: `false`

#### 为什么没有合并？

**可能原因1：间隔太大（gapMs >= hardGapMs）**

如果Job 1和Job 2之间的时间间隔 >= 1500ms，会强制返回`NEW_STREAM`。

**可能原因2：文本不完整分数不够**

Job 2的文本不完整分数计算：
- 13字符 > 9字符，不是`short` → 不加分
- 13字符 > 4字符，不是`veryShort` → 不加分
- 如果间隔 < 1000ms: +2
- 没有强标点: +1
- 如果前一个（Job 1）没有强标点且gap <= 1000ms: +1

**总分可能只有 2-4分**，如果间隔 > 1000ms，则不会触发MERGE。

**可能原因3：Job 1被提前提交**

如果Job 1被提交（COMMIT），虽然`lastUtterance`仍然保留，但可能因为：
- Job 1的`shouldCommit=true`，导致它被提交
- 提交后，如果间隔时间较长，可能超过`softGapMs`（1000ms）

**可能原因4：Job 1的`shouldWaitForMerge=true`导致状态不一致**

Job 1被标记为`shouldWaitForMerge=true`，说明它应该等待合并。但如果它被提前提交，后续的Job 2就无法与它合并。

---

### Job 3 和 Job 4

#### Job 3 信息
- **ASR文本**: "接下来这一句我会尽量连续的说得长一些中间制保留自然忽悉的节奏不做刻意的挺准看看在"
- **文本长度**: 40字符
- **动作**: `NEW_STREAM`
- **shouldWaitForMerge**: `true`（40字符在20-40字符范围内）

#### Job 4 信息
- **ASR文本**: "超过10秒钟之后系统会不会因为超时或者进行判定而相信把这句话从中间阶段从他导致前半句后半句再接点"
- **文本长度**: 48字符
- **动作**: `MERGE`（已与Job 3合并）
- **isLastInMergedGroup**: `true`

#### 分析

**实际上Job 4已经与Job 3合并了**，所以这个不是问题。

但用户可能期望的是：
- Job 3应该等待Job 4，然后一起提交
- 但实际上Job 3被标记为`shouldWaitForMerge=true`，说明它应该等待，但可能被提前提交了

---

### Job 5 和 Job 6

#### Job 5 信息
- **ASR文本**: "之前被材质的长距能够被完整的试践出来而且不会出现半句话被提前发送或者直接丢起的现象 那就说明我们当前的切分策略"
- **文本长度**: 55字符
- **动作**: `MERGE`
- **isLastInMergedGroup**: `true`

#### Job 6 信息
- **ASR文本**: "和超市规则是几分可用的"
- **文本长度**: 11字符
- **动作**: `NEW_STREAM`
- **shouldWaitForMerge**: `false`

#### 为什么没有合并？

**可能原因1：间隔太大**

如果Job 5和Job 6之间的时间间隔 >= 1500ms，会强制返回`NEW_STREAM`。

**可能原因2：Job 5被提前提交**

Job 5的`isLastInMergedGroup=true`，说明它触发了提交。如果它被提交，后续的Job 6就无法与它合并。

**可能原因3：文本不完整分数不够**

Job 6的文本不完整分数计算：
- 11字符 > 9字符，不是`short` → 不加分
- 11字符 > 4字符，不是`veryShort` → 不加分
- 如果间隔 < 1000ms: +2
- 没有强标点: +1
- 如果前一个（Job 5）没有强标点且gap <= 1000ms: +1

**总分可能只有 2-4分**，如果间隔 > 1000ms，则不会触发MERGE。

---

## 根本原因总结

### 1. 提交时机问题

**问题**：当`shouldCommit=true`时，utterance会被立即提交，即使它应该等待与下一个utterance合并。

**影响**：
- Job 1被提交后，Job 2无法与它合并
- Job 5被提交后，Job 6无法与它合并

**原因**：
- `shouldCommit`的判断基于：
  - 时间间隔（`commitIntervalMs`: 900ms）
  - 文本长度（`commitLenCjk`: 25字符）
- 如果Job 1（38字符）或Job 5（55字符）超过25字符，会立即触发提交

### 2. 间隔时间问题

**问题**：如果两个job之间的时间间隔 > `softGapMs`（1000ms），即使文本不完整分数足够，也不会触发MERGE。

**影响**：
- 如果Job 1和Job 2之间的间隔 > 1000ms，不会触发软合并
- 如果Job 5和Job 6之间的间隔 > 1000ms，不会触发软合并

**原因**：
- 软合并需要同时满足：
  - `score >= 2.5`
  - `gapMs <= softGapMs`（1000ms）

### 3. 文本不完整分数阈值问题

**问题**：对于中等长度的文本（11-13字符），文本不完整分数可能不够高。

**影响**：
- Job 2（13字符）和Job 6（11字符）的分数可能不够高
- 如果间隔 > 1000ms，即使分数足够，也不会触发MERGE

**原因**：
- 11-13字符的文本：
  - 不是`veryShort`（< 4字符）→ 不加3分
  - 不是`short`（< 9字符）→ 不加2分
  - 只能依靠其他因素加分（间隔、标点、连接词等）

### 4. `shouldWaitForMerge`与提交逻辑不一致

**问题**：`shouldWaitForMerge=true`表示应该等待合并，但`shouldCommit=true`会立即提交。

**影响**：
- Job 1的`shouldWaitForMerge=true`，但可能因为长度（38字符 > 25字符）触发提交
- Job 3的`shouldWaitForMerge=true`，但可能因为长度（40字符 > 25字符）触发提交

**原因**：
- `shouldWaitForMerge`是`TextForwardMergeManager`的判断
- `shouldCommit`是`CommitHandler`的判断
- 两者可能不一致

---

## 具体原因推断

### Job 1 和 Job 2 未合并的原因

**最可能的原因**：

1. **Job 1被提前提交**：
   - Job 1长度38字符 > 25字符（`commitLenCjk`）
   - 触发`shouldCommit=true`
   - 被立即提交，`pendingText`被清空
   - 虽然`lastUtterance`仍然保留，但如果间隔时间较长，可能超过`softGapMs`

2. **间隔时间 > 1000ms**：
   - 如果Job 1和Job 2之间的间隔 > 1000ms
   - 即使Job 2的文本不完整分数足够，也不会触发MERGE（因为`gapMs > softGapMs`）

3. **文本不完整分数不够**：
   - Job 2（13字符）的分数可能只有2-4分
   - 如果间隔 > 1000ms，需要间隔 < 1000ms才能加分
   - 如果间隔 > 1000ms，分数可能不够

### Job 5 和 Job 6 未合并的原因

**最可能的原因**：

1. **Job 5被提前提交**：
   - Job 5长度55字符 > 25字符（`commitLenCjk`）
   - 触发`shouldCommit=true`
   - 被立即提交，`pendingText`被清空
   - 虽然`lastUtterance`仍然保留，但如果间隔时间较长，可能超过`softGapMs`

2. **间隔时间 > 1000ms**：
   - 如果Job 5和Job 6之间的间隔 > 1000ms
   - 即使Job 6的文本不完整分数足够，也不会触发MERGE

3. **文本不完整分数不够**：
   - Job 6（11字符）的分数可能只有2-4分
   - 如果间隔 > 1000ms，分数可能不够

---

## 需要验证的信息

要确认具体原因，需要查看日志中的以下信息：

1. **时间间隔（gapMs）**：
   - Job 1和Job 2之间的间隔
   - Job 5和Job 6之间的间隔

2. **提交决策**：
   - Job 1是否被提交（`shouldCommit=true`）
   - Job 5是否被提交（`shouldCommit=true`）

3. **文本不完整分数**：
   - Job 2的`textIncompletenessScore`
   - Job 6的`textIncompletenessScore`

4. **决策日志**：
   - `AggregatorDecision: NEW_STREAM` 或 `AggregatorDecision: MERGE` 的日志
   - 包含`gapMs`、`score`、`reason`等信息

---

## 建议的修复方向

1. **调整提交逻辑**：
   - 如果`shouldWaitForMerge=true`，即使长度超过阈值，也应该等待一段时间再提交
   - 或者，如果`shouldWaitForMerge=true`，不应该立即提交

2. **调整间隔阈值**：
   - 提高`softGapMs`（1000ms）或`hardGapMs`（1500ms）
   - 让更多间隔较长的utterance能够合并

3. **调整文本不完整分数阈值**：
   - 降低`scoreThreshold`（2.5）
   - 或者，为中等长度文本（10-15字符）增加额外的分数

4. **统一`shouldWaitForMerge`和`shouldCommit`逻辑**：
   - 如果`shouldWaitForMerge=true`，不应该立即触发`shouldCommit=true`
   - 或者，在`shouldCommit`判断中考虑`shouldWaitForMerge`状态

---

**文档结束**
