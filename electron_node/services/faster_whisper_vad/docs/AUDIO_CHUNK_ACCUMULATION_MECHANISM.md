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

