# 音频被过早截断修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题现象

1. **调度服务器警告**：
   - `ASR结果可能不完整：句子未以标点符号结尾，可能是音频被过早截断`
   - 例如：`asr_text="这个东方飞简查一下"` - 没有标点符号结尾

2. **Web端播放的语音被截断**：
   - 播放的语音会丢失半句话
   - 说明TTS音频可能不完整

---

## 根本原因

### 1. Web端静音超时机制（主要原因）

**文件**: `webapp/web-client/src/types.ts`

**当前配置**：
```typescript
silenceTimeoutMs: 1000, // 1秒
```

**问题**：
- 如果检测到静音超过 1 秒，会触发 `onSilenceDetected()`
- `onSilenceDetected()` 会发送 `is_final=true`
- 调度服务器收到 `is_final=true` 后，立即 `finalize` utterance
- **结果**：音频被过早截断

**场景示例**：
```
用户说话："所以说...（停顿1.5秒）...应该发送到节点端就会被处理"
静音检测：1秒后触发 onSilenceDetected()
实际发送："所以说"
ASR结果："所以说"（不完整，未以标点符号结尾）
```

---

### 2. 调度服务器 pause_ms 超时机制

**文件**: `central_server/scheduler/src/core/config.rs`

**当前配置**：
```rust
fn default_web_pause_ms() -> u64 {
    2000  // 2秒
}
```

**问题**：
- 如果 2 秒内没有收到新的 `audio_chunk`，会触发 `finalize`
- 用户在说话过程中经常会有 2-3 秒的停顿
- **结果**：音频被过早截断

---

### 3. VAD静音检测（已修复）

**当前配置**：
- `releaseFrames: 30` (300ms) ✅ 已修复
- `releaseThreshold: 0.005` ✅ 已修复

**但**：
- VAD 停止发送音频后，如果静音超时机制检测到持续静音，仍然会触发

---

## 修复方案

### 1. 增加 Web端静音超时时间

**文件**: `webapp/web-client/src/types.ts`

**修改**：
```typescript
silenceTimeoutMs: 5000, // 从1000ms增加到5000ms（5秒）
```

**理由**：
- 用户在说话过程中经常会有 1-3 秒的停顿
- 1 秒太短，会导致音频被过早截断
- 增加到 5 秒，允许用户有更长的停顿

---

### 2. 增加调度服务器 pause_ms

**文件**: `central_server/scheduler/src/core/config.rs`

**修改**：
```rust
fn default_web_pause_ms() -> u64 {
    5000  // 从 2000ms 增加到 5000ms（5秒）
}
```

**理由**：
- 用户在说话过程中经常会有 2-3 秒的停顿
- 2 秒太短，会导致音频被过早截断
- 增加到 5 秒，允许用户有更长的停顿

---

## 修复效果

### 修复前

**场景**：
```
用户说话："所以说...（停顿1.5秒）...应该发送到节点端就会被处理"
```

**结果**：
- Web端：1秒后触发 `onSilenceDetected()`，发送 `is_final=true`
- 调度服务器：收到 `is_final=true`，立即 `finalize` utterance
- ASR结果："所以说"（不完整）

---

### 修复后

**场景**：
```
用户说话："所以说...（停顿1.5秒）...应该发送到节点端就会被处理"
```

**结果**：
- Web端：5秒后才会触发 `onSilenceDetected()`（如果持续静音）
- 调度服务器：5秒后才会触发 `finalize`（如果没有收到新的audio_chunk）
- ASR结果："所以说应该发送到节点端就会被处理"（完整）

---

## 验证

### 测试场景

1. **场景 1: 用户说话过程中有短暂停顿**
   ```
   用户说话："所以说...（停顿2秒）...应该发送到节点端就会被处理"
   ```
   **期望**：音频不会被截断，ASR结果完整

2. **场景 2: 用户说话过程中有较长停顿**
   ```
   用户说话："所以说...（停顿4秒）...应该发送到节点端就会被处理"
   ```
   **期望**：音频不会被截断，ASR结果完整

3. **场景 3: 用户停止说话**
   ```
   用户说话："所以说应该发送到节点端就会被处理"（然后停止说话，持续静音6秒）
   ```
   **期望**：5秒后触发 `onSilenceDetected()`，发送 `is_final=true`

---

## 相关修复

### 已修复的问题

1. ✅ **VAD静音检测**：
   - `releaseFrames`: 15 → 30 (150ms → 300ms)
   - `releaseThreshold`: 0.008 → 0.005

2. ✅ **音频上下文**：
   - 已禁用音频上下文（`use_context_buffer: false`）
   - 只使用文本上下文（`initial_prompt`）

3. ✅ **Web端静音超时**：
   - `silenceTimeoutMs`: 1000ms → 5000ms

4. ✅ **调度服务器 pause_ms**：
   - `pause_ms`: 2000ms → 5000ms

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/AUDIO_CONTEXT_ANALYSIS.md` - 音频上下文机制分析
- `electron_node/services/faster_whisper_vad/docs/AUDIO_TRUNCATION_ROOT_CAUSE_ANALYSIS.md` - 音频被过早截断的根本原因分析
- `electron_node/services/faster_whisper_vad/docs/AUDIO_TRUNCATION_AND_ASR_QUALITY_ISSUES.md` - 音频截断和ASR识别质量问题

