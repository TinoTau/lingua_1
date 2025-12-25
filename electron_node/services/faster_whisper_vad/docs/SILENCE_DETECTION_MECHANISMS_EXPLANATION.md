# 静音检测机制详解

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 三个静音检测机制

### 1. VAD静音检测（Web端）

**位置**: `webapp/web-client/src/recorder.ts`

**作用**：
- **实时过滤静音片段**，只发送有效语音给调度服务器
- 避免调度服务器一直处于"翻译中"状态
- 减少网络传输和服务器处理负担

**机制**：
```typescript
private processSilenceFilter(audioData: Float32Array): boolean {
  const rms = this.calculateRMS(audioData);  // 计算音频能量
  const isVoice = rms >= threshold;  // 判断是否为语音
  
  if (isVoice) {
    this.consecutiveVoiceFrames++;
    // 连续 N 帧语音才开始发送（避免误触发）
    if (this.consecutiveVoiceFrames >= attackFrames) {
      this.isSendingAudio = true;  // 开始发送音频
    }
  } else {
    this.consecutiveSilenceFrames++;
    // 连续 M 帧静音才停止发送（避免误停止）
    if (this.consecutiveSilenceFrames >= releaseFrames) {
      this.isSendingAudio = false;  // 停止发送音频
    }
  }
  
  return this.isSendingAudio;  // 返回是否应该发送该帧
}
```

**当前配置**：
```typescript
DEFAULT_SILENCE_FILTER_CONFIG: {
  attackFrames: 3,        // 连续3帧语音才开始发送（30ms）
  releaseFrames: 30,     // 连续30帧静音才停止发送（300ms）
  attackThreshold: 0.015,  // 进入语音的阈值（严格）
  releaseThreshold: 0.005, // 退出语音的阈值（宽松）
}
```

**工作流程**：
1. **检测到语音**：连续 3 帧（30ms）语音 → 开始发送音频
2. **检测到静音**：连续 30 帧（300ms）静音 → 停止发送音频
3. **继续检测**：如果再次检测到语音，重新开始发送

**关键点**：
- ✅ **只影响是否发送音频**，不触发 `finalize`
- ✅ **实时过滤**，在音频帧级别工作
- ✅ **平滑逻辑**，避免频繁启停

**示例**：
```
时间轴：
0ms:    用户开始说话 → VAD检测到语音 → 开始发送音频
500ms:  用户停顿（200ms）→ VAD继续发送（因为<300ms）
700ms:  用户继续说话 → VAD继续发送
1000ms: 用户停止说话 → VAD检测到静音
1300ms: 连续300ms静音 → VAD停止发送音频
```

---

### 2. Web端静音超时（silenceTimeoutMs）

**位置**: `webapp/web-client/src/recorder.ts`

**作用**：
- **检测用户是否已经停止说话**（持续静音超过阈值）
- 如果检测到持续静音，触发 `onSilenceDetected()` 回调
- 发送 `is_final=true` 给调度服务器，表示当前 utterance 结束

**机制**：
```typescript
private startSilenceDetection(): void {
  const detectSilence = () => {
    const average = this.dataArray.reduce(...) / this.dataArray.length;
    const threshold = 20;  // 静音阈值
    
    if (average < threshold) {
      // 检测到静音
      if (this.silenceStartTime === 0) {
        this.silenceStartTime = now;  // 记录静音开始时间
      } else if (now - this.silenceStartTime > this.config.silenceTimeoutMs) {
        // 静音超时，触发回调
        this.silenceDetectedCallback();  // 调用 onSilenceDetected()
      }
    } else {
      // 检测到语音，重置静音计时
      this.silenceStartTime = 0;
    }
  };
}
```

**当前配置**：
```typescript
silenceTimeoutMs: 5000,  // 5秒（已修复：从1秒增加到5秒）
```

**工作流程**：
1. **检测到静音**：记录静音开始时间
2. **持续静音**：如果持续静音超过 `silenceTimeoutMs`（5秒）
3. **触发回调**：调用 `onSilenceDetected()`
4. **发送结束帧**：`onSilenceDetected()` 会发送 `is_final=true`

**关键点**：
- ✅ **触发 utterance 结束**，发送 `is_final=true`
- ✅ **基于音量检测**（使用 `AnalyserNode`）
- ✅ **独立于 VAD**，即使 VAD 停止发送，仍然会检测

**示例**：
```
时间轴：
0ms:    用户开始说话 → silenceStartTime = 0（重置）
5000ms: 用户停止说话 → silenceStartTime = 5000ms（开始计时）
10000ms: 持续静音5秒 → 触发 onSilenceDetected() → 发送 is_final=true
```

---

### 3. 调度服务器 pause_ms 超时

**位置**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

**作用**：
- **检测是否收到新的 audio_chunk**
- 如果超过 `pause_ms` 时间没有收到新的 `audio_chunk`，触发 `finalize`
- 将当前累积的 `audio_chunk` 拼接成完整的 `utterance`，发送给节点端

**机制**：
```rust
async fn handle_audio_chunk(
    &mut self,
    chunk: Vec<u8>,
    is_final: bool,
    timestamp_ms: i64,
    ...
) {
    // 检查暂停是否超过阈值
    let pause_exceeded = self.state
        .audio_buffer
        .record_chunk_and_check_pause(&self.session_id, timestamp_ms, self.pause_ms)
        .await;
    
    if pause_exceeded {
        // 先 finalize 当前 utterance
        let finalized = self.try_finalize(utterance_index, "Pause").await?;
    }
    
    // 如果是最终块，立即 finalize
    if is_final {
        self.try_finalize(utterance_index, "IsFinal").await?;
    }
}
```

**当前配置**：
```rust
fn default_web_pause_ms() -> u64 {
    5000  // 5秒（已修复：从2秒增加到5秒）
}
```

**工作流程**：
1. **收到 audio_chunk**：记录时间戳，重置暂停计时
2. **没有收到新的 audio_chunk**：如果超过 `pause_ms`（5秒）没有收到新的 `audio_chunk`
3. **触发 finalize**：将当前累积的 `audio_chunk` 拼接成完整的 `utterance`
4. **发送给节点端**：创建 `JobAssignMessage`，发送给节点端进行 ASR 处理

**关键点**：
- ✅ **触发 utterance 结束**，将音频拼接成完整的 utterance
- ✅ **基于时间间隔**，检测是否收到新的 audio_chunk
- ✅ **独立于 Web 端**，即使 Web 端没有发送 `is_final=true`，也会触发

**示例**：
```
时间轴：
0ms:    收到 audio_chunk → 重置暂停计时
1000ms: 收到 audio_chunk → 重置暂停计时
2000ms: 收到 audio_chunk → 重置暂停计时
3000ms: 没有收到新的 audio_chunk → 开始计时
8000ms: 超过5秒没有收到新的 audio_chunk → 触发 finalize → 发送 utterance 给节点端
```

---

## 三个机制的关系

### 工作流程

```
用户说话
  ↓
[1] VAD静音检测（实时过滤）
  ↓ 只发送有效语音
Web端发送 audio_chunk（每100ms）
  ↓
调度服务器累积 audio_chunk
  ↓
[2] 调度服务器 pause_ms 超时（5秒没有收到新的 audio_chunk）
  OR
[3] Web端静音超时（5秒持续静音）→ 发送 is_final=true
  ↓
调度服务器 finalize utterance
  ↓
发送完整的 utterance 给节点端
```

---

### 触发 finalize 的条件

**条件 1**: Web端发送 `is_final=true`
- 触发：Web端静音超时（5秒持续静音）
- 立即触发：`try_finalize(utterance_index, "IsFinal")`

**条件 2**: 调度服务器 pause_ms 超时
- 触发：5秒内没有收到新的 `audio_chunk`
- 触发：`try_finalize(utterance_index, "Pause")`

**条件 3**: 音频长度超过限制（异常保护）
- 触发：音频长度超过 500KB
- 触发：`try_finalize(utterance_index, "MaxLength")`

---

## 为什么需要三个机制？

### 1. VAD静音检测（实时过滤）

**目的**：
- 减少网络传输和服务器处理负担
- 只发送有效语音，过滤静音片段

**为什么需要**：
- 如果发送所有音频（包括静音），会浪费网络带宽和服务器资源
- 调度服务器会一直处于"翻译中"状态，即使没有有效语音

---

### 2. Web端静音超时（用户停止说话检测）

**目的**：
- 检测用户是否已经停止说话
- 主动发送 `is_final=true`，通知调度服务器结束当前 utterance

**为什么需要**：
- 用户可能停止说话，但不会主动点击"发送"按钮
- 需要自动检测并结束当前 utterance

**问题**：
- 如果阈值太短（例如 1 秒），会在用户还没说完时就触发
- 导致音频被过早截断

---

### 3. 调度服务器 pause_ms 超时（网络异常保护）

**目的**：
- 检测网络是否异常（没有收到新的 audio_chunk）
- 即使 Web 端没有发送 `is_final=true`，也能触发 `finalize`

**为什么需要**：
- **网络异常保护**：如果网络中断，Web 端可能无法发送 `is_final=true`
- **防止音频无限累积**：如果 Web 端异常，调度服务器不会一直等待
- **确保 utterance 最终会被处理**：即使 Web 端异常，也能触发 finalize

**问题**：
- 如果阈值太短（例如 2 秒），会在用户说话过程中短暂停顿时触发
- 导致音频被过早截断

---

## 修复后的配置

### 当前配置

1. **VAD静音检测**：
   - `releaseFrames: 30` (300ms) ✅
   - `releaseThreshold: 0.005` ✅

2. **Web端静音超时**：
   - `silenceTimeoutMs: 5000` (5秒) ✅ 已修复

3. **调度服务器 pause_ms**：
   - `pause_ms: 5000` (5秒) ✅ 已修复

---

## 最佳实践

### 配置建议

1. **VAD静音检测**：
   - `releaseFrames`: 30-50 (300-500ms)
   - `releaseThreshold`: 0.003-0.005
   - **目的**：允许用户在说话过程中有短暂停顿

2. **Web端静音超时**：
   - `silenceTimeoutMs`: 5000-10000 (5-10秒)
   - **目的**：允许用户有较长的停顿，避免过早截断

3. **调度服务器 pause_ms**：
   - `pause_ms`: 5000-10000 (5-10秒)
   - **目的**：与 Web 端静音超时保持一致，避免过早截断

---

## 总结

### 三个机制的作用

1. **VAD静音检测**：
   - ✅ 实时过滤静音片段
   - ✅ 只发送有效语音
   - ✅ 不触发 finalize

2. **Web端静音超时**：
   - ✅ 检测用户是否已经停止说话
   - ✅ 触发 `onSilenceDetected()` 回调
   - ✅ 发送 `is_final=true` 给调度服务器

3. **调度服务器 pause_ms 超时**：
   - ✅ 检测是否收到新的 audio_chunk
   - ✅ 网络异常保护
   - ✅ 触发 finalize，发送 utterance 给节点端

### 它们的关系

- **VAD** 负责实时过滤，只发送有效语音
- **Web端静音超时** 和 **调度服务器 pause_ms** 都负责检测 utterance 结束
- **两者都可以触发 finalize**，但通常 Web 端静音超时会先触发（因为 VAD 已经停止发送）

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/AUDIO_TRUNCATION_FIX.md` - 音频被过早截断修复
- `electron_node/services/faster_whisper_vad/docs/AUDIO_TRUNCATION_ROOT_CAUSE_ANALYSIS.md` - 音频被过早截断的根本原因分析

