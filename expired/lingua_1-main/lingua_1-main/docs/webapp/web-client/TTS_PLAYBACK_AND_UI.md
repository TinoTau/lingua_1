# TTS 播放与 UI 更新

**状态**: ✅ **已实现**

## 概述

Web客户端实现了TTS音频播放功能，包括音频缓冲区管理、UI状态更新、以及播放控制。本文档描述了实现细节和问题修复过程。

## 核心功能

### 1. TTS 播放器

**文件**: `webapp/web-client/src/tts_player.ts`

**功能**:
- 流式音频播放（PCM16/Opus）
- 音频缓冲区管理
- 播放状态跟踪
- 播放倍速控制
- 内存管理（自动清理已播放音频）

**关键方法**:
- `addAudioChunk()`: 添加音频块到缓冲区
- `startPlayback()`: 开始播放
- `pausePlayback()`: 暂停播放
- `resumePlayback()`: 恢复播放
- `hasPendingAudio()`: 检查是否有待播放音频

### 2. UI 状态更新

**文件**: `webapp/web-client/src/app.ts`, `webapp/web-client/src/ui/renderers.ts`

**功能**:
- 音频可用时更新播放按钮状态
- 显示音频时长
- 播放状态可视化

## 实现细节

### 音频缓冲区管理

```typescript
interface AudioBufferWithIndex {
  audio: Float32Array;
  utteranceIndex: number;
}
```

- 音频块与 `utterance_index` 关联
- 播放时边播放边清理，减少内存占用
- 支持最大缓存时长限制

### UI 更新机制

1. **状态机通知**: 使用 `notifyUIUpdate()` 在不改变状态时触发UI更新
2. **异步处理**: 等待音频添加到缓冲区后再触发UI更新
3. **状态检查**: 在 `INPUT_RECORDING` 状态时更新播放按钮

## 问题修复历史

### 问题1: TTS 音频添加后 UI 未更新

**症状**: 收到TTS音频后，播放按钮仍然被禁用。

**原因**: 
- `addAudioChunk()` 是异步方法
- `notifyTtsAudioAvailable()` 在音频添加完成前执行
- UI只在状态变化时更新，添加音频时状态未变化

**修复**:
- 在 `addAudioChunk().then()` 中调用 `notifyTtsAudioAvailable()`
- 添加 `stateMachine.notifyUIUpdate()` 方法
- 在音频添加完成后触发UI更新

### 问题2: 播放按钮状态不正确

**症状**: 有音频但播放按钮显示为禁用状态。

**原因**:
- UI更新时 `hasPendingAudio()` 返回 `false`
- 状态机只在状态变化时触发回调

**修复**:
- 实现 `notifyUIUpdate()` 方法，允许不改变状态时触发回调
- 在 `INPUT_RECORDING` 状态时主动触发UI更新
- 改进UI更新逻辑，重新检查 `hasPendingAudio()`

### 问题3: 异步时序问题

**症状**: 音频已添加但UI未及时更新。

**原因**:
- `addAudioChunk()` 是异步的，但UI更新在调用后立即执行
- 此时音频可能还未真正添加到缓冲区

**修复**:
- 使用 Promise 链确保时序正确
- 在 `addAudioChunk().then()` 中触发UI更新
- 添加日志便于调试

## 工作流程

### 收到翻译结果

1. 收到 `translation_result` 消息，包含 TTS 音频
2. 调用 `addAudioChunk()` 添加音频（异步）
3. 等待 Promise 完成
4. 调用 `notifyTtsAudioAvailable()`
5. 触发 `stateMachine.notifyUIUpdate()`
6. UI 回调被触发，检查 `hasPendingAudio()`
7. 更新播放按钮状态和时长显示

### 播放控制

1. 用户点击播放按钮
2. `startPlayback()` 开始播放
3. 状态切换到 `PLAYING_TTS`
4. 播放音频块，边播放边清理
5. 播放完成，状态切回 `INPUT_RECORDING`

## 调试指南

### 检查音频状态

```javascript
// 浏览器控制台
window.app.ttsPlayer.audioBuffers.length
window.app.ttsPlayer.hasPendingAudio()
window.app.ttsPlayer.getTotalDuration()
```

### 检查应用状态

```javascript
window.app.stateMachine.getState()
window.app.hasPendingTtsAudio()
window.app.getTtsAudioDuration()
```

### 手动触发UI更新

```javascript
window.app.stateMachine.notifyUIUpdate()
```

### 预期日志

```
收到 TTS 音频，累积到缓冲区，不自动播放 base64长度: 123624
TtsPlayer: 添加音频块，当前状态: input_recording
TtsPlayer: 音频块已添加到缓冲区，缓冲区大小: 1 总时长: 3.86 秒
[App] TTS 音频块已添加到缓冲区，触发 UI 更新
[App] TTS 音频可用，总时长: 3.86 秒 hasPendingAudio: true
[App] 触发 UI 更新（不改变状态），当前状态: input_recording
[UI] UI 更新通知（状态未变化）: { hasPendingAudio: true, duration: 3.86 }
```

## 常见问题

### Q: 播放按钮仍然被禁用

**检查**:
1. `hasPendingAudio()` 是否返回 `true`
2. `audioBuffers.length` 是否 > 0
3. 当前状态是否为 `INPUT_RECORDING`
4. UI更新是否被触发

### Q: 音频时长显示不正确

**检查**:
1. `getTotalDuration()` 返回值
2. 音频是否成功解码
3. 采样率是否正确（默认16000Hz）

### Q: 播放时没有声音

**检查**:
1. 浏览器音频权限
2. AudioContext 是否正常初始化
3. 音频格式是否支持（PCM16/Opus）
4. 浏览器控制台是否有错误

## 相关文档

- [TTS 播放器实现](../src/tts_player.ts)
- [状态机实现](../src/state_machine.ts)
- [UI 渲染器](../src/ui/renderers.ts)

