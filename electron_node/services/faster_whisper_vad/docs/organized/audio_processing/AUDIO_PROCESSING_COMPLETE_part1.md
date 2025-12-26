# ��Ƶ���������ĵ� (Part 1/6)

# ��Ƶ���������ĵ�

���ĵ��ϲ���������Ƶ������صķ������޸��������ĵ���

---

## AUDIO_TRUNCATION_ROOT_CAUSE_ANALYSIS.md

# 音频被过早截断的根本原因分析

**日期**: 2025-12-25  
**状�?*: 🔍 **分析�?*

---

## 问题现象

1. **调度服务器警�?*�?
   - `ASR结果可能不完整：句子未以标点符号结尾，可能是音频被过早截断`
   - 例如：`asr_text="这个东方飞简查一�?` - 没有标点符号结尾

2. **Web端播放的语音被截�?*�?
   - 播放的语音会丢失半句�?
   - 说明TTS音频可能不完�?

---

## 音频截断的可能原�?

### 1. Web端VAD静音检测（已修复）

**当前配置** (`webapp/web-client/src/types.ts`):
```typescript
DEFAULT_SILENCE_FILTER_CONFIG: {
  releaseFrames: 30, // 连续30帧静音才停止发送（300ms�?
  releaseThreshold: 0.005, // 退出语音：更宽�?
}
```

**状�?*�?
- �?已修复：`releaseFrames` �?15 增加�?30�?50ms �?300ms�?
- �?已修复：`releaseThreshold` �?0.008 降低�?0.005

**�?*�?
- ⚠️ 如果用户在说话过程中有超�?300ms 的停顿，VAD 仍然会停止发�?
- ⚠️ 这可能导致音频被过早截断

---

### 2. Web端静音超时机�?

**文件**: `webapp/web-client/src/recorder.ts`

**机制**�?
```typescript
private startSilenceDetection(): void {
  // �?00ms检查一�?
  const checkSilence = () => {
    if (this.isRecording) {
      const now = Date.now();
      if (this.silenceStartTime === 0) {
        this.silenceStartTime = now;
      } else if (now - this.silenceStartTime > this.config.silenceTimeoutMs) {
        // 静音超时，触发回�?
        if (this.silenceDetectedCallback) {
          this.silenceDetectedCallback();
        }
      }
      // ...
    }
  };
}
```

**问题**�?
- 如果 `silenceTimeoutMs` 太短，会在用户还没说完时就触�?`onSilenceDetected()`
- `onSilenceDetected()` 会调�?`sendFinal()`，导致音频被过早截断

**需要检�?*�?
- `silenceTimeoutMs` 的值是多少�?
- 是否太短�?

---

### 3. 调度服务器的 pause_ms 超时机制

**文件**: `central_server/scheduler/src/websocket/session_actor/actor.rs`

**机制**�?
```rust
// 检查暂停是否超过阈�?
let pause_exceeded = self.state
    .audio_buffer
    .record_chunk_and_check_pause(&self.session_id, timestamp_ms, self.pause_ms)
    .await;

if pause_exceeded {
    // �?finalize 当前 utterance
    let finalized = self.try_finalize(utterance_index, "Pause").await?;
}
```

**问题**�?
- 如果 `pause_ms` 时间内没有收到新�?`audio_chunk`，会触发 `finalize`
- 默认值可能是 2000ms�?秒）
- 如果用户在说话过程中有超�?2 秒的停顿，会导致音频被过早截�?

**需要检�?*�?
- `pause_ms` 的默认值是多少�?
- 是否太短�?

---

### 4. Web端发�?is_final=true 过早

**文件**: `webapp/web-client/src/app.ts`

**机制**�?
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

**问题**�?
- 如果 `onSilenceDetected()` 被过早触发，会过早发�?`is_final=true`
- 调度服务器收�?`is_final=true` 后，会立�?`finalize` utterance
- 导致音频被过早截�?

---

## 根本原因分析

### 可能的原因组�?

1. **Web端VAD停止发�?+ 静音超时触发**�?
   - VAD 检测到 300ms 静音，停止发送音�?
   - 静音超时机制检测到持续静音，触�?`onSilenceDetected()`
   - `onSilenceDetected()` 发�?`is_final=true`
   - 调度服务器收�?`is_final=true`，立�?`finalize` utterance
   - **结果**：音频被过早截断

2. **调度服务�?pause_ms 超时**�?
   - 用户在说话过程中有超�?`pause_ms`（可能是 2 秒）的停�?
   - 调度服务器检测到暂停超时，触�?`finalize`
   - **结果**：音频被过早截断

3. **VAD �?pause_ms 双重触发**�?
   - VAD 停止发送音频（300ms 静音�?
   - 调度服务器检测到暂停超时�? 秒）
   - 两者都可能触发 `finalize`

---

## 解决方案

### 1. 增加 Web端静音超时时�?

**需要检�?*�?
- `silenceTimeoutMs` 的当前�?
- 如果太短（例�?< 3 秒），需要增�?

**建议**�?
- 增加�?5-10 秒，允许用户有更长的停顿

---

### 2. 增加调度服务�?pause_ms

**需要检�?*�?
- `pause_ms` 的当前�?
- 如果太短（例�?< 3 秒），需要增�?

**建议**�?
- 增加�?5-10 秒，允许用户有更长的停顿

---

### 3. 优化 VAD 静音检�?

**当前配置**�?
- `releaseFrames: 30` (300ms)
- `releaseThreshold: 0.005`

**建议**�?
- 进一步增�?`releaseFrames` �?50-100�?00ms-1000ms�?
- 进一步降�?`releaseThreshold` �?0.003

---

### 4. 禁用或优化静音超时机�?

**如果静音超时机制导致问题**�?
- 可以禁用静音超时机制
- 或者增加超时时�?
- 或者只在用户明确停止录音时才触�?

---

## 下一�?

1. **检查配置�?*�?
   - `silenceTimeoutMs` 的�?
   - `pause_ms` 的�?

2. **调整配置**�?
   - 根据检查结果调整配�?
   - 增加超时时间，允许更长的停顿

3. **测试验证**�?
   - 测试用户说话过程中有停顿的场�?
   - 确认音频不会被过早截�?

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/AUDIO_CONTEXT_ANALYSIS.md` - 音频上下文机制分�?
- `electron_node/services/faster_whisper_vad/docs/AUDIO_TRUNCATION_AND_ASR_QUALITY_ISSUES.md` - 音频截断和ASR识别质量问题



---

## AUDIO_TRUNCATION_FIX.md

# 音频被过早截断修�?

**日期**: 2025-12-25  
**状�?*: �?**已修�?*

---

## 问题现象

1. **调度服务器警�?*�?
   - `ASR结果可能不完整：句子未以标点符号结尾，可能是音频被过早截断`
   - 例如：`asr_text="这个东方飞简查一�?` - 没有标点符号结尾

2. **Web端播放的语音被截�?*�?
   - 播放的语音会丢失半句�?
   - 说明TTS音频可能不完�?

---

## 根本原因

### 1. Web端静音超时机制（主要原因�?

**文件**: `webapp/web-client/src/types.ts`

**当前配置**�?
```typescript
silenceTimeoutMs: 1000, // 1�?
```

**问题**�?
- 如果检测到静音超过 1 秒，会触�?`onSilenceDetected()`
- `onSilenceDetected()` 会发�?`is_final=true`
- 调度服务器收�?`is_final=true` 后，立即 `finalize` utterance
- **结果**：音频被过早截断

**场景示例**�?
```
用户说话�?所以说...（停�?.5秒）...应该发送到节点端就会被处理"
静音检测：1秒后触发 onSilenceDetected()
实际发送："所以说"
ASR结果�?所以说"（不完整，未以标点符号结尾）
```

---

### 2. 调度服务�?pause_ms 超时机制

**文件**: `central_server/scheduler/src/core/config.rs`

**当前配置**�?
```rust
fn default_web_pause_ms() -> u64 {
    2000  // 2�?
}
```

**问题**�?
- 如果 2 秒内没有收到新的 `audio_chunk`，会触发 `finalize`
- 用户在说话过程中经常会有 2-3 秒的停顿
- **结果**：音频被过早截断

---

### 3. VAD静音检测（已修复）

**当前配置**�?
- `releaseFrames: 30` (300ms) �?已修�?
- `releaseThreshold: 0.005` �?已修�?

**�?*�?
- VAD 停止发送音频后，如果静音超时机制检测到持续静音，仍然会触发

---

## 修复方案

### 1. 增加 Web端静音超时时�?

**文件**: `webapp/web-client/src/types.ts`

**修改**�?
```typescript
silenceTimeoutMs: 5000, // �?000ms增加�?000ms�?秒）
```

**理由**�?
- 用户在说话过程中经常会有 1-3 秒的停顿
- 1 秒太短，会导致音频被过早截断
- 增加�?5 秒，允许用户有更长的停顿

---

### 2. 增加调度服务�?pause_ms

**文件**: `central_server/scheduler/src/core/config.rs`

**修改**�?
```rust
fn default_web_pause_ms() -> u64 {
    5000  // �?2000ms 增加�?5000ms�?秒）
}
```

**理由**�?
- 用户在说话过程中经常会有 2-3 秒的停顿
- 2 秒太短，会导致音频被过早截断
- 增加�?5 秒，允许用户有更长的停顿

---

## 修复效果

### 修复�?

**场景**�?
```
用户说话�?所以说...（停�?.5秒）...应该发送到节点端就会被处理"
```

**结果**�?
- Web端：1秒后触发 `onSilenceDetected()`，发�?`is_final=true`
- 调度服务器：收到 `is_final=true`，立�?`finalize` utterance
- ASR结果�?所以说"（不完整�?

---

### 修复�?

**场景**�?
```
用户说话�?所以说...（停�?.5秒）...应该发送到节点端就会被处理"
```

**结果**�?
- Web端：5秒后才会触发 `onSilenceDetected()`（如果持续静音）
- 调度服务器：5秒后才会触发 `finalize`（如果没有收到新的audio_chunk�?
- ASR结果�?所以说应该发送到节点端就会被处理"（完整）

---

## 验证

### 测试场景

1. **场景 1: 用户说话过程中有短暂停顿**
   ```
   用户说话�?所以说...（停�?秒）...应该发送到节点端就会被处理"
   ```
   **期望**：音频不会被截断，ASR结果完整

2. **场景 2: 用户说话过程中有较长停顿**
   ```
   用户说话�?所以说...（停�?秒）...应该发送到节点端就会被处理"
   ```
   **期望**：音频不会被截断，ASR结果完整

3. **场景 3: 用户停止说话**
   ```
   用户说话�?所以说应该发送到节点端就会被处理"（然后停止说话，持续静音6秒）
   ```
   **期望**�?秒后触发 `onSilenceDetected()`，发�?`is_final=true`

---

## 相关修复

### 已修复的问题

1. �?**VAD静音检�?*�?
   - `releaseFrames`: 15 �?30 (150ms �?300ms)
   - `releaseThreshold`: 0.008 �?0.005

2. �?**音频上下�?*�?
   - 已禁用音频上下文（`use_context_buffer: false`�?
   - 只使用文本上下文（`initial_prompt`�?

3. �?**Web端静音超�?*�?
   - `silenceTimeoutMs`: 1000ms �?5000ms

4. �?**调度服务�?pause_ms**�?
   - `pause_ms`: 2000ms �?5000ms

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/AUDIO_CONTEXT_ANALYSIS.md` - 音频上下文机制分�?
- `electron_node/services/faster_whisper_vad/docs/AUDIO_TRUNCATION_ROOT_CAUSE_ANALYSIS.md` - 音频被过早截断的根本原因分析
- `electron_node/services/faster_whisper_vad/docs/AUDIO_TRUNCATION_AND_ASR_QUALITY_ISSUES.md` - 音频截断和ASR识别质量问题



---

## AUDIO_TRUNCATION_AND_ASR_QUALITY_ISSUES.md

# 音频截断和ASR识别质量问题分析

**日期**: 2025-12-25  
**状�?*: 🔍 **问题分析�?*

---

## 用户反馈的问�?

1. **调度服务器警�?*�?
   - `ASR结果可能不完整：句子未以标点符号结尾，可能是音频被过早截断`
   - 例如：`asr_text="这个东方飞简查一�?` - 没有标点符号结尾

2. **Web端播放的语音被截�?*�?
   - 播放的语音会丢失半句�?
   - 说明TTS音频可能不完�?

3. **ASR识别质量非常�?*�?
   - 识别结果：`"所以说预应则发送到几天端就会被处理 然后评并调整"`
   - 完全不知道在说什�?

4. **重复问题**�?
   - 仍然有重复的内容

---

## 问题分析

### 1. VAD静音检测过于敏�?

**当前配置** (`webapp/web-client/src/types.ts`):
```typescript
DEFAULT_SILENCE_FILTER_CONFIG: {
  enabled: true,
  threshold: 0.015,
  attackThreshold: 0.015, // 进入语音：严�?
  releaseThreshold: 0.008, // 退出语音：宽松
  windowMs: 100,
  attackFrames: 3, // 连续3帧语音才开始发�?
  releaseFrames: 15, // 连续15帧静音才停止发送（150ms�?
}
```

**问题**�?
- `releaseFrames: 15` = 150ms 静音就停止发�?
- 如果用户在说话过程中有短暂停顿（超过150ms），VAD会停止发�?
- 这会导致音频被过早截断，ASR结果不完�?

**示例场景**�?
```
用户说话�?所以说...（停�?00ms�?..应该发送到节点端就会被处理"
VAD检测：150ms静音后停止发�?
实际发送："所以说"
ASR结果�?所以说"（不完整，未以标点符号结尾）
```

---

### 2. 音频发送逻辑

**当前逻辑** (`webapp/web-client/src/app.ts`):
```typescript
private onSilenceDetected(): void {
  if (this.stateMachine.getState() === SessionState.INPUT_RECORDING) {
