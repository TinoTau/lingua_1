# 重复检测逻辑Bug分析

**日期**: 2025-12-30  
**问题**: 所有utterance都被误判为与`lastCommittedText`重复，导致返回空结果，没有语音返回

---

## 问题现象

从集成测试日志可以看到：

1. **所有utterance都被返回为空结果**：
   - `textAsrLength: 0, ttsAudioLength: 0`
   - 没有文本发送给NMT，没有TTS音频生成
   - 用户看不到任何翻译结果和语音

2. **所有utterance都被检测为重复**：
   - `timeSinceLastCommit: 0ms` - 说明在同一个`processUtterance`调用中被检测为重复
   - `commitText`与`lastCommittedText`完全相同

---

## ASR识别内容

从日志中提取的ASR识别结果：

### Utterance 0
- **ASR原始文本**: "现在让我们来测试一下这个版本的系统 还是一样第一句话呢我会手动发送"
- **ASR文本长度**: 33字符
- **聚合后文本**: 相同（33字符，未变化）
- **聚合动作**: `MERGE`

### Utterance 1
- **ASR原始文本**: "好 现在开始第二句话呢我们可能需要一个三秒的停顿来触发自动发送"
- **ASR文本长度**: 31字符
- **聚合后文本**: 相同（31字符，未变化）
- **聚合动作**: `MERGE`

### Utterance 2
- **ASR原始文本**: "发自动发送"
- **ASR文本长度**: 5字符
- **聚合后文本**: 相同（5字符，去重了5个字符）
- **聚合动作**: `MERGE`

### Utterance 3
- **ASR原始文本**: "发自动发送发"
- **ASR文本长度**: 6字符
- **聚合后文本**: 相同（6字符，未变化）
- **聚合动作**: `MERGE`

### Utterance 4
- **ASR原始文本**: "发自动发送"
- **ASR文本长度**: 5字符
- **聚合后文本**: 相同（5字符，未变化）
- **聚合动作**: `MERGE`

### Utterance 5
- **ASR原始文本**: "发自动发送"
- **ASR文本长度**: 5字符
- **聚合后文本**: 相同（5字符，去重了5个字符）
- **聚合动作**: `MERGE`

---

## 合并后的内容

从日志可以看到：

1. **所有utterance的合并前后文本都相同**：
   - `textChanged: false` - 说明聚合没有改变文本
   - `dedupCharsRemoved: 0` 或 `5` - 部分utterance有去重，但最终文本相同

2. **聚合动作都是`MERGE`**：
   - 说明所有utterance都被判断为应该合并
   - 但没有实际合并（因为文本相同）

---

## 聚合模块做了什么导致问题

### 问题根源：重复检测逻辑错误

**错误的执行顺序**（修复前）：

```typescript
// 1. 提取commitText
commitText = this.pendingText;

// 2. 更新lastCommittedText（错误：在检测之前就更新了）
this.lastCommittedText = commitText;

// 3. 检测重复（错误：此时lastCommittedText已经是commitText了）
if (commitText === this.lastCommittedText) {
  return { text: '', shouldCommit: false, ... }; // 总是返回空结果
}
```

**问题分析**：

1. **时序错误**：
   - `lastCommittedText`在检测重复**之前**就被更新为`commitText`
   - 导致检测时`commitText`总是等于`lastCommittedText`
   - `timeSinceLastCommit: 0ms`证明了这一点

2. **所有utterance都被误判为重复**：
   - Utterance 0: 被检测为与`lastCommittedText`重复（但这是第一个utterance！）
   - Utterance 1: 被检测为与`lastCommittedText`重复
   - 所有后续utterance都被误判

3. **结果**：
   - 所有`processUtterance`调用都返回`{ text: '', shouldCommit: false }`
   - `AggregationStage`收到空文本，返回空结果
   - `PostProcessCoordinator`返回空结果
   - 没有文本发送给NMT，没有TTS音频生成

---

## 修复方案

**正确的执行顺序**（修复后）：

```typescript
// 1. 提取commitText
commitText = this.pendingText;

// 2. 在更新lastCommittedText之前，先检测重复（正确）
if (commitText && this.lastCommittedText && 
    normalizeText(commitText) === normalizeText(this.lastCommittedText)) {
  // 如果重复，不更新lastCommittedText，直接返回空结果
  return { text: '', shouldCommit: false, ... };
}

// 3. 只有在不是重复的情况下，才更新lastCommittedText
this.lastCommittedText = commitText;
```

**关键修复点**：

1. ✅ 重复检测移到更新`lastCommittedText`**之前**
2. ✅ 只有在不是重复的情况下才更新`lastCommittedText`
3. ✅ 移除了返回结果之前的重复检测（已在更新前完成）

---

## 修复后的预期行为

1. **第一个utterance**：
   - `lastCommittedText`为空，不会检测为重复
   - 正常处理并更新`lastCommittedText`

2. **后续utterance**：
   - 只有在与`lastCommittedText`完全相同时才被过滤
   - 正常的文本会通过并发送给NMT/TTS

3. **结果**：
   - 用户能看到翻译结果和听到语音
   - 只有真正重复的文本才会被过滤

---

## 相关文件

- `electron_node/electron-node/main/src/aggregator/aggregator-state.ts`
  - `processUtterance`方法：重复检测逻辑修复

