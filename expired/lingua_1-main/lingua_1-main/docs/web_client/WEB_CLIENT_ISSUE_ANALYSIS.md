# Web 端代码逻辑检查报告

## 检查项 1：音频数据发送逻辑

### 发现

1. **Web 端使用两种方式发送音频**：
   - `sendAudioChunk(audioData, isFinal)`: 发送 `audio_chunk` 消息（**不包含 `utterance_index`**）
   - `sendUtterance(audioData, utteranceIndex, ...)`: 发送 `utterance` 消息（**包含 `utterance_index`**）

2. **音频发送流程**：
   - `onAudioFrame`: 每 100ms 发送一次 `audio_chunk`（`is_final=false`）
   - `onSilenceDetected`: 发送剩余的 `audio_chunk`，然后发送 `sendFinal()`（`is_final=true`）
   - `sendCurrentUtterance`: 发送 `utterance` 消息，然后发送 `sendFinal()`

3. **VAD 静音过滤**：
   - `Recorder` 使用 VAD 过滤静音片段
   - 如果音频被过滤（静音），`audioFrameCallback` 不会被调用
   - 如果所有音频都被过滤，`audioBuffer` 可能为空

### 代码位置
- `webapp/web-client/src/app.ts:250-290`
- `webapp/web-client/src/recorder.ts:235-324`

---

## 检查项 2：utterance_index 管理逻辑

### 发现

1. **utterance_index 管理**：
   - Web 端维护 `currentUtteranceIndex`（从 0 开始）
   - 只在 `sendUtterance` 时递增 `currentUtteranceIndex`
   - **`sendAudioChunk` 不涉及 `utterance_index`**

2. **问题**：
   - `sendAudioChunk` 发送的 `audio_chunk` 消息**不包含 `utterance_index`**
   - 调度服务器使用自己的 `current_utterance_index` 来管理
   - 如果 Web 端只发送 `audio_chunk`（不发送 `utterance`），调度服务器的 `current_utterance_index` 可能不同步

### 代码位置
- `webapp/web-client/src/app.ts:69, 1201`
- `webapp/web-client/src/websocket_client.ts:592-656`

---

## 检查项 3：VAD 静音过滤对音频数据的影响

### 发现

1. **VAD 过滤逻辑**：
   - `processSilenceFilter`: 如果检测到静音，返回 `false`，不调用 `audioFrameCallback`
   - 如果连续静音帧数 >= `releaseFrames`，停止发送音频
   - 如果连续语音帧数 >= `attackFrames`，开始发送音频

2. **可能的问题**：
   - 如果用户说话时，VAD 误判为静音，音频数据不会被发送
   - 如果 `audioBuffer` 为空，`sendCurrentUtterance` 会跳过发送
   - 如果 `audioBuffer` 为空，`onSilenceDetected` 会发送空的 `audio_chunk`，然后 `sendFinal()`

3. **关键代码**：
   ```typescript
   // app.ts:1203-1205
   } else {
     console.log('音频缓冲区为空，跳过发送');
   }
   ```
   - 如果 `audioBuffer` 为空，**不会发送 `utterance` 消息**
   - 但会发送 `sendFinal()`，这会触发调度服务器的 finalize

### 代码位置
- `webapp/web-client/src/recorder.ts:243-324`
- `webapp/web-client/src/app.ts:1180-1222`

---

## 检查项 4：调度服务器如何处理 audio_chunk

### 发现

1. **调度服务器的处理逻辑**：
   - `handle_audio_chunk`: 使用 `current_utterance_index` 添加音频块
   - `do_finalize`: 检查音频缓冲区，如果为空则返回 `false`
   - 如果 `do_finalize` 返回 `false`，`current_utterance_index` **不会递增**

2. **问题场景**：
   - Web 端发送 `is_final=true` 的 `audio_chunk`，但音频数据为空（被 VAD 过滤）
   - 调度服务器收到 `is_final=true`，调用 `try_finalize`
   - `do_finalize` 检查音频缓冲区，发现为空，返回 `false`
   - `current_utterance_index` **不会递增**
   - 下次收到 `audio_chunk` 时，仍然使用旧的 `utterance_index`

### 代码位置
- `central_server/scheduler/src/websocket/session_actor/actor.rs:496-533`
- `central_server/scheduler/src/websocket/session_actor/actor.rs:216-350`

---

## 根本原因分析

### 问题 1：utterance_index=12, 13 没有被 finalize

**可能的原因**：
1. **VAD 过滤导致音频数据为空**：
   - Web 端的 VAD 过滤了 `utterance_index=12, 13` 的音频数据
   - `audioBuffer` 为空，`sendCurrentUtterance` 跳过发送
   - 但 `sendFinal()` 仍然被调用，触发调度服务器的 finalize
   - 调度服务器的 `do_finalize` 检查音频缓冲区，发现为空，返回 `false`
   - `current_utterance_index` 不会递增，导致 `utterance_index=12, 13` 没有被 finalize

2. **静音检测超时**：
   - 如果用户说话时，VAD 误判为静音，音频数据不会被发送
   - 静音检测超时，触发 `onSilenceDetected`
   - 发送空的 `audio_chunk` + `sendFinal()`
   - 调度服务器 finalize 失败，`current_utterance_index` 不递增

### 问题 2：空结果触发 Gap timeout

**原因**：
- 空结果被正确添加到 `result_queue` 并递增了 `expected_index`
- 但下一个 `utterance_index` 的结果可能还没有返回
- 如果下一个结果确实没有返回，Gap timeout 是合理的

---

## 建议修复方案

### 方案 1：修复 Web 端 VAD 过滤逻辑

**问题**：如果 `audioBuffer` 为空，不应该发送 `sendFinal()`

**修复**：
```typescript
// app.ts:1180-1222
async sendCurrentUtterance(): Promise<void> {
  // ...
  if (this.audioBuffer.length > 0) {
    // 发送音频数据
    await this.wsClient.sendUtterance(...);
    this.currentUtteranceIndex++;
    // 发送 finalize
    this.wsClient.sendFinal();
  } else {
    // 音频缓冲区为空，不发送 finalize
    console.log('音频缓冲区为空，跳过发送和 finalize');
    return; // 不发送 finalize
  }
}
```

### 方案 2：修复调度服务器的 finalize 逻辑

**问题**：如果音频缓冲区为空，应该仍然 finalize（递增 `current_utterance_index`）

**修复**：
```rust
// actor.rs:496-533
async fn do_finalize(...) -> Result<bool, anyhow::Error> {
  // ...
  let audio_data_opt = self.state.audio_buffer.take_combined(...).await;
  
  let audio_data = match audio_data_opt {
    Some(data) if !data.is_empty() => data,
    _ => {
      // 音频缓冲区为空，但仍然 finalize（递增 utterance_index）
      debug!(
        session_id = %self.session_id,
        utterance_index = utterance_index,
        reason = reason,
        "Audio buffer empty, but still finalizing to increment utterance_index"
      );
      // 返回 true，允许 finalize（递增 utterance_index）
      return Ok(true);
    }
  };
  // ...
}
```

### 方案 3：添加更详细的日志

**建议**：
1. 在 Web 端添加日志，记录 `audioBuffer` 为空的情况
2. 在调度服务器添加日志，记录 `do_finalize` 返回 `false` 的情况
3. 在调度服务器添加日志，记录 `current_utterance_index` 的变化

---

## 总结

### 已确认的问题

1. ✅ **Web 端 VAD 过滤逻辑正常**：静音片段被正确过滤
2. ❌ **Web 端 finalize 逻辑有问题**：即使 `audioBuffer` 为空，仍然发送 `sendFinal()`
3. ❌ **调度服务器 finalize 逻辑有问题**：如果音频缓冲区为空，不递增 `current_utterance_index`

### 根本原因

1. **utterance_index=12, 13 没有被 finalize**：
   - Web 端 VAD 过滤了音频数据，`audioBuffer` 为空
   - Web 端仍然发送 `sendFinal()`，触发调度服务器的 finalize
   - 调度服务器的 `do_finalize` 检查音频缓冲区，发现为空，返回 `false`
   - `current_utterance_index` 不会递增，导致 `utterance_index=12, 13` 没有被 finalize

2. **空结果触发 Gap timeout**：
   - 这是正常行为，如果下一个结果确实没有返回，Gap timeout 是合理的

### 建议修复

1. **立即修复**：修改 Web 端，如果 `audioBuffer` 为空，不发送 `sendFinal()`
2. **长期修复**：修改调度服务器，即使音频缓冲区为空，仍然 finalize（递增 `utterance_index`）

