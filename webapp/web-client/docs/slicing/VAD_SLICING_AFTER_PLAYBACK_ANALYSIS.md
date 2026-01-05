# 播放完成后VAD切片问题分析

## 问题现象

- **第一次输入语音**：音频完整（5.64秒-15.88秒），ASR识别质量好
- **播放完成后输入语音**：音频被切分成很小的块（0.26秒-4.1秒），ASR识别质量差

## 根本原因分析

### 1. VAD攻击机制（Attack Phase）

**代码位置**：`webapp/web-client/src/recorder.ts:284-291`

```typescript
// 如果连续 N 帧语音，开始发送（避免误触发）
if (!this.isSendingAudio && this.consecutiveVoiceFrames >= this.silenceFilterConfig.attackFrames) {
  this.isSendingAudio = true;
  console.log('[VAD] ✅ 检测到语音，开始发送音频', {
    consecutiveVoiceFrames: this.consecutiveVoiceFrames,
  });
}
```

**配置**：
- `attackFrames: 3` - 需要连续3帧语音才开始发送
- `windowMs: 100` - 每帧100ms
- **总延迟**：3帧 × 100ms = **300ms**

**问题**：
- 当`isSendingAudio = false`时，需要连续3帧（300ms）语音才能开始发送
- 在这300ms内，即使检测到语音，也不会发送（`return this.isSendingAudio`，即`return false`）

### 2. 录音器恢复时的状态重置

**代码位置**：`webapp/web-client/src/recorder.ts:190-196`

```typescript
this.isRecording = true;
this.silenceStartTime = 0;
// 重置静音过滤状态
this.consecutiveVoiceFrames = 0;
this.consecutiveSilenceFrames = 0;
this.isSendingAudio = false;  // ⚠️ 重置VAD状态
this.frameCounter = 0;
```

**问题**：
- 录音器恢复时，VAD状态被重置：`isSendingAudio = false`
- 需要重新"攻击"（连续3帧语音）才能开始发送
- 用户说话的前300ms可能被丢弃

### 3. 录音器恢复延迟

**代码位置**：`webapp/web-client/src/app.ts:261-283`

```typescript
const restoreTimeout = setTimeout(() => {
  this.recorder.start().then(() => {
    console.log('[App] ✅ 已恢复录音，可以继续说话');
  });
}, 200);  // ⚠️ 200ms延迟
```

**问题**：
- 录音器恢复有200ms延迟
- 如果用户在这200ms内开始说话，音频帧会被丢弃（`isRecording = false`）

### 4. 为什么第一次输入正常？

**第一次输入时**：
1. 录音器已经启动，`isRecording = true`
2. VAD状态是初始状态（`isSendingAudio = false`）
3. 用户开始说话，VAD需要"攻击"（连续3帧）
4. **但是**：用户可能已经持续说话一段时间，所以能够满足`attackFrames`的要求
5. 一旦开始发送，VAD状态变为`isSendingAudio = true`，使用更宽松的`releaseThreshold`（0.003）
6. 用户继续说话，音频连续发送

**播放完成后输入时**：
1. 录音器被停止（`isRecording = false`），VAD状态被重置
2. TTS播放完成，状态机切换回`INPUT_RECORDING`
3. 录音器恢复有200ms延迟
4. 如果用户在这200ms内开始说话，音频帧被丢弃
5. 录音器恢复后，VAD状态是`isSendingAudio = false`
6. 用户说话，VAD需要重新"攻击"（连续3帧 = 300ms）
7. **关键问题**：如果用户说话很短（比如只有1-2秒），然后停顿
   - VAD检测到静音（`releaseFrames: 20` = 200ms），停止发送
   - 导致音频被切分成很小的块（只有300ms-2秒的有效音频）

### 5. 为什么音频会被切分成很小的块？

**可能的原因**：

1. **VAD攻击延迟**：
   - 录音器恢复后，VAD需要300ms才能开始发送
   - 如果用户说话很短，只有1-2秒，然后停顿
   - VAD检测到静音（200ms），停止发送
   - 导致音频被切分成很小的块（只有300ms-2秒的有效音频）

2. **VAD释放机制**：
   - `releaseFrames: 20` = 200ms静音就停止发送
   - 如果用户在说话过程中有短暂的停顿（比如换气、思考）
   - VAD可能误判为静音，停止发送
   - 然后用户继续说话，VAD重新"攻击"，但只发送了很短的一段

3. **录音器恢复延迟**：
   - 200ms延迟 + 300ms攻击延迟 = 500ms总延迟
   - 如果用户在这500ms内开始说话，前500ms的音频可能被丢失或切分

## 解决方案

### 方案1：录音器恢复时不重置VAD状态（推荐）

**实现**：
- 修改`recorder.start()`，添加一个参数`preserveVadState: boolean`
- 如果`preserveVadState = true`，不重置VAD状态（`isSendingAudio`）
- 在录音器恢复时，使用`preserveVadState = true`

**优点**：
- 保持VAD状态的连续性
- 避免重新"攻击"延迟
- 用户说话时能够立即发送

**缺点**：
- 如果录音器停止时间很长，VAD状态可能不准确

### 方案2：减少VAD攻击延迟

**实现**：
- 减少`attackFrames`（从3帧减少到1-2帧）
- 或者，在录音器恢复后，立即设置`isSendingAudio = true`（假设用户可能立即说话）

**优点**：
- 减少攻击延迟
- 用户说话时能够更快开始发送

**缺点**：
- 可能增加误触发（噪音被误判为语音）

### 方案3：优化录音器恢复机制

**实现**：
- 减少恢复延迟（从200ms减少到50ms或更少）
- 或者，在状态切换时立即恢复录音器（不使用延迟）

**优点**：
- 减少音频丢失
- 用户说话时能够更快被录制

**缺点**：
- 可能影响状态转换的稳定性

### 方案4：改进VAD释放机制

**实现**：
- 增加`releaseFrames`（从20帧增加到30-40帧）
- 或者，在录音器恢复后的一段时间内，使用更宽松的释放阈值

**优点**：
- 减少误判为静音的情况
- 保持音频的连续性

**缺点**：
- 可能增加静音片段的发送

## 推荐方案

**推荐方案1 + 方案3**：
1. 录音器恢复时不重置VAD状态（保持`isSendingAudio`）
2. 减少录音器恢复延迟（从200ms减少到50ms）

**理由**：
1. 保持VAD状态的连续性，避免重新"攻击"延迟
2. 减少音频丢失，用户说话时能够更快被录制
3. 保持音频流的连续性，避免被切分成很小的块
