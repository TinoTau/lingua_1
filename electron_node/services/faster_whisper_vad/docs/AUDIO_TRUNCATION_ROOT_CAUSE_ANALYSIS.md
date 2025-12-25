# 音频被过早截断的根本原因分析

**日期**: 2025-12-25  
**状态**: 🔍 **分析中**

---

## 问题现象

1. **调度服务器警告**：
   - `ASR结果可能不完整：句子未以标点符号结尾，可能是音频被过早截断`
   - 例如：`asr_text="这个东方飞简查一下"` - 没有标点符号结尾

2. **Web端播放的语音被截断**：
   - 播放的语音会丢失半句话
   - 说明TTS音频可能不完整

---

## 音频截断的可能原因

### 1. Web端VAD静音检测（已修复）

**当前配置** (`webapp/web-client/src/types.ts`):
```typescript
DEFAULT_SILENCE_FILTER_CONFIG: {
  releaseFrames: 30, // 连续30帧静音才停止发送（300ms）
  releaseThreshold: 0.005, // 退出语音：更宽松
}
```

**状态**：
- ✅ 已修复：`releaseFrames` 从 15 增加到 30（150ms → 300ms）
- ✅ 已修复：`releaseThreshold` 从 0.008 降低到 0.005

**但**：
- ⚠️ 如果用户在说话过程中有超过 300ms 的停顿，VAD 仍然会停止发送
- ⚠️ 这可能导致音频被过早截断

---

### 2. Web端静音超时机制

**文件**: `webapp/web-client/src/recorder.ts`

**机制**：
```typescript
private startSilenceDetection(): void {
  // 每100ms检查一次
  const checkSilence = () => {
    if (this.isRecording) {
      const now = Date.now();
      if (this.silenceStartTime === 0) {
        this.silenceStartTime = now;
      } else if (now - this.silenceStartTime > this.config.silenceTimeoutMs) {
        // 静音超时，触发回调
        if (this.silenceDetectedCallback) {
          this.silenceDetectedCallback();
        }
      }
      // ...
    }
  };
}
```

**问题**：
- 如果 `silenceTimeoutMs` 太短，会在用户还没说完时就触发 `onSilenceDetected()`
- `onSilenceDetected()` 会调用 `sendFinal()`，导致音频被过早截断

**需要检查**：
- `silenceTimeoutMs` 的值是多少？
- 是否太短？

---

### 3. 调度服务器的 pause_ms 超时机制

**文件**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

**机制**：
```rust
// 检查暂停是否超过阈值
let pause_exceeded = self.state
    .audio_buffer
    .record_chunk_and_check_pause(&self.session_id, timestamp_ms, self.pause_ms)
    .await;

if pause_exceeded {
    // 先 finalize 当前 utterance
    let finalized = self.try_finalize(utterance_index, "Pause").await?;
}
```

**问题**：
- 如果 `pause_ms` 时间内没有收到新的 `audio_chunk`，会触发 `finalize`
- 默认值可能是 2000ms（2秒）
- 如果用户在说话过程中有超过 2 秒的停顿，会导致音频被过早截断

**需要检查**：
- `pause_ms` 的默认值是多少？
- 是否太短？

---

### 4. Web端发送 is_final=true 过早

**文件**: `webapp/web-client/src/app.ts`

**机制**：
```typescript
private onSilenceDetected(): void {
  if (this.stateMachine.getState() === SessionState.INPUT_RECORDING) {
    // 发送剩余的音频数据
    if (this.audioBuffer.length > 0) {
      const chunk = this.concatAudioBuffers(this.audioBuffer);
      this.audioBuffer = [];
      this.wsClient.sendAudioChunk(chunk, false);
    }

    // 发送结束帧
    this.wsClient.sendFinal();  // is_final=true

    // 停止录音
    this.stateMachine.stopRecording();
  }
}
```

**问题**：
- 如果 `onSilenceDetected()` 被过早触发，会过早发送 `is_final=true`
- 调度服务器收到 `is_final=true` 后，会立即 `finalize` utterance
- 导致音频被过早截断

---

## 根本原因分析

### 可能的原因组合

1. **Web端VAD停止发送 + 静音超时触发**：
   - VAD 检测到 300ms 静音，停止发送音频
   - 静音超时机制检测到持续静音，触发 `onSilenceDetected()`
   - `onSilenceDetected()` 发送 `is_final=true`
   - 调度服务器收到 `is_final=true`，立即 `finalize` utterance
   - **结果**：音频被过早截断

2. **调度服务器 pause_ms 超时**：
   - 用户在说话过程中有超过 `pause_ms`（可能是 2 秒）的停顿
   - 调度服务器检测到暂停超时，触发 `finalize`
   - **结果**：音频被过早截断

3. **VAD 和 pause_ms 双重触发**：
   - VAD 停止发送音频（300ms 静音）
   - 调度服务器检测到暂停超时（2 秒）
   - 两者都可能触发 `finalize`

---

## 解决方案

### 1. 增加 Web端静音超时时间

**需要检查**：
- `silenceTimeoutMs` 的当前值
- 如果太短（例如 < 3 秒），需要增加

**建议**：
- 增加到 5-10 秒，允许用户有更长的停顿

---

### 2. 增加调度服务器 pause_ms

**需要检查**：
- `pause_ms` 的当前值
- 如果太短（例如 < 3 秒），需要增加

**建议**：
- 增加到 5-10 秒，允许用户有更长的停顿

---

### 3. 优化 VAD 静音检测

**当前配置**：
- `releaseFrames: 30` (300ms)
- `releaseThreshold: 0.005`

**建议**：
- 进一步增加 `releaseFrames` 到 50-100（500ms-1000ms）
- 进一步降低 `releaseThreshold` 到 0.003

---

### 4. 禁用或优化静音超时机制

**如果静音超时机制导致问题**：
- 可以禁用静音超时机制
- 或者增加超时时间
- 或者只在用户明确停止录音时才触发

---

## 下一步

1. **检查配置值**：
   - `silenceTimeoutMs` 的值
   - `pause_ms` 的值

2. **调整配置**：
   - 根据检查结果调整配置
   - 增加超时时间，允许更长的停顿

3. **测试验证**：
   - 测试用户说话过程中有停顿的场景
   - 确认音频不会被过早截断

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/AUDIO_CONTEXT_ANALYSIS.md` - 音频上下文机制分析
- `electron_node/services/faster_whisper_vad/docs/AUDIO_TRUNCATION_AND_ASR_QUALITY_ISSUES.md` - 音频截断和ASR识别质量问题

