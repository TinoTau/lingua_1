# Web端VAD和音频发送机制分析

## 问题现象

- **Job0-2（第一批，在返回结果之前）**：音频时长5.64秒-15.88秒，ASR识别质量好
- **Job3-20（后续，播放第一个返回结果之后）**：音频时长0.26秒-4.1秒，很多被识别为过短的句子

## 根本原因

### 1. TTS播放时录音器被停止

**代码位置**：`webapp/web-client/src/app.ts:233-248`

```typescript
} else if (newState === SessionState.PLAYING_TTS) {
  // 播放模式：屏蔽麦克风输入，避免声学回响
  if (this.sessionManager.getIsSessionActive()) {
    // 会话进行中：停止录音（不关闭），屏蔽输入
    console.log('[App] 播放模式：正在屏蔽麦克风输入，避免声学回响');
    this.recorder.stop();  // ⚠️ 停止录音器
    console.log('[App] ✅ 播放模式：已屏蔽麦克风输入，避免声学回响', {
      isRecording: this.recorder.getIsRecording(),
    });
  }
}
```

**问题**：
- 当TTS播放开始时，状态机切换到`PLAYING_TTS`
- 录音器被停止（`recorder.stop()`）
- 在播放期间，用户的语音无法被录制

### 2. TTS播放结束后录音器恢复延迟

**代码位置**：`webapp/web-client/src/app.ts:252-279`

```typescript
// 从播放状态回到录音状态时，恢复录音
if (newState === SessionState.INPUT_RECORDING && oldState === SessionState.PLAYING_TTS) {
  if (this.sessionManager.getIsSessionActive()) {
    // 会话进行中：恢复录音
    console.log('[App] 从播放状态回到录音状态，正在恢复录音...');
    if (!this.recorder.getIsRecording()) {
      // 延迟一小段时间，确保状态转换完成
      const restoreTimeout = setTimeout(() => {
        this.recorder.start().then(() => {
          console.log('[App] ✅ 已恢复录音，可以继续说话');
        }).catch((error) => {
          console.error('[App] ❌ 恢复录音失败:', error);
          // 重试机制...
        });
      }, 200);  // ⚠️ 200ms延迟
    }
  }
}
```

**问题**：
- TTS播放结束后，状态机切换回`INPUT_RECORDING`
- 录音器恢复有200ms延迟
- 如果用户在这200ms内开始说话，音频可能被丢失或切分成很小的块

### 3. VAD状态重置

**代码位置**：`webapp/web-client/src/recorder.ts:213-225`

```typescript
stop(): void {
  if (!this.isRecording) {
    console.log('[Recorder] 录音器未运行，跳过停止');
    return;
  }

  console.log('[Recorder] 正在停止录音器...');
  this.isRecording = false;
  this.stopSilenceDetection();
  // 重置静音过滤状态
  this.consecutiveVoiceFrames = 0;
  this.consecutiveSilenceFrames = 0;
  this.isSendingAudio = false;  // ⚠️ 重置VAD状态
  console.log('[Recorder] ✅ 录音器已停止');
}
```

**问题**：
- 当录音器停止时，VAD状态被重置（`isSendingAudio = false`）
- 当录音器恢复时，VAD需要重新检测语音活动
- 这可能导致：
  - 用户说话时，VAD还没有检测到语音活动
  - 音频被切分成很小的块（因为VAD状态重置，需要重新"攻击"）

### 4. VAD攻击/释放机制

**代码位置**：`webapp/web-client/src/recorder.ts:262-343`

```typescript
private processSilenceFilter(audioData: Float32Array): boolean {
  // 计算 RMS 值
  const rms = this.calculateRMS(audioData);
  
  // 获取阈值（Attack/Release 使用不同阈值）
  const attackThreshold = this.silenceFilterConfig.attackThreshold ?? this.silenceFilterConfig.threshold;
  const releaseThreshold = this.silenceFilterConfig.releaseThreshold ?? this.silenceFilterConfig.threshold;
  
  // 判断当前帧是否为语音
  const isVoice = rms >= (this.isSendingAudio ? releaseThreshold : attackThreshold);
  
  if (isVoice) {
    // 检测到语音
    this.consecutiveVoiceFrames++;
    this.consecutiveSilenceFrames = 0;
    
    // 如果连续 N 帧语音，开始发送（避免误触发）
    if (!this.isSendingAudio && this.consecutiveVoiceFrames >= this.silenceFilterConfig.attackFrames) {
      this.isSendingAudio = true;  // ⚠️ 需要连续N帧才能开始发送
      console.log('[VAD] ✅ 检测到语音，开始发送音频');
    }
    
    return this.isSendingAudio;
  }
  // ...
}
```

**问题**：
- VAD需要连续`attackFrames`帧语音才能开始发送
- 如果录音器刚恢复，VAD状态是`isSendingAudio = false`
- 用户说话时，需要等待`attackFrames`帧才能开始发送
- 这可能导致：
  - 用户说话的前几帧被丢弃
  - 音频被切分成很小的块

## 解决方案建议

### 方案1：播放TTS时不停止录音器（推荐）

**优点**：
- 避免录音器停止/恢复的延迟
- 避免VAD状态重置
- 保持音频流的连续性

**实现**：
- 修改`app.ts`，在`PLAYING_TTS`状态时不停止录音器
- 使用回声消除（echo cancellation）来避免声学回响
- 或者，在播放TTS时继续录音，但标记音频来源，避免将TTS音频误识别为用户语音

### 方案2：优化录音器恢复机制

**实现**：
- 减少恢复延迟（从200ms减少到50ms或更少）
- 在恢复时，保持VAD状态（不重置`isSendingAudio`）
- 或者，在恢复时，立即开始发送音频（跳过VAD攻击阶段）

### 方案3：改进VAD攻击机制

**实现**：
- 在录音器恢复后，降低`attackFrames`阈值
- 或者，在录音器恢复后，立即设置`isSendingAudio = true`（假设用户可能立即说话）

## 推荐方案

**推荐方案1**：播放TTS时不停止录音器，使用回声消除来避免声学回响。

**理由**：
1. 保持音频流的连续性，避免音频被切分成很小的块
2. 避免VAD状态重置，保持VAD检测的连续性
3. 现代浏览器的`getUserMedia`已经支持回声消除（`echoCancellation: true`）

**实现步骤**：
1. 修改`app.ts`，在`PLAYING_TTS`状态时不调用`recorder.stop()`
2. 确保`getUserMedia`配置中启用了`echoCancellation: true`（已在`recorder.ts:115`中启用）
3. 测试验证：播放TTS时，用户说话是否会被正确录制，且不会被TTS音频干扰
