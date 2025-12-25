# TTS UI 更新时序修复

**日期**: 2025-12-25  
**状态**: ✅ **已修复**

---

## 问题描述

用户反馈：**重新测试后，web端没有显示可播放的音频**

---

## 问题分析

### 根本原因

1. **异步时序问题**
   - `addAudioChunk()` 是异步方法（返回 Promise）
   - `notifyTtsAudioAvailable()` 在 `addAudioChunk()` 调用后立即执行
   - 但此时音频可能还没有真正添加到 `audioBuffers` 数组
   - 导致 `hasPendingAudio()` 返回 `false`，UI 更新时播放按钮仍然被禁用

2. **日志证据**
   - 调度服务器日志显示：`tts_audio_len: 123624`（有TTS音频）
   - 调度服务器日志显示：`"Sending translation result to session (single mode)"`
   - 但 Web 端可能没有正确显示播放按钮

3. **代码流程**
   ```typescript
   // 错误的时序
   this.ttsPlayer.addAudioChunk(message.tts_audio).catch(...);
   this.notifyTtsAudioAvailable(); // 可能在 addAudioChunk 完成之前执行
   ```

---

## 修复方案

### 修改 `translation_result` 消息处理

**文件**: `webapp/web-client/src/app.ts`

**修改内容**:
```typescript
// 处理 TTS 音频（如果存在）
if (message.tts_audio && message.tts_audio.length > 0) {
  console.log('收到 TTS 音频，累积到缓冲区，不自动播放', 'base64长度:', message.tts_audio.length);
  if (this.isInRoom) {
    // 房间模式：使用音频混控器
    this.handleTtsAudioForRoomMode(message.tts_audio);
    // 触发 UI 更新，显示播放按钮和时长
    this.notifyTtsAudioAvailable();
  } else {
    // 单会话模式：累积到 TtsPlayer，不自动播放
    // 等待音频添加到缓冲区后再触发 UI 更新
    this.ttsPlayer.addAudioChunk(message.tts_audio).then(() => {
      console.log('[App] TTS 音频块已添加到缓冲区，触发 UI 更新');
      // 触发 UI 更新，显示播放按钮和时长
      this.notifyTtsAudioAvailable();
    }).catch((error) => {
      console.error('添加 TTS 音频块失败:', error);
    });
  }
}
```

**作用**: 确保 `notifyTtsAudioAvailable()` 在音频真正添加到缓冲区后才执行

---

### 修改 `tts_audio` 消息处理

**文件**: `webapp/web-client/src/app.ts`

**修改内容**:
```typescript
case 'tts_audio':
  // ...
  if (this.isInRoom) {
    // 房间模式：使用音频混控器
    this.handleTtsAudioForRoomMode(message.payload);
    // 触发 UI 更新，显示播放按钮和时长
    this.notifyTtsAudioAvailable();
  } else {
    // 单会话模式：累积到 TtsPlayer，不自动播放
    // 等待音频添加到缓冲区后再触发 UI 更新
    this.ttsPlayer.addAudioChunk(message.payload).then(() => {
      console.log('[App] TTS 音频块已添加到缓冲区（单独消息），触发 UI 更新');
      // 触发 UI 更新，显示播放按钮和时长
      this.notifyTtsAudioAvailable();
    }).catch((error) => {
      console.error('添加 TTS 音频块失败:', error);
    });
  }
  break;
```

**作用**: 确保单独的 `tts_audio` 消息也能正确触发 UI 更新

---

## 修复效果

### 修复前

1. 收到 `translation_result` 消息，包含 TTS 音频
2. 调用 `addAudioChunk()`（异步）
3. **立即调用 `notifyTtsAudioAvailable()`**
4. **此时 `audioBuffers.length === 0`**
5. **`hasPendingAudio()` 返回 `false`**
6. **UI 更新时播放按钮被禁用**

### 修复后

1. 收到 `translation_result` 消息，包含 TTS 音频
2. 调用 `addAudioChunk()`（异步）
3. **等待 `addAudioChunk()` Promise 完成**
4. **此时 `audioBuffers.length > 0`**
5. **`hasPendingAudio()` 返回 `true`**
6. **调用 `notifyTtsAudioAvailable()`**
7. **UI 更新时播放按钮被启用，显示时长**

---

## 测试验证

### 测试步骤

1. 重新编译 Web 客户端
2. 启动 Web 客户端
3. 开始会话并发送语音输入
4. 等待收到翻译结果（包含 TTS 音频）

### 预期结果

1. ✅ 控制台应该显示：`[App] TTS 音频块已添加到缓冲区，触发 UI 更新`
2. ✅ 控制台应该显示：`[App] TTS 音频可用，总时长: X.XX 秒 hasPendingAudio: true`
3. ✅ 控制台应该显示：`[App] 触发 UI 更新（不改变状态），当前状态: input_recording hasPendingAudio: true`
4. ✅ 控制台应该显示：`[UI] UI 更新通知（状态未变化）: { hasPendingAudio: true, duration: X.XX }`
5. ✅ 播放按钮应该被启用
6. ✅ 播放按钮应该显示时长（例如："播放 (3.5s)"）
7. ✅ TTS 音频信息应该显示

### 验证日志

**浏览器控制台应该显示**:
```
收到 TTS 音频，累积到缓冲区，不自动播放 base64长度: 123624
TtsPlayer: 添加音频块，当前状态: input_recording base64长度: 123624
TtsPlayer: 音频块已添加到缓冲区，缓冲区大小: 1 是否正在播放: false 总时长: 3.86 秒
[App] TTS 音频块已添加到缓冲区，触发 UI 更新
[App] TTS 音频可用，总时长: 3.86 秒 hasPendingAudio: true
[App] 触发 UI 更新（不改变状态），当前状态: input_recording hasPendingAudio: true
[UI] UI 更新通知（状态未变化）: { state: 'input_recording', hasPendingAudio: true, duration: 3.86 }
```

---

## 相关文件

- `webapp/web-client/src/app.ts` - 修复 `translation_result` 和 `tts_audio` 消息处理的异步时序问题

---

**修复完成时间**: 2025-12-25  
**状态**: ✅ **已修复**

