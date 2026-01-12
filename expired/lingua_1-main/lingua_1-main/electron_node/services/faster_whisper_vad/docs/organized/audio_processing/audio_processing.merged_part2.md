# Audio Processing (Part 2/6)

    // 发送剩余的音频数据
    if (this.audioBuffer.length > 0) {
      const chunk = this.concatAudioBuffers(this.audioBuffer);
      this.audioBuffer = [];
      this.wsClient.sendAudioChunk(chunk, false);
    }
    // 发送结束帧
    this.wsClient.sendFinal();
    // 停止录音
    this.stateMachine.stopRecording();
  }
}
```

**问题**：
- VAD停止发送后，`onSilenceDetected()` 会立即发送当前缓冲的音频
- 如果VAD在用户还没说完时就停止，会导致音频不完整

---

### 3. ASR识别质量

**当前配置** (`electron_node/services/faster_whisper_vad/faster_whisper_vad_service.py`):
```python
MIN_AUDIO_RMS = 0.002
MIN_AUDIO_STD = 0.002
MIN_AUDIO_DYNAMIC_RANGE = 0.01
MIN_AUDIO_DURATION = 0.5  # 最短音频时长0.5秒
```

**日志显示**：
- 音频时长：`4.56秒` ✅ 足够长
- `condition_on_previous_text=False` ✅ 已生效
- 但识别结果仍然很差

**可能的原因**：
1. **音频被截断**：VAD过早停止发送，导致音频不完整
2. **音频质量问题**：虽然通过了质量检查，但可能仍然有问题
3. **模型配置问题**：可能需要调整ASR参数

---

### 4. 重复问题

**状态**：
- `condition_on_previous_text=False` 已经生效 ✅
- 但可能还有跨utterance的重复

---

## 解决方案

### 1. 增加VAD的releaseFrames（允许更长的停顿）

**修改** (`webapp/web-client/src/types.ts`):
```typescript
DEFAULT_SILENCE_FILTER_CONFIG: {
  enabled: true,
  threshold: 0.015,
  attackThreshold: 0.015,
  releaseThreshold: 0.008,
  windowMs: 100,
  attackFrames: 3,
  releaseFrames: 30, // 从15增加到30（300ms，允许更长的停顿）
}
```

**理由**：
- 150ms的停顿太短，用户在说话过程中经常会有200-300ms的停顿
- 增加到300ms可以避免过早截断

---

### 2. 增加VAD的releaseThreshold（降低静音检测敏感度）

**修改** (`webapp/web-client/src/types.ts`):
```typescript
DEFAULT_SILENCE_FILTER_CONFIG: {
  enabled: true,
  threshold: 0.015,
  attackThreshold: 0.015,
  releaseThreshold: 0.005, // 从0.008降低到0.005（更宽松，避免误停止）
  windowMs: 100,
  attackFrames: 3,
  releaseFrames: 30,
}
```

**理由**：
- 降低releaseThreshold可以让VAD在更低的音量下继续发送
- 避免说话过程中音量稍微降低就被误判为静音

---

### 3. 检查ASR识别质量的其他原因

**需要检查**：
1. **音频编码质量**：检查Opus编码是否导致质量下降
2. **模型配置**：检查ASR模型参数是否正确
3. **上下文参数**：检查`initial_prompt`是否正确传递

---

## 验证步骤

### 1. 测试VAD修复

1. 重新编译Web端
2. 测试场景：
   - 用户说话："所以说...（停顿200ms）...应该发送到节点端就会被处理"
   - **期望**：VAD不会在150ms时停止，应该继续发送直到300ms静音

### 2. 测试ASR识别质量

1. 查看日志确认：
   - 音频时长是否足够（>0.5秒）
   - 音频质量指标（RMS、STD、动态范围）
   - ASR识别结果

2. 如果识别质量仍然很差：
   - 检查音频编码质量
   - 检查ASR模型配置
   - 检查上下文参数

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/ISSUE_STATUS_REPORT.md` - 问题状态报告
- `electron_node/electron-node/main/docs/CONDITION_ON_PREVIOUS_TEXT_FIX.md` - condition_on_previous_text修复



---

## AUDIO_CHUNK_ACCUMULATION_MECHANISM.md

# Audio Chunk积累和发送机制

**日期**: 2025-12-24  
**问题**: audio_chunk如何积累数据以及发送数据，并与utterance保持错开？  
**状态**: ✅ **已分析**

---

## 核心机制

### Web端audioBuffer的工作原理

**定义**: `private audioBuffer: Float32Array[] = []`

**关键操作**:
- `audioBuffer.push(audioData)` - 累积音频帧
- `audioBuffer.splice(0, 10)` - **移除并返回前10帧**（关键！）
- `audioBuffer = []` - 清空所有剩余帧

---

## 详细数据流

### 场景：用户连续说话3秒

#### 时间线

```
T=0.0s: 开始录音
  → audioBuffer = []
  
T=0.0s-0.1s: 收到10帧
  → audioBuffer.push(frame0, frame1, ..., frame9)
  → audioBuffer.length = 10
  → audioBuffer.splice(0, 10) → 移除前10帧，返回[frame0...frame9]
  → sendAudioChunk([frame0...frame9], false)
  → audioBuffer = [] ✅ 已清空，不会重复发送

T=0.1s-0.2s: 收到10帧
  → audioBuffer.push(frame10, frame11, ..., frame19)
  → audioBuffer.length = 10
  → audioBuffer.splice(0, 10) → 移除前10帧，返回[frame10...frame19]
  → sendAudioChunk([frame10...frame19], false)
  → audioBuffer = [] ✅ 已清空

... (持续每100ms发送一次)

T=2.9s-3.0s: 收到10帧
  → audioBuffer.push(frame290, frame291, ..., frame299)
  → audioBuffer.length = 10
  → audioBuffer.splice(0, 10) → 移除前10帧，返回[frame290...frame299]
  → sendAudioChunk([frame290...frame299], false)
  → audioBuffer = [] ✅ 已清空

T=3.0s: 用户点击发送按钮
  → sendCurrentUtterance()
  → audioBuffer.length = 0 (因为已经全部通过audio_chunk发送)
  → 跳过发送（audioBuffer为空）
```

#### 场景：用户说话2.5秒后点击发送

```
T=0.0s-2.4s: 每100ms发送一次audio_chunk
  → 已发送: frame0-frame239 (24次，每次10帧)
  → audioBuffer = [] (每次发送后都清空)

T=2.4s-2.5s: 收到最后10帧
  → audioBuffer.push(frame240, frame241, ..., frame249)
  → audioBuffer.length = 10
  → 但还没到100ms，所以不会自动发送

T=2.5s: 用户点击发送按钮
  → sendCurrentUtterance()
  → audioBuffer.length = 10
  → concatAudioBuffers(audioBuffer) → [frame240...frame249]
  → sendUtterance([frame240...frame249], ...)
  → audioBuffer = [] ✅ 清空，不会重复发送
```

---

## 关键代码分析

### 1. onAudioFrame() - 自动发送audio_chunk

```typescript
private onAudioFrame(audioData: Float32Array): void {
  // 累积到buffer
  this.audioBuffer.push(new Float32Array(audioData));
  
  // 每100ms自动发送（当buffer中有10帧时）
  if (this.audioBuffer.length >= 10) {
    // ✅ 关键：splice(0, 10) 会移除前10帧并返回它们
    const chunk = this.concatAudioBuffers(this.audioBuffer.splice(0, 10));
    this.wsClient.sendAudioChunk(chunk, false);
    // ✅ audioBuffer中只剩下剩余的帧（如果有）
  }
}
```

**关键点**:
- `splice(0, 10)` **移除**前10帧，不会重复发送
- 剩余的帧继续留在buffer中，等待下次发送或手动发送

### 2. sendCurrentUtterance() - 手动发送utterance

```typescript
async sendCurrentUtterance(): Promise<void> {
  if (this.audioBuffer.length > 0) {
    // ✅ 发送buffer中所有剩余数据（这些数据还没有通过audio_chunk发送）
    const audioData = this.concatAudioBuffers(this.audioBuffer);
    this.audioBuffer = []; // ✅ 清空，避免重复发送
    await this.wsClient.sendUtterance(audioData, ...);
  }
}
```

**关键点**:
- 只发送buffer中**剩余的数据**（还没有通过audio_chunk发送的）
- 发送后立即清空buffer，避免重复

### 3. onSilenceDetected() - 静音检测后发送

```typescript
private onSilenceDetected(): void {
  if (this.audioBuffer.length > 0) {
    // ✅ 发送剩余数据
    const chunk = this.concatAudioBuffers(this.audioBuffer);
    this.audioBuffer = []; // ✅ 清空
    this.wsClient.sendAudioChunk(chunk, false);
  }
  this.wsClient.sendFinal(); // 发送结束帧
}
```

**关键点**:
- 静音检测后，发送剩余数据（通过audio_chunk）
- 然后发送final帧，触发调度服务器finalize

---

## 错开机制

### 为什么不会重复发送？

**原因**: `splice()`操作会**移除**元素

```typescript
// 示例
audioBuffer = [frame0, frame1, ..., frame9, frame10, frame11]
audioBuffer.length = 12

// 发送audio_chunk
const chunk = audioBuffer.splice(0, 10)
// chunk = [frame0, frame1, ..., frame9] ✅ 已发送
// audioBuffer = [frame10, frame11] ✅ 剩余数据，未发送

// 手动发送utterance
const audioData = concatAudioBuffers(audioBuffer)
// audioData = [frame10, frame11] ✅ 只包含剩余数据，不会重复
```

### 数据流示例

#### 场景1: 纯自动发送（audio_chunk）

```
录音3秒，每100ms发送一次
  → T=0.0s: 发送frame0-9 (audio_chunk)
  → T=0.1s: 发送frame10-19 (audio_chunk)
  → ...
  → T=2.9s: 发送frame290-299 (audio_chunk)
  → T=3.0s: 静音检测，发送剩余frame300-309 (audio_chunk) + final
  → audioBuffer = [] ✅ 全部发送完毕
```

#### 场景2: 混合发送（audio_chunk + utterance）

```
录音2.5秒，用户在第2.5秒点击发送
  → T=0.0s-2.4s: 每100ms发送audio_chunk (frame0-239)
  → T=2.4s-2.5s: 收到frame240-249，但还没到100ms
  → T=2.5s: 用户点击发送
    → sendUtterance(frame240-249) ✅ 只发送剩余数据
  → audioBuffer = [] ✅ 清空
```

---

## 调度服务器端的累积

### audio_buffer的累积逻辑

**文件**: `central_server/scheduler/src/managers/audio_buffer.rs`

```rust
// 每个audio_chunk都会添加到buffer
audio_buffer.add_chunk(session_id, utterance_index, chunk);

// finalize时合并所有chunk
let audio_data = audio_buffer.take_combined(session_id, utterance_index);
// take_combined会移除buffer，避免重复
```

**关键点**:
- 每个`audio_chunk`消息都会累积到同一个`utterance_index`的buffer
- `take_combined()`会**移除**buffer，避免重复使用
- 如果同时有`utterance`消息，会创建新的job（不同的数据源）

---

## 潜在问题

### 问题：如果同时使用audio_chunk和utterance会怎样？

**场景**:
1. 用户说话，通过`audio_chunk`发送部分数据
2. 用户点击发送按钮，通过`utterance`发送剩余数据
3. 调度服务器可能收到两个数据源

**结果**:
- `audio_chunk` → `audio_buffer` → finalize → job1
- `utterance` → 直接创建job → job2
- **可能创建两个job，导致重复处理**

**解决方案**:
- 确保Web端逻辑正确：如果使用`audio_chunk`，就不要使用`utterance`
- 或者：统一使用一种方式

---

## 总结

### audio_chunk的积累和发送

1. **积累**: `audioBuffer.push(audioData)` - 持续累积音频帧
2. **自动发送**: 每100ms，`splice(0, 10)`移除前10帧并发送
3. **剩余数据**: 保留在buffer中，等待下次发送或手动发送

### 与utterance的错开

1. **不会重复**: `splice()`会移除已发送的数据
2. **utterance只发送剩余**: `sendCurrentUtterance()`只发送buffer中剩余的数据
3. **清空机制**: 发送后立即清空buffer，避免重复

### 关键代码

```typescript
// ✅ 自动发送（移除前10帧）
const chunk = this.concatAudioBuffers(this.audioBuffer.splice(0, 10));
this.wsClient.sendAudioChunk(chunk, false);

// ✅ 手动发送（发送所有剩余数据）
const audioData = this.concatAudioBuffers(this.audioBuffer);
this.audioBuffer = []; // 清空
this.wsClient.sendUtterance(audioData, ...);
```

---

## 相关文件

- `webapp/web-client/src/app.ts` - Web端音频处理逻辑
- `webapp/web-client/src/websocket_client.ts` - Web端发送逻辑
- `central_server/scheduler/src/managers/audio_buffer.rs` - 调度服务器音频缓冲区
- `central_server/scheduler/src/websocket/session_actor/actor.rs` - Session Actor处理逻辑



---

## AUDIO_CHUNK_CONCATENATION_ANALYSIS.md

# Audio Chunk拼接问题分析

**日期**: 2025-12-25  
**状态**: 🔍 **问题已定位**

---

## 问题现象

**所有job的音频都只有0.24秒（3840 samples at 16kHz）**

从日志看：
- `job-031EC479`: `original_samples=3840 original_duration_sec=0.240`
- `job-E14E2B85`: `original_samples=3840 original_duration_sec=0.240`
- `job-D6A0E6E9`: `original_samples=3840 original_duration_sec=0.240`
- `job-CDEA69AC`: `original_samples=3840 original_duration_sec=0.240`

---

## 预期机制

### 调度服务器应该拼接audio_chunk

1. **Web端发送audio_chunk**:
   - 每100ms发送一个audio_chunk（10帧，每帧10ms）
   - 累积到调度服务器的`audio_buffer`

2. **调度服务器累积**:
   - 所有audio_chunk累积到同一个`utterance_index`的buffer
   - 每次收到chunk后，重置超时计时器（pause_ms，默认2000ms）

3. **调度服务器finalize**:
   - 如果`pause_ms`时间内没有收到新的audio_chunk → **自动finalize**
   - 如果收到`is_final=true` → **立即finalize**
   - 如果检测到pause_exceeded → **先finalize上一个，然后开始新的**

4. **finalize执行**:
   - 合并所有chunk: `take_combined()` → 合并所有chunk
   - 创建job → 发送给节点端

### faster_whisper_vad的上下文缓冲区

**注意**: faster_whisper_vad的上下文缓冲区是用于**跨utterance**的上下文，不是用于拼接audio_chunk的。

- **用途**: 保存前一个utterance的尾部音频（最后2秒），前置到当前utterance
- **不是**: 拼接audio_chunk（那是调度服务器的职责）

---

## 问题分析

### 0.24秒音频 = 只收到了2-3个audio_chunk

**计算**:
- 0.24秒 = 240ms
- 每个audio_chunk = 100ms（10帧 × 10ms/帧）
- 0.24秒 ≈ 2-3个audio_chunk

**可能原因**:

#### 原因1: Web端静音检测过早触发 ⚠️

**场景**:
- Web端录音开始
- 发送了2-3个audio_chunk（0.2-0.3秒）
- Web端静音检测触发 → 停止发送audio_chunk
- 调度服务器等待2秒后超时 → finalize → 只有0.24秒音频

**检查点**:
- Web端的静音检测配置（silence_threshold, silence_duration_ms）
- Web端是否过早触发静音检测

#### 原因2: Web端发送了`is_final=true` ⚠️

**场景**:
- Web端发送了2-3个audio_chunk
- Web端发送`is_final=true` → 调度服务器立即finalize
- 只有0.24秒音频

**检查点**:
- Web端是否过早调用`sendFinal()`
- Web端的静音检测逻辑

#### 原因3: 调度服务器finalize机制有问题 ⚠️

**场景**:
- Web端正常发送audio_chunk
- 但调度服务器的finalize机制过早触发
- 只累积了2-3个chunk就finalize了