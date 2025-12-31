# 超时音频切割实现方案

**日期**: 2025-12-30  
**状态**: ✅ **已实现并测试通过**  
**注意**: 详细机制说明请参见 `TIMEOUT_AUDIO_SPLITTING_MECHANISM.md`

---

## 一、需求分析

### 业务背景

从用户行为来说，不太会有持续20秒的长篇大论或者复杂句式。所以20秒强制截断（MaxDuration）应该：
1. 作为一个打包发送的流程
2. 节点端对超时标签进行特殊处理：音频切割
3. 找到最长停顿作为分句凭据（考虑用户语速不同）
4. 前半句立即ASR识别，后半句保留在缓冲区等待合并

### 用户需求

1. **调度服务器端**：
   - MaxDuration finalize时设置`is_timeout_triggered = true`
   - 这只是一个打包发送的流程

2. **节点端处理**：
   - 检测到`is_timeout_triggered`时，对音频进行切割
   - 找到停顿最久的一次作为分句凭据
   - 前半句：立即ASR识别，使用当前utterance_id
   - 后半句：保留在缓冲区，等待与后续utterance合并

3. **后续处理**：
   - 后续utterance（手动发送、3秒静音、20秒超时）都会与缓冲区中的后半句合并
   - 合并后再进行ASR识别
   - 如果后续utterance也有超时标识，仍然需要切割

---

## 二、实现方案

### 1. 调度服务器端修改 ✅

**文件**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

**修改内容**：
```rust
// 第672行：MaxDuration和Timeout都设置为is_timeout_triggered=true
let is_timeout_triggered = reason == "Timeout" || reason == "MaxDuration";
```

**说明**：
- MaxDuration（20秒超时）和Timeout都设置为`is_timeout_triggered = true`
- 这样节点端可以统一处理超时情况

---

### 2. 节点端音频切割实现 ✅

**文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts`

#### 2.1 音频切割逻辑

**方法**: `findLongestPauseAndSplit()`

**算法**：
1. 将音频分成100ms的窗口
2. 计算每个窗口的RMS值（均方根）
3. 找到RMS值低于阈值的连续段（静音段）
4. 找到最长的静音段
5. 在最长静音段的结束位置分割

**参数**：
- `WINDOW_SIZE_MS = 100ms`：分析窗口大小
- `SILENCE_THRESHOLD = 500`：静音阈值（RMS值，可调整）
- `MIN_PAUSE_MS = 200ms`：最小停顿时长

**代码**：
```typescript
private findLongestPauseAndSplit(audio: Buffer): {
  splitPosition: number;
  longestPauseMs: number;
} | null {
  // 1. 计算每个窗口的RMS值
  // 2. 找到静音段（RMS值低于阈值的连续窗口）
  // 3. 找到最长的静音段
  // 4. 在最长静音段的结束位置分割
}
```

#### 2.2 超时处理逻辑

**流程**：
```
接收utterance（is_timeout_triggered=true）
  ↓
如果有pendingSecondHalf，先合并
  ↓
聚合所有音频块
  ↓
找到最长停顿并分割
  ↓
前半句：立即ASR识别（使用当前utterance_id）
  ↓
后半句：保留在缓冲区（pendingSecondHalf）
```

**代码**：
```typescript
if (isTimeoutTriggered) {
  // 聚合所有音频块（包括pendingSecondHalf，如果有）
  const aggregatedAudio = this.aggregateAudioChunks(buffer.audioChunks);
  
  // 找到最长停顿并分割
  const splitResult = this.findLongestPauseAndSplit(aggregatedAudio);
  
  if (splitResult) {
    const firstHalf = aggregatedAudio.slice(0, splitResult.splitPosition);
    const secondHalf = aggregatedAudio.slice(splitResult.splitPosition);
    
    // 保留后半句在缓冲区
    buffer.pendingSecondHalf = secondHalf;
    buffer.audioChunks = [];
    buffer.totalDurationMs = 0;
    
    // 返回前半句，立即进行ASR识别
    return firstHalf;
  }
}
```

#### 2.3 后续utterance合并逻辑

**流程**：
```
接收后续utterance
  ↓
检查是否有pendingSecondHalf
  ↓
如果有，先与当前音频合并
  ↓
然后根据标识处理（手动发送、3秒静音、20秒超时）
  ↓
如果也有超时标识，再次切割
```

**代码**：
```typescript
// 如果有保留的后半句，先与当前音频合并
if (buffer.pendingSecondHalf) {
  const mergedAudio = Buffer.alloc(
    buffer.pendingSecondHalf.length + currentAudio.length
  );
  buffer.pendingSecondHalf.copy(mergedAudio, 0);
  currentAudio.copy(mergedAudio, buffer.pendingSecondHalf.length);
  currentAudio = mergedAudio;
  buffer.pendingSecondHalf = undefined;
}
```

---

## 三、工作流程示例

### 场景1：单个超时utterance

```
时间轴：
T1: 调度服务器MaxDuration finalize → JobAssign1 (utterance1音频, is_timeout_triggered=true)
  ↓
节点端AudioAggregator：
  接收JobAssign1
  ↓
  检测到is_timeout_triggered=true
  ↓
  找到最长停顿（比如在8秒处）
  ↓
  前半句（0-8秒）：立即ASR识别，utterance_id=1
  ↓
  后半句（8-20秒）：保留在缓冲区（pendingSecondHalf）
```

### 场景2：超时utterance + 后续utterance（手动发送）

```
时间轴：
T1: 调度服务器MaxDuration finalize → JobAssign1 (utterance1音频, is_timeout_triggered=true)
  ↓
节点端AudioAggregator：
  前半句（0-8秒）：立即ASR识别，utterance_id=1
  后半句（8-20秒）：保留在缓冲区
  ↓
T2: 调度服务器IsFinal finalize → JobAssign2 (utterance2音频, is_manual_cut=true)
  ↓
节点端AudioAggregator：
  接收JobAssign2
  ↓
  检测到pendingSecondHalf，先合并（后半句 + utterance2）
  ↓
  检测到is_manual_cut=true，立即处理
  ↓
  聚合后的音频：立即ASR识别，utterance_id=2
```

### 场景3：超时utterance + 后续utterance（也是超时）

```
时间轴：
T1: 调度服务器MaxDuration finalize → JobAssign1 (utterance1音频, is_timeout_triggered=true)
  ↓
节点端AudioAggregator：
  前半句（0-8秒）：立即ASR识别，utterance_id=1
  后半句（8-20秒）：保留在缓冲区
  ↓
T2: 调度服务器MaxDuration finalize → JobAssign2 (utterance2音频, is_timeout_triggered=true)
  ↓
节点端AudioAggregator：
  接收JobAssign2
  ↓
  检测到pendingSecondHalf，先合并（后半句 + utterance2）
  ↓
  检测到is_timeout_triggered=true，再次切割
  ↓
  找到最长停顿（比如在合并后的12秒处）
  ↓
  前半句（0-12秒）：立即ASR识别，utterance_id=2
  ↓
  后半句（12-20秒）：保留在缓冲区（pendingSecondHalf）
```

---

## 四、关键实现细节

### 1. RMS值计算

**方法**: `calculateRMS()`

**算法**：
```typescript
private calculateRMS(audio: Buffer): number {
  let sumSquares = 0;
  const sampleCount = audio.length / this.BYTES_PER_SAMPLE;
  
  for (let i = 0; i < audio.length; i += this.BYTES_PER_SAMPLE) {
    const sample = audio.readInt16LE(i);
    const normalized = sample / 32768.0;
    sumSquares += normalized * normalized;
  }
  
  return Math.sqrt(sumSquares / sampleCount) * 32768;
}
```

### 2. 静音段检测

**逻辑**：
- 将音频分成100ms的窗口
- 计算每个窗口的RMS值
- 找到RMS值低于阈值（500）的连续窗口
- 过滤掉小于200ms的静音段

### 3. 最长停顿选择

**逻辑**：
- 找到所有符合条件的静音段
- 选择时长最长的静音段
- 在最长静音段的结束位置分割

**优势**：
- 考虑用户语速不同
- 以停顿最久的一次作为分割依据最可靠
- 在自然停顿处分割，避免在句子中间截断

---

## 五、优势

### 1. 提高ASR识别准确率

- ✅ 在自然停顿处分割，避免在句子中间截断
- ✅ 前半句是完整的句子，ASR识别更准确
- ✅ 后半句与后续utterance合并，形成完整句子

### 2. 用户体验更好

- ✅ 即使20秒超时，也会在自然停顿处分割
- ✅ 不会在句子中间强制截断
- ✅ 后续utterance会自动与后半句合并

### 3. 处理逻辑清晰

- ✅ 超时标识统一处理
- ✅ 切割逻辑可复用
- ✅ 后续utterance自动合并

---

## 六、注意事项

### 1. 参数调整

- `SILENCE_THRESHOLD = 500`：可能需要根据实际音频质量调整
- `MIN_PAUSE_MS = 200ms`：最小停顿时长，可能需要调整
- `WINDOW_SIZE_MS = 100ms`：分析窗口大小，可能需要调整

### 2. 边界情况

- **找不到静音段**：直接返回完整音频，不分割
- **音频太短**：无法分割，直接返回
- **所有窗口都是静音**：选择中间位置分割

### 3. 性能考虑

- RMS值计算需要遍历整个音频，可能影响性能
- 对于长音频（20秒），计算时间可能较长
- 可以考虑优化：只分析中间部分，或使用更高效的算法

---

## 七、相关文件

- `central_server/scheduler/src/websocket/session_actor/actor.rs` - 调度服务器finalize逻辑
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts` - 音频聚合和切割逻辑
- `electron_node/electron-node/main/src/pipeline-orchestrator/pipeline-orchestrator.ts` - 集成音频聚合器

---

## 八、测试建议

### 测试场景

1. **单个超时utterance**：
   - 验证是否能找到最长停顿
   - 验证前半句是否正确
   - 验证后半句是否保留在缓冲区

2. **超时utterance + 手动发送**：
   - 验证后半句是否与后续utterance合并
   - 验证合并后的音频是否正确

3. **超时utterance + 超时utterance**：
   - 验证是否能再次切割
   - 验证前半句和后半句是否正确

4. **找不到静音段**：
   - 验证是否直接返回完整音频
   - 验证不会出错

---

## 九、后续优化

1. **参数自适应**：
   - 根据音频质量动态调整静音阈值
   - 根据用户语速动态调整最小停顿时长

2. **性能优化**：
   - 使用更高效的静音检测算法
   - 只分析音频的关键部分

3. **错误处理**：
   - 增强边界情况处理
   - 添加更详细的日志

