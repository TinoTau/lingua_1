# 超时音频切割机制文档

**日期**: 2025-12-30  
**版本**: 1.1  
**状态**: ✅ **已实现并测试通过**  
**优化补充**: 参见 [超时音频切割机制优化补充](./TIMEOUT_AUDIO_SPLITTING_OPTIMIZATION.md)

---

## 一、概述

### 1.1 背景

从用户行为来说，不太会有持续20秒的长篇大论或者复杂句式。当调度服务器因为20秒超时（MaxDuration）强制截断音频时，如果直接在句子中间截断，会导致ASR识别准确率下降。

### 1.2 解决方案

实现**超时音频切割机制**，在节点端对带有超时标识的音频进行智能切割：
- 找到音频中最长的停顿（静音段）
- 在最长停顿处分割音频
- 前半句立即进行ASR识别
- 后半句保留在缓冲区，等待与后续utterance合并

### 1.3 优势

1. **提高ASR识别准确率**：在自然停顿处分割，避免在句子中间截断
2. **改善用户体验**：即使20秒超时，也会在自然停顿处分割
3. **自动合并**：后续utterance自动与保留的后半句合并，形成完整句子

---

## 二、架构设计

### 2.1 整体流程

```
调度服务器（MaxDuration finalize）
  ↓
设置 is_timeout_triggered = true
  ↓
节点端 AudioAggregator
  ↓
检测到 is_timeout_triggered = true
  ↓
找到最长停顿并分割
  ↓
前半句：立即ASR识别（使用当前utterance_id）
  ↓
后半句：保留在缓冲区（pendingSecondHalf）
  ↓
后续utterance到达
  ↓
自动与保留的后半句合并
  ↓
根据标识处理（手动发送/3秒静音/20秒超时）
```

### 2.2 组件说明

#### 2.2.1 调度服务器（Scheduler）

**文件**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

**职责**:
- 检测MaxDuration（20秒超时）
- 设置`is_timeout_triggered = true`标识
- 创建JobAssignMessage并发送到节点端

**关键代码**:
```rust
// MaxDuration和Timeout都设置为is_timeout_triggered=true
let is_timeout_triggered = reason == "Timeout" || reason == "MaxDuration";
```

#### 2.2.2 节点端 AudioAggregator

**文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts`

**职责**:
- 接收JobAssignMessage
- 检测`is_timeout_triggered`标识
- 执行音频切割逻辑
- 管理缓冲区（包括pendingSecondHalf）

**关键方法**:
- `processAudioChunk()`: 处理音频块，根据标识决定是否聚合或切割
- `findLongestPauseAndSplit()`: 找到最长停顿并分割音频
- `calculateRMS()`: 计算音频的RMS值（用于静音检测）

---

## 三、核心算法

### 3.1 音频切割算法

#### 3.1.1 算法流程

```
1. 将音频分成100ms的窗口
2. 计算每个窗口的RMS值（均方根）
3. 找到RMS值低于阈值（500）的连续段（静音段）
4. 过滤掉小于200ms的静音段
5. 找到最长的静音段
6. 在最长静音段的结束位置分割
```

#### 3.1.2 参数配置

| 参数 | 值 | 说明 |
|------|-----|------|
| `WINDOW_SIZE_MS` | 100ms | 分析窗口大小 |
| `SILENCE_THRESHOLD` | 500 | 静音阈值（RMS值） |
| `MIN_PAUSE_MS` | 200ms | 最小停顿时长 |

#### 3.1.3 RMS值计算

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

### 3.2 最长停顿检测

#### 3.2.1 静音段检测

1. **窗口分析**：将音频分成100ms的窗口
2. **RMS计算**：计算每个窗口的RMS值
3. **静音识别**：RMS值低于阈值（500）的窗口视为静音
4. **连续段合并**：连续的静音窗口合并为一个静音段
5. **最小长度过滤**：过滤掉小于200ms的静音段

#### 3.2.2 最长停顿选择

- 从所有符合条件的静音段中选择时长最长的
- 在最长静音段的结束位置分割
- 如果找不到静音段，返回完整音频（不分割）

---

## 四、处理流程

### 4.1 超时utterance处理

#### 场景1：单个超时utterance

```
T1: JobAssign1 (utterance1音频, is_timeout_triggered=true)
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

#### 场景2：超时utterance + 手动发送

```
T1: JobAssign1 (utterance1, is_timeout_triggered=true)
  ↓
节点端：找到最长停顿（8秒处）
  ↓
前半句（0-8秒）：ASR识别，utterance_id=1
后半句（8-20秒）：保留在缓冲区
  ↓
T2: JobAssign2 (utterance2, is_manual_cut=true)
  ↓
节点端：合并（后半句 + utterance2）
  ↓
检测到is_manual_cut=true，立即处理
  ↓
聚合后的音频：ASR识别，utterance_id=2
```

#### 场景3：超时utterance + 超时utterance

```
T1: JobAssign1 (utterance1, is_timeout_triggered=true)
  ↓
节点端：找到最长停顿（8秒处）
  ↓
前半句（0-8秒）：ASR识别，utterance_id=1
后半句（8-20秒）：保留在缓冲区
  ↓
T2: JobAssign2 (utterance2, is_timeout_triggered=true)
  ↓
节点端：合并（后半句 + utterance2）
  ↓
检测到is_timeout_triggered=true，再次切割
  ↓
找到最长停顿（合并后的12秒处）
  ↓
前半句（0-12秒）：ASR识别，utterance_id=2
后半句（12-20秒）：保留在缓冲区
```

### 4.2 标识处理优先级

| 标识 | 优先级 | 处理方式 |
|------|--------|----------|
| `is_manual_cut` | 最高 | 立即处理（不切割） |
| `is_pause_triggered` | 高 | 立即处理（不切割） |
| `is_timeout_triggered` | 中 | 切割处理（找到最长停顿） |
| `MAX_BUFFER_DURATION_MS` | 低 | 自动处理（不切割） |

---

## 五、实现细节

### 5.1 数据结构

#### AudioBuffer接口

```typescript
interface AudioBuffer {
  audioChunks: Buffer[];           // 音频块列表
  totalDurationMs: number;         // 总时长（毫秒）
  startTimeMs: number;             // 开始时间
  lastChunkTimeMs: number;          // 最后一块的时间
  isManualCut: boolean;            // 手动截断标识
  isPauseTriggered: boolean;        // 3秒静音标识
  isTimeoutTriggered: boolean;      // 超时标识
  sessionId: string;               // 会话ID
  utteranceIndex: number;          // Utterance索引
  pendingSecondHalf?: Buffer;      // 保留的后半句（用于超时切割）
}
```

### 5.2 关键方法

#### processAudioChunk()

**功能**: 处理音频块，根据标识决定是否聚合或切割

**流程**:
1. 解码音频（Opus → PCM16）
2. 检查是否有pendingSecondHalf，如果有则先合并
3. 更新缓冲区
4. 根据标识决定处理方式：
   - `is_timeout_triggered`: 切割处理
   - `is_manual_cut` / `is_pause_triggered`: 立即处理
   - 超过MAX_BUFFER_DURATION_MS: 自动处理
   - 否则: 继续缓冲

#### findLongestPauseAndSplit()

**功能**: 找到最长停顿并分割音频

**返回值**:
```typescript
{
  splitPosition: number;      // 分割位置（字节）
  longestPauseMs: number;     // 最长停顿时长（毫秒）
} | null
```

**边界情况**:
- 音频太短（< 200ms窗口）：返回null
- 找不到静音段：返回null
- 找到静音段：返回分割位置和停顿时长

### 5.3 缓冲区管理

#### pendingSecondHalf

**用途**: 存储超时切割后的后半句音频

**生命周期**:
1. 创建：超时切割时，后半句存储在`buffer.pendingSecondHalf`
2. 合并：后续utterance到达时，自动与pendingSecondHalf合并
3. 清空：合并后或处理完成后清空

**注意事项**:
- 不清空整个缓冲区，只保留pendingSecondHalf
- 后续utterance到达时，先合并再处理

---

## 六、配置参数

### 6.1 音频聚合参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MAX_BUFFER_DURATION_MS` | 20000ms (20秒) | 最大缓冲时长 |
| `SAMPLE_RATE` | 16000Hz | 采样率 |
| `BYTES_PER_SAMPLE` | 2 | PCM16字节数 |

### 6.2 音频切割参数

| 参数 | 默认值 | 说明 | 可调整性 |
|------|--------|------|----------|
| `WINDOW_SIZE_MS` | 100ms | 分析窗口大小 | 可调整 |
| `SILENCE_THRESHOLD` | 500 | 静音阈值（RMS值） | **可调整** |
| `MIN_PAUSE_MS` | 200ms | 最小停顿时长 | 可调整 |

### 6.3 参数调优建议

#### SILENCE_THRESHOLD（静音阈值）

- **当前值**: 500
- **调整范围**: 300-1000
- **调优方向**:
  - 如果误判静音（将语音识别为静音）：**降低**阈值（如300-400）
  - 如果漏判静音（将静音识别为语音）：**提高**阈值（如600-800）

#### MIN_PAUSE_MS（最小停顿时长）

- **当前值**: 200ms
- **调整范围**: 100-500ms
- **调优方向**:
  - 如果分割太频繁：**提高**最小停顿时长（如300-500ms）
  - 如果漏掉短停顿：**降低**最小停顿时长（如100-150ms）

---

## 七、测试验证

### 7.1 单元测试

**测试文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.test.ts`

**测试覆盖**:
- ✅ 基本功能（缓冲、标识处理）
- ✅ 超时标识处理（音频切割）
- ✅ 后续utterance合并
- ✅ 多会话隔离
- ✅ 边界情况

**测试结果**: 13个测试用例全部通过 ✅

**详细报告**: 参见 `AUDIO_AGGREGATOR_TEST_REPORT.md`

### 7.2 集成测试建议

建议进行以下集成测试：

1. **实际音频测试**
   - 使用真实录音测试切割准确性
   - 验证不同语速下的切割效果
   - 验证不同环境噪音下的静音检测

2. **端到端测试**
   - 验证与调度服务器的交互
   - 验证与ASR服务的集成
   - 验证完整流程（切割 → ASR → NMT → TTS）

3. **性能测试**
   - 长音频（20秒+）的处理时间
   - RMS值计算的性能
   - 内存使用情况

---

## 八、使用示例

### 8.1 基本使用

```typescript
import { AudioAggregator } from './audio-aggregator';
import { JobAssignMessage } from '@shared/protocols/messages';

const aggregator = new AudioAggregator();

// 处理音频块
const result = await aggregator.processAudioChunk(job);

if (result === null) {
  // 音频被缓冲，等待更多音频块或触发标识
  console.log('Audio buffered');
} else {
  // 音频已聚合/切割，可以发送到ASR
  console.log('Audio ready for ASR:', result.length);
}
```

### 8.2 检查缓冲区状态

```typescript
const status = aggregator.getBufferStatus(sessionId);

if (status) {
  console.log('Buffer status:', {
    chunkCount: status.chunkCount,
    totalDurationMs: status.totalDurationMs,
    hasPendingSecondHalf: status.hasPendingSecondHalf,
    pendingSecondHalfDurationMs: status.pendingSecondHalfDurationMs,
  });
}
```

### 8.3 清理缓冲区

```typescript
// 清理指定会话的缓冲区
aggregator.clearBuffer(sessionId);
```

---

## 九、故障排查

### 9.1 常见问题

#### 问题1：找不到静音段，返回完整音频

**原因**:
- 音频中没有明显的静音段
- 静音阈值设置过高
- 音频质量差（噪音大）

**解决**:
- 调整`SILENCE_THRESHOLD`参数
- 检查音频质量
- 考虑使用其他分割方法（如基于时间）

#### 问题2：分割位置不准确

**原因**:
- 静音检测不准确
- 窗口大小不合适
- 最小停顿时长设置不当

**解决**:
- 调整`WINDOW_SIZE_MS`参数
- 调整`MIN_PAUSE_MS`参数
- 优化RMS值计算

#### 问题3：后续utterance没有合并

**原因**:
- pendingSecondHalf被意外清空
- 会话ID不匹配
- 缓冲区状态异常

**解决**:
- 检查日志中的合并信息
- 验证会话ID一致性
- 检查缓冲区状态

### 9.2 日志分析

#### 关键日志

1. **音频切割日志**:
```
AudioAggregator: Timeout triggered, split audio at longest pause. 
First half ready for ASR, second half buffered.
```

2. **合并日志**:
```
AudioAggregator: Merging pending second half with current audio
```

3. **缓冲区状态日志**:
```
AudioAggregator: Audio chunk added to buffer
```

#### 日志字段说明

- `firstHalfDurationMs`: 前半句时长（毫秒）
- `secondHalfDurationMs`: 后半句时长（毫秒）
- `longestPauseMs`: 最长停顿时长（毫秒）
- `splitPosition`: 分割位置（字节）
- `pendingSecondHalfLength`: 保留的后半句长度（字节）

---

## 十、性能考虑

### 10.1 计算复杂度

- **RMS值计算**: O(n)，n为音频样本数
- **静音段检测**: O(m)，m为窗口数
- **最长停顿选择**: O(k)，k为静音段数

**总体复杂度**: O(n)，线性时间复杂度

### 10.2 内存使用

- **音频缓冲区**: 每个会话最多20秒音频（约640KB）
- **pendingSecondHalf**: 最多20秒音频（约640KB）
- **总内存**: 每个会话最多约1.3MB

### 10.3 优化建议

1. **延迟计算**: 只在需要切割时计算RMS值
2. **采样分析**: 可以只分析部分窗口（如每隔一个窗口）
3. **缓存结果**: 缓存RMS值计算结果

---

## 十一、未来优化

### 11.1 参数自适应

- 根据音频质量动态调整静音阈值
- 根据用户语速动态调整最小停顿时长

### 11.2 算法优化

- 使用更高效的静音检测算法（如VAD）
- 使用机器学习模型预测最佳分割点

### 11.3 功能扩展

- 支持多级切割（多个停顿点）
- 支持基于语义的分割（结合ASR结果）

---

## 十二、相关文档

- **实现文档**: `TIMEOUT_AUDIO_SPLITTING_IMPLEMENTATION.md`
- **测试报告**: `AUDIO_AGGREGATOR_TEST_REPORT.md`
- **业务逻辑分析**: `FINALIZE_BUSINESS_LOGIC_ANALYSIS.md`

---

## 十三、版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2025-12-30 | 初始版本，实现超时音频切割机制 |
| 1.1 | 2025-12-30 | 添加优化补充文档，包含噪声环境兜底、Hangover、安全阀等优化建议 |

## 十四、优化建议

详细的优化建议和实施方案请参见：[超时音频切割机制优化补充](./TIMEOUT_AUDIO_SPLITTING_OPTIMIZATION.md)

主要优化点包括：
1. **噪声环境下的兜底切割策略**：解决找不到静音段的问题
2. **分割点Hangover机制**：保证尾音完整性
3. **pendingSecondHalf生命周期安全阀**：防止长期滞留
4. **静音阈值相对值**：提升不同环境下的鲁棒性
5. **二级切割**：改善极端长句的处理

---

## 十四、联系方式

如有问题或建议，请联系开发团队。

