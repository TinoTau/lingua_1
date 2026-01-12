# 静音超时和手动发送修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 修复内容

### 1. 将两个超时配置改为 3 秒

**修改文件**：
- `webapp/web-client/src/types.ts`
- `central_server/scheduler/src/core/config.rs`

**修改内容**：
- `silenceTimeoutMs`: 从 5000ms 减少到 3000ms（3秒）
- `pause_ms`: 从 5000ms 减少到 3000ms（3秒）

**原因**：
- 用户反馈：3 秒也可以接受，可以减少等待时间
- 两个超时保持一致，避免不一致导致的截断问题

---

### 2. 用户手动点击发送按钮时立即触发 finalize

**修改文件**：
- `webapp/web-client/src/app.ts`

**修改内容**：
- 在 `sendCurrentUtterance()` 方法中，除了发送 `utterance` 消息，还调用 `sendFinal()` 发送 `is_final=true` 的 `audio_chunk` 消息

**原因**：
- 当用户手动点击发送按钮时，应该立即触发 finalize，而不是等待超时
- 确保调度服务器立即 finalize 当前正在累积的 `audio_chunk`

**修改前**：
```typescript
async sendCurrentUtterance(): Promise<void> {
  // ...
  if (this.audioBuffer.length > 0) {
    // 发送 Utterance 消息
    await this.wsClient.sendUtterance(...);
    this.currentUtteranceIndex++;
  }
  // 没有发送 is_final=true
}
```

**修改后**：
```typescript
async sendCurrentUtterance(): Promise<void> {
  // ...
  if (this.audioBuffer.length > 0) {
    // 发送 Utterance 消息
    await this.wsClient.sendUtterance(...);
    this.currentUtteranceIndex++;
  }
  
  // 修复：用户手动点击发送按钮时，立即触发 finalize
  this.wsClient.sendFinal();
  console.log('已发送 is_final=true，触发调度服务器立即 finalize');
}
```

---

## 工作流程

### 用户手动点击发送按钮

```
用户点击发送按钮
  ↓
sendCurrentUtterance() 被调用
  ↓
1. 发送 Utterance 消息（完整的音频，manual_cut=true）
  ↓
2. 发送 is_final=true 的 audio_chunk 消息（触发 finalize）
  ↓
调度服务器收到 is_final=true
  ↓
立即触发 finalize（不等待 pause_ms 超时）
  ↓
发送完整的 utterance 给节点端
```

### 自动静音超时

```
用户停止说话
  ↓
Web端静音检测：持续静音 3 秒
  ↓
触发 onSilenceDetected()
  ↓
发送 is_final=true 的 audio_chunk 消息
  ↓
调度服务器收到 is_final=true
  ↓
立即触发 finalize
  ↓
发送完整的 utterance 给节点端
```

### 调度服务器 pause_ms 超时（网络异常保护）

```
调度服务器收到 audio_chunk
  ↓
记录时间戳，重置暂停计时
  ↓
3 秒内没有收到新的 audio_chunk
  ↓
触发 finalize（网络异常保护）
  ↓
发送完整的 utterance 给节点端
```

---

## 配置总结

### 当前配置

1. **VAD静音检测**：
   - `releaseFrames: 30` (300ms)
   - `releaseThreshold: 0.005`

2. **Web端静音超时**：
   - `silenceTimeoutMs: 3000` (3秒) ✅ 已修复

3. **调度服务器 pause_ms**：
   - `pause_ms: 3000` (3秒) ✅ 已修复

4. **手动发送按钮**：
   - 立即发送 `is_final=true` ✅ 已修复

---

## 相关文档

- `electron_node/services/faster_whisper_vad/docs/SILENCE_DETECTION_MECHANISMS_EXPLANATION.md` - 静音检测机制详解

