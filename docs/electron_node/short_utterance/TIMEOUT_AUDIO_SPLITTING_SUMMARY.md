# 超时音频切割实现总结

**日期**: 2025-12-30  
**状态**: ✅ **已实现**

---

## 一、实现内容

### 1. 调度服务器端 ✅

**文件**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

**修改**：
- MaxDuration finalize时设置`is_timeout_triggered = true`
- 这样节点端可以统一处理超时情况

**代码**：
```rust
// 第672行
let is_timeout_triggered = reason == "Timeout" || reason == "MaxDuration";
```

---

### 2. 节点端音频切割 ✅

**文件**: `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts`

#### 2.1 音频切割算法

**方法**: `findLongestPauseAndSplit()`

**算法**：
1. 将音频分成100ms的窗口
2. 计算每个窗口的RMS值（均方根）
3. 找到RMS值低于阈值（500）的连续段（静音段）
4. 找到最长的静音段
5. 在最长静音段的结束位置分割

**参数**：
- `WINDOW_SIZE_MS = 100ms`：分析窗口大小
- `SILENCE_THRESHOLD = 500`：静音阈值（RMS值）
- `MIN_PAUSE_MS = 200ms`：最小停顿时长

#### 2.2 超时处理流程

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

#### 2.3 后续utterance合并

```
接收后续utterance
  ↓
检查是否有pendingSecondHalf
  ↓
如果有，先与当前音频合并
  ↓
然后根据标识处理：
  - 手动发送（is_manual_cut）：立即处理
  - 3秒静音（is_pause_triggered）：立即处理
  - 20秒超时（is_timeout_triggered）：再次切割
```

---

## 二、工作流程示例

### 场景1：超时utterance + 手动发送

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

### 场景2：超时utterance + 超时utterance

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

---

## 三、关键特性

### 1. 智能分割

- ✅ 找到最长停顿作为分割点
- ✅ 考虑用户语速不同
- ✅ 在自然停顿处分割，避免在句子中间截断

### 2. 自动合并

- ✅ 后续utterance自动与保留的后半句合并
- ✅ 支持多种触发标识（手动发送、3秒静音、20秒超时）
- ✅ 如果后续utterance也有超时标识，会再次切割

### 3. 完整流程

- ✅ 前半句立即ASR识别，使用当前utterance_id
- ✅ 后半句保留在缓冲区，等待合并
- ✅ 合并后的音频形成完整句子

---

## 四、相关文件

- `central_server/scheduler/src/websocket/session_actor/actor.rs` - 调度服务器finalize逻辑
- `electron_node/electron-node/main/src/pipeline-orchestrator/audio-aggregator.ts` - 音频聚合和切割逻辑
- `electron_node/docs/short_utterance/TIMEOUT_AUDIO_SPLITTING_IMPLEMENTATION.md` - 详细实现文档

---

## 五、测试建议

1. **单个超时utterance**：验证切割是否正确
2. **超时utterance + 手动发送**：验证合并是否正确
3. **超时utterance + 超时utterance**：验证再次切割是否正确
4. **找不到静音段**：验证是否直接返回完整音频

