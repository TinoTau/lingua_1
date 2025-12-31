# Utterance 合并的目的和具体流程

## 一、合并的目的

### 1.1 核心问题

在实时语音翻译场景中，ASR 服务会将连续的语音切分成多个独立的 utterance（话语片段）。这些片段可能：

1. **不完整**：一个完整的句子被切分成多个片段
   - 例如："让我们来试一下" + "这个版本的系统测试"
   - 如果分别翻译，可能产生不连贯的翻译结果

2. **过短**：单个片段太短，缺乏上下文
   - 例如："然后"、"所以"、"但是" 等连接词
   - 单独翻译可能不准确

3. **时间间隔短**：片段之间间隔很短，可能是同一句话的不同部分
   - 例如：间隔 < 1000ms 的片段，很可能是同一句话

### 1.2 合并的好处

1. **提高翻译质量**：
   - 将相关的片段合并后，NMT 服务可以获得更完整的上下文
   - 例如："让我们来试一下这个版本的系统测试" 比 "让我们来试一下" + "这个版本的系统测试" 翻译更准确

2. **减少翻译次数**：
   - 合并后的文本只需要翻译一次，而不是每个片段都翻译
   - 降低 NMT 服务负载，提高性能

3. **减少用户干扰**：
   - 避免频繁的翻译结果更新
   - 提供更流畅的用户体验

## 二、合并决策逻辑

### 2.1 决策函数

位置：`electron_node/electron-node/main/src/aggregator/aggregator-decision.ts`

核心函数：`decideStreamAction(prev, curr, mode, tuning)`

返回：`"MERGE"` 或 `"NEW_STREAM"`

### 2.2 决策规则（优先级从高到低）

#### 规则 1：硬规则（强制 NEW_STREAM）

```typescript
// 1. 手动切分：用户点击"发送"按钮
if (curr.isManualCut) return "NEW_STREAM";

// 2. 时间间隔过长：超过硬间隔阈值（offline: 2000ms, room: 1500ms）
if (gapMs >= tuning.hardGapMs) return "NEW_STREAM";
```

#### 规则 2：语言切换检测（强制 NEW_STREAM）

```typescript
// 如果检测到语言切换（例如：中文 → 英文），强制 NEW_STREAM
if (isLangSwitchConfident(prev.lang, curr.lang, gapMs, tuning)) return "NEW_STREAM";
```

条件：
- 时间间隔 > `langSwitchRequiresGapMs` (offline: 600ms, room: 500ms)
- 两个 utterance 的语言置信度都 >= 0.8
- 语言不同，且置信度差异 >= 0.15 (offline) 或 0.18 (room)

#### 规则 3：强合并（强制 MERGE）

```typescript
// 时间间隔很短：<= strongMergeMs (offline: 1000ms, room: 800ms)
if (gapMs <= tuning.strongMergeMs) return "MERGE";
```

#### 规则 4：文本不完整性评分（条件 MERGE）

```typescript
// 计算文本不完整性分数
const score = textIncompletenessScore(prev, curr, gapMs, tuning);

// 如果分数 >= 阈值 (2.5) 且时间间隔 <= softGapMs (offline: 1200ms, room: 1000ms)
if (score >= tuning.scoreThreshold && gapMs <= tuning.softGapMs) return "MERGE";
```

### 2.3 文本不完整性评分

位置：`textIncompletenessScore(prev, curr, gapMs, tuning)`

评分因素：

1. **文本长度**：
   - 非常短（CJK < 4 字，英文 < 3 词）：+3 分
   - 短（CJK < 10 字，英文 < 6 词）：+2 分

2. **时间间隔**：
   - 间隔 < (strongMergeMs + 200ms)：+2 分

3. **标点符号**：
   - 不以强句号结尾（。！？.!?；;）：+1 分

4. **连接词/填充词**：
   - 以连接词结尾（然后、所以、但是、and、but 等）：+1 分

5. **质量分数**：
   - qualityScore < 0.45 (offline) 或 0.5 (room)：+1 分

6. **上下文**：
   - 上一个 utterance 不以强句号结尾，且间隔 <= softGapMs：+1 分

**总分 >= 2.5** 时，触发 MERGE

## 三、合并的具体流程

### 3.1 流程概览

```
ASR 返回文本
    ↓
AggregatorState.processUtterance()
    ↓
decideStreamAction() → 决策：MERGE 或 NEW_STREAM
    ↓
┌─────────────────┬─────────────────┐
│   MERGE         │   NEW_STREAM    │
│   (合并)        │   (新流)        │
└─────────────────┴─────────────────┘
    ↓                    ↓
合并到 pendingText   清空 pendingText
    ↓                    ↓
检查 shouldCommit    开始新的 pendingText
    ↓                    ↓
提交或继续累积       提交或继续累积
```

### 3.2 MERGE 操作详细流程

位置：`electron_node/electron-node/main/src/aggregator/aggregator-state.ts`

#### 步骤 1：去重处理

```typescript
if (action === 'MERGE' && this.lastUtterance) {
  // 1. 如果有 tail buffer，先与 tail 合并
  if (this.tailBuffer) {
    const tailDedup = dedupMergePrecise(this.tailBuffer, text, this.dedupConfig);
    processedText = tailDedup.text;
    // 处理去重结果...
    this.tailBuffer = '';
  } else {
    // 2. 与上一个 utterance 的尾部去重
    const lastText = this.lastUtterance.text;
    const lastTail = extractTail(lastText, this.tailCarryConfig) || lastText.slice(-20);
    const dedupResult = dedupMergePrecise(lastTail, text, this.dedupConfig);
    processedText = dedupResult.text;
    // 处理去重结果...
  }
  
  // 3. 合并到 pending text
  this.pendingText += (this.pendingText ? ' ' : '') + processedText;
  
  // 4. 如果是合并组的第一个 utterance，记录它
  if (isFirstInMergedGroup) {
    this.mergeGroupStartUtterance = curr;
  }
}
```

**去重目的**：避免重复文本（例如："然后然后" → "然后"）

#### 步骤 2：判断是否是合并组中的第一个

```typescript
const isFirstInMergedGroup = action === 'MERGE' && 
                              this.pendingText === '' &&        // 没有待提交的文本
                              this.mergeGroupStartUtterance === null &&  // 没有正在进行的合并组
                              this.lastUtterance !== null;      // 有上一个 utterance
```

**关键点**：
- 如果 `pendingText === ''`，说明之前的合并组已经完成（已提交），当前是新合并组的开始
- 只有合并组中的第一个 utterance 才会返回完整的聚合文本
- 后续被合并的 utterance 返回空文本（避免重复发送）

#### 步骤 3：检查是否需要提交

```typescript
let shouldCommitNow = shouldCommit(
  this.pendingText,
  this.lastCommitTsMs,
  nowMs,
  this.mode,
  this.tuning
) || isFinal || isManualCut;
```

**提交条件**（满足任一即可）：
1. **时间间隔**：距离上次提交 >= `commitIntervalMs` (offline: 1200ms, room: 900ms)
2. **文本长度**：
   - CJK：>= `commitLenCjk` (offline: 30 字, room: 25 字)
   - 英文：>= `commitLenEnWords` (offline: 12 词, room: 10 词)
3. **isFinal**：当前 utterance 是 final 结果
4. **isManualCut**：用户手动切分（点击"发送"）

#### 步骤 4：提交处理

```typescript
if (shouldCommitNow && this.pendingText) {
  if (isFinal || isManualCut) {
    // Final 或手动切分：不保留 tail，全部输出
    commitText = this.pendingText;
    if (this.tailBuffer) {
      commitText = this.tailBuffer + commitText;
      this.tailBuffer = '';
    }
  } else {
    // 非 final：保留 tail（用于下一次合并）
    commitText = removeTail(this.pendingText, this.tailCarryConfig);
    const tail = extractTail(this.pendingText, this.tailCarryConfig);
    if (tail) {
      this.tailBuffer = tail;  // 保存 tail 到 buffer
    }
  }
  
  this.pendingText = '';
  this.lastCommitTsMs = nowMs;
  this.metrics.commitCount++;
  this.lastCommittedText = commitText;
  this.updateRecentCommittedText(commitText);  // 更新最近提交的文本（用于 S1 prompt）
  
  // 清空合并组起始标志
  if (this.mergeGroupStartUtterance && this.mergeGroupStartUtterance === curr) {
    this.mergeGroupStartUtterance = null;
  }
}
```

**Tail Carry 机制**：
- 目的：保留 utterance 的尾部（最后几个字符），用于下一次合并时的去重
- 例如："让我们来试一下" 的 tail 是 "试一下"，下一次 utterance "试一下这个版本" 可以检测到重复

### 3.3 NEW_STREAM 操作详细流程

```typescript
else {
  // NEW_STREAM: 先提交之前的 pending text
  if (this.pendingText) {
    const textToCommit = removeTail(this.pendingText, this.tailCarryConfig);
    const tail = extractTail(this.pendingText, this.tailCarryConfig);
    if (tail) {
      this.tailBuffer = tail;
    }
    this.pendingText = '';
  }
  
  // 开始新的 stream，清空合并组起始标志
  this.mergeGroupStartUtterance = null;
  this.pendingText = processedText;  // 开始新的 pending text
}
```

## 四、合并后的处理

### 4.1 AggregationStage 处理

位置：`electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts`

```typescript
if (aggregatorResult.action === 'MERGE') {
  if (aggregatorResult.isFirstInMergedGroup === true && 
      aggregatorResult.shouldCommit && 
      aggregatorResult.text) {
    // 这是合并组中的第一个 utterance，且触发了提交，返回聚合后的文本
    aggregatedText = aggregatorResult.text;
    isFirstInMergedGroup = true;
  } else {
    // 这不是合并组中的第一个 utterance，返回空文本
    aggregatedText = '';
    isFirstInMergedGroup = false;
  }
} else if (aggregatorResult.shouldCommit && aggregatorResult.text) {
  // NEW_STREAM 且触发了提交：返回聚合后的文本
  aggregatedText = aggregatorResult.text;
} else {
  // NEW_STREAM 但未提交：使用原始文本
  aggregatedText = asrTextTrimmed;
}
```

**关键逻辑**：
- 只有合并组中的第一个 utterance 且触发提交时，才返回完整的聚合文本
- 后续被合并的 utterance 返回空文本（避免重复发送）
- 这样确保每个合并组只发送一次完整的翻译结果

### 4.2 翻译处理

位置：`electron_node/electron-node/main/src/agent/postprocess/translation-stage.ts`

```typescript
// 如果文本被聚合（aggregationChanged === true），需要重新翻译
if (aggregationResult.aggregationChanged) {
  // 使用聚合后的文本重新翻译
  const nmtResult = await this.taskRouter.routeNMTTask({
    text: aggregatedText,
    src_lang: job.src_lang,
    tgt_lang: job.tgt_lang,
    context_text: contextText,
  });
  translatedText = nmtResult.text;
}
```

**目的**：确保翻译的是完整的合并文本，而不是单个片段

### 4.3 去重处理

位置：`electron_node/electron-node/main/src/agent/postprocess/dedup-stage.ts`

```typescript
// 检查是否与最近发送的文本重复
if (isDuplicate(aggregatedText, lastSentText)) {
  return {
    shouldSend: false,
    aggregatedText: '',
    translatedText: '',
    // ...
  };
}
```

**目的**：避免发送重复的翻译结果

## 五、实际示例

### 示例 1：短间隔合并

**场景**：用户快速连续说话

```
Utterance 1: "让我们来试一下" (t=0ms)
Utterance 2: "这个版本的系统测试" (t=500ms)  ← 间隔 500ms < 1000ms (strongMergeMs)
```

**决策**：
- Utterance 2: `action = "MERGE"` (强合并)
- `isFirstInMergedGroup = false` (因为 Utterance 1 已经提交)
- `pendingText = "让我们来试一下 这个版本的系统测试"`
- 如果触发提交：返回完整的合并文本
- 如果未触发提交：Utterance 2 返回空文本，等待后续提交

### 示例 2：文本不完整性合并

**场景**：用户说了一个不完整的句子

```
Utterance 1: "然后" (t=0ms, 2 字, 无标点)
Utterance 2: "我们开始测试" (t=800ms, 6 字, 无标点)
```

**决策**：
- 计算文本不完整性分数：
  - Utterance 1 非常短：+3 分
  - 间隔短：+2 分
  - 无强标点：+1 分
  - 总分：6 分 >= 2.5
- Utterance 2: `action = "MERGE"`
- 合并后：`pendingText = "然后 我们开始测试"`

### 示例 3：语言切换（不合并）

**场景**：用户切换语言

```
Utterance 1: "让我们来试一下" (中文, p1=0.95, t=0ms)
Utterance 2: "Let's test this" (英文, p1=0.92, t=1000ms)
```

**决策**：
- 检测到语言切换（中文 → 英文）
- Utterance 2: `action = "NEW_STREAM"` (强制新流)
- 不合并，分别翻译

## 六、配置参数

### 6.1 时间阈值

| 参数 | Offline 模式 | Room 模式 | 说明 |
|------|-------------|----------|------|
| `strongMergeMs` | 1000ms | 800ms | 强合并阈值（<= 此值强制合并） |
| `softGapMs` | 1200ms | 1000ms | 软间隔阈值（<= 此值可合并） |
| `hardGapMs` | 2000ms | 1500ms | 硬间隔阈值（>= 此值强制新流） |
| `commitIntervalMs` | 1200ms | 900ms | 提交时间间隔 |

### 6.2 文本长度阈值

| 参数 | Offline 模式 | Room 模式 | 说明 |
|------|-------------|----------|------|
| `shortCjkChars` | 10 字 | 9 字 | 短文本阈值（CJK） |
| `veryShortCjkChars` | 4 字 | 4 字 | 非常短文本阈值（CJK） |
| `shortEnWords` | 6 词 | 5 词 | 短文本阈值（英文） |
| `veryShortEnWords` | 3 词 | 3 词 | 非常短文本阈值（英文） |
| `commitLenCjk` | 30 字 | 25 字 | 提交长度阈值（CJK） |
| `commitLenEnWords` | 12 词 | 10 词 | 提交长度阈值（英文） |

### 6.3 评分权重

| 权重 | 值 | 说明 |
|------|-----|------|
| `wVeryShort` | 3 | 非常短文本权重 |
| `wShort` | 2 | 短文本权重 |
| `wGapShort` | 2 | 短间隔权重 |
| `wNoStrongPunct` | 1 | 无强标点权重 |
| `wEndsWithConnective` | 1 | 连接词结尾权重 |
| `wLowQuality` | 1 | 低质量权重 |
| `scoreThreshold` | 2.5 | 合并分数阈值 |

## 七、关键代码位置

1. **决策逻辑**：`electron_node/electron-node/main/src/aggregator/aggregator-decision.ts`
   - `decideStreamAction()` - 决策函数
   - `textIncompletenessScore()` - 文本不完整性评分
   - `shouldCommit()` - 提交判断

2. **状态管理**：`electron_node/electron-node/main/src/aggregator/aggregator-state.ts`
   - `processUtterance()` - 处理 utterance
   - `isFirstInMergedGroup` - 判断是否是合并组中的第一个

3. **聚合阶段**：`electron_node/electron-node/main/src/agent/postprocess/aggregation-stage.ts`
   - `process()` - 聚合处理
   - 决定返回完整文本还是空文本

4. **去重处理**：`electron_node/electron-node/main/src/aggregator/dedup.ts`
   - `dedupMergePrecise()` - 精确去重
   - `extractTail()` / `removeTail()` - Tail Carry 处理

## 八、完整处理流程

### 8.1 整体流程顺序

```
ASR 服务
    ↓
ASR 返回文本（多个独立的 utterance）
    ↓
PostProcessCoordinator.process()
    ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 1: AggregationStage (文本聚合)                   │
│   - 决策：MERGE 或 NEW_STREAM                           │
│   - 合并过程中的去重：与上一个 utterance 的尾部去重     │
│   - 累积到 pendingText                                  │
│   - 返回：aggregatedText（合并后的文本）                │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 2: TranslationStage (翻译)                        │
│   - 输入：aggregatedText（合并后的长文本）              │
│   - 输出：translatedText（翻译结果）                    │
│   - 目的：使用完整上下文增强翻译质量                    │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 3: DedupStage (去重检查)                          │
│   - 检查：是否与最近发送的文本重复                      │
│   - 输出：shouldSend（是否应该发送）                    │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 4: TTSStage (TTS 音频生成)                        │
│   - 输入：translatedText（翻译结果）                    │
│   - 输出：ttsAudio（TTS 音频）                          │
└─────────────────────────────────────────────────────────┘
    ↓
返回最终结果给调度服务器
```

### 8.2 去重的两个阶段

#### 阶段 1：合并过程中的去重（AggregationStage）

位置：`aggregator-state.ts` 第 223-248 行

**目的**：避免相邻 utterance 之间的重复文本

**方法**：
- 与上一个 utterance 的尾部（tail）进行精确去重
- 例如："让我们来试一下" + "试一下这个版本" → "让我们来试一下这个版本"

**时机**：在合并到 `pendingText` 之前

#### 阶段 2：最终去重检查（DedupStage）

位置：`dedup-stage.ts`

**目的**：避免发送与最近发送的文本重复的结果

**方法**：
- 检查合并后的文本和翻译结果是否与最近发送的文本高度相似
- 如果相似度 > 0.9，标记为 `shouldSend: false`

**时机**：在翻译完成后，TTS 生成之前

### 8.3 关键代码位置

```typescript
// postprocess-coordinator.ts 第 160-167 行
if (needsTranslation && this.translationStage) {
  // 重要：翻译时使用合并后的文本（aggregatedText），而不是原始 ASR 文本
  translationResult = await this.translationStage.process(
    job,
    aggregationResult.aggregatedText,  // ← 使用合并后的文本
    result.quality_score,
    aggregationResult.metrics?.dedupCharsRemoved || 0
  );
}
```

## 九、总结

### 9.1 合并的目的

1. **提高翻译质量**：将相关的片段合并，提供更完整的上下文
2. **减少翻译次数**：合并后的文本只需要翻译一次
3. **减少用户干扰**：避免频繁的翻译结果更新
4. **增强纠错能力**：长文本翻译时，NMT 可以利用更完整的上下文进行纠错

### 9.2 合并的时机

- **发生在 ASR 之后**：ASR 返回多个独立的 utterance
- **在翻译之前**：合并后的文本交给 NMT 翻译
- **去重在合并过程中**：与上一个 utterance 的尾部去重，避免重复文本

### 9.3 合并决策基于

- 时间间隔（强合并、软间隔、硬间隔）
- 文本不完整性评分（长度、标点、连接词等）
- 语言稳定性（检测语言切换）

### 9.4 合并流程

1. **决策**：MERGE 或 NEW_STREAM
2. **去重**：与上一个 utterance 的尾部去重（合并过程中的去重）
3. **累积**：合并到 pendingText
4. **提交**：满足条件时提交完整的合并文本
5. **翻译**：使用合并后的长文本进行翻译（增强纠错）
6. **去重检查**：检查是否与最近发送的文本重复（最终去重检查）
7. **TTS**：生成 TTS 音频

### 9.5 关键点

- 只有合并组中的第一个 utterance 且触发提交时，才返回完整的聚合文本
- 后续被合并的 utterance 返回空文本，避免重复发送
- 这样确保每个合并组只发送一次完整的翻译结果
- **翻译使用的是合并后的长文本，而不是单个 utterance 的文本**，这确实可以增强纠错能力

