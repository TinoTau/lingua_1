# 重复检测的目的和作用

**日期**: 2025-12-30

---

## 一、重复检测的目的

### 1. **防止重复处理**

重复检测的主要目的是**防止相同的文本被重复处理**，避免：

- **重复的NMT翻译**：如果相同的文本被重复发送给NMT服务，会造成不必要的计算资源浪费
- **重复的TTS语音生成**：如果相同的文本被重复发送给TTS服务，会生成重复的语音，浪费资源
- **重复的UI显示**：如果相同的文本被重复显示在UI上，会影响用户体验

### 2. **处理ASR重复识别**

在某些情况下，ASR可能会重复识别相同的文本：

- **网络重传**：如果网络出现问题，同一个音频可能会被重复发送
- **ASR服务重试**：如果ASR服务出现错误，可能会重试并返回相同的结果
- **音频缓冲问题**：如果音频缓冲出现问题，可能会导致相同的音频被重复处理

### 3. **处理用户重复操作**

用户可能会因为各种原因重复发送相同的utterance：

- **误操作**：用户可能误点击发送按钮多次
- **网络延迟**：用户可能因为网络延迟，以为没有发送成功，再次点击发送
- **UI反馈延迟**：用户可能因为UI反馈延迟，以为没有发送成功，再次点击发送

---

## 二、重复检测的实现

### 1. **检测时机**

重复检测在**提交文本之前**进行：

```typescript
// 在更新 lastCommittedText 之前，先检测重复
if (commitText && commitText.trim().length > 0 && this.lastCommittedText && this.lastCommittedText.trim().length > 0) {
  const normalizeText = (t: string): string => {
    return t.replace(/\s+/g, ' ').trim();
  };
  
  const normalizedCommitText = normalizeText(commitText);
  const normalizedLast = normalizeText(this.lastCommittedText);
  
  if (normalizedCommitText === normalizedLast && normalizedCommitText.length > 0) {
    // 检测到重复，返回空结果
    return { text: '', shouldCommit: false, action: 'MERGE', metrics: {} };
  }
}
```

### 2. **文本标准化**

在比较之前，会对文本进行标准化处理：

- **去除多余空格**：`replace(/\s+/g, ' ')` 将多个连续空格替换为单个空格
- **去除首尾空格**：`trim()` 去除首尾空格

这样可以避免因为空格差异导致的误判。

### 3. **存储上一次提交的文本**

使用 `lastCommittedText` 存储上一次提交的文本：

```typescript
private lastCommittedText: string = '';
```

每次提交新文本时，如果文本不相同，就更新 `lastCommittedText`。

---

## 三、当前实现的问题

### 1. **过于严格**

当前的实现**过于严格**，导致了一些问题：

- **所有utterance都被检测为重复**：从日志看，所有utterance的`commitText`都是相同的，都被检测为重复
- **即使文本相同，也可能是合法的**：用户可能确实想重复发送相同的文本，或者ASR确实识别到了相同的文本

### 2. **没有考虑时间间隔**

当前的实现**没有考虑时间间隔**：

- **短时间内重复**：如果距离上次提交时间很短（如<1秒），可能是重复的utterance，应该过滤
- **长时间后重复**：如果距离上次提交时间较长（如>10秒），即使文本相同，也可能是用户重新发送，应该允许

### 3. **没有考虑合并标识**

当前的实现**没有考虑合并标识**：

- **手动发送**：如果`is_manual_cut`为true，即使文本相同，也应该允许提交（用户明确要求发送）
- **3秒静音触发**：如果`is_pause_triggered`为true，即使文本相同，也应该允许提交（用户确实停止了说话）

---

## 四、建议的改进方案

### 1. **增加时间间隔判断**

```typescript
const TIME_THRESHOLD_MS = 1000; // 1秒
const timeSinceLastCommit = nowMs - this.lastCommitTsMs;

if (normalizedCommitText === normalizedLast && normalizedCommitText.length > 0) {
  // 如果距离上次提交时间很短，可能是重复的utterance
  if (timeSinceLastCommit < TIME_THRESHOLD_MS) {
    // 返回空结果
    return { text: '', shouldCommit: false, action: 'MERGE', metrics: {} };
  }
  // 如果距离上次提交时间较长，即使文本相同，也允许提交
}
```

### 2. **考虑合并标识**

```typescript
if (normalizedCommitText === normalizedLast && normalizedCommitText.length > 0) {
  // 如果收到手动发送/3秒静音标识，即使文本相同，也应该允许提交
  if (isManualCut || isPauseTriggered) {
    // 允许提交
  } else if (timeSinceLastCommit < TIME_THRESHOLD_MS) {
    // 返回空结果
    return { text: '', shouldCommit: false, action: 'MERGE', metrics: {} };
  }
}
```

### 3. **增加相似度判断**

除了完全相同的文本，还可以考虑相似度：

- **高相似度（>95%）**：可能是重复的utterance，应该过滤
- **中等相似度（80%-95%）**：可能是部分重复，需要进一步判断
- **低相似度（<80%）**：可能是不同的utterance，应该允许提交

---

## 五、总结

### 重复检测的作用

1. **防止重复处理**：避免相同的文本被重复发送给NMT/TTS服务
2. **处理ASR重复识别**：处理ASR服务可能重复识别相同文本的情况
3. **处理用户重复操作**：处理用户可能重复发送相同utterance的情况

### 当前实现的问题

1. **过于严格**：所有utterance都被检测为重复
2. **没有考虑时间间隔**：没有区分短时间内重复和长时间后重复
3. **没有考虑合并标识**：没有考虑`is_manual_cut`和`is_pause_triggered`的情况

### 建议的改进

1. **增加时间间隔判断**：区分短时间内重复和长时间后重复
2. **考虑合并标识**：对于`is_manual_cut`或`is_pause_triggered`的情况，即使文本相同，也应该允许提交
3. **增加相似度判断**：除了完全相同的文本，还可以考虑相似度

---

## 六、相关代码位置

- **重复检测逻辑**：`electron_node/electron-node/main/src/aggregator/aggregator-state.ts:403-429`
- **lastCommittedText存储**：`electron_node/electron-node/main/src/aggregator/aggregator-state.ts:74`
- **文本标准化**：`electron_node/electron-node/main/src/aggregator/aggregator-state.ts:406-408`

